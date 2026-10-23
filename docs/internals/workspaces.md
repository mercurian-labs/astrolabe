# Workspaces sync

Workspaces and teams are Better Auth organizations and teams in the cloud's
Postgres. Clients read them as Electric shapes and write them through the
cloud. The product says "workspace"; code, schema and the plugin keep
"organization" so upstream syncs and the plugin stay untouched.

## Rules live inside Better Auth

The organization plugin's endpoints are reachable directly at
`/api/auth/organization/*`, so every rule is an access-control permission or an
organization hook ([`workspaces.ts`](../../apps/cloud/src/auth/workspaces.ts),
[`access.ts`](../../apps/cloud/src/auth/access.ts)), never only a check in the
cloud's own write path. What the plugin has no endpoint for (joining a team
yourself, team owners, handing over ownership) is a small plugin of ours with
its own table, so it migrates with the rest.

Hooks get the acting user only from `getCurrentAuthEndpointContext()`, and must
read and write through `getCurrentAdapter(...)`. The base adapter runs on
another pooled connection, outside the write's transaction: it can't see what
the write did, and on a single-connection database it deadlocks.

## Writes return a txid

[`/api/workspaces/write`](../../apps/cloud/src/workspaces/writes.ts) runs one
plugin endpoint inside a Drizzle transaction the cloud opens, by binding a
transaction adapter into Better Auth's adapter context (`auth.api.*` keeps it;
`auth.handler` resets it). It returns `pg_current_xact_id_if_assigned()`, which
is null when nothing was written; clients wait for a txid only when there is
one, or they would wait forever on a no-op. Mail queued with
`queueAfterTransactionHook` goes out after commit.

## Shapes are fixed per reader

[`shapes.ts`](../../apps/cloud/src/workspaces/shapes.ts) scopes each shape with
subqueries on the reader's id, so a definition never changes with membership;
Electric moves rows in and out. Those moves arrive as tag-pattern events that
only `@tanstack/electric-db-collection` applies; a hand-rolled Electric client
silently keeps rows after a removal. The settings page reads seven shapes at
once, each a held long-poll, so the API needs HTTP/2 in front of it: over
HTTP/1.1 a browser's six connections per host leave writes queued behind them.
