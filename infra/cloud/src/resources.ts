// @effect-diagnostics anyUnknownInErrorContext:off - Alchemy resources expose framework-owned any requirements.
/**
 * The cloud stack's shared resources. Each is an Effect that declares its
 * resources when yielded, so the stack and the API's props can both yield
 * them and get the same instances.
 */
import * as ecs from "@distilled.cloud/aws/ecs";
import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

const ELECTRIC_IMAGE = "electricsql/electric:1.8.1";
// Graviton: matches Apple Silicon locally and is the cheaper Fargate platform.
// Electric's Erlang VM also crashes under x86 emulation on Apple Silicon.
export const ARM64 = { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" } as const;

// Local Postgres runs in Docker rather than emulated RDS, which ignores
// parameter groups (Electric needs wal_level=logical). Containers reach it
// through the host, so the port must be free on the host's loopback too: the
// POC's Postgres listens on 54329 and would silently take the connections.
const LOCAL_POSTGRES = {
  port: Number(process.env.CLOUD_POSTGRES_PORT ?? 54341),
  user: "mercurian",
  password: "mercurian",
  database: "mercurian_cloud",
};

/** The database URL as containers see it. */
export const DatabaseUrl = Effect.gen(function* () {
  const image = yield* Docker.RemoteImage("PostgresImage", {
    name: "postgres",
    tag: "17-alpine",
    alwaysPull: false,
  });
  const postgres = yield* Docker.Container("Postgres", {
    image,
    command: ["postgres", "-c", "wal_level=logical"],
    environment: {
      POSTGRES_DB: LOCAL_POSTGRES.database,
      POSTGRES_USER: LOCAL_POSTGRES.user,
      POSTGRES_PASSWORD: LOCAL_POSTGRES.password,
    },
    ports: [{ external: LOCAL_POSTGRES.port, internal: 5432 }],
    healthcheck: {
      cmd: [`pg_isready -U ${LOCAL_POSTGRES.user} -d ${LOCAL_POSTGRES.database}`],
      interval: "2 seconds",
      timeout: "5 seconds",
      retries: 20,
    },
    start: true,
  });
  // Derived from the container so everything that connects waits for it.
  return Output.map(
    postgres.name,
    () =>
      `postgresql://${LOCAL_POSTGRES.user}:${LOCAL_POSTGRES.password}@host.docker.internal:${LOCAL_POSTGRES.port}/${LOCAL_POSTGRES.database}`,
  );
});

export const Cluster = AWS.ECS.Cluster("Cluster", {});

/**
 * The API's load balancer, declared before the API so its address can be the
 * API's own public URL (`AUTH_URL`): Better Auth needs a fixed origin, and the
 * emulator's load balancer rewrites `Host`, so it can't infer one.
 */
export const ApiIngress = Effect.gen(function* () {
  const loadBalancer = yield* AWS.ELBv2.LoadBalancer("ApiLoadBalancer", {});
  const listener = yield* AWS.ELBv2.Listener("ApiListener", {
    loadBalancerArn: loadBalancer.loadBalancerArn,
    port: 80,
    defaultActions: [{ type: "fixedResponse", statusCode: "404", messageBody: "no route" }],
  });
  return {
    listener,
    url: Output.map(loadBalancer.dnsName, (dnsName) => `http://${dnsName}`),
  };
});

/**
 * The sender identity. Mail lands in the emulator's mailbox at
 * http://localhost:4566/_aws/ses. The emulator can't verify a domain (no DNS),
 * so dev verifies one address per stage: the emulator is shared, and only one
 * stack can own an identity. Deploys will verify astrolabe.sh with DKIM.
 */
export const MailIdentity = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  return yield* AWS.SES.EmailIdentity("MailIdentity", {
    emailIdentity: `login+${stage}@astrolabe.sh`,
  });
});

/**
 * Runs the migration task to completion and fails the deploy unless it exits
 * 0. Its input carries the task definition revision, so it re-runs whenever
 * the image (and with it the migrations) changes.
 */
const RunMigrations = Alchemy.Action(
  "RunMigrations",
  (input: { cluster: string; taskDefinition: string }) =>
    Effect.gen(function* () {
      const started = yield* ecs.runTask({
        cluster: input.cluster,
        taskDefinition: input.taskDefinition,
        count: 1,
        launchType: "FARGATE",
      });
      const taskArn = started.tasks?.[0]?.taskArn;
      if (!taskArn) {
        const reasons = started.failures?.map((failure) => failure.reason).join(", ");
        return yield* Effect.die(`migrations did not start: ${reasons ?? "no task returned"}`);
      }
      const task = yield* ecs.describeTasks({ cluster: input.cluster, tasks: [taskArn] }).pipe(
        Effect.map((described) => described.tasks?.[0]),
        Effect.repeat({
          until: (current) => current?.lastStatus === "STOPPED",
          schedule: Schedule.spaced("2 seconds"),
        }),
        Effect.timeout("10 minutes"),
      );
      const exitCode = task?.containers?.[0]?.exitCode;
      if (exitCode !== 0) {
        return yield* Effect.die(
          `migrations exited with ${exitCode ?? "no exit code"} (${task?.stoppedReason ?? "no reason"})`,
        );
      }
      return { taskDefinition: input.taskDefinition };
    }),
);

/**
 * The migration task (plain Node, built from Dockerfile) and its run. Yields
 * the migrated task definition, which anything that needs the schema waits on.
 */
export const Migrations = Effect.gen(function* () {
  const cluster = yield* Cluster;
  const build = yield* Command.Build("MigrateBuild", {
    command: "vp run build",
    cwd: ".",
    outdir: "dist/migrate",
    memo: {
      include: [
        "src/migrate.ts",
        "Dockerfile",
        "package.json",
        "../../apps/cloud/migrations/**",
        "../relay/migrations/**",
      ],
    },
  });
  const migrate = yield* AWS.ECS.Task("Migrate", {
    context: build.outdir,
    dockerfile: "Dockerfile",
    runtimePlatform: ARM64,
    env: { DATABASE_URL: yield* DatabaseUrl },
  });
  const migrated = yield* RunMigrations({
    cluster: cluster.clusterArn,
    taskDefinition: migrate.taskDefinitionArn,
  });
  return migrated.taskDefinition;
});

export const Electric = Effect.gen(function* () {
  return yield* AWS.ECS.Service("Electric", {
    cluster: yield* Cluster,
    image: ELECTRIC_IMAGE,
    port: 3000,
    desiredCount: 1,
    runtimePlatform: ARM64,
    loadBalancer: { health: { "3000/http": { path: "/v1/health" } } },
    cpu: 512,
    memory: 1024,
    env: {
      DATABASE_URL: yield* DatabaseUrl,
      // Only the API reaches Electric, so the shared secret stays server-side.
      ELECTRIC_INSECURE: "true",
      // Live shape requests pass through the API, which runs on Bun; Bun closes
      // a request idle for 10s, so Electric answers a quiet long-poll (20s by
      // default) before then and the client simply polls again.
      ELECTRIC_LONG_POLL_TIMEOUT: "8000",
    },
  });
});
