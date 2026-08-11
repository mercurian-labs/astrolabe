# Technical Plan — M-125: DAG explorer: replace the Navigator with a checked-out thread view

_Generated from the Goal/AC of Linear issue M-125 (see the issue for the full AC). Builds directly on the explorer landed by `docs/project/technical-plan-m-106-right-sidebar-dag-explorer.md` (and its 2026-08-04 addendum), under ADR 002's position rule (position is per-window view state — see `apps/web/src/components/mercurian/PlanPosition.logic.ts`). Design sources: the almagest vault notes DAG Explorer, Commit Tree, Merges._

**Goal, in one sentence:** the explorer's walking view shows exactly the checked-out thread — the root-to-tip path through where you stand — with an always-visible switch at every point where history diverges, replacing the Navigator's all-branches rail-list.

**Scope, stated plainly:** the Graph (spatial map) view is untouched; history semantics are untouched (forks and merges stay human-driven; selection keeps navigate-on-select via `positionAfterPick`). The three-view icon switcher belongs to M-126 — this issue leaves the switcher a two-option toggle (Thread / Graph), and M-126 grows it.

## Conventions Detected

- **Pure logic in colocated `*.logic.ts` modules with `*.logic.test.ts` beside them** — every mercurian component with derivation logic follows this (`PlanGraph.logic.ts`, `PlanPosition.logic.ts`, `PlanArtifact.logic.ts`, all with colocated tests in `apps/web/src/components/mercurian/`). Views stay dumb; the logic module is where tests pin behavior. Confidence: high.
- **Tests on `vite-plus/test`, hand-built commit fixtures with ASCII shape diagrams** — `PlanGraph.logic.test.ts` builds `chain` / `fork` / `merged` fixtures via a local `commit()` helper. Run scoped: `vp test run <files>`; no repo-wide checks (AGENTS.md "Verifying"). Confidence: high.
- **Persisted view preferences via `useLocalStorage` + effect `Schema` literals, keys namespaced `mercurian:*:v1`** — `EXPLORER_VIEW_STORAGE_KEY` in `DagExplorer.tsx`, `RIGHT_PANE_STORAGE_KEY` in `PlanningSpace.tsx`. Decode failure falls back to the default (`useLocalStorage.ts` catches and returns `initialValue`), so widening/changing a key's literal set degrades gracefully. Confidence: high.
- **Per-window, transient rendering state lives in the component, not in stores** — the spatial map's `prior` positions (`priorRef` in `DagExplorer.tsx`), the position anchor itself (`useState` in `PlanningSpace.tsx`, per ADR 002 §5 "scroll-state-shaped"). Confidence: high.
- **Hover-openable popovers exist as a first-class idiom** — `PopoverTrigger openOnHover delay={150} closeDelay={0} render={...}` in `apps/web/src/components/chat/ContextWindowMeter.tsx` (also `GitActionsControl.tsx`, `ConnectionsSettings.tsx`), on `@base-ui/react` ^1.4.1 via `ui/popover`. Confidence: high.
- **Icons from `lucide-react` (^0.564.0), one glyph per commit kind shared across views** — `commitGlyph` in `DagExplorer.tsx`. Confidence: high.
- **No graph/UI dependencies for explorer work; no continuously repainting animations** — m-106's declined-dependencies list and AGENTS.md "Taste". Confidence: high.
- **Comments describe how a thing is used, in the repo's design-prose voice** — consistent across the mercurian modules. Confidence: medium (style, not structure).

## Design

### The thread is a pure reading of the graph the explorer already holds

The explorer is a second reading of the plan subscription (m-106), and this view is a third: no wire changes, no store changes, no new props. `DagExplorer` already receives `graph: PlanGraph` and `anchoredCommitId` from `PlanningSpace`, and `PlanGraph.logic.ts` already computes everything the thread needs — `parents` (ordered), `childrenIds` (sequence-ordered), `isBranchPoint`, `isMerge`.

New module **`apps/web/src/components/mercurian/PlanThread.logic.ts` (new)** + **`PlanThread.logic.test.ts` (new)** — a separate module rather than more surface on `PlanGraph.logic.ts`, matching the one-concept-per-module split (`PlanPosition.logic.ts` precedent); `PlanGraph.logic.ts` simultaneously _loses_ the navigator layout, so the seam is natural. Exports:

- `threadLayout(graph, head, parentChoices) → { rows: ReadonlyArray<ThreadRow> }` — the root-to-tip path through `head`, root first. Upward from `head`: follow parents to the root, taking `parentChoices.get(mergeId)` where a merge offers several and `parents[0]` (the first-parent line) otherwise. Downward from `head`: follow `childrenIds[0]` to a leaf — the same first-child walk `advance` uses in `PlanPosition.logic.ts`, so the thread below you agrees with what the surface would follow live. Each `ThreadRow` carries the node plus its switches:
  - `siblings` — present when `parents.length > 0` and the parent on the path has more than one child: the parent's full `childrenIds` as branch options, with this row's index among them (the "2 of 3" fact).
  - `parentLines` — present when `isMerge`: the merge's `parents` as line options, with the currently-followed parent's index.
- `branchOption(graph, branchRootId) → { branchRootId, tipId, summary, lastActiveAt, published }` — what the flyout shows per sibling: `planCommitSummary` of the branch's first commit, the timestamp of the branch's most recent descendant, the root's `published` flag, and the tip the switch lands on.
- `mostRecentTip(graph, commitId)` — the leaf in the subtree under `commitId` with the highest `sequence`: the landing rule "you land at that branch's most recently active tip". Walk `childrenIds` breadth-first; bounded by node count like `advance`'s loop.

All pure functions of `(graph, …)`, testable exactly like the rest of the logic module.

### Switching a sibling is navigation; choosing a merge's parent line is a reading

The two switches the AC names get deliberately different treatments, and the boundary is the position model:

- **Sibling switch → `onSelect(option.tipId)`.** The existing `onSelect` prop flows to `positionAfterPick` in `PlanningSpace.tsx`, which stands you live on a leaf — precisely "you land at that branch's most recently active tip, and the planning surface moves there". No new plumbing; the flyout is one more caller of the contract every view already honors.
- **Parent-line choice → per-window `parentChoices` state inside `ThreadView`** (`useState<ReadonlyMap<string, MercurianCommitId>>`). Choosing which incoming line to display above a merge changes what the list _shows_, not where you _stand_ — history above a commit is immutable and `head` doesn't move, so this is scroll-state-shaped (ADR 002 §5), per-window and transient like the spatial map's `prior` positions. Entries for merges no longer on the displayed path are simply unused; no cleanup machinery.

Revealing a flyout never calls `onSelect` — only choosing inside it does, which is the AC's "revealing siblings does not navigate".

### The view: rows the explorer already renders, plus badges and flyouts

`DagExplorer.tsx` changes in place (the file already houses all views):

- **`NavigatorView` is deleted**, along with `navigatorLayout`, the `NavigatorRow`/`NavigatorEdge`/`NavigatorLayout` types, `railPath`, and the rail constants (`LANE_WIDTH`, `RAIL_INSET`). `ROW_HEIGHT`, `CommitRow`, `commitGlyph`, and `useCurrentRowScroll` stay — the thread is made of the same rows.
- **`ThreadView` (new, in `DagExplorer.tsx`)** renders `threadLayout(...).rows` as a plain vertical list — no SVG rail; a path has no geometry to draw. `CommitRow` keeps kind glyph, published/private text treatment, relative time, `aria-current`, and click-to-`onSelect`; the current-row auto-scroll hook carries over unchanged. The `trailing` slot (today a passive `GitForkIcon` on branch points) becomes the **divergence badge**: an always-visible button reading like `⑂ 2/3` (fork icon + "n of N"), rendered for rows with `siblings`, and its mirrored form (a merge icon + count) for rows with `parentLines`. Always visible is the point — the badge is what makes branching scannable rather than hover-discoverable.
- **The flyout** is `ui/popover` with `openOnHover delay={150} closeDelay={0}` on the badge (the `ContextWindowMeter` precedent — hover with a pointer, click/tap everywhere, one component). The popup lists each `branchOption` as a button row: summary, `formatRelativeTimeLabel(lastActiveAt)`, and the solid/hollow published treatment the dots already use; the option you're on is marked and inert. Choosing calls `onSelect(tipId)` (siblings) or updates `parentChoices` (parent lines) and closes the popup.
- **The view toggle** shrinks to Thread / Graph. `ExplorerView` literals become `["thread", "graph"]` with default `"thread"`, keeping the `mercurian:dag-explorer-view:v1` key: a stored `"navigator"` now fails schema decode and `useLocalStorage` falls back to the new default — the graceful path the hook already implements, so no key bump and no orphaned entries.

`PlanningSpace.tsx`, `PlanPosition.logic.ts`, and every prop of `DagExplorer` are untouched. The empty state ("Nothing has happened here yet.") is untouched.

### Gaps and findings

- **`published` is still uniformly `false`** on this surface (m-106 finding; Publishing unbuilt). The flyout's published treatment ships dark, same as the dots did.
- **The wire timeline still skips `issue-revision`-adjacent kinds it has no rendering for** (m-106 forward-compat skip), and `buildPlanGraph` already drops dangling edges; the thread inherits that degradation for free.
- **Merges are representable but not yet creatable** (M-111 not landed): `parentLines` ships against fixtures only, like `spatialLayout`'s merge handling did. The logic tests build the shapes by hand, per precedent.

## Implementation Checklist

- [ ] `apps/web/src/components/mercurian/PlanThread.logic.ts` (new): `threadLayout`, `branchOption`, `mostRecentTip`, with the `ThreadRow` / `BranchOption` types.
- [ ] `apps/web/src/components/mercurian/PlanThread.logic.test.ts` (new): cases below, fixtures in the `PlanGraph.logic.test.ts` style.
- [ ] `apps/web/src/components/mercurian/DagExplorer.tsx`: delete `NavigatorView`; add `ThreadView` (rows + divergence badges + hover/click popover flyouts + `parentChoices` state); `ExplorerView` → `["thread", "graph"]`, default `"thread"`, key unchanged; toggle labels "Thread" / "Graph".
- [ ] `apps/web/src/components/mercurian/PlanGraph.logic.ts`: delete `navigatorLayout` and the `Navigator*` types (nothing else changes; `buildPlanGraph`, `ancestorClosure`, `spatialLayout`, `planCommitSummary` stay).
- [ ] `apps/web/src/components/mercurian/PlanGraph.logic.test.ts`: drop the `navigatorLayout` cases only.
- [ ] No new dependencies; no changes under `packages/contracts`, `apps/server`, or to `PlanningSpace.tsx`.

## Test Plan

`PlanThread.logic.test.ts` on `vite-plus/test`, colocated, fixtures hand-built with the shared ASCII-diagram style; run `vp test run apps/web/src/components/mercurian/PlanThread.logic.test.ts apps/web/src/components/mercurian/PlanGraph.logic.test.ts`.

- [ ] **Linear chain:** `threadLayout` returns every commit root-first, no row carries `siblings` or `parentLines`.
- [ ] **Fork, standing on a branch:** only the path through `head` appears; the first on-branch row after the fork carries `siblings` with the right count and index; the off-path branch's commits appear nowhere.
- [ ] **Interior head:** the path continues below `head` by first-child to a leaf (agrees with `advance`).
- [ ] **`mostRecentTip`:** on a branch that forks again downstream, returns the max-`sequence` leaf of the whole subtree, not the first-child walk's leaf.
- [ ] **`branchOption`:** summary is the branch root's `planCommitSummary`; `lastActiveAt` is the newest descendant's `createdAt`; `tipId` is `mostRecentTip`.
- [ ] **Merge:** appears exactly once; upward path follows `parents[0]` by default; carries `parentLines` with the followed index; a `parentChoices` entry re-roots the ancestry above the merge and changes nothing at or below it.
- [ ] **Degradation:** a dangling parent edge (dropped by `buildPlanGraph`) truncates the upward walk instead of throwing; empty graph → empty rows.
- [ ] Existing `PlanGraph.logic.test.ts` suite stays green minus the deleted `navigatorLayout` block.

UI verification (on request, per AGENTS.md): one integrated pass in the web client with a seeded forked history — badge always visible, flyout opens on hover and on click, choosing a sibling moves the planning surface and the highlight, revealing alone moves nothing.
