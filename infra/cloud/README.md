# Mercurian cloud infrastructure

The Alchemy stack for the Mercurian cloud: Postgres, Electric, the cloud API, the migration task, and the SES sender. It runs locally under `alchemy dev`, and deploys to AWS as stage `prod` (see [Deploying](#deploying)).

## Running it locally

Needs Docker (OrbStack works). No AWS or Cloudflare account.

```sh
vp install
cd infra/cloud
vp run dev
```

`alchemy dev` starts:

- **Postgres 17** in Docker on host port 54341 (`wal_level=logical` for Electric). Override with `CLOUD_POSTGRES_PORT`.
- **Migrations** as a one-off ECS task, before the API starts. The deploy fails if the task exits non-zero.
- **Electric** and the **API** as ECS services in Alchemy's local AWS emulator, each behind an emulated load balancer. The `ready at` lines print their URLs; the API's `/health` reports what it can reach.
- **SES**, with sent mail visible at http://localhost:4566/_aws/ses. Each stage sends from `login+<stage>@astrolabe.sh`, because only one stack can own an identity in the shared emulator.

Editing the API rolls its container in a few seconds. Electric restarts too, since the emulator rolls image-based services on every apply.

To run a second copy beside yours, give it its own stage and port: `CLOUD_POSTGRES_PORT=54343 alchemy dev --stage <name>`.

## The API runs on Bun

[`src/Api.ts`](src/Api.ts) is Alchemy-hosted: Alchemy bundles it with its own startup code, serves its `fetch`, and wires its bindings and their IAM. Alchemy's ECS startup code exists only for Bun, so the image is `oven/bun`. Tests stay on Node, which keeps the code to Node APIs; once Alchemy ships Node startup code for ECS, switching is a change to the service's props.

The API serves Astrolabe sign-in at `/api/auth/*` from [`apps/cloud`](../../apps/cloud), which builds Better Auth once per process: the stack provisions its secret as an `Alchemy.Random` bound to `BETTER_AUTH_SECRET`, and mail goes out through the SES binding. Its load balancer is declared ahead of the service so the service knows its own public address (`AUTH_URL`); Better Auth needs a fixed origin, and the emulator's load balancer rewrites `Host`.

## Integration tests

`vp run test:integration` deploys this stack into a throwaway `it` stage (Postgres on 54391), runs
[`test/stack.integ.test.ts`](test/stack.integ.test.ts) against it like a client would, and removes the
stage. It takes about a minute and a half and needs Docker. The tests sign people in with real emailed
codes, check who can see which workspace through Electric, and hold a quiet live request past Bun's
idle timeout. `KEEP_STAGE=1` leaves the stage up afterwards.

[`test/integration.sh`](test/integration.sh) owns the teardown, using the filtered nuke below. Alchemy's
test harness can't do it: at the end of the file its destroy can't reach the sidecar that runs the local
providers, and without the sidecar the stage is destroyed as soon as the deploy returns. Right after a
deploy, Alchemy's dev mode rolls the API once more, so the suite waits until a quiet live request gets
through before testing.

## Running the relay against it

With this stack running, `vp run dev` in `infra/relay` starts the relay at http://localhost:8787 against the same Postgres, and writes `T3CODE_RELAY_URL` into this checkout's root `.env`. It needs no Cloudflare account. Tunnels, custom domains and tracing are cloud-only, so linking a managed endpoint reports "not configured" locally. [`infra/relay/dev.env`](../relay/dev.env) holds its placeholder settings; see [`src/local.ts`](../relay/src/local.ts).

## Migrations

[`src/migrate.ts`](src/migrate.ts) runs as a plain Node task, bundled into `dist/migrate` (Alchemy writes the API's bundle into `dist/`). It applies each migration folder with its own ledger table in the `drizzle` schema. The relay's folder is copied from [`infra/relay/migrations/postgres`](../relay/migrations/postgres) unchanged, so upstream relay migrations keep merging cleanly.

## Deploying

`.github/workflows/deploy-cloud.yml` deploys stage `prod` to us-east-1 on pushes to `main` that touch the cloud, and on demand. It skips itself until the repository variable `AWS_DEPLOY_ROLE_ARN` is set. A deployed stage gets:

- **Its own VPC** across two zones. Tasks run in the public subnets with public addresses, so they reach Docker Hub, ECR and SES without a NAT gateway. One security group admits only traffic from inside the VPC; the API's load balancer has its own, open on 443. Since a security group is the tasks' only barrier, the deploy fails before creating anything if any group admits the internet elsewhere ([`src/firewall.ts`](src/firewall.ts)). The usual cause is a service declared without `ServiceNetwork`, which gets Alchemy's managed group, open to the world on its port.
- **RDS Postgres 17** in the private subnets, with logical replication for Electric. It doesn't require TLS: the traffic stays in the VPC, and not every client can take RDS's certificate authority. `prod` has deletion protection and a final snapshot.
- **Electric** behind an internal load balancer, reachable only by the API.
- **The API** behind an HTTPS load balancer on `CLOUD_ORIGIN_DOMAIN`, with an ACM certificate validated through Cloudflare and a DNS-only CNAME to it. The listener answers 404 unless a request carries `x-astrolabe-origin-secret`, so only the `app.astrolabe.sh` router ([`apps/web/cloudflare/router.ts`](../../apps/web/cloudflare/router.ts)) reaches it. The router forwards the sign-in pages, `/api/auth/*` and `/api/workspaces/*`, and passes the visitor's address in `x-astrolabe-client-ip` for rate limits.
- **Secrets in SSM Parameter Store** as SecureStrings: the database URL, Better Auth's secret and the sign-in providers' secrets. ECS reads them when a task starts, so a task definition holds only their ARNs.
- **The SES domain identity** for `CLOUD_MAIL_DOMAIN`, adopted rather than created, because it is set up and DKIM-verified by hand. The stack keeps it if the stage is destroyed.

State lives in the Cloudflare state store, next to the relay's. [`src/deployment.ts`](src/deployment.ts) reads the settings.

### One-time setup

1. **AWS:** create a GitHub OIDC identity provider and a role that `repo:mercurian-labs/astrolabe:environment:production` can assume, with rights to manage VPC, ECS, ECR, ELB, ACM, RDS, SES, SSM parameters, IAM roles and policies, and CloudWatch Logs. Set its ARN as the repository variable `AWS_DEPLOY_ROLE_ARN`, not an environment one: the workflow's guard runs before the job enters `production`.
2. **SES:** verify the domain identity with Easy DKIM (RSA 2048) and MAIL FROM `mail.<domain>`, and request production access. The stack declares the same settings.
3. **GitHub `production` environment:**
   - Variables: `CLOUD_APP_URL` (`https://app.astrolabe.sh`), `CLOUD_ORIGIN_DOMAIN` (`cloud.astrolabe.sh`), `CLOUD_MAIL_DOMAIN` (`astrolabe.sh`), `CLOUD_RELAY_URL` (`https://relay.astrolabe.sh`). `CLOUDFLARE_ACCOUNT_ID` is shared with the relay.
   - Secrets: `CLOUD_ORIGIN_SECRET`, a long random string. `CLOUDFLARE_API_TOKEN` is shared with the relay and needs DNS edit on the `astrolabe.sh` zone.
   - Sign-in providers, each only when it's turned on: `GOOGLE_CLIENT_ID` (variable) and `GOOGLE_CLIENT_SECRET` (secret), likewise `MICROSOFT_*`, `CLOUD_GITHUB_CLIENT_ID` and `CLOUD_GITHUB_CLIENT_SECRET` (GitHub reserves the `GITHUB_` prefix), `APPLE_CLIENT_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`, and `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
4. **The router:** give the `astrolabe-app` Worker the same secret with `vp dlx wrangler@4.151.3 secret put CLOUD_ORIGIN_SECRET -c cloudflare/router.wrangler.jsonc` from `apps/web`. Until it has one, the router sends these paths to the app as before.

Then run **Deploy cloud** from `main`. The first deploy takes about 20 minutes, mostly RDS. Check `https://app.astrolabe.sh/api/auth/ok` afterwards, and that `aws ecs describe-task-definition` for the API lists no secret values in `environment`.

## Traps

- **Alchemy copies every setting a service's runtime code reads while planning into its task definition, as plain text.** The API's code reads `GOOGLE_CLIENT_SECRET` and the like at startup, so if the deploying process has them under those names, they land in the task definition, `secrets` or not. The deploy takes the API's secrets as `CLOUD_<name>` instead, and only the service props read them ([`src/deployment.ts`](src/deployment.ts)).
- **Port 54329 is taken.** The POC's Postgres listens there on the host's loopback, and containers reaching `host.docker.internal:54329` silently connect to it instead.
- **Edits while a resource is still being created orphan it.** The next apply fails with `Role '…' already exists and is not managed by alchemy`. Reset your stage: stop dev, then run `alchemy unsafe nuke --local --include 'AWS.*' --filter '!JSON.stringify(resource).includes("<stage>")' --yes` (add `--dry-run` first; the emulator is shared with other stacks), `docker rm -f` the stage's `mercuriancloud-postgres-*` container, and `rm -rf .alchemy/state/MercurianCloud/<stage>`. Your default stage is `dev_<user>`, which appears in names as `dev-<user>`.
- **`alchemy destroy` wants real AWS credentials,** even for a local stage. Use the filtered nuke above.
- **The emulated load balancer keeps only the last `Set-Cookie` header.** Cookie sign-in (the auth pages, the hosted web app) fails through the local load balancer URL, while bearer-token clients work. Real AWS load balancers pass every header. To work on the pages, run `vp dev` in `apps/auth`, which serves Better Auth in-process.
- **Adding a load balancer to a running service** leaves its target group empty in the emulator. Reset as above.
