# Technical Plan — M-98: Tracker connections

_Generated from the Goal/AC of Linear issue M-98 (see the issue for the full AC). Implements backlog 050 (Phase 5 — Trackers, import, revisions) on the fork as it stands at M-108 (M-96's repositories registry is planned but not landed — nothing here depends on it), under [ADR 001](../architecture/local-first-runtime.md) and [ADR 002](../architecture/event-streaming-model.md). Design sources are the almagest vault notes the issue cites: Trackers (resolved: write-back deferred), Settings, Issue Import._

**Goal, in one sentence:** make trackers connectable — a tracker connection managed from Settings with its status visible there, a connector abstraction whose every tracker produces the same minimal common shape (**id, title, description, a URL back to the origin, and status — nothing else crosses**), pull-only by construction, with Linear as the first real connector reachable end-to-end.

**Scope fences, restated from the issue:** the import browse and plan creation are 051's; refresh and issue revisions are later entries in this phase. This plan ships the connection lifecycle, the connector seam, and the live issue read that import will consume — no issue is ever _stored_ here, and no import UI appears. Write-back is resolved deferred (2026-07): "Pull-only ships; write-back waits until finalized plans exist and users ask where they went" — so nothing in this plan may write tracker-ward, and the design enforces that structurally rather than by discipline.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                       | Confidence |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Mercurian server code is additive under `apps/server/src/mercurian/`, in its own `mercurian.sqlite` with its own migration sequence (001–002 landed); Mercurian `SqlClient` provided privately (`Layer.provide`, never `provideMerge`)                                                                                                                               | ADR 001; `mercurian/persistence/Migrations.ts`, `Sqlite.ts`, `Coexistence.test.ts`; the Mercurian block in `server.ts:245–251` | High       |
| Canonical single-file Effect service: schemas/errors → `Context.Service` tag `"t3/mercurian/<area>/<Name>"` → `make` → `layer`; refusals as `Schema.TaggedErrorClass` with message getters; writes in transactions; a `PubSub`-backed `changes: Stream<void>` published by every mutation                                                                            | `mercurian/planning/PlanningStore.ts` (tag at line 261, `changes` at 810), `mercurian/commitTree/CommitStore.ts`               | High       |
| RPC surface: domain-owned method map in a contracts file, `Rpc.make` consts + `WsRpcGroup` membership (`contracts/src/rpc.ts:809–860` for the Mercurian block), scope per method in `RPC_REQUIRED_SCOPES` (type- and test-enforced), handlers in `ws.ts` wrapped in `observeRpcEffect`/`observeRpcStreamEffect` with `"rpc.aggregate": "mercurian"`                  | `MERCURIAN_WS_METHODS` end to end (contracts `mercurian.ts` → `rpc.ts` → `auth/RpcAuthorization.ts:32–41` → `ws.ts:1409+`)     | High       |
| Small human-paced collections stream as snapshot-re-emit, no resume state: queue attached to `changes` _before_ the first snapshot query, `Stream.debounce(50ms)`, re-query per signal                                                                                                                                                                               | the `subscribeTree` handler, `ws.ts:1409–1435`                                                                                 | High       |
| Mercurian read scopes ride `AuthOrchestrationReadScope`, mutations `AuthOrchestrationOperateScope`, under the recorded rationale ("same trust domain; a Mercurian-specific scope would force re-pairing for a boundary that does not exist yet")                                                                                                                     | `auth/RpcAuthorization.ts:32–41`                                                                                               | High       |
| Client data layer: atom factories in `packages/client-runtime/src/state/` (`createEnvironmentRpcSubscriptionAtomFamily` / `createEnvironmentRpcCommand` with a shared write scheduler), instantiated in `apps/web/src/state/` over `connectionAtomRuntime`, hooks keyed to the primary environment via `useEnvironmentBoundCommand`                                  | `client-runtime/src/state/mercurianPlanning.ts`, `apps/web/src/state/mercurian.ts`                                             | High       |
| Streaming subscriptions register in `EnvironmentSubscriptionRpcTag`                                                                                                                                                                                                                                                                                                  | `client-runtime/src/rpc/client.ts:42–54`                                                                                       | High       |
| Settings surface: one route file per section (`routes/settings.<section>.tsx` mounting one component from `components/settings/`), section registered in the `SettingsPath` union + `SETTINGS_SECTION_LABELS` (sidebar order) in `settingsSearch.ts` + `SETTINGS_SECTION_ICONS` in `SettingsSidebarNav.tsx`; searchable items in the `SETTINGS_SEARCH_ITEMS` catalog | `routes/settings.connections.tsx`, `components/settings/settingsSearch.ts:22–31`, `SettingsSidebarNav.tsx:46–57`               | High       |
| Secrets are files, never rows: `ServerSecretStore` (`get`/`set`/`create`/`remove` by name, `0600` under `ServerConfig.secretsDir`, atomic replace)                                                                                                                                                                                                                   | `auth/ServerSecretStore.ts`, `config.ts:131`                                                                                   | High       |
| Outbound HTTP through Effect's `HttpClient` (`effect/unstable/http`), never a raw fetch                                                                                                                                                                                                                                                                              | `telemetry/AnalyticsService.ts:17–19,71`, `provider/providerMaintenance.ts`                                                    | High       |
| Facts about the outside world are derived live and cached short-TTL, never stored (the M-96 plan's `hasGit` rule follows the same source)                                                                                                                                                                                                                            | `project/RepositoryIdentityResolver.ts` (probe + 1-min TTL `Cache`)                                                            | High       |
| UI: `ui/` primitives, lucide icons, `cn()`; behavior factored into pure `.logic.ts` helpers with co-located unit tests; Mercurian surfaces are web (desktop wraps web); mobile untouched by the fork's Mercurian work so far                                                                                                                                         | `components/settings/ConnectionsSettings.tsx` + `.logic.ts`, `components/mercurian/*`; M-95/M-100/M-106/M-108 shipped web-only | High       |
| Tests: co-located `*.test.ts`, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory`; streams drained, never sleeps; `vp test run <files>`, targeted lint/typecheck only                                                                                                                                                                               | `PlanningStore.test.ts`, `002_ProjectsPlans.test.ts`; AGENTS.md §Verifying                                                     | High       |
| Conventional commits `feat(scope): … (M-98)`; branch `venk/m-98-<slug>`; docs ride the PR (user docs, glossary, overview)                                                                                                                                                                                                                                            | `git log` (M-108/M-106/M-100 series), AGENTS.md §Hit every surface, §Pull requests                                             | High       |
| Plan documents live at `docs/project/technical-plan-m-<issue>-<slug>.md` in this exact house format                                                                                                                                                                                                                                                                  | the seven existing plans in `docs/project/`                                                                                    | High       |

## Design

### The connector seam: one interface, one registry, one narrow shape

The vault's scope-control device becomes a type: `TrackerIssue` has exactly five fields — `id`, `title`, `description`, `url`, `status` — and it is the _only_ issue-shaped type that exists on the Mercurian side of the boundary. Labels, assignees, sprints, priorities have no field to land in; "don't rebuild the tracker" is enforced by the shape, not by review discipline.

`apps/server/src/mercurian/trackers/connector.ts` **(new)** defines the per-tracker adapter interface — the thing that keeps the second connector cheap:

```ts
export interface TrackerConnector {
  readonly kind: TrackerKind;
  /** Validates the credential and names what it reaches (the connection's label). */
  readonly probe: (token: string) => Effect.Effect<TrackerProbeResult, TrackerProbeRefusal>;
  /** Live browse — the only issue-shaped read. Never stored. */
  readonly listIssues: (
    token: string,
    query: { readonly search?: string; readonly cursor?: string },
  ) => Effect.Effect<TrackerIssuePage, TrackerProbeRefusal>;
}
```

Read-only by construction: the interface has no write method, so a connector _cannot_ push anything tracker-ward — the resolved pull-only decision is a property of the type. Adding Jira or GitHub Issues later is: one literal added to `TrackerKind`, one connector file, one registry entry. Nothing in the store, the wire, or the UI changes shape.

`TrackerProbeRefusal` distinguishes the two ways a tracker says no — `TrackerAuthRefusal` (the credential is wrong or revoked) and `TrackerUnreachableRefusal` (the network or the service) — because the Settings row and the connect dialog say different things for each.

### First connector: Linear (the prioritization call, made)

The vault names Linear, Jira, and GitHub Issues as the family and deliberately doesn't pick — a prioritization call, not a design fork. This plan picks **Linear**: the team's own backlog lives there (M-98 itself is a Linear issue, so the feature is dogfoodable the day it lands), auth is one personal API key in one header with no OAuth app registration, and the whole API is a single GraphQL endpoint. Jira's site-URL+email+token triple and GitHub's app/PAT scoping decisions are exactly the per-kind connect-input variance worth deferring until the seam has proven itself on the cheap case.

`apps/server/src/mercurian/trackers/connectors/LinearConnector.ts` **(new)**: GraphQL over the existing `HttpClient` pattern (`HttpClientRequest.post("https://api.linear.app/graphql")`, `Authorization` header carrying the key, the `AnalyticsService.ts` shape). Two exported documents, both `query` operations:

- `probe` → `viewer { id } organization { name urlKey }`; success maps the organization name to the connection's label. HTTP 400/401 with Linear's auth error → `TrackerAuthRefusal`; transport failure → `TrackerUnreachableRefusal`.
- `listIssues` → `issues(filter/search, first, after)` selecting `identifier title description url state { name }`, mapped to `TrackerIssue` as: `id` = `identifier` (the human-facing key, "M-98" — stable, meaningful in a browse list, and the shape's one id; the UUID Linear also carries is API plumbing the narrow shape has no field for), `title`, `description` = the string or `""` (an absent description is an empty one, the `planText` convention), `url` = Linear's canonical issue URL (the AC's origin link, straight from the source of truth), `status` = `state.name` — the tracker's own status word, uninterpreted; normalizing status vocabularies across trackers would be rebuilding tracker semantics. `pageInfo` maps to an opaque `nextCursor`.

**Pull-only, structurally, at this level too:** the module exports its GraphQL documents as named constants, and a unit test parses each and asserts its operation type is `query` — a mutation cannot enter the file without failing the suite. Between the interface (no write methods), the documents (queries only), and the wire (no RPC writes tracker-ward), "no operation anywhere writes to the tracker" holds at three layers.

### Data model: the next migration, one narrow table

`mercurian/persistence/Migrations/003_TrackerConnections.ts` **(new)**, registered as `[3, "TrackerConnections"]` in `mercurian/persistence/Migrations.ts` — same idempotent shape as 001/002. (M-96's unlanded plan also claims number 003 for repositories; whichever lands second takes 004 — the loader keys on `[id, name]`, so this is a one-line renumber at rebase, noted here so neither branch is surprised.)

```sql
CREATE TABLE IF NOT EXISTS tracker_connections (
  connection_id TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)
```

- `kind` is the connector registry key (`"linear"` today). `label` is what the probe named at connect time (the Linear organization name) — a display fact captured once, not synced state.
- **Deliberately absent**, each with its owner: a **token column** (the credential is a secret, and secrets are files — below); a **status column** (standing is a fact about the outside world, derived live and cached, never stored — the `RepositoryIdentityResolver` rule); **imported-issue and origin columns** (051 owns import; "idempotent by origin (tracker + id)" is a fact about _plans_, and its table arrives with the feature that writes it — the 002 header's discipline); **per-kind config columns** (Linear needs none; Jira's site URL arrives with the Jira connector).
- No UNIQUE on `kind`: two Linear workspaces are two connections, and rows are cheap. Connection identity — not kind — is what import's origin will name.

### Credentials: the secret store, keyed by connection

The token is written to the existing `ServerSecretStore` under the name `mercurian-tracker-<connectionId>` — file-per-secret, `0600`, under `secretsDir`, exactly what the store exists for. It is read back only inside `TrackerStore` at the moment a connector call needs it. **No RPC response, snapshot, or log ever carries it**: the token crosses the wire exactly once, client→server, inside `connectTracker`'s payload, and nothing echoes it back — the Settings row shows the connection's label and standing, never the credential (so not even `RedactedSensitiveText` is needed; there is nothing to redact because nothing returns).

### `TrackerStore`: the service behind the surface

`apps/server/src/mercurian/trackers/TrackerStore.ts` **(new)** — canonical single-file order, tag `"t3/mercurian/trackers/TrackerStore"`, beside a small `schema.ts` **(new)** for the branded id and row codecs (the `commitTree/schema.ts` pattern). Depends on the Mercurian `SqlClient`, `ServerSecretStore`, and the connector registry (a `Record<TrackerKind, TrackerConnector>` provided by a `connectors/registry.ts` layer so tests can substitute stub connectors). It does not depend on `CommitStore` or `PlanningStore` — connections know nothing about plans, by design.

- `connect({ kind, token }) → TrackerConnection` — probe **first** (a refused credential creates nothing: the refusal returns to the dialog as-is), then mint the id server-side (the M-95 deviation, same reason: plain request/response), write the secret, insert the row in a transaction. If the row insert fails after the secret write, remove the secret before failing — no orphaned credentials.
- `disconnect({ connectionId }) → void` — delete the row, then remove the secret (the store's `remove` treats not-found as success, so the pair is idempotent). Unknown connection → `TrackerConnectionNotFoundError`. Nothing else is touched — when 051 lands imported plans, their origin records are content and history, not foreign keys into this table, so disconnection can never dangle them (the same by-construction argument M-96 makes for repository removal).
- `getSnapshot() → TrackersSnapshot` — all connections with their **standing**: `"connected" | "unauthorized" | "unreachable"`, derived by running the connector's `probe` through a per-connection short-TTL Effect `Cache` (~1 min, capacity bounded — the `RepositoryIdentityResolver` shape), so snapshot re-emits are cheap, the Settings page is passively truthful within a minute, and a revoked key surfaces without a refresh button. The probe at connect seeds the cache, so a fresh connection reads `connected` immediately.
- `listIssues({ connectionId, search?, cursor? }) → TrackerIssuePage` — resolve the connection, read its secret, delegate to its connector. **Fetched live, never stored** — no issue row exists anywhere in Mercurian's schema, which is what "import is selection, not synchronization" looks like at this layer. This is the read 051's import browse will page through; it ships now because it is the connection abstraction's actual product and the AC's minimal-shape clause is demonstrated on it end-to-end.
- `changes: Stream<void>` — `PubSub`-backed, published by `connect`/`disconnect`, driving the subscription exactly as `PlanningStore.changes` drives the tree.

Wiring in `server.ts`: `TrackerStore.layer` joins the Mercurian block beside `PlanningStore.layer`, same private-`SqlClient` discipline; `HttpClient` is already in the server's ambient services (telemetry uses it).

### The wire surface: one new contracts file, four methods

`packages/contracts/src/mercurianTrackers.ts` **(new)** — its own domain-owned method map, keeping `mercurian.ts` the planning surface its header says it is (the M-96 precedent):

```ts
export const MERCURIAN_TRACKER_WS_METHODS = {
  subscribeTrackers: "mercurian.subscribeTrackers",
  connectTracker: "mercurian.connectTracker",
  disconnectTracker: "mercurian.disconnectTracker",
  listTrackerIssues: "mercurian.listTrackerIssues",
} as const;
```

Wire schemas: `TrackerKind` (`Schema.Literals(["linear"])` — the family grows one literal per shipped connector; the vault's named family is design intent, not a wire enum to pre-declare), `TrackerConnectionId` (branded, the `makeEntityId` pattern), `TrackerStanding`, `TrackerConnection` (`connectionId`, `kind`, `label`, `standing`, `createdAt`), **`TrackerIssue` — exactly `{ id, title, description, url, status }`, all strings, with a doc comment quoting the vault: this struct _is_ the minimal common shape, and adding a field to it is a design decision, not a refactor** — `TrackerIssuePage` (`issues`, optional `nextCursor`), `TrackersSnapshot`/`TrackersStreamItem` (`{kind:"snapshot"}`, the tree's shape: connections are few and change on discrete human acts), the input schemas (`connectTracker` takes `kind` + `token: TrimmedNonEmptyString`; `listTrackerIssues` takes `connectionId` + optional `search`/`cursor`), and the refusals: `TrackerConnectionNotFoundError`, `TrackerAuthError`, `TrackerUnreachableError` (probe refusals on the wire, so the dialog can say which), and `MercurianTrackerError` (the operation-tagged catch-all, `MercurianPlanningError`'s shape).

Then the four standard touchpoints, each mechanical: barrel line in `contracts/src/index.ts`; four `Rpc.make` consts + `WsRpcGroup` membership in `rpc.ts` (`subscribeTrackers` with `stream: true`); scopes in `auth/RpcAuthorization.ts` — `subscribeTrackers`/`listTrackerIssues` → `AuthOrchestrationReadScope`, `connectTracker`/`disconnectTracker` → `AuthOrchestrationOperateScope`, under the same recorded rationale comment; handlers in `ws.ts` `makeWsRpcLayer` (`yield* TrackerStore`, `observeRpcEffect`/`observeRpcStreamEffect`, `"rpc.aggregate": "mercurian"`, the subscription as queue-before-snapshot + `Stream.debounce(50ms)` re-emit — the `subscribeTree` handler shape verbatim). Client-runtime: `mercurian.subscribeTrackers` joins `EnvironmentSubscriptionRpcTag` (`client-runtime/src/rpc/client.ts`).

### Client plumbing

`packages/client-runtime/src/state/mercurianTrackers.ts` **(new)** — `createMercurianTrackerAtoms(runtime)`: the subscription family plus three commands on a shared write scheduler (the `mercurianPlanning.ts` shape; no per-key concurrency — connect/disconnect are rare and global ordering is fine; `listTrackerIssues` rides a command, the `getPlanTextAt` precedent for a read that is a plain request). `apps/web/src/state/mercurianTrackers.ts` **(new)** instantiates over `connectionAtomRuntime` and exports primary-environment-keyed hooks: `useTrackers()` returning `{connections, isPending, error}`, `useConnectTracker()`, `useDisconnectTracker()` — reusing the `useEnvironmentBoundCommand` shape from `state/mercurian.ts` (extract it to a shared module rather than copying; M-96's plan wants the same extraction — whichever lands first does it, the other rebases onto it).

### Settings: the Trackers section

The vault places tracker connections in Settings ("connections are workspace configuration, managed from Settings — the issues themselves never arrive through Settings"), and the fork's Settings is the section-per-route surface the Mercurian sidebar already navigates to. Trackers becomes Mercurian's first owned section there:

- `routes/settings.trackers.tsx` **(new)** — the seven-line route file mounting one component (`settings.connections.tsx` verbatim shape).
- `settingsSearch.ts`: `"/settings/trackers"` joins the `SettingsPath` union and `SETTINGS_SECTION_LABELS` as **Trackers**, ordered after Connections (machine connections, then tracker connections, then Beta); search items for "Connect a tracker" and "Linear".
- `SettingsSidebarNav.tsx`: an icon entry in `SETTINGS_SECTION_ICONS` (a lucide icon in the existing family — `TicketIcon` or similar, implementation's pick from what the set offers).
- `components/settings/TrackersSettings.tsx` + `TrackersSettings.logic.ts` **(new)**: connection rows (tracker kind name, the connection's label, a standing badge — `connected` quiet, `unauthorized`/`unreachable` amber with the refusal's one-line meaning — and the connected date), each with a Disconnect action behind a `ui/alert-dialog` confirm whose copy says what disconnection is: the connection and its credential are removed from this workspace; nothing in the tracker is touched. An empty state saying what trackers are for (issues enter as the starting points of plans — import arrives next) with the Connect action. A **Connect tracker** button opening the connect dialog.
- `ConnectTrackerDialog.tsx` **(new)**: a kind list rendered from `TrackerKind` — one row today, Linear, so the dialog reads as "connect Linear" until the family grows — then the credential step: an API-key input (`type="password"`, with a one-line pointer to where a Linear personal API key comes from), Connect → `connectTracker`. A `TrackerAuthError` renders in place as "Linear didn't accept this key"; `TrackerUnreachableError` as "Couldn't reach Linear". Success closes the dialog; the row appears via the subscription. The token state lives only in the dialog and is dropped on close.

No import affordance appears anywhere in Settings — the vault is explicit that issues never arrive through Settings, and the AC excludes the browse. Mobile is untouched, per every Mercurian issue so far. **Reverse states** (AGENTS.md): connect has disconnect; both are visible as the row's presence and standing; there is no hidden state.

### Docs (AGENTS.md §Hit every surface)

`docs/user/trackers.md` **(new)**: connecting Linear (where the API key comes from, what the connection can and cannot do — shipped-product voice), standing meanings, disconnecting; explicit that Mercurian only reads. `docs/internals/glossary.md`: **Tracker**, **Tracker connection**, **Minimal common shape** entries. `docs/internals/overview.md`: a sentence pointing at `mercurian/trackers/`.

### Gaps and findings carried out of discovery

- The AC's "every imported issue's origin link opens the issue in the tracker" cannot be walked against an _imported_ issue in this issue's scope (import is 051); it is demonstrated here as a property of the shape — the `url` field is the tracker's own canonical link, asserted in connector tests and clickable in any consumer. 051 inherits it by construction.
- Migration numbering races M-96 (both plans claim 003; whichever lands second renumbers — flagged above).
- `useEnvironmentBoundCommand` extraction is shared work with M-96 (flagged above).
- The vault's Settings note lists more Settings content (Environments, Providers, confirm-gates, Archived-for-plans) — none of it is this issue's; the Trackers section lands alone and the section-per-route shape leaves every later section its own slot.

## Implementation Checklist

- [ ] Branch `venk/m-98-tracker-connections` off `main`.
- [ ] `mercurian/persistence/Migrations/003_TrackerConnections.ts` **(new)**: `tracker_connections` (DDL above); register `[3, "TrackerConnections"]` in `mercurian/persistence/Migrations.ts` (renumber to 004 if M-96's migration has landed first).
- [ ] `apps/server/src/mercurian/trackers/schema.ts` **(new)**: branded id, row codecs (`commitTree/schema.ts` pattern).
- [ ] `apps/server/src/mercurian/trackers/connector.ts` **(new)**: `TrackerConnector` interface (probe, listIssues — **no write methods, ever**), probe result and refusal types.
- [ ] `apps/server/src/mercurian/trackers/connectors/LinearConnector.ts` **(new)**: GraphQL documents as named `query` constants; `HttpClient` POST with the key in `Authorization`; mapping to the five-field shape (`id` = `identifier`, `description` absent → `""`, `status` = `state.name`, `url` = canonical); auth vs. unreachable refusal mapping; cursor paging.
- [ ] `apps/server/src/mercurian/trackers/connectors/registry.ts` **(new)**: `Record<TrackerKind, TrackerConnector>` as a layer (stub-swappable in tests).
- [ ] `apps/server/src/mercurian/trackers/TrackerStore.ts` **(new)**: tag `"t3/mercurian/trackers/TrackerStore"`; `connect` (probe-first, secret write + row insert with cleanup-on-failure), `disconnect` (row + secret, idempotent secret removal), `getSnapshot` (standing via per-connection short-TTL probe cache), `listIssues` (live, never stored), `changes` PubSub.
- [ ] `apps/server/src/server.ts`: `TrackerStore.layer` (+ registry layer) in the Mercurian block, private `SqlClient` discipline.
- [ ] `packages/contracts/src/mercurianTrackers.ts` **(new)**: `MERCURIAN_TRACKER_WS_METHODS`, `TrackerKind`, `TrackerConnectionId`, `TrackerStanding`, `TrackerConnection`, **`TrackerIssue` (exactly five fields, doc-commented as the minimal common shape)**, `TrackerIssuePage`, snapshot/stream shapes, inputs, refusals; barrel line in `contracts/src/index.ts`.
- [ ] `packages/contracts/src/rpc.ts`: four `Rpc.make` consts (`subscribeTrackers` streaming) + `WsRpcGroup` membership.
- [ ] `apps/server/src/auth/RpcAuthorization.ts`: `subscribeTrackers`/`listTrackerIssues` → `AuthOrchestrationReadScope`; `connectTracker`/`disconnectTracker` → `AuthOrchestrationOperateScope`.
- [ ] `apps/server/src/ws.ts`: `yield* TrackerStore` in `makeWsRpcLayer`; four handlers, aggregate `"mercurian"`; the subscription as queue-before-snapshot + 50ms-debounced re-emit on `changes` (the `subscribeTree` shape); token never logged (refusal causes carry no payload echo).
- [ ] `packages/client-runtime/src/rpc/client.ts`: `mercurian.subscribeTrackers` joins `EnvironmentSubscriptionRpcTag`.
- [ ] `packages/client-runtime/src/state/mercurianTrackers.ts` **(new)**: `createMercurianTrackerAtoms` (subscription + `connectTracker`/`disconnectTracker`/`listTrackerIssues` on a shared write scheduler).
- [ ] `apps/web/src/state/mercurianTrackers.ts` **(new)**: instantiate; `useTrackers` + command hooks; extract `useEnvironmentBoundCommand` from `state/mercurian.ts` into a shared helper (coordinate with M-96 if it landed first).
- [ ] `apps/web/src/components/settings/TrackersSettings.tsx` + `TrackersSettings.logic.ts` **(new)**: rows (kind, label, standing badge, date), disconnect confirm via `ui/alert-dialog`, empty state, Connect button.
- [ ] `apps/web/src/components/settings/ConnectTrackerDialog.tsx` **(new)**: kind list from `TrackerKind`, password-type key input, per-refusal inline errors, token state dropped on close.
- [ ] `routes/settings.trackers.tsx` **(new)**; `settingsSearch.ts` (`SettingsPath`, label **Trackers** after Connections, search items); `SettingsSidebarNav.tsx` icon entry.
- [ ] Do **not** add: any RPC or connector method that writes to a tracker; any stored issue row or issue cache table; any stored standing/status column; any import affordance in Settings; any token in a response, snapshot, log, or sqlite row. Do **not** touch: upstream `persistence/Migrations/*`, `orchestration/`, t3code's settings panels beyond the three registration points, mobile.
- [ ] Docs: `docs/user/trackers.md`; glossary **Tracker** / **Tracker connection** / **Minimal common shape**; `docs/internals/overview.md` sentence.
- [ ] Commits `feat(server): tracker connections and the Linear connector (M-98)`, `feat(web): trackers settings section (M-98)`.

## Test Plan

Runner: `vp test run <files>` (targeted only); server tests co-located, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory` with a stubbed connector registry and a temp-dir (or stubbed) `ServerSecretStore`; streams drained, never sleeps.

- [ ] `003_TrackerConnections.test.ts` — table/columns via `PRAGMA table_info`; re-run is a no-op (001/002 pattern); **no token, status, or issue column exists** (assert the column set exactly).
- [ ] `TrackerStore.test.ts`:
  - [ ] `connect` happy path: row exists, secret exists under `mercurian-tracker-<id>`, label = probe's answer, snapshot shows the connection with `standing: "connected"`.
  - [ ] Probe refusal at connect: auth refusal → `TrackerAuthError` surfaced, **no row, no secret**; unreachable likewise.
  - [ ] Secret-write failure path: no orphan row; row-insert failure: no orphan secret.
  - [ ] `disconnect`: row and secret both gone; repeat disconnect of the same id → `TrackerConnectionNotFoundError`; nothing else in the store changed (assert table counts).
  - [ ] Standing derivation: stub probe flips to auth-refusal → snapshot (after TTL or with TTL zeroed for test) reads `unauthorized`; standing is never read from sqlite (no column to read — covered by the migration assertion).
  - [ ] `listIssues`: delegates with the stored secret; **the returned issues deep-equal the five-field shape** — a stub connector answering with extra fields still yields wire values carrying exactly `id`/`title`/`description`/`url`/`status` (the schema encode is the fence); unknown connection → `TrackerConnectionNotFoundError`.
  - [ ] `changes` emits on connect and disconnect (drain around each).
  - [ ] Coexistence shape: ambient `SqlClient` still resolves upstream's store; `tracker_connections` invisible to it (`Coexistence.test.ts` layering).
- [ ] `LinearConnector.test.ts` — stubbed `HttpClient`:
  - [ ] **Pull-only:** every exported GraphQL document parses as operation type `query` — the structural write-back fence.
  - [ ] Response mapping: `identifier` → `id`, null description → `""`, `state.name` → `status`, `url` passthrough; extra response fields do not survive; `pageInfo` → `nextCursor`.
  - [ ] 401-shaped response → `TrackerAuthRefusal`; transport error → `TrackerUnreachableRefusal`.
  - [ ] The request carries the key in `Authorization` and nothing logs it.
- [ ] `TrackersSettings.logic.test.ts` / `ConnectTrackerDialog` logic tests — standing → badge/copy mapping; kind list renders from `TrackerKind` (one entry today); refusal → inline message mapping; row presentation.
- [ ] AC walk in a real client (`test-t3-app`, on request per AGENTS.md): connect Linear with a real key from Settings → row appears with label and `connected` standing; a wrong key is refused in the dialog and creates nothing; `listTrackerIssues` returns real issues in exactly the narrow shape and each `url` opens the issue in Linear; revoke the key in Linear → standing decays to `unauthorized` within the TTL; disconnect from Settings → row gone, secret file gone; grep the session's logs and DB for the key → absent.
- [ ] Targeted typecheck + lint for touched packages (`contracts`, `client-runtime`, `server`, `web`).

---

_Review note: the significant calls made here — Linear as the first connector (dogfooding + cheapest auth); the connector interface with no write methods plus query-only-document tests as the structural pull-only fence; `listTrackerIssues` shipped now as the seam 051 consumes rather than deferred with the browse UI; tokens in `ServerSecretStore` files keyed by connection id, never echoed; standing probed live through a short-TTL cache rather than stored or button-refreshed; `id` = the tracker's human-facing issue key; `status` as the tracker's own uninterpreted status word; no UNIQUE on `kind`; a separate `mercurianTrackers.ts` contracts domain; the Trackers section placed after Connections — can be pressure-tested with `technical-plan-decision-review`._
