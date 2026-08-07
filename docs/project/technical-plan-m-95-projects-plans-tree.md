# Technical Plan — M-95: Projects, plans, and the project tree sidebar

_Generated from the Goal/AC of Linear issue M-95 (see the issue for the full AC). Implements backlog 020 (Phase 2 — App shell) on the commit store 010 landed (`docs/project/technical-plan-m-94-multi-parent-commit-model.md`), under [ADR 001](../architecture/local-first-runtime.md) and [ADR 004](../architecture/fork-baseline.md). Design sources are the almagest vault notes the issue cites: Left Sidebar, Projects, Plans, Repository Filter, T3code Sidebar, Issues._

**Goal, in one sentence:** make projects and plans exist — a `projects`/`plans` layer in Mercurian's store over the commit graph, a small RPC surface, and the left sidebar reshaped from t3code's thread tree into the project tree (projects → plans, Workspace group below) — with plan birth obeying the first-commit rule and a minimal conversation surface as the planning space.

**A structural note up front:** ADR 004 §1 names "app-shell reshaping (backlog 020) lands on `main`" as the fork's **cut-over trigger**. This plan is that reshaping: unlike M-94's purely additive discipline, it deliberately edits upstream-owned files (`AppSidebarLayout.tsx`, the route tree, `rpc.ts`, `ws.ts`). The edits stay minimal and the thread machinery is parked in place rather than deleted — it is the substrate coding sessions (061–066) return to. Landing this PR is the event ADR 004 says ends bounded upstream tracking; that consequence is the maintainers' call, not this plan's, but it should be taken knowingly.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                  | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Mercurian server code is additive under `apps/server/src/mercurian/`, in its own `mercurian.sqlite` with its own migration sequence; Mercurian `SqlClient` provided privately (`Layer.provide`, never `provideMerge`)                                                                                                                                                                         | ADR 001 §2–3; `mercurian/persistence/Sqlite.ts` (file-header rule), `server.ts:244–248`; `persistence/Coexistence.test.ts`                | High       |
| Canonical single-file Effect service: imports → schemas/errors → `Context.Service` tag with inline interface → `make` → `export const layer`; typed refusals as `Schema.TaggedErrorClass`; `SqlSchema.*` row codecs; writes in `sql.withTransaction`                                                                                                                                          | `.macroscope/check-run-agents/effect-service-conventions.md`; exemplar `mercurian/commitTree/CommitStore.ts`                              | High       |
| RPC surface: method-name map in the domain contracts file, `Rpc.make` consts + membership in `WsRpcGroup` (`packages/contracts/src/rpc.ts:165,786`); every method needs a scope in `RPC_REQUIRED_SCOPES` (type- and test-enforced, `apps/server/src/auth/RpcAuthorization.ts:23`, `.test.ts:15`); handlers in `ws.ts` `makeWsRpcLayer` wrapped in `observeRpcEffect`/`observeRpcStreamEffect` | trace of `projects.listEntries` and `orchestration.subscribeShell` end to end                                                             | High       |
| Client data layer: `@effect/atom-react` atoms built from `packages/client-runtime/src/state/runtime.ts` factories (`createEnvironmentRpcQueryAtomFamily` / `...SubscriptionAtomFamily` / `...RpcCommand`), per-domain files in `client-runtime/src/state/` + `apps/web/src/state/`; new **streaming** RPCs must join `EnvironmentSubscriptionRpcTag` (`client-runtime/src/rpc/client.ts:42`)  | `state/shell.ts`, `state/projectCommands.ts`, `apps/web/src/state/projects.ts`                                                            | High       |
| Live lists arrive as snapshot + event stream over one `stream: true` RPC (client passes resume state; server queue-before-snapshot)                                                                                                                                                                                                                                                           | `subscribeShell`: contracts `orchestration.ts:440–502`, server `ws.ts:1129–1235`, client `client-runtime/state/shell.ts`                  | High       |
| Routing: TanStack Router v1, file-based routes in `apps/web/src/routes/`, work surfaces under the `_chat` pathless layout with its `beforeLoad` auth gate; static segments beat params                                                                                                                                                                                                        | `routes/_chat.tsx`, `routes/_chat.draft.$draftId.tsx`, `routeTree.gen.ts`                                                                 | High       |
| Sidebar UI: shadcn-style primitives in `components/ui/sidebar.tsx` (`SidebarProvider/Sidebar/SidebarRail/SidebarGroup/SidebarMenu*`), Tailwind v4 semantic tokens (`bg-sidebar-row-active/-selected/-hover`), lucide icons, `cn()`; row-state classes via a pure resolver                                                                                                                     | `ui/sidebar.tsx`, `Sidebar.logic.ts:382` (`resolveThreadRowClassName`), `components.json`                                                 | High       |
| Client preference persistence, three tiers: `ClientSettings` schema for cross-surface prefs (`contracts/settings.ts`), `useUiStateStore` (`t3code:ui-state:v1`) for per-entity UI state with debounced persist, schema-validated raw localStorage for one-offs (`hooks/useLocalStorage.ts`; width key `chat_thread_sidebar_width`)                                                            | `settings.ts:31–121`, `uiStateStore.ts`, `AppSidebarLayout.tsx:49–59`                                                                     | High       |
| Birth-on-first-send: a new thread is a client-side draft (dedicated route + persisted draft store, one reusable draft per project) and the server row is created only as part of the first send; the sidebar shows no row until the server upserts it                                                                                                                                         | `hooks/useHandleNewThread.ts`, `composerDraftStore.ts`, `ChatView.tsx` bootstrap, `routes/_chat.draft.$draftId.tsx` promote-then-navigate | High       |
| Tests: co-located `*.test.ts`, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory`; sidebar behavior factored into pure logic helpers with unit tests; run `vp test run <files>`, never repo-wide                                                                                                                                                                             | `CommitStore.test.ts`, `001_CommitGraph.test.ts`, `Sidebar.logic.ts` + tests; AGENTS.md §Verifying                                        | High       |
| Conventional commits `feat(scope):`; branch `venk/m-<n>-<slug>`                                                                                                                                                                                                                                                                                                                               | M-94 checklist; AGENTS.md §Pull requests                                                                                                  | Medium     |
| Empty states as quiet placeholder rows/`ui/empty` primitives, never hidden sections                                                                                                                                                                                                                                                                                                           | `Sidebar.tsx:974–984` ("No threads yet"), `:2981` ("No projects yet"); vault "T3code Sidebar" §Empty states                               | Medium     |

## Design

### Vocabulary seam: two kinds of "project"

t3code's `projection_projects` are workspace roots on disk; Mercurian's projects are containers of plans (the collision ADR 001 §3 assigns 020/040 to reconcile "at the surface"). This plan reconciles by prefix: everything Mercurian-side that crosses the wire is named `Mercurian*` (`MercurianProjectId`, `MercurianProject`) so the contracts barrel (`export *`) cannot collide with `project.ts`; `Plan`/`PlanId`/`PlanShell` are unprefixed (verified free — only `OrchestrationProposedPlanId` exists, and upstream plan-mode is slated to strip at 062). Web components live under `apps/web/src/components/mercurian/`. The t3code project pickers disappear from navigation with the thread sidebar; nothing renames upstream's types (renames are cut-over work, ADR 004 §3).

### Data model: migration 002, projects and plans beside the commit graph

`mercurian/persistence/Migrations/002_ProjectsPlans.ts` **(new)**, same idempotent shape as 001, in the same `mercurian.sqlite` — so `plans → commit_histories` is an ordinary same-database FK (the cross-store id-reference seam of ADR 001 §3 is not needed inside Mercurian's own file):

```sql
CREATE TABLE IF NOT EXISTS projects (
  project_id  TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  plan_id     TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(project_id),
  history_id  TEXT NOT NULL UNIQUE REFERENCES commit_histories(history_id),
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id, updated_at);
```

- `history_id UNIQUE` is "one plan per planning space" (Plans) made structural: exactly one plan per history.
- **Deliberately absent**, honoring the exclusions: no status columns (021), no `archived_at`/delete verbs (070), no `project_repositories` table (040 — the vault resolved a project's repository set as a default that "may be empty until then"; the table arrives with the feature that manages it), no import-origin columns (051 — Issue Import adds them when imported plans exist).
- A plan row exists **only** when its history does — `createPlan` takes the first message, so "nothing exists until its first commit" is enforced by API shape, not by cleanup.

### `PlanningStore`: the service over projects, plans, and the commit store

`apps/server/src/mercurian/planning/PlanningStore.ts` **(new)** — second Mercurian service, canonical single-file order, tag `"t3/mercurian/planning/PlanningStore"`. It depends on the Mercurian `SqlClient` **and on `CommitStore`** (plans compose the commit graph rather than reimplementing it). Interface:

- `createProject({name, createdAt}) → MercurianProject` — server-mints `project_id`. (Deviation from t3code's client-minted thread ids, deliberately: t3code mints client-side because the first turn command must reference the thread optimistically; here creation is a plain request/response and the draft page needs no id before the server answers.)
- `getTreeSnapshot() → PlanningTreeSnapshot` — all projects + plan shells (`planId, projectId, title, createdAt, updatedAt`), plans ordered `updated_at DESC` per project (the "newest plans" the AC shows).
- `createPlan({projectId, message, createdAt}) → PlanDetail` — the birth act: `CommitStore.createHistory` with a human-authored `message` root commit (`payload: {text}`, `rootPublished: false` — born blank is born private; born-published roots belong to Issue Import, 051), then the plan row. Title derived from the message's first line (~80 chars, `"Untitled plan"` fallback) — the vault's self-titling-from-first-exchange is an assistant behavior for later; a derived title keeps rows legible now. Ordering: history first, then plan row (the FK direction); if `sql.withTransaction` composes across the nested `CommitStore` transaction (savepoints), wrap both — verify at implementation; otherwise the ordered writes leave at worst an orphan history, which is inert and harmless.
- `appendMessage({planId, text, createdAt}) → PlanMessage` — appends a human `message` commit whose parent is the history's current tip (max-sequence commit), bumps `plans.updated_at`. Server-computed tip is correct while the planning surface renders one linear path; explicit parent selection arrives with the DAG Explorer, not here.
- `getPlan({planId}) → PlanDetail` — plan + its commits in sequence order, projected to `PlanMessage` (`commitId, authorKind, text, createdAt`); visibility `"all"` (local store is the author's workspace, per M-94's visibility design).
- `changes: Stream<void>` — a `PubSub`-backed change signal published by every mutation; what drives the tree subscription (below).

Refusals: `MercurianProjectNotFoundError`, `PlanNotFoundError` (`Schema.TaggedErrorClass`, message getters, per conventions doc); SQL/decode boundary reuses `PersistenceSqlError`/`PersistenceDecodeError`; `CommitStoreRefusal` passes through untranslated — a planning bug surfacing a store refusal should be visible as exactly what it is.

Wiring in `server.ts`: extend the existing Mercurian block — `PlanningStore.layer.pipe(Layer.provide(CommitStore.layer), Layer.provide(MercurianSqlite.layer))` merged beside the current `MercurianPersistenceLayerLive` (same private-`SqlClient` discipline the `Sqlite.ts` header mandates).

### The wire surface: five methods, one new contracts file

`packages/contracts/src/mercurian.ts` **(new)** — the promotion M-94 anticipated ("promoting the schemas to contracts then is an additive move"): `MercurianProjectId`, `PlanId`, `MercurianCommitId`, `PlanAuthorKind` (mirror of the store's `CommitAuthorKind`), `MercurianProject`, `PlanShell`, `PlanMessage`, `PlanDetail`, `PlanningTreeSnapshot`, `PlanningTreeStreamItem`, the five input schemas, the two tagged errors, and:

```ts
export const MERCURIAN_WS_METHODS = {
  subscribeTree: "mercurian.subscribeTree",
  createProject: "mercurian.createProject",
  createPlan: "mercurian.createPlan",
  appendPlanMessage: "mercurian.appendPlanMessage",
  getPlan: "mercurian.getPlan",
} as const;
```

(the `ORCHESTRATION_WS_METHODS` precedent: a domain-owned method map rather than growing `WS_METHODS`). The server's `commitTree/schema.ts` stays the store's source of truth; contracts carry only what the surface renders — `payload` never crosses as `Unknown`, it crosses as `text`.

Then the four standard touchpoints: barrel line in `contracts/src/index.ts`; five `Rpc.make` consts + `WsRpcGroup` membership in `rpc.ts` (`subscribeTree` with `stream: true`); scopes in `RpcAuthorization.ts` — **reads `AuthOrchestrationReadScope`, mutations `AuthOrchestrationOperateScope`** (planning is workspace orchestration in the same trust domain; a Mercurian-specific scope would force re-pairing decisions now for no boundary that exists yet — revisit with the shared-workspace phase, ADR 001 §4); handlers in `ws.ts` `makeWsRpcLayer` (`yield* PlanningStore`, `observeRpcEffect`/`observeRpcStreamEffect`, `"rpc.aggregate": "mercurian"`).

### Tree freshness: snapshot-re-emit, not sequenced deltas

`mercurian.subscribeTree` emits `{kind:"snapshot", snapshot}` on subscribe and again (debounced ~50ms, latest-wins) on every `PlanningStore.changes` signal. This is deliberately simpler than `subscribeShell`'s sequence/resume/coalesce machinery (significant choice; rationale): the shell stream earns that machinery because thread shells are numerous and churn continuously under live sessions; the planning tree is project + plan shells only — small rows, mutated by discrete human acts — and the Mercurian store is plain relational (M-94's decision), so there is no event log to derive deltas from without inventing one. Re-sending a small snapshot on rare change is the smallest model that is correct (AGENTS.md temperament), and ADR 002 (planning-space events) remains free to replace this seam when it is written — nothing forecloses it. The client passes no resume state.

### The reshaped sidebar

`apps/web/src/components/mercurian/ProjectTreeSidebar.tsx` **(new)** + `ProjectTreeSidebar.logic.ts` **(new)** (pure helpers, unit-tested, per `Sidebar.logic.ts` precedent). Composition, top to bottom, all on the existing `ui/sidebar.tsx` primitives and semantic tokens:

- `SidebarChromeHeader` (kept as is — brand, trigger, env pill).
- **The project tree**: one `SidebarGroup`. Per project: a row (name, chevron, hover-revealed new-plan `SquarePenIcon` button — the T3code project-row pattern, `Sidebar.tsx:~2305`), expansion persisted; expanded → plan rows (title + relative timestamp; **no status pill — 021**), newest first, sliced to the visible count with **Show more / Show less** past it (the `getVisibleThreadsForProject` shape, reimplemented as `getVisiblePlansForProject` keeping the active plan always visible); collapsed → nothing rolled up yet (rollups are 021). A **New project** affordance in the group header (`FolderPlusIcon` button → small `ui/dialog` with a name `ui/input`; the palette that would own this is 022). No search entry above the tree — that is the palette, 022.
- **Workspace group**: a second `SidebarGroup` titled "Workspace" with two `SidebarMenuButton` rows — **Repositories** (→ `/repositories`) and **Settings** (→ `/settings`). The Settings row moves here out of `SidebarChromeFooter` (which keeps only the update pills); the vault places Settings in the Workspace group, not a footer.
- On `/settings*` the panel yields to `SettingsSidebarNav` (already its own component, `components/settings/SettingsSidebarNav.tsx` — same conditional v1 uses at `Sidebar.tsx:3593`), returning when you leave — the T3code behavior, kept.
- **Empty states**: no projects → quiet `ui/empty` placeholder ("No projects yet") with the New project affordance; an expanded project with no plans → a muted "No plans yet" row (`Sidebar.tsx:974` pattern). Neither section ever hides.
- **Selection**: `resolveTreeSelection(pathname, params)` in the logic file — a plan row is active while the route is anywhere under `/plans/$planId` (prefix match, so future subpages inherit); its project row gets the containing-selection treatment; Repositories is active under `/repositories*`, Settings under `/settings*`. Row classes via a `resolvePlanRowClassName` mirroring `resolveThreadRowClassName` (`bg-sidebar-row-active` / `-hover`).

`AppSidebarLayout.tsx` (reshape edit): drop the `ThreadSidebar`/`ThreadSidebarV2` imports and the v1/v2 switch (`useSidebarV2Enabled`, `data-sidebar-version`), mount `<ProjectTreeSidebar />` unconditionally. Both thread sidebar components, `Sidebar.logic.ts`, and their satellites stay in tree **unreferenced** — parked in place, ADR 004 §2 style, awaiting the coding-session surfaces (061–066) that will mine them; deleting them is cut-over cleanup, not this issue.

### Remembered collapse and resize

- **Width**: the existing machinery transfers untouched — `SidebarRail` drag, `THREAD_SIDEBAR_WIDTH_STORAGE_KEY` localStorage, live viewport clamp (`AppSidebarLayout.tsx:129–201`). Key name stays (renames are cut-over).
- **Open/collapsed**: today this is _not_ actually remembered — `SidebarProvider` is mounted `defaultOpen` and the `sidebar_state` cookie is written but never read (`ui/sidebar.tsx`). The AC says both are remembered, so this plan fixes it: `AppSidebarLayout` reads initial open state via `getLocalStorageItem("t3code:sidebar-open:v1", Schema.Boolean)` and drives `SidebarProvider` controlled (`open`/`onOpenChange`, which the shadcn-shape provider already accepts), persisting on change; the write-only cookie code is removed. localStorage over cookie: it is where every sibling preference already lives, schema-validated.
- **Per-project expansion**: a new persisted field on `useUiStateStore` — `mercurianProjectExpandedById: Record<string, boolean>` + `setMercurianProjectExpanded` reducer (default expanded), riding the existing `t3code:ui-state:v1` debounced persistence. A new field rather than reusing `projectExpandedById`: that map is keyed by t3code logical-project keys with a legacy fallback ladder that Mercurian ids must not enter.
- **Visible count**: new `ClientSettings` key `sidebarPlanPreviewCount` reusing the `SidebarThreadPreviewCount` schema/bounds, default 6 (`contracts/settings.ts` + `DEFAULT_CLIENT_SETTINGS` + the optional patch field). Adjustment UI is not built here (the sort/preferences menu it would live in is 021/022-adjacent); the setting exists so the tree honors it and the knob has a home.
- **Show more/less expansion**: ephemeral `useState`, deliberately forgotten between visits — both T3code ("deliberately forgets show-more expansion") and v1's implementation agree.

### Routing: the thread-first shell gives way

Removed from the route tree (files deleted; components they mounted stay parked): `routes/_chat.$environmentId.$threadId.tsx`, `routes/_chat.draft.$draftId.tsx`. `routes/_chat.index.tsx` is rewritten from the auto-draft thread landing (`IndexDraftLanding`/`NoProjectsHero`) to a quiet placeholder surface (no Dashboard — removed from the design; the tombstone's temperament is a placeholder, not a landing page). `routes/_chat.tsx` slims to its auth gate + `AppSidebarLayout` + `Outlet`: the thread keybinding/shortcut plumbing (`ChatRouteGlobalShortcuts` — new-thread, thread-stepping, terminal/preview context) leaves with the routes that gave it meaning; `sidebar.toggle` survives (it lives in `AppSidebarLayout`). The `chat.*` keybindings become inert entries until coding sessions re-earn them — noted as a finding, not silently.

Added: `routes/_chat.plans.$planId.tsx` (planning space), `routes/_chat.plans.draft.$draftId.tsx` (plan draft — static `draft` segment wins over `$planId`, same trick as the thread routes), `routes/_chat.repositories.tsx` (the Repositories placeholder page: an `ui/empty` quiet placeholder, per the vault's "empty placeholder today" — management arrives at 040). Settings routes are untouched. **No plan route carries an environment id** (threads used `/$environmentId/$threadId`): Mercurian's store lives on the primary environment's server, addressed via `usePrimaryEnvironmentId()` (`state/environments.ts:59`) — environments-as-navigation is exactly what ADR 004 strips at 020/040, and cross-environment planning is deferred by ADR 001 §4.

Dashboard/Concepts: nothing to remove — the fork never had them (they lived in the pre-fork prototype; the route list confirms no such routes). Recorded so the AC's tombstone reference has an answer.

### Plan birth: the draft flow, re-derived for plans

The fork's own birth pattern (draft route + client store + born-on-first-send) transfers almost verbatim; what does **not** transfer is `composerDraftStore`'s thread entanglement (model selection, worktrees, env modes — 3.6k lines of machinery a plan draft doesn't have). So: `apps/web/src/planDraftStore.ts` **(new)** — a small zustand store, localStorage-persisted (`t3code:plan-drafts:v1`), one reusable draft per project (`draftId, projectId, text, createdAt`), mirroring `useHandleNewThread`'s get-or-reuse so an abandoned draft is picked back up rather than duplicated.

The flow, against the AC's birth clause: project row's new-plan button → get-or-create the project's draft → navigate `/plans/draft/$draftId`. The draft page is the creator's open composer and nothing else — **no tree row exists** (the tree renders only server plan rows, and no server row exists). First send → `mercurian.createPlan` → on success, clear the draft and `navigate({to: "/plans/$planId", replace: true})`; the tree subscription's next snapshot shows the row — birth is visible exactly at the root commit. Abandoning (navigating away, never sending) leaves a client-local draft blob and nothing else — "a plan you never messaged never existed"; the draft's text is still there if they return, which is the composer-draft behavior the vault lists as a clean transfer.

### The planning space, minimal

`apps/web/src/components/mercurian/PlanningSpace.tsx` **(new)**, mounted by the plan route: plan title header, the conversation as a chronological message list (`getPlan` → `PlanMessage[]`, human/assistant styling by `authorKind`), and a minimal composer (auto-growing textarea + send, `ui/` primitives — **not** the Lexical thread `Composer`; that concept arrives with the plan artifact 030 and the vault's Composer note). Send → `appendPlanMessage` (via `useAtomCommand`) → refresh the `getPlan` query atom. No live stream for the open conversation: the only writer today is the person looking at it; the seam upgrades when assistant turns exist (ADR 002 territory). Draft variant of the same surface for `/plans/draft/$draftId`, empty history, send wired to `createPlan`.

**Scope note, stated plainly:** nothing in this issue's AC gives the planning space an assistant — no provider turns, no suggested messages, no plan artifact (030), no DAG surface. The surface this plan builds renders the commit path and appends human message commits; it is the seam those features land on. Consequently every commit written through this surface is `kind: "message"`, `author_kind: "human"` — the store's other kinds stay dark until their issues arrive.

Client plumbing per the discovered pattern: `packages/client-runtime/src/state/mercurianPlanning.ts` **(new)** — `createMercurianPlanningAtoms(runtime)` bundling the subscription (`subscribeDynamic` family for `subscribeTree`), the `getPlan` query family, and the three commands; `mercurian.subscribeTree` joins `EnvironmentSubscriptionRpcTag` (`rpc/client.ts:42`); `apps/web/src/state/mercurian.ts` **(new)** instantiates against `connectionAtomRuntime` and exports the hooks the components use (`useMercurianTree()`, `usePlanDetail(planId)`), all keyed to the primary environment.

### Docs (AGENTS.md §Hit every surface)

Behavior a user notices → `docs/user/` (sidebar is now the project tree; plans and how they're born); vocabulary → `docs/internals/glossary.md` (Mercurian **Project**, **Plan**, **Planning space** entries beside the existing Planning-history section, and a disambiguation line on upstream's Project entry — the reconciliation ADR 001 §3 assigned to this phase); architecture → a sentence in `docs/internals/overview.md` pointing at `mercurian/planning/`. Mobile is parked (ADR 004 §2 — no mobile work); desktop wraps web and inherits.

### Gaps and findings carried out of discovery

- ADR 002 (planning-space events) and ADR 003 (`publish-as-act.md`) still don't exist; this plan's snapshot-re-emit and query-refresh seams are written to be replaceable by ADR 002 without contract breakage.
- The cut-over trigger fires when this lands (ADR 004 §1) — surface to maintainers on the PR.
- `chat.*` keybindings and the command palette's thread actions become inert with the thread routes gone; the palette itself is rebuilt at 022.
- Coding sessions are designed as the tree's third level; they are absent here because none exist until 061+ — the tree's row model should not pre-build an empty third level.

## Implementation Checklist

- [ ] Branch `venk/m-95-projects-plans-and-the-project-tree-sidebar` off `main`.
- [ ] `mercurian/persistence/Migrations/002_ProjectsPlans.ts` **(new)** + register `[2, "ProjectsPlans", …]` in `mercurian/persistence/Migrations.ts`.
- [ ] `apps/server/src/mercurian/planning/schema.ts` **(new)**: `MercurianProjectId`, `PlanId`, row schemas (branded-id pattern from `commitTree/schema.ts`).
- [ ] `apps/server/src/mercurian/planning/PlanningStore.ts` **(new)**: errors, `Context.Service` tag `"t3/mercurian/planning/PlanningStore"` — `createProject`, `getTreeSnapshot`, `createPlan`, `appendMessage`, `getPlan`, `changes`; `make` acquiring `SqlClient` + `CommitStore`; `layer`. Verify nested `sql.withTransaction` (savepoint) behavior for `createPlan`; fall back to history-then-row ordered writes.
- [ ] `apps/server/src/server.ts`: extend the Mercurian layer block with `PlanningStore.layer` (private `SqlClient`, `CommitStore` provided).
- [ ] `packages/contracts/src/mercurian.ts` **(new)**: `MERCURIAN_WS_METHODS`, wire schemas, inputs, `MercurianProjectNotFoundError`/`PlanNotFoundError`; barrel line in `contracts/src/index.ts`.
- [ ] `packages/contracts/src/rpc.ts`: five `Rpc.make` consts (`subscribeTree` streaming) + `WsRpcGroup` membership.
- [ ] `apps/server/src/auth/RpcAuthorization.ts`: `subscribeTree`/`getPlan` → `AuthOrchestrationReadScope`; `createProject`/`createPlan`/`appendPlanMessage` → `AuthOrchestrationOperateScope`.
- [ ] `apps/server/src/ws.ts`: `yield* PlanningStore` in `makeWsRpcLayer`; five handlers (`observeRpcEffect`/`observeRpcStreamEffect`, aggregate tag `"mercurian"`); tree stream = initial snapshot + debounced re-emit on `changes`.
- [ ] `packages/client-runtime/src/rpc/client.ts`: add `mercurian.subscribeTree` to `EnvironmentSubscriptionRpcTag`.
- [ ] `packages/client-runtime/src/state/mercurianPlanning.ts` **(new)**: `createMercurianPlanningAtoms` (subscription + `getPlan` query + three commands) via `state/runtime.ts` factories.
- [ ] `apps/web/src/state/mercurian.ts` **(new)**: instantiate over `connectionAtomRuntime`; `useMercurianTree`, `usePlanDetail`, command hooks; primary-environment keyed.
- [ ] `apps/web/src/planDraftStore.ts` **(new)**: persisted one-draft-per-project store (`t3code:plan-drafts:v1`).
- [ ] `apps/web/src/components/mercurian/ProjectTreeSidebar.tsx` + `ProjectTreeSidebar.logic.ts` **(new)**: tree, Workspace group, New-project dialog, `SettingsSidebarNav` yield, empty states, selection resolvers, `getVisiblePlansForProject` with show more/less.
- [ ] `apps/web/src/components/mercurian/PlanningSpace.tsx` **(new)**: message list + minimal composer; draft variant.
- [ ] Routes: **add** `_chat.plans.$planId.tsx`, `_chat.plans.draft.$draftId.tsx`, `_chat.repositories.tsx`; **delete** `_chat.$environmentId.$threadId.tsx`, `_chat.draft.$draftId.tsx`; rewrite `_chat.index.tsx` (quiet placeholder); slim `_chat.tsx` to auth gate + layout.
- [ ] `apps/web/src/components/AppSidebarLayout.tsx`: mount `ProjectTreeSidebar` unconditionally (drop v1/v2 switch); controlled `SidebarProvider` open state persisted to `t3code:sidebar-open:v1` (replace the write-only cookie).
- [ ] `apps/web/src/uiStateStore.ts`: `mercurianProjectExpandedById` + reducer, in `PersistedUiState`.
- [ ] `packages/contracts/src/settings.ts`: `sidebarPlanPreviewCount` (schema, default 6, patch field).
- [ ] Do **not** touch: upstream `persistence/Migrations/*`, `orchestration/`, provider adapters, `CommitStore.ts` internals, parked surfaces (`apps/mobile`, relay/cloud), thread components beyond unmounting them (they stay in tree, unreferenced).
- [ ] Docs: `docs/user/` sidebar+plans page; glossary entries + Project disambiguation; `docs/internals/overview.md` sentence.
- [ ] Commits `feat(server): projects and plans over the commit store (M-95)`, `feat(web): project tree sidebar and planning space (M-95)`; PR flags the ADR 004 cut-over trigger.

## Test Plan

Runner: `vp test run <files>` (targeted only). Server tests co-located, `@effect/vitest` `it.layer(...)`.

- [ ] `002_ProjectsPlans.test.ts` — tables/columns via `PRAGMA table_info`; re-run is a no-op (001-test pattern).
- [ ] `PlanningStore.test.ts` — layer `PlanningStore.layer.pipe(Layer.provide(CommitStore.layer), Layer.provide(MercurianSqlite.layerMemory))`:
  - [ ] `createProject` round-trips; empty tree snapshot shows the project with no plans.
  - [ ] **First-commit rule:** `createPlan` yields a plan whose history has exactly one human-authored, unpublished `message` root; the plan appears in the next `getTreeSnapshot`; there is no way to create an empty plan (API shape — assert `plans` row count equals `commit_histories`-with-plan count).
  - [ ] `appendMessage` appends at the tip (parent = previous latest), bumps `updated_at`, reorders the project's plans newest-first.
  - [ ] Title derivation: first line truncated; blank-ish message → `"Untitled plan"`.
  - [ ] Refusals: unknown `projectId` → `MercurianProjectNotFoundError`; unknown `planId` → `PlanNotFoundError`.
  - [ ] `changes` emits on each mutation (drain the stream around a `createPlan`; receipts-not-sleeps per AGENTS.md).
  - [ ] Coexistence shape (copy `Coexistence.test.ts` layering): ambient `SqlClient` still resolves upstream's store; `projects`/`plans` invisible to it.
- [ ] `ProjectTreeSidebar.logic.test.ts` — pure helpers: `getVisiblePlansForProject` (slice, active-plan-always-visible, show-more overflow flags), `resolveTreeSelection` (plan route + subpage prefix, project containing-state, Repositories/Settings prefixes), plan sort.
- [ ] `uiStateStore` reducer test for `setMercurianProjectExpanded` (existing pure-reducer test pattern).
- [ ] AC walk in a real client (`test-t3-app`, on request per AGENTS.md): tree renders projects→plans with Workspace group; no thread list/Issues listing anywhere in nav or routes; create project → create plan from its row → draft shows no tree row → first send births the row; opening a plan lands on the conversation; selection holds on subpages; collapse/resize survive reload; show more/less; both empty states.
- [ ] Targeted typecheck + lint for touched packages (`contracts`, `client-runtime`, `server`, `web`) — route deletions make this the proof that no orphaned imports of the thread routes remain.

---

_Review note: the significant calls made here — snapshot-re-emit over sequenced deltas for the tree; reusing orchestration auth scopes; server-minted ids; `Mercurian*` prefix as the vocabulary seam; a new plan-draft store instead of reusing `composerDraftStore`; fixing (rather than inheriting) the never-read sidebar open-state persistence; parking thread components in place instead of deleting; no environment id in plan routes; derived titles; no third tree level for coding sessions yet — can be pressure-tested with `technical-plan-decision-review`._
