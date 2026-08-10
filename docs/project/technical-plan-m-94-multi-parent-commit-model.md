# Technical Plan — M-94: Multi-parent commit data model

_Generated from the Goal/AC of Linear issue M-94 (see the issue for the full AC). Implements backlog 010 on the substrate [ADR 001](../architecture/local-first-runtime.md) decided, under the tracking discipline of [ADR 004](../architecture/fork-baseline.md). Design sources are the almagest vault notes the issue cites as canonical: Commit Tree, Merges (resolved: n-ary), Publishing, Issue Import, Plans._

**Goal, in one sentence:** build the heterogeneous, n-ary-parent commit DAG — typed commits, human-only forks and merges as hard refusals, coding-session leaves, the published flag with publish-the-ancestors semantics — as a fresh store in Mercurian's own SQLite database beside t3code's thread model, touching nothing t3code-shaped.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                      | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Embedded SQLite via Effect `SqlClient`, WAL + `foreign_keys` pragmas, dual Node/Bun client                                                                                                                                                                            | `apps/server/src/persistence/Layers/Sqlite.ts` (`makeSqlitePersistenceLive`: pragmas + `runMigrations()`; `node:sqlite` via `persistence/NodeSqliteClient.ts`, Bun via `@effect/sql-sqlite-bun`)                                                                              | High       |
| Migrations statically imported, run at startup via `Migrator.fromRecord`; each migration an `Effect.gen` default export, idempotent (`IF NOT EXISTS` / `PRAGMA table_info` guards)                                                                                    | `apps/server/src/persistence/Migrations.ts` (`migrationEntries`, `MigrationsLive`); `Migrations/001_OrchestrationEvents.ts`, `034_ProjectionThreadsSnoozed.ts`                                                                                                                | High       |
| Canonical single-file Effect service: imports → schemas/errors → `Context.Service` tag with inline interface → `make` → `export const layer`; namespace imports from `effect/*` subpaths                                                                              | `.macroscope/check-run-agents/effect-service-conventions.md` (authoritative reviewer instructions); exemplar `apps/server/src/persistence/AuthSessions.ts` (note: `persistence/Services/` + `Layers/` split is the _old_ pattern the conventions doc says to hoist away from) | High       |
| Typed errors via `Schema.TaggedErrorClass` with structured attributes; distinct error classes when the distinction drives caller behavior; `SqlSchema.findOne/findAll/void` for row codecs; `PersistenceSqlError`/`PersistenceDecodeError` at the SQL/decode boundary | `apps/server/src/persistence/Errors.ts`, `AuthSessions.ts`, `Layers/OrchestrationEventStore.ts`; effect-service-conventions.md §Errors                                                                                                                                        | High       |
| Append-only tables carry `sequence INTEGER PRIMARY KEY AUTOINCREMENT` + a `TEXT UNIQUE` domain id; timestamps as ISO-8601 `TEXT`; JSON payloads as `*_json TEXT` decoded with `Schema.fromJsonString`                                                                 | `Migrations/001_OrchestrationEvents.ts`; `Layers/OrchestrationEventStore.ts`                                                                                                                                                                                                  | High       |
| Branded entity ids via `TrimmedNonEmptyString.pipe(Schema.brand(...))`                                                                                                                                                                                                | `packages/contracts/src/baseSchemas.ts` (`makeEntityId`)                                                                                                                                                                                                                      | High       |
| Multi-statement writes wrapped in `sql.withTransaction`                                                                                                                                                                                                               | `persistence/Layers/ProjectionTurns.ts:269`, `ProjectionCheckpoints.ts:152`, `orchestration/Layers/OrchestrationEngine.ts:170`                                                                                                                                                | High       |
| Tests co-located `*.test.ts`, `@effect/vitest` `it.layer(...)` over `NodeSqliteClient.layerMemory()`, run with `vp test run <files>` (never repo-wide)                                                                                                                | `Migrations/035_ProjectionThreadTitleRegeneration.test.ts`; `AGENTS.md` §Verifying ("focused tests", "no `vp run -r test`")                                                                                                                                                   | High       |
| Additive placement: Mercurian code lands in new modules beside upstream's; minimal edits inside upstream-owned files; never append to upstream's migration sequence                                                                                                   | ADR 004 §1; ADR 001 §2 (own DB file, own migration module — explicit)                                                                                                                                                                                                         | High       |
| Conventional-commit messages, `feat(scope)`/`fix(scope)`                                                                                                                                                                                                              | `git log` (`fix(server): …`, `feat: add local first runtime adr`); AGENTS.md §Pull requests                                                                                                                                                                                   | Medium     |

## Design

### The delegated decision: plain relational, not event-sourced

ADR 001 leaves one question to this issue: "The commit store's schema: event-sourced like upstream's store, or plain relational?" **This plan decides: plain relational.** Rationale (significant choice; flagged for review):

- The commit DAG _is already_ an append-only history. Commits are immutable once written — the only mutation the design permits is the one-way `published` flip. Event-sourcing it would wrap an append-only log around an append-only structure, with a projector reconstituting exactly the rows the events described.
- Upstream's `orchestration_events` + `projection_*` split earns its keep because one event stream feeds many divergent read models for a live session runtime. The commit store's read model is the graph itself; there is no divergence to project.
- Every AC invariant (cycle refusal, coding-session-leaf refusal, assistant fork/merge refusal) is a transactional check against current graph state at append time — the natural shape is a constraint-checked `INSERT` inside one transaction, which is exactly what ADR 001 §2 anticipates ("010's cycle and leaf refusals are transactional checks").
- Whether _planning-space events_ ride upstream's log or a Mercurian log is ADR 002's question, per ADR 001's open-questions list — nothing here forecloses it. The fork has plain-relational precedent on the same substrate (`auth_sessions`, `AuthSessions.ts`).

### Module placement and file layout

First Mercurian-owned server module, additive per ADR 004 §1. New root `apps/server/src/mercurian/` **(new)**:

- `mercurian/persistence/Sqlite.ts` **(new)** — the Mercurian store's SqlClient layer. Mirrors upstream's `persistence/Layers/Sqlite.ts` (runtime-selected Node/Bun client, `PRAGMA foreign_keys = ON`, WAL, migrations on layer build, same trial-mode guard shape), but pointed at **`mercurian.sqlite` in the same state directory as `state.sqlite`** — derived inside this module as `join(stateDir, "mercurian.sqlite")` from `ServerConfig` (`apps/server/src/config.ts` derives `dbPath = join(stateDir, "state.sqlite")`; in prod `stateDir` is `<base>/userdata`, matching ADR 001's `<base>/userdata/mercurian.sqlite`; in dev/worktrees it lands beside the dev `state.sqlite`, which is the right behavior). No edit to `config.ts` — the path is Mercurian-owned, so it lives in the Mercurian module.
- `mercurian/persistence/Migrations.ts` **(new)** — Mercurian's own migration sequence via the same `Migrator.fromRecord` machinery, starting at `001`. Separate database file ⇒ its `effect_sql_migrations` tracking table cannot collide with upstream's (the collision ADR 001 §2 exists to avoid).
- `mercurian/persistence/Migrations/001_CommitGraph.ts` **(new)** — the schema below.
- `mercurian/commitTree/schema.ts` **(new)** — branded ids and domain schemas: `HistoryId`, `CommitId` (via the `makeEntityId` pattern, defined locally), `CommitKind = Schema.Literals(["message", "plan-revision", "issue-revision", "coding-session"])`, `CommitAuthorKind = Schema.Literals(["human", "assistant"])`, `Commit`, `NewCommit`. These stay server-side for now: `packages/contracts` is the wire boundary and nothing crosses the wire until the planning surface (020/030); promoting the schemas to contracts then is an additive move. (Significant choice; keeps the upstream-owned contracts barrel untouched today.)
- `mercurian/commitTree/CommitStore.ts` **(new)** — the store service in the canonical single-file order (schemas/errors, `Context.Service` tag with inline interface, `make`, `layer`) — the _hoisted_ pattern the conventions doc mandates for new code, exemplified by `AuthSessions.ts`, not the legacy `Services/` + `Layers/` split.

### Schema (`001_CommitGraph`)

Following `001_OrchestrationEvents.ts` conventions (sequence PK + unique domain id, ISO `TEXT` timestamps, `payload_json`):

```sql
CREATE TABLE IF NOT EXISTS commit_histories (
  history_id  TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  sequence     INTEGER PRIMARY KEY AUTOINCREMENT,  -- global append order
  commit_id    TEXT NOT NULL UNIQUE,
  history_id   TEXT NOT NULL REFERENCES commit_histories(history_id),
  kind         TEXT NOT NULL CHECK (kind IN ('message','plan-revision','issue-revision','coding-session')),
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('human','assistant')),
  published    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commits_history ON commits(history_id, sequence);

CREATE TABLE IF NOT EXISTS commit_parents (
  commit_id    TEXT NOT NULL REFERENCES commits(commit_id),
  parent_id    TEXT NOT NULL REFERENCES commits(commit_id),
  parent_order INTEGER NOT NULL,
  PRIMARY KEY (commit_id, parent_order),
  UNIQUE (commit_id, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_commit_parents_parent ON commit_parents(parent_id);
```

- **N-ary parents** ("Merges", resolved 2026-07: "a commit has _parents_, unbounded"): the `commit_parents` join table carries an ordered, unbounded parents list. A root commit has zero rows here. 0 parents = root, 1 = ordinary continuation, ≥2 = merge.
- **Both design axes** are plain `TEXT` discriminators: all four kinds and both authors are representable _today_ — landing plan revisions, issue revisions, and coding sessions later is new rows, not schema surgery (the AC's requirement). `payload_json` is deliberately opaque (`Schema.fromJsonString(Schema.Unknown)` at the row codec, like the event store's payload): kind-specific content schemas arrive with the features that write them, per the issue's "this issue is the substrate they land on."
- **`commit_histories`** exists so a history can be created empty of meaning but not of identity — it is the FK anchor and, later, where plan-level metadata attaches. One history per plan ("Plans": one plan per planning space) — but plans themselves are a later issue; the store deals only in opaque `HistoryId`s.

### The invariants are refusals in one transaction

`CommitStore.append` performs, inside a single `sql.withTransaction` (upstream convention; SQLite single-writer makes the check-then-insert race-free):

1. **Parents exist, are distinct, and belong to the same history** — refusal: `CommitParentNotFoundError` / `CommitParentHistoryMismatchError`. **Cycle rejection falls out structurally**: parent edges are written once at append and never mutated, and a parent must already exist — so no commit can ever reach itself; the explicit self-parent/duplicate case is refused by the same existence/distinctness check. The plan records this as the AC's "cycles are rejected" mechanism, and the test plan proves the refusable half (self-parent, unknown parent) directly.
2. **Coding sessions are leaves** ("interior structure is planning, leaves touch code" — Commit Tree): any parent whose `kind` is `coding-session` ⇒ `CodingSessionParentError`. Refused for _every_ author, per the AC.
3. **Forks and merges are human-driven only** (Commit Tree, resolved 2026-07 as "a guarantee", "landed before plan revisions and merges multiply what writes commits" — this issue is exactly that landing). For `author_kind = 'assistant'`:
   - zero parents ⇒ `AssistantForkError` (an assistant may not open a history — root creation is a human/import act);
   - more than one parent ⇒ `AssistantMergeError`;
   - a single parent that already has a child in `commit_parents` ⇒ `AssistantForkError` (continuing there would open a second line). Humans pass all three — returning to any earlier commit and committing _is_ the fork mechanism, unrestricted.
4. **One root per history**: a parentless commit is refused with `HistoryRootExistsError` if the history already has one.

Each refusal is its own `Schema.TaggedErrorClass` (the conventions doc: distinct classes when distinctions drive caller behavior — these are distinct AC bullets), declared in `CommitStore.ts`; the SQL/decode boundary reuses `PersistenceSqlError`/`PersistenceDecodeError` imported from `../../persistence/Errors.ts` (additive import, no upstream edit).

### Publish walks all ancestor paths; roots can be born published

- `CommitStore.publish(commitId)` — one transaction: a `WITH RECURSIVE` CTE over `commit_parents` collects the commit plus _all_ unpublished ancestors across _every_ parent path (not one path to root — the n-ary generalization of the scaffold's `publishPath` walk), then flips `published` in one `UPDATE`. Returns the set it published, so the eventual UI can render Publishing's "force-publishes the private parent branch" warning. Publishing is idempotent; the flip is one-way (no unpublish — "Publishing": publish is the deliberate crossing).
- `CommitStore.createHistory({ rootCommit, rootPublished })` — creates `commit_histories` row + root commit in one transaction; `rootPublished: true` is the "born published" import case ("Issue Import": the root is "published from the start"), `false` the born-blank case. Root must be human-authored (invariant 3).
- Non-root commits always insert `published = 0` — drafts are private by default; `publish` is the only way up.

### Visibility holds at the store, identity does not exist yet

The AC's "an unpublished commit is visible only to its author's workspace" lands as the store's read seam: every read API takes an explicit `visibility: "published" | "all"` filter (`getHistory`, `listCommits`, `children`, `ancestors` — the traversal surface the DAG Explorer needs at 020/030). On this machine, "the author's workspace" _is_ the local store — ADR 001 §4 defers user identity to the shared-workspace phase, and the Publishing resolution pins that any future transport replicates _only_ what is flagged published. So the flag plus the published-only read path is the entire boundary the design requires today; there is deliberately no author-identity column beyond `author_kind`.

### Wiring, and what deliberately does not change

`apps/server/src/server.ts` gains a few additive lines beside `PersistenceLayerLive` (line 240): `MercurianPersistenceLayerLive = CommitStore.layer.pipe(Layer.provide(MercurianSqlite.layer))`, merged into the runtime stack. The Mercurian `SqlClient` is provided **privately** (`Layer.provide`, not `provideMerge`) so the global `SqlClient` tag keeps resolving to `state.sqlite` for every upstream consumer — the two stores coexist exactly as ADR 001 §3 draws the seam. Wiring now (rather than leaving the module dark until 020) means `mercurian.sqlite` is created and migrated at startup, which is what "the substrate lands" means; it is inert otherwise.

Deliberately untouched, satisfying the final AC ("nothing t3code-shaped changes behavior"): `persistence/Migrations/` and `Migrations.ts` (no 036), `packages/contracts`, `orchestration/`, every thread/session/checkpoint surface, and all clients. The scaffold's prototype (`astrolabe-scaffold`: `apps/server/src/db/conversation-schema.ts`, `packages/shared/src/conversation-tree.ts`) is honored as semantic reference only, per the issue — **gap:** that repo is not connected to this session, so this plan grounds the semantics in the vault notes directly (which the issue names canonical anyway); connect `astrolabe-scaffold` at implementation time if a side-by-side check is wanted. One more finding: ADR 001 cites `ADR 003 (./publish-as-act.md)`, which does not exist in `docs/architecture/` yet — the publish semantics used here trace to the vault's Publishing note and ADR 001's own summary of the resolution.

## Implementation Checklist

- [ ] Branch `venk/m-94-multi-parent-commit-data-model` off `main` (Linear's branch name).
- [ ] `apps/server/src/mercurian/persistence/Sqlite.ts` **(new)**: Mercurian SqlClient layer — path `join(ServerConfig.stateDir, "mercurian.sqlite")`, `foreign_keys` + WAL pragmas, runs Mercurian migrations on build, trial-mode guard mirroring upstream `Layers/Sqlite.ts`; export `layer` (config-driven) and a `layerMemory` test layer over `NodeSqliteClient.layerMemory()`.
- [ ] `apps/server/src/mercurian/persistence/Migrations.ts` **(new)**: `migrationEntries` starting at `[1, "CommitGraph", …]`, `runMigrations`, `MigrationsLive` — same `Migrator.fromRecord` shape as upstream `persistence/Migrations.ts`.
- [ ] `apps/server/src/mercurian/persistence/Migrations/001_CommitGraph.ts` **(new)**: the three tables + indexes from Design, `IF NOT EXISTS`-guarded.
- [ ] `apps/server/src/mercurian/commitTree/schema.ts` **(new)**: `HistoryId`, `CommitId`, `CommitKind`, `CommitAuthorKind`, `Commit`, `NewCommit` (branded-id pattern from `contracts/baseSchemas.ts`, defined locally; do **not** edit `packages/contracts`).
- [ ] `apps/server/src/mercurian/commitTree/CommitStore.ts` **(new)**: refusal errors (`CommitParentNotFoundError`, `CommitParentHistoryMismatchError`, `CodingSessionParentError`, `AssistantForkError`, `AssistantMergeError`, `HistoryRootExistsError`) as `Schema.TaggedErrorClass`; `Context.Service` tag `"mercurian/commitTree/CommitStore"` with inline interface — `createHistory`, `append`, `publish`, `getCommit`, `getHistory`, `children`, `ancestors`, `listCommits` (all reads visibility-filtered); `make` acquiring `SqlClient` from the environment; `export const layer`. All writes in `sql.withTransaction`; row codecs via `SqlSchema.*` mapping `PersistenceSqlError`/`PersistenceDecodeError` per the `AuthSessions.ts` pattern.
- [ ] `apps/server/src/server.ts`: additive wiring of `MercurianPersistenceLayerLive` beside `PersistenceLayerLive` (~3 lines; `Layer.provide` the Mercurian SqlClient privately — it must not leak into the global environment).
- [ ] Do **not** touch: `apps/server/src/persistence/Migrations*` (no 036), `packages/contracts`, `orchestration/`, thread/session/checkpoint code, any client, parked surfaces.
- [ ] Docs per AGENTS.md §Hit every surface: this is contributor-facing architecture — add the commit store to `docs/internals/overview.md`'s persistence description (a sentence and a pointer) and the new terms (commit, history, published) to `docs/internals/glossary.md`; nothing in `docs/user/` (no user-visible behavior).
- [ ] Commit `feat(server): multi-parent commit store for planning histories (M-94)`, citing ADR 001 §2–3.

## Test Plan

Runner: `vp test run <files>` (targeted, per AGENTS.md — no repo-wide runs). Co-located `*.test.ts` using `@effect/vitest` `it.layer(...)` over the in-memory Mercurian layer (migrations + `NodeSqliteClient.layerMemory()`, the `035_…test.ts` pattern).

- [ ] `mercurian/persistence/Migrations/001_CommitGraph.test.ts` — migration creates the three tables with expected columns (`PRAGMA table_info` assertions, mirroring upstream migration tests); running twice is a no-op.
- [ ] `mercurian/commitTree/CommitStore.test.ts`, cases mapped to the AC:
  - [ ] **DAG shape:** build root → fork (two children of one commit, human) → 3-parent human merge; retrieve via `getHistory`/`children`/`ancestors`; parent order round-trips; a second parentless commit refuses with `HistoryRootExistsError`.
  - [ ] **Cycle rejection:** self-parent refused; unknown/duplicate parent refused; parent from another history refused (`CommitParentHistoryMismatchError`).
  - [ ] **Both axes:** commits of all four kinds × both authors round-trip (payloads opaque).
  - [ ] **Human-only structure as hard rule:** assistant commit with 2 parents ⇒ `AssistantMergeError`; assistant commit whose parent already has a child ⇒ `AssistantForkError`; assistant parentless commit ⇒ `AssistantForkError`; the same shapes succeed for `author_kind: "human"`.
  - [ ] **Leaves:** any commit (either author) with a `coding-session` parent ⇒ `CodingSessionParentError`; a `coding-session` commit itself appends fine as a leaf on any branch.
  - [ ] **Publish-with-ancestors across all paths:** diamond graph (root → A, B → merge M), all private except root; `publish(M)` flips M, A, _and_ B (both paths, not one path to root); already-published ancestors untouched; publish is idempotent.
  - [ ] **Born published:** `createHistory({rootPublished: true})` yields a published root with subsequent commits defaulting private; `false` yields a fully private history.
  - [ ] **Visibility:** reads with `visibility: "published"` exclude drafts; `"all"` includes them.
- [ ] **Coexistence (the last AC):** boot-shaped test asserting the Mercurian layer builds beside upstream's persistence layer with the global `SqlClient` still resolving to upstream's store (two DB files, no cross-talk); plus `git diff --stat` shows no edits under `persistence/Migrations`, `orchestration/`, or any client — the t3code surfaces are untouched by construction.
- [ ] Targeted `tsgo --noEmit` (server) and lint for the touched scope.

---

_Review note: the significant calls made here — plain relational over event-sourced (ADR 001's delegated question), schemas kept server-side rather than in `packages/contracts`, wiring the store into `server.ts` now vs leaving it dark, `commit_histories` as a first-class table, refusal-per-error-class granularity, and cycle rejection by construction rather than a traversal check — can be pressure-tested with `technical-plan-decision-review`._
