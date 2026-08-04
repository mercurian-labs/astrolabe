# Technical Plan — M-106: Right Sidebar: plan artifact and DAG Explorer

_Generated from the Goal/AC of Linear issue M-106 (see the issue for the full AC). Implements backlog 031 (Phase 3 — Planning space) on the plan artifact and live subscription 030 landed (`docs/project/technical-plan-m-100-plan-artifact-and-plan-revisions.md`), under [ADR 001](../architecture/local-first-runtime.md), [ADR 002](../architecture/event-streaming-model.md), and [ADR 004](../architecture/fork-baseline.md). Design sources are the almagest vault notes the issue cites: Right Sidebar (amended 2026-08), DAG Explorer (resolved), Plans, Commit Tree, Merges, Publishing._

**Goal, in one sentence:** make the conversation the planning space's main content and give the plan's two standing views — the plan artifact and the DAG Explorer — one right pane, chosen by icons in the space's top-right corner (artifact by default, closable, remembered), where the explorer shows the whole branching history in Navigator and Graph views, distinguishes published from private work, and picking a commit navigates the planning surface to the path through it.

**Scope, stated plainly (the issue's exclusions):** no sending from a picked commit (the composer acts; the explorer only chooses the place — that is M-108), no merge creation (M-111), no issue-staleness indicator (nothing to indicate until issue revisions exist, M-109), and no change to how artifact editing works — the artifact component moves whole, keeping its M-100 contract. One consequence of the first exclusion is designed here deliberately: while the surface is navigated to an earlier commit, the composer and the artifact's Edit affordance are disabled with a "Back to now" affordance, because acting from an earlier point _is_ the fork mechanics M-108 owns, and silently appending at the tip while the user looks at the past would be a lying surface.

## Design

### The explorer reads the subscription the space already has

The explorer needs the history's _shape_ — parents, branch points, published flags — and the client already holds every commit as `PlanDetail.timeline`, folded live by `planReducer` over `mercurian.subscribePlan`. ADR 002's rule ("no new surface invents a channel") and the one-subscription economy both say: **the explorer is a second reading of the same subscription, not a second stream.** What was missing is only that the wire projection dropped the graph facts on the floor.

So `PlanTimelineItem` grows two fields on both variants, in `packages/contracts/src/mercurian.ts` and mirrored in the server's `PlanningStore` projections:

```
parents: Schema.Array(MercurianCommitId),  // ordered; empty for the root
published: Schema.Boolean,
```

Both are commit facts `CommitStore` already returns on every read. The contracts module header names `parents`/`published` alongside `sequence` as the deliberate exceptions to "a commit arrives already projected", so the comment keeps telling the truth.

Publish-flip events do not exist (nothing invokes `CommitStore.publish` yet), so `published` is static per commit on this surface today; every in-app commit is born private and renders as such. The distinction ships as real code against a currently-uniform input — a finding, not a blocker, since imported roots (M-101) arrive published.

### Position: navigation is per-window view state; the frozen past is a unary read

Picking a commit navigates. ADR 002 §5 decides where the position lives: nothing ranks, rolls up, or derives from _where a window is looking_, so position is scroll-state-shaped — **client-local, per-window, transient** (`useState` in `PlanningSpace`, not even localStorage: reopening a plan lands on now). Two windows on one plan may look at different commits and still agree on every server-owned fact.

```
type PlanPosition = { _tag: "now" } | { _tag: "anchored"; commitId: MercurianCommitId };
```

- `now` (default): today's behavior — full timeline, live `planText`, composer enabled; the explorer highlights the latest commit.
- `anchored`: the surface shows the path _through_ the anchored commit — its ancestor closure, computed client-side from the `parents` edges now on the wire, in the same sequence order. History above an anchor is immutable, so the anchored view needs no liveness machinery: new commits keep folding into the subscription (the reducer is untouched), the explorer stays live, and the anchored projection is a pure function of `(timeline, anchor)`. Anchoring at the latest commit collapses back to `now`.

What the client _cannot_ derive at an anchor is the artifact's text there: timeline items deliberately carry no revision text (M-100's payload decision, upheld). One unary read closes the gap — `mercurian.getPlanTextAt({planId, commitId}) → { planText }`: the text of the last `plan-revision` at-or-above that commit, `""` when none. Server-side it is existing reads composed: `requirePlan` → `CommitStore.getCommit` (visibility `all`; refuse `CommitNotFoundError` when absent **or when its** `historyId` **is not the plan's** — a commit from another plan's history does not exist _for this plan_) → `CommitStore.ancestors` ∪ self → last revision by `sequence` → decode `PlanRevisionCommitPayload`. Along a single path last-by-sequence is exact; across a pre-merge n-ary ancestry it is a deliberate tiebreak that stops mattering once merges exist (a merge's output _is_ a plan revision, M-111). The result is immutable, so the client fetches once per anchor.

Anchored is a **reverse-state pair**: the way in is picking a commit; the way out is picking the latest commit, or the "Back to now" affordance shown wherever acting is disabled — in the composer's slot and as the artifact header's replacement for Edit. No mode outlives the window.

### The wire: one method in, two fields wider, nothing removed

- `packages/contracts/src/mercurian.ts`: `MERCURIAN_WS_METHODS.getPlanTextAt`; `parents` + `published` on `PlanMessage`/`PlanRevision` (flowing into `PlanTimelineItem`, `PlanDetail`, `PlanStreamItem` untouched); `MercurianGetPlanTextAtInput`, `PlanTextAt`; `MercurianPlanningError.operation` gains `"getPlanTextAt"`.
- `packages/contracts/src/rpc.ts`: `WsMercurianGetPlanTextAtRpc` (unary) in `WsRpcGroup`. `CommitNotFoundError` deliberately does **not** cross the wire: the client only names commits it received from this plan's own subscription, so commit-not-found is a planning bug and wraps into `MercurianPlanningError` like every other cause the client cannot act on.
- `apps/server/src/auth/RpcAuthorization.ts`: `getPlanTextAt` → `AuthOrchestrationReadScope` (the type-checked coverage map enforces the entry).
- `apps/server/src/ws.ts`: unary handler — `PlanNotFoundError` passes, all else wraps, aggregate `"mercurian"`. `subscribePlan` untouched.
- `apps/server/src/mercurian/planning/PlanningStore.ts` and `wire.ts`: projections carry the new fields; `getPlanTextAt` per the design above. No migration — `mercurian.sqlite` already holds every fact this reads.

### Client plumbing: one command, no reducer change

`planReducer.ts` is unchanged (the new fields ride the existing types). `mercurianPlanning.ts` gains `getPlanTextAt` via `createEnvironmentRpcCommand` on the shared scheduler with no concurrency key — it is a read of a frozen fact. `apps/web/src/state/mercurian.ts` exposes `useGetPlanTextAt()`.

### The web surface: pane, icons, explorer

All new code stays in `apps/web/src/components/mercurian/` on `ui/` primitives. The thread world's `RightPanelTabs`/`rightPanelStore` are precedent for the _idea_ and are deliberately not imported (ADR 004; the M-100 `ChatMarkdown` rule applied again).

- **`PlanningSpace.tsx`** — the layout inverts. The conversation column (`PlanTimeline` + `PlanComposer`) is the `flex-1` main content; the right pane sits beside it, `border-l`, width via `useResizableWidth` with `edge: "left"` and key `mercurian:plan-right-pane-width:v1`. Below `sm` the pane stacks above the conversation. The header's right edge carries the toggle icons. Position state, the anchored projection, and the `getPlanTextAt` fetch live here. `PlanningSpaceDraft` is untouched: no plan, no pane, no icons.
- **`PlanPaneToggle`** — the icon pair on `ui/toggle-group` (single-select, deselect-on-reclick = close, exactly the AC's toggle semantics), tooltip labels "Plan" / "History", `FileTextIcon` and `GitBranchIcon`. State is one preference object, `mercurian:plan-right-pane:v1`, default `{ open: true, view: "artifact" }` — the amended vault resolution. Not keying by plan is what makes the choice follow you across plans.
- **`PlanArtifact.tsx`** — moves into the pane as-is; gains `readOnly` + `readOnlyAction` for the anchored case and otherwise keeps its M-100 contract byte-for-byte.
- **`PlanGraph.logic.ts` (+ test)** — the pure graph model over `ReadonlyArray<PlanTimelineItem>`: `buildPlanGraph` (children by inverting `parents`; branch points, merges, `latest`; parent ids absent from the timeline become dropped edges rather than throws), `ancestorClosure`, `navigatorRows` (tree linearization where a merge appears under each parent — one real row, the rest visibly marked references that jump to it), `graphLayout` (lane assignment: first parent inherits the lane, further children open lanes, merges close them), and `planCommitSummary`. _(Superseded by the addendum below: `navigatorRows` is dropped, `graphLayout` becomes `navigatorLayout`, and `spatialLayout` is added.)_
- **`DagExplorer.tsx`** — the pane's explorer: a slim header with the Navigator/Graph switch (`mercurian:dag-explorer-view:v1`, default `navigator`), both views over the logic module. Navigator is a DOM list indented by depth; Graph shares the row rendering with an absolutely-positioned inline SVG rail drawing lanes and edges — no canvas, no animation loop, no graph dependency. Both distinguish published from private, highlight the position, auto-scroll it into view, and call `onSelect` to navigate. _(View assignment superseded by the addendum below.)_

### AC criteria that resolve by construction

- _Exactly one place the artifact appears_: the route mounts one `PlanningSpace`; the artifact renders only inside the pane's `view === "artifact"` branch; the old pane is gone in the same edit.
- _Artifact behaves exactly as today_: the component moves with its props unchanged; its M-100 tests and `PlanArtifact.logic.ts` move nowhere.
- _Stays live without refresh_: unchanged subscription; the explorer folds from the same state.
- _Nothing is destroyed by moving_: navigation writes nothing — no checkout, no rewind, no mutation anywhere on the path.

## Findings carried out of implementation

- `published` is uniformly `false` on this surface until something calls `CommitStore.publish` (no RPC exists; Publishing is unbuilt). The distinction ships dark; imported roots (M-101) light it first. If Publishing later flips flags on _existing_ commits, the subscription has no publish-flip event — that event shape belongs to the Publishing issue.
- The wire timeline skips `issue-revision`/`coding-session` kinds (M-100's forward-compat skip), so "every commit" in the explorer means every commit the surface renders. `buildPlanGraph`'s dropped-edge behavior keeps that a rendering gap rather than a crash, and is pinned by a test.
- Forks are representable everywhere here but creatable nowhere until M-108; merge rendering is contract-only until M-111. The logic tests build both shapes by hand.
- `PlanningStore.readTip` picks the _globally latest_ commit as append target — fine while the UI cannot create forks, but wrong-shaped the day M-108 lands (a send should extend the _viewed_ path). Out of scope here; recorded for M-108's plan.
- The old `mercurian:plan-artifact-width:v1` localStorage entries are orphaned by the key change; harmless, no migration written.

---

## Addendum (2026-08-04) — view semantics corrected: the Navigator is the git-graph; the Graph is the spatial map

_Recorded after review of the in-progress build (PR #11). The vault is amended to match (almagest: "DAG Explorer", "Merges" — vault commit `6ead8bc`); this addendum records the implementation consequences. Everything not named here stands as planned._

**The correction.** The two views were mis-assigned above. The lane-rail git-graph — sequence-ordered commit rows with an SVG rail drawing lanes and edges — is the **Navigator**: rows in time order are the easier reading to move through, and rows are the thing you pick. The **Graph** view is a spatial, Obsidian-style map of the DAG — every commit a node, every parent edge drawn, the whole shape visible at once — for seeing structure, not for walking it. Consequently no view renders the history tree-style, and the merge-under-each-parent contract (Merges) goes dormant: both views draw a merge once — the navigator where its lanes reunite, the graph as one node with an edge from each parent.

### Superseded in the plan above

- `NavigatorView` (tree-indented DOM list) and `navigatorRows` (tree linearization with merge reference rows) are dropped. The rendering built as `GraphView` — commit rows sharing the row component, SVG rail from `graphLayout` — is the Navigator; its lane semantics move over unchanged, under the name `navigatorLayout` (with `PlanGraphRow`/`PlanGraphEdge`/`PlanGraphLayout` renamed to `NavigatorRow`/`NavigatorEdge`/`NavigatorLayout`, the freed `NavigatorRow` name now meaning the right thing).
- The AC bullet on tree-style merge rendering is amended in place.
- The Graph view is new work: the spatial map, architecture below.
- Unchanged: the persisted view preference (`mercurian:dag-explorer-view:v1`, default `"navigator"`), navigate-on-pick, position highlight, published/private treatment, `ancestorClosure`, and everything outside `DagExplorer.tsx` / `PlanGraph.logic.ts`.

### Architecture of the spatial Graph view

The known failure modes of a force-directed DAG view are instability (a different layout every open), hairball (direction illegible), live commits re-scrambling the map, and reaching for a graph engine. Each is addressed head-on, inside the repo's temperament (no graph dependency, no continuously repainting animations):

- **Layout is a pure, deterministic function** in `PlanGraph.logic.ts`: `spatialLayout(graph, prior?) → { nodes, positions, edges, bounds, simulated }`. No `Math.random`, no clocks — initial positions are seeded from an FNV-1a hash of each commit id, arranged along a time axis by generation. Same timeline → same picture, every open, every window — and it tests exactly like the rest of the logic module.
- **Force simulation runs synchronously** to a fixed tick budget, then renders once as static SVG. Three forces: springs along parent edges; pairwise repulsion (n² is fine — histories are human-scale; beyond `SPATIAL_MAX_SIMULATED_NODES` (300) the sim is skipped for the plain time-axis arrangement, reported as `simulated: false`); and a weak directional field ordering nodes by generation along one axis (ancestors above, descendants below). The directional field is the piece plain Obsidian doesn't have and a DAG needs — it keeps root→tips reading as flow instead of a hairball, while springs and repulsion still let branches splay sideways.
- **Two invariants are enforced rather than hoped for**, in post-passes after the solve: every child sits strictly beyond every parent along the flow axis (a soft force gets this right _most_ of the time, and "most of the time" is how a graph view starts lying about which way time runs), and no two nodes end up closer than `SPATIAL_MIN_SEPARATION`. The separation pass pushes only along the cross axis, so the two passes cannot fight.
- **Locality under live commits**: when the timeline grows, new nodes initialize at their first parent's position plus a small seeded offset, and the sim re-runs warm from `prior` positions with a reduced budget — the map drifts locally instead of re-solving globally. (`prior` is per-window component state, like the position anchor.)
- **Rendering and interaction**: one inline SVG (the rail idiom, grown up) — nodes as the same solid/hollow published-vs-private dots with the kind glyph, edges as curves, labels on the current node and on hover; click is `onSelect(commitId)`, the same navigate contract; the current position highlighted and centred on position change. Pan/zoom is a single `transform` on a `<g>`, driven by pointer/wheel events — state changes only during a gesture; nothing repaints at rest.
- **Explicitly declined**: d3-force / reactflow / dagre (a dependency for a problem that is small at this scale), canvas/WebGL (SVG suffices), continuous simulation (temperament), semantic zoom (nothing to elide at these history sizes; revisit if real histories outgrow a screen).

### Two defects the corrected build surfaced

Both were found by putting a real forked history on screen for the first time (seeded through `CommitStore`, since M-108 does not exist yet), and both are fixed here:

- **Pointer capture swallowed the pick.** Capturing the pointer on `pointerdown` to drive panning retargets the subsequent `click` to the capturing element, so clicking a node never reached its handler — the map was draggable but not clickable. Capture is now deferred until the pointer has travelled past a small threshold: a press that never moves is a pick, not a pan. (`setPointerCapture` is wrapped in `try`/`catch`, matching `useResizableWidth`'s precedent.)
- **`now` showed every commit, not the path.** The conversation filtered by ancestor closure only while anchored; at `now` it rendered the unfiltered timeline, which on a forked history interleaves parallel branches into one conversation. It now filters by the closure of the anchored commit _or the latest one_ — the conversation is always exactly one path, and a branch you are not on is a different conversation rather than more of this one.

Also fixed in passing: the map's node groups carried no accessible name, leaving them unreadable to a screen reader and unreachable by keyboard. Each now carries `aria-label={planCommitSummary(item)}`.

### Test plan deltas

`PlanGraph.logic.test.ts` drops the `navigatorRows` cases, keeps the lane cases under `navigatorLayout`, and gains `spatialLayout` cases: determinism (two runs, identical output, across chain/fork/merge fixtures); the flow axis is monotone along ancestry (every child strictly beyond its parents); minimum node separation after convergence on the fixture shapes; locality (appending a leaf moves no prior node beyond a tolerance, and the newcomer lands near its parent); the over-cap fallback. The AC walk swaps the two views' descriptions accordingly.

### Checklist deltas

- `apps/web/src/components/mercurian/PlanGraph.logic.ts`: drop `navigatorRows`, rename `graphLayout` → `navigatorLayout`, add `spatialLayout`.
- `apps/web/src/components/mercurian/DagExplorer.tsx`: the rows-plus-rail rendering becomes `NavigatorView`; a new `GraphView` renders the spatial map.
- `apps/web/src/components/mercurian/PlanningSpace.tsx`: `visibleTimeline` filters by ancestor closure at `now` as well as when anchored.
