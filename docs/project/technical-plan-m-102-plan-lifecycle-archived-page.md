# Technical Plan — M-102: Plan lifecycle: archive, delete, and the Archived page

_Generated from the Goal/AC of Linear issue M-102 (see the issue for the full AC). Implements backlog 070 (Phase 7 — Settings and lifecycle) on the t3code-fork base, under [ADR 004](../architecture/fork-baseline.md) (Mercurian code additive, minimal edits in upstream-owned files). Design sources are the almagest vault notes the issue cites: Plans (the lifecycle resolution), Settings (resolved: workspace-wide; the Archived page), Publishing, Issue Import, T3code Sidebar / T3code Settings (the adapted archive pattern — now this repository's own code)._

**Goal, in one sentence:** make archive and delete mean exactly what the lifecycle resolution says — "delete exists only while a plan is fully private; once anything is published, archive is the only disappearance" — with the Archived page in Settings as the reversible half.

**Scope, stated plainly (the issue's exclusions):** no confirm-gates (071 — delete lands ungated here and 071 adds the optional second click), no worktree teardown offers (066), no Workspaces concept (deferred by the vault until cloud — archiving is workspace-wide, and in this local-first phase the local workspace "is effectively personal and the distinction has no surface").

## What discovery found

The blocked-by issues landed everything this plan stands on:

- **The published flag and its machinery exist (M-94).** `commits.published` is in the schema ([001_CommitGraph.ts](../../apps/server/src/mercurian/persistence/Migrations/001_CommitGraph.ts)), and [CommitStore.ts](../../apps/server/src/mercurian/commitTree/CommitStore.ts) already ships `publish` — idempotent, one-way, closing over unpublished ancestors — plus `createHistory`'s `rootPublished: true` documented as "the imported-plan case." Nothing calls `publish` yet (Publishing's "What exists today": the act doesn't exist), and `createPlan` roots born-blank plans private ([PlanningStore.ts](../../apps/server/src/mercurian/planning/PlanningStore.ts): "Born blank is born private; an imported plan's published root belongs to issue import").
- **The plans table has no lifecycle columns, on purpose.** [002_ProjectsPlans.ts](../../apps/server/src/mercurian/persistence/Migrations/002_ProjectsPlans.ts): "Deliberately absent: … archive/delete columns … Each arrives with the feature that writes it." This is that feature.
- **The tree has rows but no verbs (M-95).** A plan row in [ProjectTreeSidebar.tsx](../../apps/web/src/components/mercurian/ProjectTreeSidebar.tsx) is title + relative timestamp — no hover actions, no menu. The tree arrives as a whole-snapshot subscription (`mercurian.subscribeTree`) and the client derives everything in pure logic modules ([ProjectTreeSidebar.logic.ts](../../apps/web/src/components/mercurian/ProjectTreeSidebar.logic.ts)).
- **The Archived settings entry exists and points at the fork's thread panel (M-93).** `/settings/archived` is in the Mercurian nav's Workspace group ([SettingsNav.logic.ts](../../apps/web/src/components/mercurian/SettingsNav.logic.ts)); the route ([settings.archived.tsx](../../apps/web/src/routes/settings.archived.tsx)) renders `ArchivedThreadsPanel` from upstream-owned [SettingsPanels.tsx](../../apps/web/src/components/settings/SettingsPanels.tsx). The M-93 plan recorded this as deliberate: "070 brings the plan-shaped contents."
- **The t3code machinery to adapt is all here:** `thread.archive` / `thread.unarchive` / `thread.delete` commands and `archivedAt` in [orchestration.ts](../../packages/contracts/src/orchestration.ts), the archived page grouped by project with restore and confirm-gated delete (`ArchivedThreadsPanel`), and the `ThreadArchiveBlockedError` refusal-naming precedent in [useThreadActions.ts](../../apps/web/src/hooks/useThreadActions.ts). Per the ADR 004 posture the M-93/M-106 plans practiced, this is precedent to adapt in Mercurian-owned code, never imported wholesale.
- **Two gaps the AC touches, both expected.** The palette lists the fork's _threads_, not plans ([CommandPalette.logic.ts](../../apps/web/src/components/CommandPalette.logic.ts) has no plan rows), so "palette recents" has no plan surface to edit yet — the exclusion must hold by construction for whatever lists plans later. And import-origin columns don't exist (051 owns them), so re-import semantics land here as a storage contract, not a lookup.

## Conventions Detected

- **Mercurian server code is additive under `apps/server/src/mercurian/`** — store modules (`PlanningStore`, `CommitStore`) as Effect services with `Schema`-validated inputs, tagged refusal errors, `sql.withTransaction`, `announceChange` pubsub; wire mapping in `planning/wire.ts`; handlers in upstream `ws.ts` under the `"rpc.aggregate": "mercurian"` label. Evidence: the M-108 handler additions; PlanningStore throughout. **High.**
- **Mercurian migrations get their own numbered sequence** in `mercurian/persistence/Migrations/`, registered in [Migrations.ts](../../apps/server/src/mercurian/persistence/Migrations.ts) (`migrationEntries`), never appended to upstream's. Evidence: 001, 002; the module's own ADR citation. **High.**
- **Contracts live in [mercurian.ts](../../packages/contracts/src/mercurian.ts)** — `MERCURIAN_WS_METHODS` constants, branded ids, `Schema.TaggedErrorClass` refusals with `isX` guards; every method gets a scope row in [RpcAuthorization.ts](../../apps/server/src/auth/RpcAuthorization.ts) (read vs. operate). Evidence: the seven existing methods. **High.**
- **Client state is atoms in [mercurianPlanning.ts](../../packages/client-runtime/src/state/mercurianPlanning.ts)** — subscriptions via `createEnvironmentRpcSubscriptionAtomFamily`, writes via `createEnvironmentRpcCommand` on the shared scheduler, per-plan serialization via `serialPerPlan`. **High.**
- **Mercurian UI is `Component.tsx` + `Component.logic.ts` (pure) + colocated `Component.logic.test.ts`** in `apps/web/src/components/mercurian/`, rendering on the `ui/` primitives (`sidebar`, `menu`, `empty`, `button`). Evidence: ProjectTreeSidebar, SettingsNav, PlanArtifact. **High.**
- **Tests:** server stores use `@effect/vitest` `it.layer` over `MercurianSqlite.layerMemory` ([PlanningStore.test.ts](../../apps/server/src/mercurian/planning/PlanningStore.test.ts)); ws round-trips live in `server.test.ts`; web logic is vitest over pure modules. Targeted runs only (`vp test run <files>` — AGENTS.md: no repo-wide checks). **High.**
- **Commits:** `feat(server)/feat(web): <lowercase summary> (M-102)`, feature branch `venk/m-102-…`, PR to main; the plan itself lands as `docs(project)` in `docs/project/technical-plan-m-<n>-<slug>.md`. Evidence: `git log`, seven existing plan files. **High.**
- **Error surfacing in web hooks**: `toastManager` + `isAtomCommandInterrupted`/`squashAtomCommandFailure`, as `useThreadActions` does. **Medium** (fork-owned pattern; verify it reads cleanly from a Mercurian hook at implementation).

## Design

### The rule, computed where it already lives

The lifecycle rule is a predicate over the commit history the store already owns: **a plan is fully private iff no commit in its history is published.** No new state records this — `EXISTS (… published = 1)` against `commits` is the truth, and it flips exactly when Publishing's act (or 051's published-at-birth root) lands. Since nothing can publish today, every current plan is deletable — correct, per the vault: the rule ships now and tightens automatically as publish and import arrive. Tests exercise the published side through `CommitStore.publish` directly.

Archive is one nullable column: `plans.archived_at` (migration **`003_PlanLifecycle`** (new), registered as entry 3). Null means active; archiving stamps it (idempotently — a second archive keeps the first timestamp); restoring nulls it. `updated_at` is deliberately untouched by both, so a restored plan returns to its old place in the newest-first ordering rather than jumping to the top. Delete is a hard `DELETE` — plan row, commits, `commit_parents`, and the `commit_histories` row, in one transaction — because "deleting it leaves no trace."

**The re-import contract (with 051):** origin columns are 051's, but their behavior is decided by what survives here. Archive keeps the plan row and history, so 051's idempotent-by-origin lookup finds the archived plan and resurfaces (restores) it rather than duplicating. Delete removes the row the origin link would hang from, so re-import finds nothing and starts fresh. This plan's store tests pin "archived row survives / deleted row is gone" as that contract's foundation.

### Store and wire

[PlanningStore.ts](../../apps/server/src/mercurian/planning/PlanningStore.ts) grows three acts, each `announceChange`-ing so every window's tree re-sends:

- **`archivePlan(planId)`** — stamp `archived_at` if null. **`unarchivePlan(planId)`** — null it. Both total for existing plans (no published check: archive is every plan's disappearance).
- **`deletePlan(planId)`** — in one transaction: refuse with **`PlanDeleteBlockedError`** (new tagged error, named after the fork's `ThreadArchiveBlockedError` precedent) if any commit of the plan's history is published; otherwise collect the attachment ids named by the history's message payloads, delete parents → commits → plan row → history row, and return the ids. File bytes are unlinked by the ws handler through a new **`removePlanAttachments`** in [attachments.ts](../../apps/server/src/mercurian/planning/attachments.ts) — the boundary owns files on the way out exactly as `normalizePlanAttachments` owns them on the way in (best-effort, logged: a missing file is not a failed delete).

The snapshot queries carry the two facts the UI decides by. `getTreeSnapshot` plans gain `archivedAt` and a computed `hasPublishedCommits` (per-plan `EXISTS`); `getPlanSnapshot`/`createPlan` supply the same on `PlanDetail.plan`. On the wire, `PlanShell` gains `archivedAt: Schema.NullOr(IsoDateTime)` (the fork's `ThreadShell` shape) and `hasPublishedCommits: Schema.Boolean`; `planReducer` is untouched — the shape flows through decode.

Three new `MERCURIAN_WS_METHODS` — `archivePlan`, `unarchivePlan`, `deletePlan` — with handlers in [ws.ts](../../apps/server/src/ws.ts) following the M-108 pattern (`observeRpcEffect`, refusals passed through, the rest wrapped in `MercurianPlanningError`), and operate-scope rows in [RpcAuthorization.ts](../../apps/server/src/auth/RpcAuthorization.ts). The server is authoritative: the UI hides delete for published plans, and `deletePlan` re-checks inside the transaction anyway.

**One design call, flagged:** archived plans ride the existing `subscribeTree` snapshot (with their `archivedAt`) rather than a separate fetch-on-demand read like the fork's `getArchivedShellSnapshot`. t3code excluded archived threads from its live snapshot at thread scale; Mercurian's tree is documented in [mercurianPlanning.ts](../../packages/client-runtime/src/state/mercurianPlanning.ts) as "one small value" re-sent whole, and one live source makes the Archived page correct in every window with no refresh machinery, no second read method, no second auth row. The cost — the snapshot carries archived plans forever — is bounded by deletion existing at all and can be revisited when plan counts justify a paged read.

### Web: the verbs on the rows, the page in Settings

- **Plan rows** ([ProjectTreeSidebar.tsx](../../apps/web/src/components/mercurian/ProjectTreeSidebar.tsx)): the relative timestamp yields on hover to an actions trigger — the adapted T3code Sidebar pattern ("a relative timestamp that yields on hover to an archive button") — opening a `ui/menu` popup: **Archive** always, **Delete** only while `hasPublishedCommits` is false. One affordance carries both verbs because the web app has no context-menu primitive (the fork's row menu is Electron-only `api.contextMenu`); a menu the row itself owns works on every surface. Archiving or deleting the open plan navigates to `/` first (the fork's fallback-after-delete pattern, simplified: the tree is the fallback).
- **Derivation stays pure:** [ProjectTreeSidebar.logic.ts](../../apps/web/src/components/mercurian/ProjectTreeSidebar.logic.ts) gains `partitionPlansByLifecycle` (active vs. archived) and `resolvePlanRowActions({hasPublishedCommits})`; the tree renders active plans only. Any future listing — the plan-aware palette included — reads the same helpers, which is how "removed from palette recents and listings" holds for surfaces that don't exist yet.
- **The Archived page:** new **`ArchivedPlansPanel.tsx` + `.logic.ts` (new)** in `components/mercurian/`, and [settings.archived.tsx](../../apps/web/src/routes/settings.archived.tsx) swaps its one import to it — the same one-line takeover M-93 performed on the settings nav. `ArchivedThreadsPanel` itself is untouched (upstream-owned, still serving the dormant fork sidebar). The page derives from the live tree snapshot: archived plans grouped by project (project order per `sortProjectsForTree`, plans newest-`archivedAt` first — the fork page's ordering), each row carrying a one-click **Restore** button (vault language; the wire verb stays `unarchivePlan`), and **Delete** beside it only when the plan is fully private — "Delete is not offered here for published plans." Empty state on the `ui/empty` primitives: no archived plans yet, and archiving is where a plan goes to leave the tree without being destroyed.
- **State and actions:** [mercurianPlanning.ts](../../packages/client-runtime/src/state/mercurianPlanning.ts) gains the three commands (on `serialPerPlan`, so a lifecycle act serializes against that plan's in-flight writes), and a new **`usePlanLifecycleActions` (new)** hook in `apps/web/src/hooks/` mirrors `useThreadActions`'s shape — perform, toast on failure, navigate when the acted-on plan is open.

Opening an archived plan by direct URL keeps working — `subscribePlan` doesn't consult `archived_at`, and that is the point: archiving "destroys nothing" and is purely navigational. Restore is merely what puts the row back.

## Implementation Checklist

- [ ] Migration `003_PlanLifecycle` (new): `ALTER TABLE plans ADD COLUMN archived_at TEXT NULL`; register as entry 3 in `mercurian/persistence/Migrations.ts`.
- [ ] `planning/schema.ts`: `archivedAt` (nullable) on `Plan`; a `TreePlan`-style row type carrying `hasPublishedCommits` for snapshot reads.
- [ ] `PlanningStore`: `archivePlan` / `unarchivePlan` (idempotent, `announceChange`, no `updated_at` touch); `deletePlan` (in-transaction published check → `PlanDeleteBlockedError`; cascade delete parents/commits/plan/history; return attachment ids); snapshot queries gain `archivedAt` + per-plan `EXISTS` published flag.
- [ ] `attachments.ts`: `removePlanAttachments` — best-effort unlink by attachment id via the existing `attachmentStore` path resolution; never fails the delete.
- [ ] `contracts/mercurian.ts`: three `MERCURIAN_WS_METHODS` entries with input schemas (`planId`); `PlanShell` + `archivedAt` + `hasPublishedCommits`; `PlanDeleteBlockedError` + guard.
- [ ] `ws.ts`: three handlers on the M-108 pattern; delete handler unlinks attachments after the store transaction succeeds.
- [ ] `RpcAuthorization.ts`: operate-scope rows for the three methods.
- [ ] `client-runtime/state/mercurianPlanning.ts`: `archivePlan`, `unarchivePlan`, `deletePlan` commands on `serialPerPlan`.
- [ ] `ProjectTreeSidebar.logic.ts`: `partitionPlansByLifecycle`, `resolvePlanRowActions`; tree renders active plans only.
- [ ] `ProjectTreeSidebar.tsx`: hover-revealed row actions menu (Archive; Delete when fully private) on `ui/menu`.
- [ ] `hooks/usePlanLifecycleActions.ts` (new): perform + toast + navigate-away-when-open.
- [ ] `ArchivedPlansPanel.tsx` + `.logic.ts` (new, `components/mercurian/`): grouped, restorable, delete-when-private, empty state; `settings.archived.tsx` swaps its import. `ArchivedThreadsPanel` and all upstream files otherwise untouched.
- [ ] Don't add: confirm-gates (071), worktree teardown (066), import-origin columns (051), a separate archived-snapshot read method (revisit with scale).

## Test Plan

Server (`vp test run` on the touched files; `@effect/vitest` over `layerMemory`):

- [ ] `PlanningStore.test.ts`: archive stamps `archivedAt`, is idempotent, leaves `updatedAt` alone, and the snapshot row shows it; unarchive nulls it; the `changes` stream signals both.
- [ ] Delete on a fully private plan removes the plan row, its commits, parents, and history row (SQL counts), returns its attachment ids, and a later `getPlanSnapshot` refuses with `PlanNotFoundError` — "leaves no trace," the re-import-fresh foundation.
- [ ] Delete refuses with `PlanDeleteBlockedError` when any commit is published — root, and a mid-history commit published via `CommitStore.publish` — and the archived row (unlike the deleted one) survives with history intact: the resurface-not-duplicate foundation for 051.
- [ ] `hasPublishedCommits` in snapshots: false at birth, true after `publish`.
- [ ] `attachments.test.ts`: `removePlanAttachments` unlinks named files and tolerates already-missing ones.
- [ ] `server.test.ts`: ws round-trip — archive → tree snapshot carries `archivedAt`; delete on published → the tagged error decodes; the three methods sit behind operate scope.

Web (vitest over pure logic):

- [ ] `ProjectTreeSidebar.logic.test.ts`: partition excludes archived from active listing; row actions offer delete iff not published.
- [ ] `ArchivedPlansPanel.logic.test.ts`: grouping by project, newest-`archivedAt` ordering, delete visibility per plan, empty when nothing archived.
- [ ] One integrated pass per AGENTS.md ("hit every surface"): archive from the tree, watch the row leave every window, restore from Settings → Archived, watch it return in place; delete a private plan and confirm the URL now dead-ends; confirm no delete appears anywhere on a plan with a published commit (set up via a seeded published root).
