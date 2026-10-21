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
- **SES**, with sent mail visible at http://localhost:4566/_aws/ses.

Editing `src/` rebundles into `dist/`, which rolls the API container in about five seconds.

The API is a stand-in until `apps/cloud` lands; it only proves the wiring.

## Running the relay against it

With this stack running, `vp run dev` in `infra/relay` starts the relay at http://localhost:8787 against the same Postgres, and writes `T3CODE_RELAY_URL` into this checkout's root `.env`. It needs no Cloudflare account. Tunnels, custom domains and tracing are cloud-only, so linking a managed endpoint reports "not configured" locally. [`infra/relay/dev.env`](../relay/dev.env) holds its placeholder settings; see [`src/local.ts`](../relay/src/local.ts).

## Migrations

[`src/migrate.ts`](src/migrate.ts) applies each migration folder with its own ledger table in the `drizzle` schema. The relay's folder is copied from [`infra/relay/migrations/postgres`](../relay/migrations/postgres) unchanged, so upstream relay migrations keep merging cleanly.

## Traps

- **Port 54329 is taken.** The POC's Postgres listens there on the host's loopback, and containers reaching `host.docker.internal:54329` silently connect to it instead.
- **Edits while a resource is still being created orphan it.** The next apply fails with `Role '…' already exists and is not managed by alchemy`. Reset the local stack: stop dev, then run `alchemy unsafe nuke --local --include 'AWS.*' --yes`, `docker rm -f` the `mercuriancloud-postgres-*` container, and `rm -rf .alchemy`.
- **Adding a load balancer to a running service** leaves its target group empty in the emulator. Reset as above.
