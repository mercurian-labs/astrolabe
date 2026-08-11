# Technical Plan — M-127: DAG explorer: graph view polish

_Generated from the Goal/AC of Linear issue M-127 (see the issue for the full AC). Builds directly on `docs/project/technical-plan-m-106-right-sidebar-dag-explorer.md` and its 2026-08-04 addendum, which shipped the explorer this plan polishes. The d3 direction is maintainer-decided, recorded as a comment on M-127. Design source: the almagest vault's "DAG Explorer" note, §"How the graph view reads"._

**Goal, in one sentence:** make the explorer's Graph view legible and fluid — a calm cursor-anchored camera with eased movement and fit/jump controls, finite motion between solved layouts, hover/focus emphasis of a commit's lineage, a persistently marked current path, badge-style nodes with zoom-dependent detail, and a minimap when the map outgrows the frame — without giving up the view's deterministic, nothing-ticks-at-rest architecture.

**Scope, stated plainly (the issue's exclusions):** the Navigator view is untouched; no continuous/live physics (the map stays still at rest, by design and by AGENTS.md temperament); commit-kind colors are an open decision in the vault, not planned here; the stale-issue indicator remains M-109's. Nothing in this plan crosses the wire: every change lives in `apps/web/src/components/mercurian/`.

## Conventions Detected

- **Logic/component split** — pure logic in `<Component>.logic.ts` with colocated `<Component>.logic.test.ts`, component in `<Component>.tsx` (`PlanGraph.logic.ts`, `SearchPalette.logic.ts`, `ProjectTreeSidebar.logic.ts`, …). Confidence: high.
- **Tests** — `import { describe, expect, it } from "vite-plus/test"`; hand-built timeline fixtures with ASCII-art shape comments (`PlanGraph.logic.test.ts`); run targeted via `vp test run <files>`, never repo-wide (AGENTS.md §Verifying). Confidence: high.
- **No continuously repainting animations** — AGENTS.md §Taste ("they peg the GPU on high-refresh displays") and M-106's addendum ("nothing repaints at rest"). Finite, event-triggered transitions are the only motion allowed. Confidence: high.
- **Reduced motion** — checked inline via `window.matchMedia("(prefers-reduced-motion: reduce)")` (`settingsLayout.tsx:43`, `terminal/ghostty/surface.ts:538`); no shared hook exists. Confidence: medium (two instances) — this plan follows the inline pattern rather than inventing a hook.
- **Dependencies** — app-local deps are caret-pinned directly in `apps/web/package.json` (`lucide-react`, `zustand`); the workspace `catalog:` in `pnpm-workspace.yaml` is reserved for cross-package pins. No d3 module exists anywhere in the lockfile today. Types live in `devDependencies` (`@types/react` precedent). Confidence: high.
- **Styling** — Tailwind semantic tokens (`border`, `muted-foreground`, `primary` — mapped in `apps/web/src/index.css` `@theme`) composed with `cn()`; shared primitives from `components/ui/` (`toggle-group`, `button`, `tooltip` all present). Confidence: high.
- **Commits & branch** — conventional, scoped, issue-tagged: `feat(web): … (M-127)`; branch `venk/m-127-dag-explorer-graph-view-polish` (Linear's `gitBranchName`; matches M-123/M-124 history). PR needs before/after images, and motion needs a short video (AGENTS.md §Pull requests). Confidence: high.
- **Plan documents** — `docs/project/technical-plan-m-<n>-<slug>.md`. Confidence: high.

## Design

### Reversing one M-106 decision, keeping the rest

M-106's addendum "explicitly declined: d3-force / reactflow / dagre … canvas/WebGL … continuous simulation". This plan reverses **only the d3-force line**, by maintainer direction on M-127: the solver's internals and the transition math come from two d3 micro-modules, **`d3-force`** and **`d3-interpolate`**. Everything else declined stays declined — no graph engine, no canvas/WebGL, no continuous simulation — and the invariants that made the view trustworthy are non-negotiable: layout remains a **pure, deterministic, synchronously-solved function of `(graph, prior)`**, and the SVG repaints only on discrete events or during a finite transition.

`d3-zoom` is deliberately **not** adopted: it is a DOM behavior bound to d3-selection, and `DagExplorer.tsx` already owns pointer handling in React (the pick-vs-pan threshold logic M-106 debugged). The camera math it would bring is small enough to own; the one piece worth importing — smooth zoom-and-pan flights — is `interpolateZoom`, which lives in `d3-interpolate`.

Determinism under d3-force needs one care: its internal jiggle (applied to coincident points) draws from `Math.random` unless overridden. The simulation gets a seeded LCG via `simulation.randomSource(...)`, seeded from the same FNV-1a scheme `seedOf` already provides — same timeline, same picture, every window, still pinned by the existing determinism tests.

### `PlanGraph.logic.ts` — solver swap, same contract

`spatialLayout(graph, prior?)` keeps its signature, its exported constants, its warm-start locality behavior, its `SPATIAL_MAX_SIMULATED_NODES` fallback, and its two enforced post-passes. Internals change:

- The hand-rolled tick loop (repulsion + springs + flow field + damping, ~70 lines) is replaced by a `d3-force` simulation constructed per call, `.stop()`ed immediately, and ticked synchronously to the existing budgets (`SPATIAL_COLD_TICKS` / `SPATIAL_WARM_TICKS`): `forceLink` on parent edges (distance `SPATIAL_SPRING_LENGTH`), `forceManyBody` (charge tuned to match today's `SPATIAL_REPULSION` feel; quadtree approximation makes the n² pass cheaper as histories grow), `forceY` per node to `generation × SPATIAL_FLOW_SPACING` (the flow field), and `forceCollide(SPATIAL_MIN_SEPARATION / 2)` doing the bulk of separation work inside the solve.
- The **flow post-pass stays verbatim** (child strictly beyond every parent — `forceCollide` pushes radially and could nudge along the flow axis, so the guarantee remains a post-pass, run last). The **cross-axis separation pass stays as the backstop** for what collide leaves; with collide in the solve it converges in a pass or two instead of 32.
- Initial positions are seeded exactly as today; `prior` warm-starts land unchanged.
- New export: `descendantClosure(graph, commitId)` — the mirror of `ancestorClosure` over `childrenIds`, needed for lineage emphasis. Same shape, same tests style.

### `DagExplorer.logic.ts` (new) — camera, gestures, and render geometry, pure

New sibling module per the logic-split convention, owning everything the AC makes mathematical, so it tests like the rest:

- `type MapTransform = { x: number; y: number; zoom: number }` (the existing inline transform state, given a name).
- `zoomAtPoint(transform, factor, point, viewBox)` — clamps to `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM` and solves the translation that keeps `point` (in viewBox coordinates, converted from the client point by the component) fixed on screen. Replaces today's center-anchored `onWheel` math.
- `wheelIntent({ ctrlKey, metaKey, deltaX, deltaY })` → `{ kind: "zoom"; factor } | { kind: "pan"; dx; dy }` — pinch reaches the browser as a `ctrlKey` wheel event, so: modifier-wheel zooms, plain wheel pans (Figma-style, matching the AC). Pure so the mapping is pinned by tests, not by manual QA.
- `fitTransform(bounds, viewBox)` and `centerOn(point, transform, viewBox)` — the two controls' targets.
- `cameraTween(from, to, viewBox)` → `(t: number) => MapTransform` — same-zoom flights (node pick, jump-to-current, recenter-on-anchor-move) are a pure eased pan: the map shifts over, zoom identical at every t. Only zoom-changing flights (fit) go through `interpolateZoom`, computed in **center space** — `[cx, cy, w]` where `c` is the world point at the viewport center and `w = viewBox.width / zoom` — never in translation space, which mis-scales the van Wijk flight and collapses the map mid-flight. _(Amended 2026-08-10: the original translation-space wrapping shipped exactly that collapse; found on the browser pass.)_
- `detailFor(zoom)` → `"dot" | "glyph" | "labeled"` with exported thresholds, plus `labelVisible(zoom, node, isCurrent)` — junction commits (branch points, merges) and the current commit gain labels a tier earlier than ordinary commits.
- `radiusFor(node)` — base **10** (up from 6), **12** for branch points and merges; glyph size = radius (a 0.5 ratio of diameter, versus today's 0.75 crush).
- Minimap geometry _(added 2026-08-10 by maintainer direction)_: `minimapProjection(bounds, size)` → the world→minimap scale/offset mapping (aspect-preserving, padded); `visibleWorldRect(transform, viewBox)` → the world region the frame currently shows; `minimapPointToWorld(point, projection)` — the inverse mapping, for click/drag-to-move; `mapOverflows(bounds, transform, viewBox)` → whether any of the graph lies outside the frame, the minimap's visibility predicate. All pure, so the appear/disappear boundary and both mappings are pinned by tests.
- ~~`edgeRibbon(...)` — a tapered parent→child ribbon~~ _(shipped, then declined by maintainer direction 2026-08-10 — it didn't read well; see the edges bullet below)._

### `DagExplorer.tsx` — rendering and the one finite transition driver

- **Badge nodes.** Published: solid `fill-muted-foreground` disc, **no border stroke** (today's stroke muddies the solid read), glyph in `text-background` at `strokeWidth={3}` (lucide draws on a 24-unit grid; 3/24 × 10px ≈ 1.25px on screen — without this the glyph stays illegibly thin at any padding). Private: `fill-background` disc with `stroke-muted-foreground`, glyph in `text-muted-foreground`. Current-commit ring keys off `radiusFor(node) + 4`.
- **Lineage emphasis.** `hovered ?? focused` node → lineage = `ancestorClosure ∪ descendantClosure`. Node groups and edges outside the lineage drop to ~18% opacity via a Tailwind `transition-opacity duration-150` — a finite CSS transition triggered by a discrete event, inside the no-continuous-animation rule. Focus (keyboard) triggers emphasis exactly like hover, so the interaction isn't pointer-only.
- **Edges stay uniform strokes.** A tapered parent→child ribbon shipped first and was declined by maintainer direction (this issue) — it didn't read well. Edges return to the existing uniform-width cubic curves; direction needs no decoration because the layout _enforces_ it: the flow post-pass guarantees every child sits strictly below its parents, so time reads downward from position alone.
- **Current path.** Edges whose both ends sit in `ancestorClosure(currentCommitId)` render `stroke-foreground` (near-black in light mode, near-white in dark) at slightly greater width; the rest stay `stroke-border`. Always on — orientation shouldn't require interaction. _(Amended 2026-08-10, decision recorded on M-127: was `primary`; blue lines over-signal — the ring alone keeps `primary` as the position marker.)_
- **Level of detail.** `detailFor(zoom)`: below the glyph threshold nodes render as plain discs; labels render per `labelVisible`, with opacity stepped by tier. Zoom only changes during gestures/flights, which already repaint — LOD adds no new repaint pressure.
- **The transition driver.** One small local hook, `useTween`: a single `requestAnimationFrame` loop that runs **only while a tween is active**, cancels any prior tween, and completes in ~250ms. Consumers: camera flights (`cameraTween`) and layout-change motion — when `spatialLayout` returns a new layout, node/edge positions interpolate from the previous layout's `positions` map to the new one (new nodes fade/scale in at their solved spot). When `window.matchMedia("(prefers-reduced-motion: reduce)")` matches, duration is 0 — state applies instantly, per the repo's inline-check pattern. At rest: no rAF scheduled, no CSS animation running.
- **Controls.** A small overlay (bottom-right of the map, `absolute` inside the existing `relative` wrapper): two `ui/button` ghost icon buttons with `ui/tooltip` labels — fit-to-view (`Maximize2Icon`) and jump-to-current (`LocateFixedIcon`) — both flying via `cameraTween`.
- **Gestures.** The existing pointer pick-vs-pan threshold logic stands (M-106 debugged it; don't disturb it). Wheel handling is a **native non-passive listener** registered on the svg in an effect — React ≥17 registers root wheel listeners passive, so a synthetic `onWheel` cannot `preventDefault()` and pinch would zoom the page — routing through `wheelIntent`. _(Amended 2026-08-10: found in review.)_
- **Minimap.** _(Added 2026-08-10 by maintainer direction.)_ A local `Minimap` function component in `DagExplorer.tsx` (the `NavigatorView`/`GraphView` precedent — same file): its own small `<svg>` (~160×110) in the overlay corner, rendered from the same `layout` via `minimapProjection` — nodes as ~2px dots (`fill-muted-foreground`, current commit `fill-primary`), no glyphs or labels, edges as hairline strokes when they fit, and the `visibleWorldRect` drawn as a `stroke-primary` rectangle with a faint fill. Shown only while `mapOverflows(...)` is true — when the whole graph fits in the frame it doesn't render. Pointer-down/drag recenters via `minimapPointToWorld` + `centerOn` — drag tracks directly (no tween mid-gesture), a plain click flies via `cameraTween`. Carries `aria-label="Map overview"`; repaints only when the transform or the layout changes. When the minimap is visible, the fit/jump buttons stack directly above it.

### AC criteria that resolve by construction

- _Pan/zoom preserved across commits landing_: transform state was never keyed on layout (M-106 decision) — untouched.
- _Same history, same picture, every window_: determinism pinned by existing tests, extended to cover the seeded `randomSource`.
- _A press without movement still picks_: the untouched drag-threshold logic.
- _Keyboard/screen-reader access while emphasis is active_: emphasis is opacity on the same interactive groups — `aria-label`, `role="button"`, `tabIndex`, and key handling are unchanged, and focus itself drives emphasis.

### Findings and accepted edges

- Pinch-as-`ctrlKey`-wheel is the cross-browser convention Chromium/Firefox emit; the desktop app is Electron (Chromium), so the primary surface is exact. Two-pointer touch pinch on actual touchscreens is not implemented today and stays out of scope.
- Label collision avoidance at high zoom is deliberately not planned (yagni at ≤300-node histories); revisit only if real histories make labels overlap in practice.
- Retuning is expected: swapping solvers changes exact positions, so test tolerances (separation, locality drift) may need adjusting — the _properties_ pinned must not weaken.

## Implementation Checklist

- [ ] Branch `venk/m-127-dag-explorer-graph-view-polish` off latest `main`.
- [ ] Add to `apps/web/package.json`: `d3-force` ^3, `d3-interpolate` ^3 (dependencies); `@types/d3-force`, `@types/d3-interpolate` (devDependencies). `vp i`. Do **not** add `d3-zoom`, `d3-selection`, or the `d3` metapackage.
- [ ] `PlanGraph.logic.ts`: swap the solver internals to `d3-force` per design (seeded `randomSource`, synchronous ticks, forces mapped to the existing constants); keep signature, constants, warm start, cap fallback, and both post-passes; add `descendantClosure`.
- [ ] `PlanGraph.logic.test.ts`: existing property suites pass (retune tolerances only, never the properties); add `randomSource` determinism coverage and `descendantClosure` cases on the chain/fork/merge fixtures.
- [ ] `DagExplorer.logic.ts` **(new)**: `MapTransform`, `zoomAtPoint`, `wheelIntent`, `fitTransform`, `centerOn`, `cameraTween`, `detailFor`/`labelVisible`, `radiusFor`, with exported threshold constants.
- [ ] `DagExplorer.logic.test.ts` **(new)**: cases per Test Plan.
- [ ] `DagExplorer.tsx`: badge nodes; lineage emphasis on hover **and focus**; always-on current-path treatment; LOD rendering; `useTween` driver with reduced-motion guard; controls overlay; wheel routing through `wheelIntent` (native non-passive listener); leave pointer pick-vs-pan logic untouched.
- [ ] `DagExplorer.logic.ts`: add the minimap geometry (`minimapProjection`, `visibleWorldRect`, `minimapPointToWorld`, `mapOverflows`); remove `edgeRibbon` (edges return to uniform strokes).
- [ ] `DagExplorer.tsx`: the `Minimap` local component with overflow-gated visibility and click/drag recentering; replace ribbon edges with uniform-stroke curves (`stroke-foreground` current path, `stroke-border` rest).
- [ ] Targeted verification only: `vp test run` on the two test files; targeted typecheck/lint for `apps/web/src/components/mercurian/`. No repo-wide checks.
- [ ] Commits conventional and issue-tagged, e.g. `feat(web): dag graph view — d3-force solver, calm camera, badge nodes (M-127)`; split solver swap and rendering/camera work into separate commits if review benefits.
- [ ] PR (only when asked): before/after screenshots plus a short video of the motion (AGENTS.md requirement), body ending with model + harness.

## Test Plan

Unit tests, colocated, `vite-plus/test`, run via `vp test run apps/web/src/components/mercurian/PlanGraph.logic.test.ts apps/web/src/components/mercurian/DagExplorer.logic.test.ts`.

`PlanGraph.logic.test.ts` (extend):

- [ ] Determinism holds through the d3-force swap: two cold solves of chain/fork/merge fixtures are identical; two warm solves from the same `prior` are identical.
- [ ] Flow monotonicity, minimum separation, warm-start locality, and the over-cap fallback still hold (retuned tolerances documented in the test if changed).
- [ ] `descendantClosure`: leaf → itself; branch point → all descendants across both arms; merge parents → closure flows through the merge; unknown id → empty.

`DagExplorer.logic.test.ts` (new):

- [ ] `zoomAtPoint` keeps the anchor point fixed (world point under cursor identical before/after), clamps at both zoom bounds, and is identity at factor 1.
- [ ] `wheelIntent`: plain deltas → pan with matching dx/dy; `ctrlKey` (and `metaKey`) → zoom with factor direction following delta sign.
- [ ] `fitTransform` frames the full bounds inside the viewBox with padding; `centerOn` puts the target at the viewBox center at unchanged zoom.
- [ ] `cameraTween` endpoints equal `from` at t=0 and `to` at t=1, including the degenerate same-center and zoom-only cases; an equal-zoom flight holds zoom constant at every sampled t (the map shifts over, never dips); a zoom-changing flight's intermediate zoom stays within a sane band of its endpoints (the mid-flight collapse cannot regress).
- [ ] `detailFor`/`labelVisible`: tiers are monotone in zoom; junction and current commits label a tier before ordinary commits.
- [ ] `radiusFor`: ordinary vs branch/merge sizing.
- [ ] Minimap geometry: `minimapProjection` round-trips with `minimapPointToWorld` (world → mini → world is identity within rounding); `visibleWorldRect` at the fit transform covers the full bounds; `mapOverflows` is false at the fit transform and true once zoomed in past it; projection preserves aspect (no stretch).

Manual/integrated (on request, per AGENTS.md): one `test-t3-app` pass on a seeded forked history — verify pinch/scroll feel, hover emphasis smoothness, minimap appearance/disappearance across the fit boundary and drag-to-move, reduced-motion behavior with the OS setting on, and that the map is motionless at rest (no repaints in the performance panel).

## Addendum (2026-08-11) — d3-dag layouts, display settings, straight edges, proximity sizing

_Maintainer-decided, superseding the parts of the plan named below. Everything not named here stands: camera, gestures, tween driver, minimap, badge nodes, lineage emphasis, current path, LOD, accessibility guards._

### The layout engine changes: `d3-dag` replaces `d3-force`

The Graph view's arrangement now comes from `d3-dag` (^1.1 — TypeScript-first, types bundled, actively maintained), and the user chooses among its three layouts — **Sugiyama (default), Grid, and Zherebko** — so the force simulation is retired before it was ever swapped. Superseded:

- The entire "solver swap" section: no `d3-force`, no seeded `randomSource`, no warm start, no post-passes — Sugiyama's layering puts every child strictly beyond its parents by construction, and all three layouts are deterministic without seeding.
- Dependencies: `d3-dag` ^1.1 replaces `d3-force` + `@types/d3-force`. `d3-interpolate` stays — camera flights and layout tweens are unchanged.
- `spatialLayout(graph, prior?)` becomes `dagLayout(graph, options)`: `graphStratify` from `commitId`/`parents`, run the selected layout, return `{ nodes, positions, edges, bounds }` with each edge carrying the layout's `points` as a polyline. The node cap and its fallback are retired; the `SPATIAL_*` force constants go with the solver.
- A locality trade, made knowingly: M-106's "the map drifts locally" warm-start design does not survive a layered layout — a landing commit may legitimately rearrange ranks. The `useTween` layout transition keeps that humane: the map animates to its new arrangement, and pan/zoom never resets. The locality test is replaced by transition coverage.
- Edges render as straight polyline segments through the layout's edge points — the cubic curves are retired along with the taper. The minimap draws the same polylines as hairlines.

### Display settings

A settings button (ghost `ui/button`, `Settings2Icon`) at the right end of the explorer's "History" bar, after the Navigator/Graph toggle, opens a `ui/popover`:

- **Display layout** — dropdown (`ui/select`): Sugiyama / Grid / Zherebko, default Sugiyama.
- **Node size** — slider (`ui/slider`), 0.00–5.00, step 0.05, default 1.00 — multiplier on node radius.
- **Line thickness** — slider, same range/step, default 1.00 — multiplier on edge stroke width.

Persistence follows the `EXPLORER_VIEW_STORAGE_KEY` idiom: one Schema-validated `useLocalStorage` entry, `mercurian:dag-explorer-display:v1` (malformed or out-of-range → defaults) — display settings follow you across plans like the view choice. Verified at implementation time: `ui/popover`, `ui/select`, `ui/button` present; `ui/slider` absent — added to `components/ui/` in the repo's base-ui + shadcn idiom, never hand-rolled in the feature.

### Node sizing: connectedness and proximity

- `radiusFor(node, settings)` = base radius × `nodeSize` × a degree factor (√(parents + children), clamped ~1–1.6×) — subsumes the fixed branch/merge bump.
- Proximity growth: pure `proximityScale(distanceToPointer)` (1.0 beyond ~72px, easing to ~1.35× at the node), applied on pointer-move over the map — repaints only while the cursor moves, so the at-rest invariant holds.

### Checklist deltas

- [ ] Dependencies: add `d3-dag` ^1.1; remove `d3-force`/`@types/d3-force`.
- [ ] `PlanGraph.logic.ts`: replace `spatialLayout` with `dagLayout(graph, options)`; keep `buildPlanGraph`, `ancestorClosure`, `descendantClosure`.
- [ ] `DagExplorer.logic.ts`: display-settings schema + defaults, `proximityScale`, degree-aware `radiusFor(node, settings)`; edge types become polylines.
- [ ] `DagExplorer.tsx`: straight polyline edges; settings popover on the History bar (add `ui/slider`); sizing wired to settings; proximity growth on pointer-move.

### Test plan deltas

- [ ] `dagLayout`: deterministic per layout; flow-monotone per layout; layout option respected; polyline endpoints coincide with endpoint nodes. Drops: warm-start locality, over-cap fallback, separation tolerance.
- [ ] Display settings: schema decode round-trip; malformed/out-of-range → defaults; multipliers of 0 honored.
- [ ] `radiusFor`: monotone in degree; linear in nodeSize. `proximityScale`: 1.0 beyond falloff; max at 0; monotone non-increasing.

### Addendum 2 (2026-08-11) — hover popover, click-only labels

_Maintainer-decided on the browser pass. Supersedes the zoom-tier labeling: `labelVisible`'s junction/current tiers retire — the only inline label is the clicked (current) commit's, at any zoom. Hovering any node opens a popover carrying the commit's full message (untruncated), anchored at the node and dismissed on pointer-leave; it repaints only on hover changes, so the at-rest invariant holds. LOD keeps governing dot→glyph simplification only._

_Also decided: the display-settings button moves off the History bar into the upper-right corner of the graph canvas, rendered only with the Graph view — placement says scope. The fit/jump controls keep the bottom-right corner._
