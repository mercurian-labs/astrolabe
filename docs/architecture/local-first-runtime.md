# ADR 001: Local-first runtime and session substrate

**Status:** Proposed — drafted 2026-08-02, executing the technical plan authored on M-89 (2026-07-17) against the fork as it stands; review and acceptance tracked on M-89. Decides over the baseline declared by [ADR 004](./fork-baseline.md) (accepted 2026-08-02).

## Context

The vault resolved the design direction: unpublished planning lives locally, and "Astrolabe is local-first; cloud features, including the shared workspace, are optional add-ons layered later" ("Environments", resolved 2026-07). This ADR decides what that concretely means for the runtime: where Mercurian's persistent state — projects, plans, the commit DAG — lives on a user's machine, what storage engine backs it, and how it relates to t3code's own persistence.

Facts on the fork that shape the decision:

- **The runtime's outer shape already exists.** One local Node server (`apps/server`) wraps the provider agents, serves the web bundle and the WebSocket API from a single origin (`apps/server/src/http.ts`, default port 3773 in `apps/server/src/config.ts`), and is independently startable without Electron (`apps/server/src/bin.ts`). The desktop shell supervises it as a child process with health-gated startup and restart backoff (`apps/desktop/src/backend/DesktopBackendManager.ts`) and `loadURL`s the served origin (`apps/desktop/src/window/DesktopWindow.ts`). There is no Postgres, no hosted auth layer, no organizations — the questions the retired scaffold posed here have dissolved.
- **The fork ships a proven persistence substrate.** An embedded, event-sourced SQLite store: an append-only `orchestration_events` log plus `projection_*` read models (`apps/server/src/persistence/Migrations/`, currently at 032 and actively growing upstream), migrations statically imported and run at startup, WAL and foreign-key pragmas (`persistence/Layers/Sqlite.ts`), with a zero-native-dependency `node:sqlite` client (`persistence/NodeSqliteClient.ts`) or the Bun client per runtime. Data home: `~/.t3` (`os-jank.ts`), state at `<base>/userdata/state.sqlite`.
- **Auth on the fork is machine-access control, not identity.** Bearer sessions and pairing credentials for reaching your own local server (`apps/server/src/auth/EnvironmentAuth.ts`, `auth/EnvironmentAuthPolicy.ts` — methods `desktop-bootstrap` and `one-time-token`; persistence in `persistence/AuthSessions.ts`). Multi-user identity returns only with the shared workspace.
- **What the fork does not have** is a home for Mercurian's objects: projects, plans, and the commit DAG (backlog 010 / M-94) have no storage.
- **ADR 004's tracking discipline constrains placement:** Mercurian code is additive where practical, with minimal edits inside upstream-owned files — upstream's migration sequence is high-churn territory.

## Decision

### 1. Runtime topology — confirmed as built; nothing must change

One local server process owns the API, the web bundle, and all persistence; the desktop shell supervises it, and both the shell and any browser tab open the same locally-served origin, authenticating via the existing environment-auth bootstrap (desktop token for the shell, one-time pairing token for a browser). This satisfies the Environments requirement — "a local environment can serve the app to your browser directly — the desktop shell and the browser open the same product" — by confirmation, with the file citations above as evidence. The server's independent startability (`bin.ts`, `src/cli/`) is part of the guarantee, not an accident.

### 2. Storage — same engine and pattern as the fork, separate store

Mercurian's persistent state lives in **SQLite via the substrate the fork already proves in production** — the Effect `SqlClient` over `node:sqlite` (or the Bun client under Bun), WAL journaling, statically-imported migrations — but in its **own database file**: `<base>/userdata/mercurian.sqlite`, beside `state.sqlite`, with its **own Mercurian-owned migration module**, not appended to upstream's `persistence/Migrations/` sequence.

Rationale: upstream's migration sequence is at 032 and actively growing; appending Mercurian migrations to it guarantees numbering collisions and merge conflicts on every upstream merge — exactly what ADR 004's additive discipline exists to avoid. A separate file also gives Mercurian state independent backup/reset/export semantics (wiping t3code threads and wiping planning history become separable acts) and keeps the single-writer WAL contention of the two domains apart.

Costs, recorded honestly: no cross-database foreign keys, and no atomic transaction spanning both stores — cross-references are by id (see §3).

Alternatives declined: _same file, second migration namespace_ (entangles reset/backup semantics and migrator state for no gain); _a different engine_ (nothing motivates a new dependency against a zero-dependency engine already proven in-tree); _files-on-disk, no database_ (the commit DAG needs indexed traversal and atomic multi-row writes from day one — 010's cycle and leaf refusals are transactional checks).

### 3. Relation to t3code's thread/session persistence — coexistence, with an id-reference seam

t3code's store keeps owning what it owns today: threads, turns, messages, session runtime, checkpoints, environment auth (`orchestration_events` + `projection_*`). Mercurian's store owns projects, plans, and the commit DAG — including **coding-session leaf commits** once sessions become leaves (backlog 061–066): the leaf commit (identity, parent commit, kind, author, published flag) is Mercurian-side; the session it names — its timeline, runtime state, worktree, checkpoints — stays t3code-side, referenced by thread id. No wrapping, no migration; nothing t3code-shaped changes behavior when the commit store lands (echoing 010's final AC).

One vocabulary collision this seam creates, named so 020/040 can reconcile it at the surface level: t3code's `projection_projects` are workspace roots on disk; Mercurian's Projects (the vault note) are containers of plans. Same word, different objects; both exist, upstream's untouched.

### 4. Deferred to the shared-workspace phase

Recorded so later issues cite this list instead of re-deciding: the hosted shared workspace itself; publish **transport** and any CRDT/replication layer (semantics pinned by [ADR 003](./publish-as-act.md)); user identity, organizations, membership, permissions; tracker write-back; cross-machine movement of unpublished work (accepted cost per "Environments": private planning is machine-bound until published); and whether t3code's parked cloud plumbing — the T3 Connect/relay surfaces (`apps/server/src/cloud/`, `src/relay/`; parked by ADR 004 rev 2) and the parked `packages/ssh`/`packages/tailscale` — plays a role in that phase or is replaced.

## Open questions

- The commit store's schema: event-sourced like upstream's store, or plain relational? That is 010's decision, taken on this substrate.
- Whether planning-space events ride upstream's `orchestration_events` or a Mercurian log in the new store — ADR 002's decision; this ADR only guarantees both have a home.
- The `~/.t3` base-dir name under Mercurian branding: a rename is a cut-over item per ADR 004 §3, and what migrates user data when it happens is unowned.
- Backup/export conventions for the Mercurian store.
- Whether Astrolabe keeps the dual Node/Bun client path or pins Node-only.
