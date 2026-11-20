// @effect-diagnostics anyUnknownInErrorContext:off - Alchemy resources expose framework-owned any requirements.
/**
 * The cloud stack's shared resources. Each is an Effect that declares its resources when
 * yielded, so the stack and the API's props get the same instances. Dev runs on Docker and
 * Alchemy's AWS emulator; a deployed stage gets a VPC, RDS and an HTTPS load balancer.
 */
import * as ec2 from "@distilled.cloud/aws/ec2";
import * as ecs from "@distilled.cloud/aws/ecs";
import * as Alchemy from "alchemy";
import * as AWS from "@alchemy.run/aws";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "@alchemy.run/docker";
import * as Output from "alchemy/Output";
import { adopt } from "alchemy/AdoptPolicy";
import { ALCHEMY_DEV } from "alchemy/Phase";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { Deployment, ORIGIN_SECRET_HEADER } from "./deployment.ts";

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

const VPC_CIDR = "10.40.0.0/16";
const API_PORT = 4310;
const ELECTRIC_PORT = 3000;

/**
 * A deployed stage's network. Tasks run in the public subnets with public
 * addresses, so they reach Docker Hub, ECR and SES without a NAT gateway;
 * the internal group admits only traffic from inside the VPC, and RDS sits in
 * the private subnets.
 */
export const Network = Effect.gen(function* () {
  const network = yield* AWS.EC2.Network("Network", {
    cidrBlock: VPC_CIDR,
    availabilityZones: 2,
  });
  const fromVpc = (port: number, description: string) => ({
    ipProtocol: "tcp",
    fromPort: port,
    toPort: port,
    cidrIpv4: VPC_CIDR,
    description,
  });
  const internal = yield* AWS.EC2.SecurityGroup("InternalSecurityGroup", {
    vpcId: network.vpcId,
    description: "Load balancers, tasks and the database, reachable only from inside the VPC",
    ingress: [
      fromVpc(80, "Electric's internal load balancer"),
      fromVpc(API_PORT, "API tasks"),
      fromVpc(ELECTRIC_PORT, "Electric tasks"),
      fromVpc(5432, "Postgres"),
    ],
  });
  const publicIngress = yield* AWS.EC2.SecurityGroup("PublicSecurityGroup", {
    vpcId: network.vpcId,
    description: "The API's HTTPS load balancer",
    ingress: [
      {
        ipProtocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrIpv4: "0.0.0.0/0",
        description: "HTTPS",
      },
    ],
  });
  return {
    vpcId: network.vpcId,
    publicSubnetIds: network.publicSubnetIds,
    privateSubnetIds: network.privateSubnetIds,
    internalSecurityGroupId: internal.groupId,
    publicSecurityGroupId: publicIngress.groupId,
  };
});

/**
 * Networking props for an ECS service. Dev leaves them unset (the emulator's
 * default VPC). Deployed services bring their own security group: Alchemy's
 * managed one admits the container port from anywhere.
 */
export const ServiceNetwork = Effect.gen(function* () {
  if (yield* ALCHEMY_DEV) return {};
  const network = yield* Network;
  return {
    vpcId: network.vpcId,
    subnets: network.publicSubnetIds,
    securityGroups: [network.internalSecurityGroupId],
    assignPublicIp: true,
  };
});

/**
 * The database URL as containers see it. RDS requires no TLS here: its
 * certificate authority isn't in the images' trust stores, the clients can't
 * all take one, and the traffic never leaves the VPC.
 */
export const DatabaseUrl = Effect.gen(function* () {
  if (!(yield* ALCHEMY_DEV)) {
    const network = yield* Network;
    const { stage } = yield* Alchemy.Stack;
    const password = yield* Alchemy.Random("DatabasePassword");
    const subnets = yield* AWS.RDS.DBSubnetGroup("DatabaseSubnets", {
      description: "Private subnets for the cloud database",
      subnetIds: network.privateSubnetIds,
    });
    const parameters = yield* AWS.RDS.DBParameterGroup("DatabaseParameters", {
      family: "postgres17",
      description: "Logical replication for Electric",
      parameters: { "rds.logical_replication": "1", "rds.force_ssl": "0" },
    });
    const database = yield* AWS.RDS.DBInstance("Database", {
      engine: "postgres",
      engineVersion: "17",
      dbInstanceClass: "db.t4g.micro",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      dbName: LOCAL_POSTGRES.database,
      masterUsername: LOCAL_POSTGRES.user,
      masterUserPassword: password.text,
      dbSubnetGroupName: subnets.dbSubnetGroupName,
      dbParameterGroupName: parameters.dbParameterGroupName,
      vpcSecurityGroupIds: [network.internalSecurityGroupId],
      publiclyAccessible: false,
      backupRetentionPeriod: "7 days",
      deletionProtection: stage === "prod",
      skipFinalSnapshot: stage !== "prod",
    });
    return Output.all(database.endpointAddress, database.endpointPort, password.text).pipe(
      Output.map(
        ([host, port, secret]) =>
          `postgresql://${LOCAL_POSTGRES.user}:${secret}@${host}:${port ?? 5432}/${LOCAL_POSTGRES.database}?sslmode=disable`,
      ),
    );
  }
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
 * Better Auth's secret. It encrypts TOTP secrets and the JWKS private keys, so
 * a new logical id (and with it a new value) breaks every stage's 2FA and keys.
 */
export const BetterAuthSecret = Alchemy.Random("BetterAuthSecret");

/**
 * The API's load balancer, declared before the API. In dev its address is also `AUTH_URL`:
 * Better Auth needs a fixed origin, and the emulator rewrites `Host`. A deployed stage serves
 * HTTPS on its origin domain, which only the app router reaches (see ApiRouting).
 */
export const ApiIngress = Effect.gen(function* () {
  if (yield* ALCHEMY_DEV) {
    const loadBalancer = yield* AWS.ELBv2.LoadBalancer("ApiLoadBalancer", {});
    const listener = yield* AWS.ELBv2.Listener("ApiListener", {
      loadBalancerArn: loadBalancer.loadBalancerArn,
      port: 80,
      defaultActions: [{ type: "fixedResponse", statusCode: "404", messageBody: "no route" }],
    });
    return {
      listener,
      publicUrl: Output.map(loadBalancer.dnsName, (dnsName) => `http://${dnsName}`),
    };
  }
  const { appUrl, originDomain } = yield* Deployment;
  const network = yield* Network;
  const certificate = yield* AWS.ACM.Certificate("ApiCertificate", {
    domainName: originDomain,
    dnsValidation: "external",
  });
  yield* Cloudflare.DNS.RecordList("ApiCertificateValidation", {
    records: certificate.domainValidationOptions.pipe(Output.map(AWS.ACM.validationRecordsOf)),
  });
  const issued = yield* AWS.ACM.CertificateValidation("ApiCertificateIssued", {
    certificateArn: certificate.certificateArn,
  });
  const loadBalancer = yield* AWS.ELBv2.LoadBalancer("ApiLoadBalancer", {
    scheme: "internet-facing",
    subnets: network.publicSubnetIds,
    securityGroups: [network.publicSecurityGroupId],
  });
  yield* Cloudflare.DNS.RecordList("ApiOriginRecord", {
    records: loadBalancer.dnsName.pipe(
      Output.map((dnsName) => [{ name: originDomain, type: "CNAME" as const, value: dnsName }]),
    ),
  });
  const listener = yield* AWS.ELBv2.Listener("ApiListener", {
    loadBalancerArn: loadBalancer.loadBalancerArn,
    port: 443,
    protocol: "HTTPS",
    certificateArn: issued.certificateArn,
    defaultActions: [{ type: "fixedResponse", statusCode: "404", messageBody: "no route" }],
  });
  return { listener, publicUrl: appUrl };
});

/** The rule a deployed API's requests must match: the app router's secret header. */
export const ApiRouting = Effect.gen(function* () {
  if (yield* ALCHEMY_DEV) return undefined;
  const { originSecret } = yield* Deployment;
  return [{ header: { name: ORIGIN_SECRET_HEADER, values: [originSecret] } }];
});

/**
 * The sender. Dev verifies one address per stage (mailbox at http://localhost:4566/_aws/ses):
 * the emulator can't verify a domain, and only one stack can own an identity. A deployed
 * stage adopts the domain identity, DKIM-verified by hand, and keeps it if destroyed.
 */
export const Mail = Effect.gen(function* () {
  if (yield* ALCHEMY_DEV) {
    const { stage } = yield* Alchemy.Stack;
    const identity = yield* AWS.SES.EmailIdentity("MailIdentity", {
      emailIdentity: `login+${stage}@astrolabe.sh`,
    });
    return {
      identity,
      from: Output.map(identity.emailIdentity, (address) => `Astrolabe <${address}>`),
    };
  }
  const { mailDomain } = yield* Deployment;
  const identity = yield* AWS.SES.EmailIdentity("MailIdentity", {
    emailIdentity: mailDomain,
    dkimSigningKeyLength: "RSA_2048_BIT",
    mailFromDomain: `mail.${mailDomain}`,
    mailFromBehaviorOnMxFailure: "USE_DEFAULT_VALUE",
  }).pipe(adopt(true), RemovalPolicy.retain());
  return { identity, from: `Astrolabe <login@${mailDomain}>` };
});

/**
 * Runs the migration task to completion and fails the deploy unless it exits
 * 0. Its input carries the task definition revision, so it re-runs whenever
 * the image (and with it the migrations) changes.
 */
const RunMigrations = Alchemy.Action(
  "RunMigrations",
  (input: {
    cluster: string;
    taskDefinition: string;
    network?: { subnets: string[]; securityGroups: string[] };
  }) =>
    Effect.gen(function* () {
      // Fargate tasks run in awsvpc mode, which needs subnets; in dev the default VPC's will do.
      const subnets =
        input.network?.subnets ??
        (yield* ec2.describeSubnets
          .items({ Filters: [{ Name: "default-for-az", Values: ["true"] }] })
          .pipe(
            Stream.map((subnet) => subnet.SubnetId),
            Stream.filter((id): id is string => id !== undefined),
            Stream.runCollect,
            Effect.map((ids) => Array.from(ids)),
          ));
      const started = yield* ecs.runTask({
        cluster: input.cluster,
        taskDefinition: input.taskDefinition,
        count: 1,
        launchType: "FARGATE",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets,
            ...(input.network ? { securityGroups: input.network.securityGroups } : {}),
            assignPublicIp: "ENABLED",
          },
        },
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
  const network = (yield* ALCHEMY_DEV) ? undefined : yield* Network;
  const migrated = yield* RunMigrations({
    cluster: cluster.clusterArn,
    taskDefinition: migrate.taskDefinitionArn,
    ...(network
      ? {
          network: {
            subnets: network.publicSubnetIds,
            securityGroups: [network.internalSecurityGroupId],
          },
        }
      : {}),
  });
  return migrated.taskDefinition;
});

/** Electric. Only the API reaches it: deployed stages put it behind an internal load balancer. */
export const Electric = Effect.gen(function* () {
  const dev = yield* ALCHEMY_DEV;
  return yield* AWS.ECS.Service("Electric", {
    cluster: yield* Cluster,
    image: ELECTRIC_IMAGE,
    port: ELECTRIC_PORT,
    desiredCount: 1,
    runtimePlatform: ARM64,
    ...(yield* ServiceNetwork),
    loadBalancer: {
      ...(dev ? {} : { public: false }),
      health: { [`${ELECTRIC_PORT}/http`]: { path: "/v1/health" } },
    },
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
