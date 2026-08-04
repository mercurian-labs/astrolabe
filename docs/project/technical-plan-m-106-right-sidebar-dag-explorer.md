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
- **`PlanGraph.logic.ts` (+ test)** — the pure graph model over `ReadonlyArray<PlanTimelineItem>`: `buildPlanGraph` (children by inverting `parents`; branch points, merges, `latest`; parent ids absent from the timeline become dropped edges rather than throws), `ancestorClosure`, `navigatorRows` (tree linearization where a merge appears under each parent — one real row, the rest visibly marked references that jump to it), `graphLayout` (lane assignment: first parent inherits the lane, further children open lanes, merges close them), and `planCommitSummary`.
- **`DagExplorer.tsx`** — the pane's explorer: a slim header with the Navigator/Graph switch (`mercurian:dag-explorer-view:v1`, default `navigator`), both views over the logic module. Navigator is a DOM list indented by depth; Graph shares the row rendering with an absolutely-positioned inline SVG rail drawing lanes and edges — no canvas, no animation loop, no graph dependency. Both distinguish published from private, highlight the position, auto-scroll it into view, and call `onSelect` to navigate.

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
