# Mercurian cloud infrastructure

The Alchemy stack for the Mercurian cloud: Postgres, Electric, the cloud API, the migration task, and the SES sender. Only local development runs so far; AWS deploys come next.

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

The API serves Astrolabe sign-in at `/api/auth/*` from [`apps/cloud`](../../apps/cloud), using `@alchemy.run/better-auth`: Alchemy provisions Better Auth's secret, and mail goes out through the SES binding. Its load balancer is declared ahead of the service so the service knows its own public address (`AUTH_URL`); Better Auth needs a fixed origin, and the emulator's load balancer rewrites `Host`.

## Running the relay against it

With this stack running, `vp run dev` in `infra/relay` starts the relay at http://localhost:8787 against the same Postgres, and writes `T3CODE_RELAY_URL` into this checkout's root `.env`. It needs no Cloudflare account. Tunnels, custom domains and tracing are cloud-only, so linking a managed endpoint reports "not configured" locally. [`infra/relay/dev.env`](../relay/dev.env) holds its placeholder settings; see [`src/local.ts`](../relay/src/local.ts).

## Migrations

[`src/migrate.ts`](src/migrate.ts) runs as a plain Node task, bundled into `dist/migrate` (Alchemy writes the API's bundle into `dist/`). It applies each migration folder with its own ledger table in the `drizzle` schema. The relay's folder is copied from [`infra/relay/migrations/postgres`](../relay/migrations/postgres) unchanged, so upstream relay migrations keep merging cleanly.

## Traps

- **Port 54329 is taken.** The POC's Postgres listens there on the host's loopback, and containers reaching `host.docker.internal:54329` silently connect to it instead.
- **Edits while a resource is still being created orphan it.** The next apply fails with `Role '…' already exists and is not managed by alchemy`. Reset your stage: stop dev, then run `alchemy unsafe nuke --local --include 'AWS.*' --filter '!JSON.stringify(resource).includes("<stage>")' --yes` (add `--dry-run` first; the emulator is shared with other stacks), `docker rm -f` the stage's `mercuriancloud-postgres-*` container, and `rm -rf .alchemy/state/MercurianCloud/<stage>`. Your default stage is `dev_<user>`, which appears in names as `dev-<user>`.
- **`alchemy destroy` wants real AWS credentials,** even for a local stage. Use the filtered nuke above.
- **Adding a load balancer to a running service** leaves its target group empty in the emulator. Reset as above.
