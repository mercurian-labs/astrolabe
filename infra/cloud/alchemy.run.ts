// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off - Alchemy provider helpers expose framework-owned any requirements.
import * as ecs from "@distilled.cloud/aws/ecs";
import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import { ALCHEMY_DEV } from "alchemy/Phase";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

const ELECTRIC_IMAGE = "electricsql/electric:1.8.1";
const MAIL_ADDRESS = "login@mercurian.app";
const MAIL_FROM = `Mercurian <${MAIL_ADDRESS}>`;
// Graviton: matches Apple Silicon locally and is the cheaper Fargate platform.
// Electric's Erlang VM also crashes under x86 emulation on Apple Silicon.
const ARM64 = { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" } as const;

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

export default Alchemy.Stack(
  "MercurianCloud",
  {
    providers: Layer.mergeAll(AWS.providers(), Docker.providers()),
    // Deploys will keep state in Cloudflare next to the relay's, so stacks can
    // reference each other; local dev needs no account at all.
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    if (!(yield* ALCHEMY_DEV)) {
      return yield* Effect.die("MercurianCloud only runs under `alchemy dev` so far.");
    }

    const postgresImage = yield* Docker.RemoteImage("PostgresImage", {
      name: "postgres",
      tag: "17-alpine",
      alwaysPull: false,
    });
    const postgres = yield* Docker.Container("Postgres", {
      image: postgresImage,
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
    const databaseUrl = Output.map(
      postgres.name,
      () =>
        `postgresql://${LOCAL_POSTGRES.user}:${LOCAL_POSTGRES.password}@host.docker.internal:${LOCAL_POSTGRES.port}/${LOCAL_POSTGRES.database}`,
    );

    const cluster = yield* AWS.ECS.Cluster("Cluster", {});
    // Mail lands in the emulator's mailbox at http://localhost:4566/_aws/ses.
    // The emulator can't verify a domain (no DNS), so dev verifies the one
    // address; deploys verify mercurian.app itself with DKIM.
    const mailIdentity = yield* AWS.SES.EmailIdentity("MailIdentity", {
      emailIdentity: MAIL_ADDRESS,
    });

    const build = yield* Command.Build("ApiBuild", {
      command: "vp run build",
      cwd: ".",
      outdir: "dist",
      memo: { include: ["src/**", "Dockerfile", "package.json", "../relay/migrations/**"] },
    });
    // Rebundling into dist/ is what rolls the containers onto new code; the
    // build above doesn't rerun on edits. Only runs under `alchemy dev`.
    yield* Command.Dev("ApiWatch", { command: "vp pack --watch --no-clean" });

    const migrate = yield* AWS.ECS.Task("Migrate", {
      context: build.outdir,
      dockerfile: "Dockerfile",
      command: ["node", "migrate.mjs"],
      runtimePlatform: ARM64,
      env: { DATABASE_URL: databaseUrl },
    });
    const migrated = yield* RunMigrations({
      cluster: cluster.clusterArn,
      taskDefinition: migrate.taskDefinitionArn,
    });

    const electric = yield* AWS.ECS.Service("Electric", {
      cluster,
      image: ELECTRIC_IMAGE,
      port: 3000,
      desiredCount: 1,
      runtimePlatform: ARM64,
      loadBalancer: { health: { "3000/http": { path: "/v1/health" } } },
      cpu: 512,
      memory: 1024,
      env: {
        DATABASE_URL: databaseUrl,
        // Only the API reaches Electric, so the shared secret stays server-side.
        ELECTRIC_INSECURE: "true",
      },
    });

    const api = yield* AWS.ECS.Service("Api", {
      cluster,
      context: build.outdir,
      dockerfile: "Dockerfile",
      port: 4310,
      desiredCount: 1,
      runtimePlatform: ARM64,
      loadBalancer: { health: { "4310/http": { path: "/health" } } },
      env: {
        DATABASE_URL: databaseUrl,
        ELECTRIC_URL: electric.url,
        MAIL_FROM: Output.map(mailIdentity.emailIdentity, () => MAIL_FROM),
        // Starts only after migrations succeed.
        MIGRATED: migrated.taskDefinition,
      },
    });

    return { apiUrl: api.url, electricUrl: electric.url };
  }),
);
