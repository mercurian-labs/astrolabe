# Technical Plan — M-146: Mobile plan list

_Generated from the Goal/AC of Linear issue M-146 (see the issue for the full AC). Design source of record: the almagest vault's Left Sidebar note (flat cards, status slot, unread emphasis, project scope filter, archived shelf), with the status grammar owned by Issue Status and rendered per the Status Vocabulary, and Projects as scope-not-hierarchy. The desktop plan list this mirrors shipped under `docs/project/technical-plan-m-124-plan-list-sidebar.md`._

**Stack context:** this is the bottom code branch of a stacked-PR chain — `venk/m-146-mobile-plan-list` on `main`, nothing below it. It must establish the mobile Mercurian foundations later branches assume: (a) a mobile state bridge over `createMercurianPlanningAtoms`, (b) the plan-list home surface, and (c) a navigation route to a stub planning-space screen that M-147 fills. Decision of record, argued below: **the plan list replaces the t3 thread home** — same posture as the web app, inside the existing app shell, no rebrand in this issue.

**Goal, in one sentence:** put a paired workspace's plans on the phone as the home screen — a flat, newest-first, live-updating list with the desktop sidebar's status grammar, a project scope filter, an archived shelf with restore, and tap-through to a (stub) planning space.

**Scope fences:** no plan creation or drafts (the issue excludes creating plans from the phone — no FAB, no composer), no archive/mark-unread/delete row actions (restore from the shelf is the only lifecycle verb here), no search, no hover/long-press detail popover, no jump shortcuts, no multi-workspace merged list (one workspace at a time, picker when several are paired), and no re-housing of the tablet split-view sidebar (still the t3 thread list; follow-up noted in Risks).

## Conventions Detected

- **Shared client logic lives in `packages/client-runtime`** — AGENTS.md §Where code lives ("client code shared by web and mobile"); the package exposes per-module subpath exports (`./state/mercurian-planning` → `src/state/mercurianPlanning.ts`, `packages/client-runtime/package.json:70-73`) with colocated `.test.ts`. Confidence: high.
- **The Mercurian data layer is already client-agnostic** — `createMercurianPlanningAtoms(runtime)` needs only an `AtomRuntime` carrying `EnvironmentRegistry` (`packages/client-runtime/src/state/mercurianPlanning.ts:32`), which `Connection.layer` provides (`packages/client-runtime/src/connection/layer.ts:22`). Mobile's `connectionAtomRuntime` (`apps/mobile/src/connection/runtime.ts`) is layer-for-layer identical to web's (`apps/web/src/connection/runtime.ts`), and mobile's RPC client is built from the same `WsRpcGroup` that carries `MERCURIAN_WS_METHODS` (`packages/client-runtime/src/rpc/protocol.ts:5`; methods at `packages/contracts/src/mercurian.ts:38-57`). Confidence: high.
- **Web's bridge is the pattern to mirror** — `apps/web/src/state/mercurian.ts:30-90`: module-level `createMercurianPlanningAtoms(connectionAtomRuntime)`, an EMPTY atom for the no-environment case, `useAtomValue` + `AsyncResult` unwrap, squashed error string. Web binds everything to a _primary_ environment (`PrimaryConnectionTarget`, `apps/web/src/state/primaryEnvironment.ts`); mobile has no primary — it pairs N remote environments — so the mobile bridge takes an explicit `environmentId`. Confidence: high.
- **Mobile feature shape** — screens under `apps/mobile/src/features/<domain>/`, a `<X>RouteScreen` (navigation + data wiring) over a presentational screen (`HomeRouteScreen`/`HomeScreen`), pure list models in plain `.ts` with colocated `vite-plus/test` tests (`homeListItems.ts`, `threadListV2.ts` + `.test.ts`), row components in a sibling `.tsx` (`thread-list-v2-items.tsx`). Styling via uniwind classNames on `AppText`/`View`, theme colors via `useThemeColor`. Confidence: high.
- **The mobile flat-list-with-shelf donor** — Thread List v2: one `LegendList` (`apps/mobile/src/features/home/HomeScreen.tsx:1149`), typed list items with an equality fn for recycled rows (`homeListItems.ts:88`), a collapsed shelf header showing a count (`ThreadListV2SettledShelfHeader`), shelf paging 10 then +25 (`threadListV2.ts:102-103`), a minute-quantized `now` tick for time labels (`HomeScreen.tsx:576`), and `relativeTime` from `apps/mobile/src/lib/time.ts`. Confidence: high.
- **Status rendering grammar** — one colored text label per state, same hues on every surface: "Input" indigo, "Working" sky (`thread-list-v2-items.tsx:55-62`; web plan cards agree, `PlanListSidebar.tsx:757-777`). Unread is title weight, not a slot label (`PlanListSidebar.tsx:647-655`; the slot/unread split is `resolvePlanCardStatus`, `PlanListSidebar.logic.ts:89-97`). Never hue alone — the label text carries the state (Status Vocabulary). Confidence: high.
- **Navigation** — React Navigation v7 static API; workspace routes live FLAT in the root stack with path linking (`apps/mobile/src/Stack.tsx:219-224`, `Thread` at `threads/:environmentId/:threadId`); screens read params via `StaticScreenProps` (`ThreadRouteScreen.tsx:103,133-147`) and set dynamic header options with `NativeStackScreenOptions`. Confidence: high.
- **Fork posture (ADR 004)** — dead surface stays in-tree and typechecking, never deleted; mount-point swaps are single-line (M-124 swapped `ProjectTreeSidebar` → `PlanListSidebar` in `AppSidebarLayout`). `apps/mobile` is currently marked **Parked** with revival criteria "vault design first" and "revived by a later amendment to this ADR, not silently" (`docs/architecture/fork-baseline.md:37,41,65`) — this issue is that revival and must amend the ADR. Confidence: high.
- **Verification** — targeted `vp test run <files>` and per-package typecheck only; no repo-wide checks locally (AGENTS.md §Verifying; CI runs the full suite, and mobile TS is already inside blocking CI via `vp check`/`vp run test`, `.github/workflows/ci.yml:44-92`). Every AC then demonstrated in the running app — `test-t3-mobile` for mobile. Confidence: high.
- **Commits & plan docs** — conventional, scoped, issue-tagged (`fix(mobile): …` in recent log); plan documents at `docs/project/technical-plan-m-<n>-<slug>.md`. Confidence: high.
- **Naming (medium)** — mobile mixes camelCase models (`homeListItems.ts`) with kebab-case component files (`thread-list-v2-items.tsx`); this plan follows that mix and flags it as only a medium-confidence convention.

## Design

### The home decision: replace, don't stand beside

On web, Mercurian replaced the t3 sidebar wholesale (M-124) and the thread surfaces went dead-but-typechecking. Mobile follows: `Stack.tsx`'s `Home` screen swaps from `HomeRouteScreen` to the new `PlanListRouteScreen` — a one-line mount change, the M-124 pattern. `HomeRouteScreen`, `HomeScreen`, and the whole thread-list machinery stay in-tree untouched (ADR 004); thread routes stay registered — coding sessions will need them later, and `NotFoundScreen`'s "Return home" (`Stack.tsx:390`) keeps working unchanged. The new home keeps the shell's chrome duties: `checkForAppUpdateOnLaunch()` on mount and the connection-aware brand header (`getConnectionAwareBrandHeaderOptions`, `HomeRouteScreen.tsx:134-139`) — Mercurian surfaces inside the existing shell, no rebrand.

In split-view layouts the plan list renders as the Home pane's content in place of `WorkspaceEmptyDetail`. The persistent sidebar still shows t3 threads there (`AdaptiveWorkspaceLayout.tsx:239-242`) — re-housing it is out of scope; the issue covers the phone's home experience, and the phone (compact) layout never mounts that sidebar.

### Shared grammar hoists to `client-runtime`

The status grammar must mean the same thing on every surface (Status Vocabulary: one meaning per state), so mobile must not re-derive it. The pure helpers both clients need move from `apps/web/src/components/mercurian/` into **`packages/client-runtime/src/state/planListing.ts` (new)**, exported as **`./state/plan-listing` (new subpath)**:

- from `planListing.logic.ts`: `sortPlansNewestFirst`, `partitionPlansByLifecycle`, `resolvePlanRowStatus`, and the types `PlanRowStatus`, `PlanRowStatusFields`, `PlanLifecycleFields`;
- from `PlanListSidebar.logic.ts`: `resolvePlanCardStatus` + `PlanCardStatus`, `filterPlansByProjectScope`, `pageArchivedPlans` + `ARCHIVED_PLAN_INITIAL_COUNT`/`ARCHIVED_PLAN_PAGE_COUNT`;
- from `ArchivedPlansPanel.logic.ts`: `sortPlansNewestArchivedFirst`;
- from `planListing.logic.ts`: `sortProjectsForTree` (the filter menu's ordering).

The three web modules keep their paths and **re-export the moved symbols** from the new subpath, so none of the seven web importers change. Test cases for moved functions migrate into `packages/client-runtime/src/state/planListing.test.ts` (colocated-test convention there); the web `.logic.test.ts` files keep only the web-only helpers (route selection, menus, jump/adjacency, rollup). Behavior-neutral by construction — its own commit. Web-only helpers (`resolveTreeSelection`, `buildPlanRowMenuItems`, `resolveAdjacentId`, `resolvePlanRowActions`, `resolveRollupStatus`, …) stay where they are. One Hermes note: the moved code already avoids anything ES2023+ (plain `[...arr].sort`, `Array.prototype` basics), matching mobile's "no change-by-copy array methods" constraint (`threadListV2.ts:170-171`); keep it that way.

### The mobile state bridge — `apps/mobile/src/state/mercurian.ts` (new)

Mirrors `apps/web/src/state/mercurian.ts`, minus the primary-environment assumption:

- `export const mercurianPlanning = createMercurianPlanningAtoms(connectionAtomRuntime)` over mobile's runtime (`../connection/runtime`).
- `useMercurianTree(environmentId: EnvironmentId | null): MercurianTreeState` — web's shape verbatim (`{snapshot, isPending, error}`, EMPTY atom when `environmentId` is null, `AsyncResult` unwrap, `Cause.squash` error string; `apps/web/src/state/mercurian.ts:37-90`). Liveness is free: the tree is a whole-snapshot subscription over `mercurian.subscribeTree` with reconnect handled by the supervisor-generation machinery (`runtime.ts:537-552`), which is exactly AC "reflects changes from other clients without refresh". Mobile's background-scope observer ignores unknown methods (`connection/background-activity-scopes.ts:39-50`), so no registration is needed.
- `useVisitPlan(environmentId)` and `useUnarchivePlan(environmentId)` — thin wrappers over `useAtomCommand(mercurianPlanning.visitPlan / .unarchivePlan)` (mobile's `useAtomCommand` is web-identical, `apps/mobile/src/state/use-atom-command.ts`), passing `{environmentId, input}` explicitly. No other verbs cross in this issue.

### Which workspace: explicit, ephemeral, defaulting to the only one

Mobile pairs N environments; the tree subscription is per-environment; the AC speaks of _a_ paired workspace. The route screen derives the paired list exactly as `HomeRouteScreen` does (saved connections joined with connection state, sorted by label — `HomeRouteScreen.tsx:52-71`), holds an ephemeral `useState` selection, and clamps it with a pure `resolvePlanListEnvironmentId(selectedId, available)` (new, tested): a vanished selection falls back to the first paired workspace — so the single-workspace phone never sees a picker decision at all. Merging several workspaces into one list is deliberately out (Risks).

### The plan list surface — `apps/mobile/src/features/plans/` (new directory)

- **`PlanListRouteScreen.tsx` (new)** — mounted at `Home`. Brand header + update check as above; a header-area row hosting the **filter pill** (`ControlPillMenu`, the `HomeHeader` idiom) and a Settings entry (`SettingsSheet` navigation, as today); resolves the workspace; reads `useMercurianTree`; renders `PlanListScreen` or an empty state.
- **`plan-list-filter-menu.ts` + `.test.ts` (new)** — `buildPlanListFilterMenu`, mirroring `home-list-filter-menu.ts:35-127`: a **Workspace** submenu (radio over paired workspaces, rendered only when more than one is paired — no "All workspaces" entry) and a **Project** submenu — "All projects" default plus the tree's projects via `sortProjectsForTree` (Projects note: scope, not hierarchy). Scope selection is ephemeral `useState`, resetting like web's (vault: "resets on reload").
- **`planListItems.ts` + `.test.ts` (new)** — the list model, `homeListItems.ts`-style: item union `plan` | `archived-shelf` | `archived-plan` | `archived-show-more`, plus `buildPlanListItems({plans, projectScopeId, archivedExpanded, archivedPage})` composing the hoisted helpers — scope filter → `partitionPlansByLifecycle` → active `sortPlansNewestFirst` (AC: newest first) → shelf header with count → when expanded, `sortPlansNewestArchivedFirst` + `pageArchivedPlans` (10 then +25, the shared constants; mobile's settled shelf pages the same way). Also `planListItemsAreEqual` (recycled-row equality, `homeListItems.ts:88` precedent) and `resolvePlanListEnvironmentId`. Empty-state derivation lives here too, following `deriveEmptyState` (`HomeScreen.tsx:134-195`): loading connections → no workspace paired (offer Add environment → `SettingsSheet`/`SettingsEnvironmentNew`) → connecting → tree pending → "No plans yet" / "No plans in {project} yet".
- **`plan-list-rows.tsx` (new)** — the row components:
  - **Plan row**: one line (vault: "the list is the list" — dense single-line cards; project name never on the row). Title left, truncating; unread emphasis is weight (`font-t3-bold text-foreground` vs `font-t3-medium text-foreground/90`), driven by `resolvePlanCardStatus(row).unread`. The right edge is the status slot, one signal at a time from `.slot`: `working` → sky "Working", `awaiting-input` → indigo "Input" (labels and hues shared with web plan cards and mobile thread rows; most-urgent-wins ordering comes from the shared resolver), otherwise `relativeTime(updatedAt)` in tertiary tabular-nums. `accessibilityRole="button"`, label naming title + spoken status (never hue alone). Tap → navigate `Plan`.
  - **Archived shelf header**: the `ThreadListV2SettledShelfHeader` pattern — collapsed by default showing "Archived (n)", toggling `expanded` local state, with the accessibility labels/states that component carries.
  - **Archived row**: slim and receded (tertiary title, `relativeTime(archivedAt)`), with an explicit **Restore** icon-button (`AppSymbol`, `accessibilityLabel` "Restore {title}") calling `useUnarchivePlan` — no swipe machinery for a single verb.
  - **Show-more row**: reveals the next archived page, count from `pageArchivedPlans`.
- **`PlanListScreen.tsx` (new)** — presentational: one `LegendList` over the items with the equality fn, a minute-quantized `now` tick (the `HomeScreen.tsx:576` idiom) so relative-time labels stay honest while on screen, `ErrorBanner` when the tree reports an error, `EmptyState` otherwise. Tree emissions re-render rows directly — that plus the subscription is AC "live while on screen".

### The stub planning space — `PlanRouteScreen.tsx` (new) + route

Registered flat in the root stack: `Plan: createNativeStackScreen({ screen: PlanRouteScreen, linking: "plans/:environmentId/:planId", options: GLASS_HEADER_OPTIONS })` — the thread-route linking shape, so M-147 inherits a stable deep link and `navigationPathConfig` picks it up automatically. The screen reads params via `StaticScreenProps`, brands the header with the plan's title from the tree row, renders a placeholder body (`EmptyState`: the planning space arrives with M-147), and — the load-bearing part — **visits on open**: an unguarded effect keyed on the row's `updatedAt` calling `visitPlan`, exactly web's semantics ("being here is seeing it… the server already refuses to write a visit that changes nothing", `PlanningSpace.tsx:318-331`). That effect is what makes AC "opening it clears the emphasis" true today, and it survives M-147 replacing the body.

### Vault and ADR bookkeeping

`apps/mobile` is Parked in ADR 004 with "vault design first" as the revival gate. Two small documents move with this plan, before implementation: (1) via the product-docs skill, record the mobile adaptation in the almagest vault — the Left Sidebar note's plan-list design carried to the phone home (single-line rows, no hover affordances, restore-only shelf), either as a short Mobile section there or a small linked note; (2) amend `docs/architecture/fork-baseline.md` (a dated rev, the ADR's own convention): `apps/mobile` revived for Mercurian surfaces, upstream thread surfaces within it now the parked half.

## Implementation Checklist

- [ ] Branch `venk/m-146-mobile-plan-list` off latest `main`.
- [ ] Vault first (product-docs skill): record the phone-home adaptation of the Left Sidebar design; amend ADR 004 (`docs/architecture/fork-baseline.md`) — mobile revived for Mercurian surfaces.
- [ ] Hoist: create `packages/client-runtime/src/state/planListing.ts` + `planListing.test.ts`, add the `./state/plan-listing` export to `packages/client-runtime/package.json`; turn the moved symbols in `apps/web/src/components/mercurian/{planListing.logic.ts, PlanListSidebar.logic.ts, ArchivedPlansPanel.logic.ts}` into re-exports; migrate the corresponding test cases out of the web `.logic.test.ts` files. No behavior change; own commit (`refactor(client-runtime): share the plan listing grammar with mobile (M-146)`).
- [ ] Bridge: `apps/mobile/src/state/mercurian.ts` — `mercurianPlanning`, `useMercurianTree(environmentId)`, `useVisitPlan(environmentId)`, `useUnarchivePlan(environmentId)`.
- [ ] Feature logic: `apps/mobile/src/features/plans/planListItems.ts` + `.test.ts` (item union, `buildPlanListItems`, `planListItemsAreEqual`, `resolvePlanListEnvironmentId`, empty-state derivation) and `plan-list-filter-menu.ts` + `.test.ts`.
- [ ] Feature UI: `plan-list-rows.tsx`, `PlanListScreen.tsx`, `PlanListRouteScreen.tsx` as designed (LegendList, minute tick, ErrorBanner/EmptyState, filter pill, brand header, update check).
- [ ] Stub: `PlanRouteScreen.tsx` with the visit-on-open effect and title from the tree row.
- [ ] `apps/mobile/src/Stack.tsx`: register `Plan` (linking `plans/:environmentId/:planId`, `GLASS_HEADER_OPTIONS`); swap `Home`'s screen to `PlanListRouteScreen` (imports updated; `HomeRouteScreen` stays in-tree, dead but typechecking).
- [ ] Constraints: no new dependencies; no contracts/server changes (everything rides existing `MERCURIAN_WS_METHODS`); no edits to parked upstream mobile surfaces beyond the `Stack.tsx` mount; no ES2023+ array methods in code Hermes runs.
- [ ] Commit the surface as `feat(mobile): the plan list is the phone's home (M-146)` (split further per house one-concern taste).

## Test Plan

Unit (vite-plus, colocated; `vp test run <files>`):

- [ ] `packages/client-runtime/src/state/planListing.test.ts` — migrated cases: newest-first ordering (ties by id), lifecycle partition, status priority (awaiting-input > working > unseen; null when quiet), `resolvePlanCardStatus` slot/unread independence (a working, unread plan says both), scope filter, archived ordering + 10/+25 paging.
- [ ] `apps/web/src/components/mercurian/{planListing.logic.test.ts, PlanListSidebar.logic.test.ts, ArchivedPlansPanel.logic.test.ts}` — remaining web-only cases stay green through the re-exports.
- [ ] `apps/mobile/src/features/plans/planListItems.test.ts` — layout: active rows before shelf; shelf collapsed → header only, with count; expanded → paged archived rows + show-more when hidden remain; scope change filters both sections; empty-state derivation per connection phase; `resolvePlanListEnvironmentId` clamps a vanished selection to the first paired workspace; equality fn stability across a shelf toggle.
- [ ] `apps/mobile/src/features/plans/plan-list-filter-menu.test.ts` — Workspace submenu only when >1 paired; "All projects" default checked; project entries follow `sortProjectsForTree`.
- [ ] Typecheck the touched packages: `vp run --filter @t3tools/mobile typecheck`, `vp run --filter @t3tools/client-runtime typecheck`, `vp run --filter t3-web typecheck`. No repo-wide checks (AGENTS.md §Verifying).

Device walk (`test-t3-mobile`, simulator paired to a seeded dev server — every AC demonstrated live, per house practice):

- [ ] Paired workspace's plans render as a flat single-line list, newest first, titles truncating.
- [ ] Status slot: a streaming plan shows sky "Working"; a plan waiting on a structured question shows indigo "Input"; a quiet plan shows its relative age, ticking over the minute boundary.
- [ ] Change a plan from web/desktop while the phone list is on screen: the row updates (order, status, emphasis) with no manual refresh.
- [ ] The changed plan carries unread title weight; tapping it lands on the stub planning space; going back, the emphasis is cleared (and clears on other clients too — server-side visit).
- [ ] Filter pill: default All projects; scoping to one project narrows active rows and the shelf; with two paired workspaces the Workspace submenu switches lists; with one it is absent.
- [ ] Archived shelf: collapsed with the right count; expanding lists newest-archived first, pages 10 then +25; Restore returns a plan to the active list (verify it reappears on web too).
- [ ] Deep link `plans/:environmentId/:planId` opens the stub directly; unknown routes still land on NotFound → Return home.
- [ ] Empty states: no environment paired (offers Add environment), connecting, no plans yet, no plans in scoped project; a paired non-Mercurian server surfaces the tree error banner rather than a silent blank.
- [ ] Split-view (iPad) smoke: the plan list renders as the Home pane; nothing regresses in thread navigation from the sidebar.

## Risks / open follow-ups

- **Tablet split view still shows the t3 thread sidebar** beside the Mercurian home — re-housing the sidebar is a deliberate deferral; the phone (compact) layout, which this issue covers, never mounts it.
- **One workspace at a time**: a merged multi-workspace list (mobile's thread list merges environments) is deferred; the Workspace submenu is the escape hatch.
- **Paired against an upstream (non-Mercurian) server**, `mercurian.subscribeTree` fails; the surface shows the tree error state honestly. Acceptable while pairing targets Mercurian serves; revisit if mixed pairing becomes real.
- Later branches (M-147+) replace `PlanRouteScreen`'s body; its route shape, params, and visit-on-open effect are the contract they inherit.
- Verification caveat from house memory: fresh worktrees can hit frozen-install/patch drift — fix installs before trusting a typecheck failure.
