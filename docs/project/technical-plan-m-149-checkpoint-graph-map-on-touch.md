# Technical Plan — M-149: Checkpoint Graph map on touch

_Generated from the Goal/AC of Linear issue M-149 ("Checkpoint Graph map on touch"). Branch `venk/m-149-checkpoint-graph-map-on-touch`, stacked on `venk/m-148-history-thread-view-on-mobile` (history Thread view; checkpoint grouping + position logic placed for reuse), which stacks on `venk/m-147-mobile-planning-space` and `venk/m-146-mobile-plan-list`. Downstream `venk/m-150-implement-moment-on-mobile` fills this plan's implement seam. Design source: the almagest vault note **Checkpoint Graph** — "How the graph view reads" and "The node popover" — read together with the touch divergences already decided for this issue (they are design inputs here, not open questions): tap summons the node detail as a bottom sheet; acts (Go here / implement from here) live in the sheet; tap never navigates directly; the map opens full-screen as its own route; hover-swell is replaced by enlarged hit targets (44pt+); a fit-to-view control joins the minimap._

**Goal, in one sentence:** the plan history's spatial map — the same DAG the desktop Graph view draws, laid out by the same engine — becomes a full-screen, touch-first route on mobile: pinch-zoom around the touch point, eased pan, glyph discs with corner status dots, a bottom sheet for identity and acts, and a camera that never loses you; read-mostly, with arrangement and drawing settings deliberately out of this pass.

## Stack assumptions

The four sibling branches exist but are being planned in parallel (all currently point at main, `d1731ae88`). This plan treats M-146..148 as landed and pins what it assumes about each; if a sibling landed a piece differently, the adjustment is named inline.

1. **M-146 (mobile plan list)** created the mobile Mercurian wiring: `apps/mobile/src/state/mercurian.ts` **(assumed)** calling `createMercurianPlanningAtoms(connectionAtomRuntime)` — the exact pattern every mobile state module already follows (`apps/mobile/src/state/git.ts`, `auth.ts`, `projects.ts`) and the mirror of `apps/web/src/state/mercurian.ts:30`. The atoms themselves already exist and are shared: `packages/client-runtime/src/state/mercurianPlanning.ts` (subscription + every act) and `planReducer.ts` (whose doc comment says "Pure, so web and mobile share it"). Nothing new crosses the wire for M-149.
2. **M-147 (mobile planning space)** established the plan route. Assumed: a flat RootStack route with linking prefix `plans/:planId` (web's `mercurian.ts:33` comment establishes that Mercurian lives on the primary environment and "plan routes therefore carry no environment id"; mobile's `THREAD_LINKING_PREFIX` in `apps/mobile/src/Stack.tsx:224` shows the flat-route convention). If M-147 chose a different prefix (e.g. carrying `environmentId`), the map route in this plan nests under whatever it chose.
3. **M-148 (history Thread view)** hoisted the framework-free planning-history logic from `apps/web/src/components/mercurian/` into `packages/client-runtime` — the repo's stated home for "client code shared by web and mobile" (AGENTS.md, "Where code lives"). Assumed hoisted: `PlanGraph.logic.ts` (graph building), `PlanCheckpoints.logic.ts` (condensing, `planNodeStatusDots`, `planNodeSummary`), `PlanPosition.logic.ts`, `PlanNodePopover.logic.ts` (`derivePlanNodePopover`, `offeredActs`), and the freshness leaf sets from `SpecArtifact.logic.ts` (`staleSpecLeafIds`, `stalePlanLeafIds`) — with their tests, and web imports re-pointed. Also assumed from M-148: a per-plan **position store** on mobile (the Thread view's picks already had to move the planning surface, and position is per-window/transient — `PlanPosition.logic.ts`'s ADR 002 §5 framing — so it lives client-side, not on the wire). If M-148 hoisted less than this, the missing modules move as part of this plan's checklist item 1 (the hoist is additive either way); if M-148 already built a checkpoint-detail sheet for its rows, this plan **extends that sheet** instead of adding a second one — the vault's "one popover, three views" contract.
4. **M-150 (implement moment)** is downstream: the sheet's "Implement from here" act routes through a stub hook (below) that M-150 replaces with the real gate flow.

## What discovery found

### The desktop map is already two-thirds portable

- **Layout is pure and engine-backed.** `dagLayout` in `apps/web/src/components/mercurian/PlanGraph.logic.ts:211` runs d3-dag's `sugiyama`/`grid`/`zherebko` over the condensed graph and returns a `SpatialLayout` (nodes, positions, polyline edges, bounds). d3-dag 1.2.2's runtime deps are pure JS (`d3-array`, `javascript-lp-solver`, `quadprog`, `stringify-object` — no DOM), so it runs under Hermes/Metro unchanged.
- **The camera is pure too.** `apps/web/src/components/mercurian/DagExplorer.logic.ts` (300 lines, framework-free) holds everything the AC's camera needs: `zoomAtPoint` (pinch-around-the-touch-point is the same formula as ctrl-wheel-around-the-pointer), `fitTransform` + `centerOn`, `cameraTween` (d3-interpolate's `interpolateZoom` — the eased pan/zoom flight), `detailFor`/`MAP_GLYPH_ZOOM` (zoom-fade from glyph to plain dot), `radiusFor` (degree-scaled discs), `edgeWidthFor`, `minimapSize`/`minimapProjection`/`minimapPointToWorld`/`visibleWorldRect`/`mapOverflows`. Web-only pieces stay behind: `wheelIntent`, `proximityScale` (the hover swell — replaced on touch by hit slop), and the `DagExplorerDisplaySettings` schema (settings are out of this pass).
- **Layout-change animation is pure as well.** `settledSpatialLayout` and `interpolateSpatialLayout` (`DagExplorer.tsx:2050–2104`) — the "commit landing while you read moves the map smoothly" behavior — are plain functions over `SpatialLayout`, currently trapped in the web component file.
- **What is genuinely web-bound** is `SpatialMap` (`DagExplorer.tsx:1310`): DOM SVG, pointer events, wheel, ResizeObserver, `requestAnimationFrame` tween driver, Base UI popover. That is the part this plan rebuilds for touch.
- **Node drawing grammar** (all in `DagExplorer.tsx:1624–1770`, per the corrected 2026-08-19 vault resolution — glyphs stay, color means status): published = solid disc (`fill-muted-foreground`), private = hollow (`fill-background stroke-muted-foreground`); checkpoint double-ring inside the disc; kind glyphs — `MessagesSquareIcon` for turn checkpoints, `MessageSquareIcon` (x-mirrored for human authors via `graphMessageGlyphTransform`), `FileTextIcon` plan revision, `CircleDotIcon` spec revision, `SquareTerminalIcon` coding-session leaf — hidden below `MAP_GLYPH_ZOOM = 0.65`; corner status dots at top-right (`planNodeStatusDots`: ready → emerald-500, stale spec → amber-500, stale plan → orange-500, stacking in that order); current commit ringed (`stroke-primary`, r+4); current path's edges emphasized (`stroke-foreground` vs `stroke-border`); accessible name per node (`planNodeAccessibleLabel` + status suffixes).
- **The sheet's content already has one derivation.** `derivePlanNodePopover` (`PlanNodePopover.logic.ts:106`) produces the full reading — identity kind/label/relative-time/published, query text + response excerpt, effect chips, model switch, staleness, moved-past-split, readiness with its repository reason, session facts — and `offeredActs` the act list. The desktop popover renders it; the mobile sheet renders the same reading natively.
- **Position semantics are settled.** `positionAfterPick` (`PlanPosition.logic.ts:61`) is what "Go here" calls; `resolveImplementFrom`/`resolveActingHead` is what an implement act must route through (a session leaf acts from its parent).
- **Props the map needs are all derivable client-side** exactly as `PlanningSpace.tsx:239–248` does: `graph = buildPlanGraph(detail.timeline)`, `explorerGraph = condensePlanGraph(graph)`, `staleSpecLeafIds`/`stalePlanLeafIds`, `readyCommits` and `codingSessions` off the subscription state (`planReducer.ts:20`). No server or contract change anywhere in this issue.

### The mobile side has every substrate the map needs — and no Mercurian surface yet

- **`react-native-svg` 15.15.4 is already a dependency** (`apps/mobile/package.json`); **`@shopify/react-native-skia` is not** (verified). `react-native-gesture-handler` ~2.31.1, `react-native-reanimated` 4.3.1, and `react-native-worklets` 0.8.3 are present. `Animated.createAnimatedComponent` is already in use (`GitActionProgressOverlay.tsx:15`), and the `Gesture.Pan()` + `GestureDetector` + `runOnJS` pattern has precedent in `apps/mobile/src/features/layout/workspace-pane-divider.tsx`.
- **Native-dependency discipline is explicit**: `.github/workflows/mobile-fingerprint-check.yml` labels any PR that drifts the native fingerprint as "📱 Native Change" so it can be held and batch-merged before a store build — a native add breaks OTA reach for everything behind it. A new native module needs to earn that; this feature doesn't need one.
- **Navigation**: routes are registered flat in `RootStack` (`apps/mobile/src/Stack.tsx`) via `createNativeStackScreen` with linking paths; bottom sheets are **routes** with `presentation: "formSheet"`, `sheetAllowedDetents: [0.55, 0.92]`, `sheetGrabberVisible: true` (the four Git sheets, `Stack.tsx:458–493`); screens read params via `StaticScreenProps` (`GitOverviewSheet.tsx:37`).
- **Styling**: uniwind classNames on RN components; raw `ColorValue`s for SVG/props come from `useThemeColor("--color-…")` (`apps/mobile/src/lib/useThemeColor.ts`). Mobile's token vocabulary differs from web's (`--color-foreground-muted`, `--color-border`, `--color-screen`, `--color-primary` — `apps/mobile/global.css`); Tailwind palette classes (emerald/amber/orange) are in active mobile use.
- **Icons**: mobile carries `@tabler/icons-react-native` and SF Symbols (`AppSymbol`), not lucide — and neither can render _inside_ an `<Svg>` tree (each icon is its own `<Svg>` root). Glyph parity with desktop therefore needs the lucide path data inlined as `<Path>` constants (five glyphs, stroke-rendered on a 24-unit grid, exactly what web draws).
- **Tests**: colocated `*.test.ts` importing `vite-plus/test`, run via `vp test run <files>` (`apps/mobile/package.json`, e.g. `thread-settings-sheet-state.test.ts`). Sheet building blocks (`SheetActionButton`, `MetaCard`, `SheetListRow`) exist but are threads-scoped (`gitSheetComponents.tsx`); the plans feature gets its own equivalents rather than importing across features.
- **Relative time** formatting exists at `apps/mobile/src/lib/time.ts`.
- **Gap**: `apps/mobile/src` has no Mercurian feature at all today — every entry point below lands on the stack's new plans feature, and this plan touches no existing mobile screen except registering routes and one entry control.

## Conventions Detected

- **Shared client logic lives in `packages/client-runtime`** — AGENTS.md says it outright; every mobile state module wraps a `create*Atoms` factory from it; `planReducer.ts` was written for exactly this reuse. **High.**
- **client-runtime uses subpath exports, no barrel; hyphenated subpath → camelCase file** (`./state/mercurian-planning` → `mercurianPlanning.ts`). **High.**
- **Pure logic in `*.logic.ts` with colocated tests; components carry doc-comment rationale** — the entire `components/mercurian/` directory; mobile mirrors with `*.test.ts` beside sources. **High.**
- **Mobile features under `apps/mobile/src/features/<area>/`, routes registered flat in `Stack.tsx`, sheets as formSheet routes with detents** — threads/git/review/settings all follow it. **High.**
- **Native deps are a held, batched decision** (fingerprint workflow); prefer already-linked native modules. **High.**
- **Performance mandate**: no continuously repainting animations; gesture-driven work stays off the JS thread where the platform allows (AGENTS.md "Taste"; reanimated + worklets are in the app for this). **High.**
- **Targeted verification only**: `vp test run <files>`, scoped typecheck/lint; CI owns the suite; user-visible changes get one integrated pass via `test-t3-mobile` on request, and every AC gets walked in the running app. **High.**
- **Commits & docs**: plan lands as `docs(project): …` in `docs/project/technical-plan-m-149-checkpoint-graph-map-on-touch.md`; implementation as `feat(mobile): …` / `refactor(client-runtime): …` with `(M-149)`; conventional titles per `git log`. **High.**
- **Mercurian-owned files only** (the ADR 004 additive discipline every web Mercurian plan records): all touched files are Mercurian- or plans-feature-owned; the only upstream-shared file edited is `Stack.tsx`, additively (route registrations), which is how every new mobile route lands. **Medium** on the mobile side only because the stack is creating mobile's Mercurian precedent as it goes.

## Design

### One geometry, hoisted — the "same shape" AC is a build artifact, not a promise

The AC "the same history draws the same shape as the desktop map" is satisfied structurally: mobile calls the **same** `condensePlanGraph` → `dagLayout` pipeline, not a port of it. **Decision: hoist, don't copy.**

- New `packages/client-runtime/src/state/planMap.ts` **(new)**, exported as `./state/plan-map`: the camera/geometry core moved verbatim from `apps/web/src/components/mercurian/DagExplorer.logic.ts` (`MapTransform`, `MapPoint`, `MapViewBox`, `MapBounds`, `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM`/`MAP_GLYPH_ZOOM`/`MAP_FIT_PADDING`, `detailFor`, `zoomAtPoint`, `fitTransform`, `centerOn`, `cameraTween`, `radiusFor`, `edgeWidthFor`, `minimapSize`, `minimapProjection`, `minimapPointToWorld`, `visibleWorldRect`, `mapOverflows`) plus `settledSpatialLayout`/`interpolateSpatialLayout` (with their `AnimatedSpatialLayout` types) moved out of `DagExplorer.tsx`. Web-only members (`wheelIntent`, `proximityScale`, the display-settings schema and its decode) stay in `DagExplorer.logic.ts`, which now imports the core from client-runtime.
- `dagLayout` and the `SpatialLayout` types travel with wherever M-148 put `PlanGraph.logic.ts`; if M-148 hoisted graph-building without the d3-dag layout half, this plan moves that half too.
- **Dependencies**: `d3-dag ^1.2.2` and `d3-interpolate ^3.0.1` (plus `@types/d3-interpolate` in devDependencies) move from `apps/web/package.json` into `packages/client-runtime/package.json` — same pinning style as web used (client-runtime's existing deps use `catalog:`, but these two are not in the workspace catalog; adding them to the catalog is optional tidiness, not required). Web drops its direct deps once no web file imports them directly. Both packages are pure JS: no native fingerprint impact (the workflow will still run because `packages/client-runtime/**` is in its path filter — it should report no drift).
- Moved tests move with their modules (`DagExplorer.logic.test.ts` splits: camera-core cases follow `planMap.ts`; `PlanGraph.logic.test.ts` follows its module). Web's suites must stay green with imports re-pointed — the memory-noted CI trap of touching shared modules without their consumers.

The mobile map always renders the **default arrangement** (`sugiyama`, nodeSize 1, lineThickness 1 — `DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS`): the Goal excludes arrangement and drawing settings from this pass, so "same shape" means "same engine, default settings" — which is also what a desktop user who never opened the settings popover sees.

### Rendering: react-native-svg, not Skia

**Decision: `react-native-svg` (already installed), rejecting `@shopify/react-native-skia`.** Rationale: (1) Skia is a new native module — a fingerprint drift that would park this PR behind the next store-build batch and cost main its OTA reach, for no need the feature has; (2) the map is read-mostly with node counts in the dozens (a plan's checkpoint history), far below where SVG rendering strains; (3) RNSVG elements accept Reanimated `animatedProps`, so pan/zoom can run entirely on the UI thread as one transform on the world `<G>` — the same "single transform on one `<g>`" architecture the web map documents (`DagExplorer.tsx:1245`); (4) vectors re-render crisply under a `<G>`-level scale, unlike scaling a rasterized view. If a future plan brings hundreds-of-node histories or drawing settings that demand it, Skia can be revisited then with the batching cost priced in.

### The map route

- `PlanMapRouteScreen` **(new)** registered in `RootStack` with linking `plans/:planId/map` (nested under M-147's plan prefix), `SOLID_HEADER_OPTIONS` (the map scrolls nothing for glass to sample — the file-viewer/terminal precedent), title "Map". Full-screen `card` presentation: the decided divergence says the map is its own route, not a pane.
- **Entry point**: a header action on the history view M-148 built (the exact header slot per M-148's layout) navigating to `PlanMap` — the mobile analog of the desktop Graph toggle. If M-148's history view has no header actions, the control lands beside its view affordances; either way it is one `navigation.navigate` call and an icon.
- The screen subscribes exactly as the stack's planning space does (`usePlanDetail`-equivalent from M-146's `state/mercurian.ts`), derives `graph`/`explorerGraph`/leaf sets/`readyCommits`/`codingSessions` with the shared logic, and reads/writes the stack's position store. The map carries no subscription of its own — the same "second rendering, not a second stream" contract as desktop (`PlanGraph.logic.ts` header comment).

### Camera and gestures

State: three Reanimated shared values `tx`, `ty`, `zoom` (one `MapTransform`), driving `animatedProps` on an `Animated.createAnimatedComponent(G)` wrapping the whole world (edges + nodes). The `Svg` fills the screen with no viewBox, so world→screen is purely the transform (units-per-pixel = 1 — simpler than web's letterboxed viewBox, and `fitTransform`/`centerOn` accept the frame as their `MapViewBox`).

- **Pan**: `Gesture.Pan()` (one or two fingers) updating `tx`/`ty` in the worklet — direct manipulation, no easing while the finger is down (easing a live drag would make it lag; "eased, never snapping" governs camera _flights_ and layout changes, which all tween).
- **Pinch**: `Gesture.Pinch()` updating zoom around the gesture's focal point in the worklet — the `zoomAtPoint` formula (clamp to `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM`, reproject so the focal world point stays under the fingers). Composed `Gesture.Simultaneous(pan, pinch)` so pinch-and-drag reads as one motion.
- **Worklet math**: the per-frame formulas live in `planMap.gestures.ts` **(new, mobile)** as `'worklet'`-directive pure functions (`panBy`, `pinchAround`) — worklet-marked functions are still plain JS to the test runner, so a colocated test pins them **against the hoisted `zoomAtPoint`/clamp** for agreement; the shared module itself stays free of Reanimated directives.
- **Tap**: `Gesture.Tap()` (fails if the pan/pinch activates) → `runOnJS` with the tap point and current transform → hit-test (below).
- **Camera flights** (fit-to-view, jump-to-current, minimap tap): computed with the shared `cameraTween`(via `interpolateZoom`) on the JS side and driven by a ported `useTween` rAF driver (the web one, `DagExplorer.tsx:1987`, works as-is under RN's `requestAnimationFrame`) writing the shared values each frame — 250ms, ease-out cubic, exactly the desktop feel. Flights are rare and short; gestures never touch the JS thread. Reduce Motion (`AccessibilityInfo.isReduceMotionEnabled`, mirrored into the driver the way web mirrors `prefers-reduced-motion`) collapses tween duration to 0.
- **Initial framing**: `fitTransform(layout.bounds, frame)` on first layout — the AC opens on "the whole DAG … every branch point visible at once" (a deliberate divergence from web's center-on-current landing; where you stand is still ringed, and jump-to-current is one tap).
- **Layout changes** (a commit landing): `interpolateSpatialLayout` tween on the JS side re-rendering the (static) node/edge tree — infrequent, small, and identical to web; pan/zoom shared values are deliberately untouched by it, preserving "never at the cost of your pan and zoom".
- **Zoom-fade**: `useAnimatedReaction` on `zoom` → `runOnJS(setDetail)` only when `detailFor(zoom)` changes value — one cheap state flip at the 0.65 threshold, not a per-frame render.

### Touch picking — enlarged targets, and a tap that never navigates

One centralized hit-test replaces per-element press handling (SVG hit areas are the drawn geometry — far under 44pt — and per-node responders would fight the pan/pinch): `hitTestNode(layout, transform, point, nodeRadiusFor)` in `planMap.logic.ts` **(new, mobile)** converts the tap to world space and returns the nearest node whose **screen-space** distance is within `max(drawnRadius × zoom, 22pt)` — a ≥44pt effective diameter at every zoom level, the decided replacement for the desktop hover-swell. Nearest-wins resolves overlaps; a miss returns `null` and the tap does nothing.

The invariant the AC states — **a mistouch never navigates** — is structural: the tap handler's only effect is opening the sheet for a hit node. No code path from the map surface calls the position store; only the sheet's "Go here" act does.

### Node drawing — desktop grammar, touch-sized

Rendered per node inside the world `<G>`, with colors resolved once via `useThemeColor`:

- Disc: published solid (`--color-foreground-muted` fill), private hollow (`--color-screen` fill + `--color-foreground-muted` stroke) — the same solid/hollow published contract as every desktop view; checkpoint inner ring as on web (`DagExplorer.tsx:1731–1742`).
- Radius: shared `radiusFor` with default settings — junctions draw bigger, exactly as on desktop.
- Glyphs: `planMapGlyphs.ts` **(new, mobile)** — the five lucide path constants (messages-square, message-square, file-text, circle-dot, square-terminal) as stroke `<Path>`s on the 24-unit grid, scaled to the disc, human messages x-mirrored (the `graphMessageGlyphTransform` rule), hidden when `detailFor(zoom) === "dot"`. Glyph color: `--color-screen` on solid discs, `--color-foreground-muted` on hollow — the web's background-on-solid contrast mapped to mobile tokens.
- Corner status dots: shared `planNodeStatusDots` keys mapped to fixed hex values (ready `#10b981`, stale-spec `#f59e0b`, stale-plan `#f97316` — Tailwind's emerald/amber/orange 500, the exact classes web uses, which read on both themes); anchored top-right at `radius/√2`, stacking rightward as on web.
- Current commit: `--color-primary` ring at `radius + 4`; current path (`ancestorClosure` of the resolved position) edges in `--color-foreground` at the emphasized width, all other edges `--color-border` — shared `edgeWidthFor`.
- Edges: `<Polyline>` per `SpatialEdge`, straight, no arrowheads — the layout's own points, untouched.
- Lineage emphasis: desktop's hover-emphasis has no touch analog; instead, **while the sheet is open**, the picked node's ancestor+descendant closure stays at full opacity and the rest dims to the web's 0.18 — the sheet's half-height detent leaves the map visible behind it, so selection-emphasis is the honest touch reading of "pointing is emphasis". Dismissing the sheet restores everything.
- Accessibility: the per-node `<G>` carries `accessibilityLabel={planNodeAccessibleLabel(node) + status suffixes}` and button role, matching the web `aria-label` contract ("every node remains named for assistive technology, statuses included"); the sheet is the full assistive reading.

### Recovering yourself: fit control, jump-to-current, minimap

An overlay column at the bottom-right (44pt targets, plans-feature pill buttons over the map):

- **Fit to view** — always visible (touch has no hover to reveal it, and the AC names it as the recovery guarantee): tweens to `fitTransform`.
- **Jump to current** — tweens `centerOn` the ringed node; disabled when the position has no node (pre-snapshot gap).
- **Minimap** — appears only when `mapOverflows(...)` is true (the vault: "when everything fits in view, it gets out of the way"), gated by a `useAnimatedReaction` boolean flip. A second small static `Svg` (shared `minimapSize`/`minimapProjection`; monochrome dots r=2, current node in `--color-primary`) with the **viewport rectangle as an `Animated.View`** positioned by `useAnimatedStyle` from the same shared values — the rect tracks every gesture frame without a single JS-thread render (the repo's performance mandate). Tap recenters with a tween; drag (`Gesture.Pan` on the minimap) recenters live via `minimapPointToWorld` + `centerOn`.

### The node detail sheet

`PlanCheckpointSheet` **(new, mobile — or the extension of M-148's sheet if one landed; one sheet serves every history view)**, registered as a formSheet route (`plans/:planId/checkpoint/:commitId`, detents `[0.55, 0.92]`, grabber — the Git-sheet precedent, and 0.55 keeps the map readable behind it for the lineage emphasis above). It re-derives its reading from the same plan subscription (atoms are keyed by plan, so the sheet and map read one stream) and renders `derivePlanNodePopover`'s sections in the vault's order, in the plans feature's sheet components:

1. **Identity** — kind glyph + label (`reading.label`), author grammar (You / Assistant lines for turns), relative time via `lib/time.ts`, Published/Private chip.
2. **What changed** — query text, response excerpt, effect chips (`Plan updated` / `Spec updated` / `Interrupted` / `Unanswered`, with the in-flight unanswered suppression via `isUnansweredCheckpointInFlight`), standalone acts' one-line summaries, split projections, session facts (status/branch/PR from the `PlanCodingSessionRecord`), model-switch line when `modelSwitch` is present.
3. **Position honesty** — stale spec, stale plan (`PLAN_MAY_BE_STALE_LABEL`/description strings travel with the M-148 hoist or move here), moved-past-split wording.
4. **Readiness** — the ready badge with its repository reason.
5. **Acts**:
   - **Go here** (the AC's and vault's name for the act; desktop's button says "Continue from here" — the sheet follows the issue's wording): `positionAfterPick(explorerGraph, commitId)` into the position store, dismiss the sheet, and pop back to the planning space route — on desktop the surface moves beside a persistent map pane; full-screen, "the planning surface follows" means showing it standing there. The map, revisited, shows the ring moved.
   - **Implement from here** — rendered whenever shared `offeredActs` includes `implement` (the AC's parity clause), wired through `useImplementFromHere(planId)` **(new, mobile stub)**: it resolves the acting commit via `resolveImplementFrom` and returns `{ status: "unavailable", reason }` in this pass, which the sheet renders as the act row disabled with its reason ("Implementing from a checkpoint arrives with the implement flow"). M-150 replaces the hook's body with the real gate (stale-plan warning, `tryImplement` — the shared atom command already accepts an arbitrary `parentCommitId`); the sheet does not change again.
   - **Deliberately not in this pass**: _Edit and branch_ (it seeds the composer draft — that belongs with the mobile composer's owner, desktop's M-134 analog) and _Open session_ (mobile has no Coding Session View route to open; offering a doorway to nowhere is worse than omitting it). Both are single additive rows when their destinations exist; `offeredActs` output is filtered, not forked.

### What deliberately does not change

The wire and server (nothing new crosses; no `server.test.ts` mock drift risk), the checkpoint grouping and `nodeIdByCommit`, position/continuation semantics, the desktop map's behavior (imports re-pointed, pixels identical), arrangement/drawing settings and their persistence (out of this pass — mobile draws the default), hover-preview (never designed in), and the desktop-only interactions (hover swell, linger popover, wheel intents) which simply do not port.

## File & module layout

**Moved / changed, shared:**

- `packages/client-runtime/src/state/planMap.ts` **(new)** — camera core + layout interpolation, moved from web; `./state/plan-map` export added to `packages/client-runtime/package.json`; `d3-dag`, `d3-interpolate` deps added (moved from `apps/web/package.json`); colocated `planMap.test.ts` (moved cases).
- `apps/web/src/components/mercurian/DagExplorer.logic.ts` / `DagExplorer.tsx` — re-import the moved members; delete the moved local definitions; zero behavior change.
- (Conditional, if M-148 left it behind: `dagLayout` + `SpatialLayout` move beside the hoisted `planGraph` module.)

**New, mobile (`apps/mobile/src/features/plans/` — the stack's plans feature directory):**

- `PlanMapRouteScreen.tsx` — route screen: params, subscription, derivations, hosts the map + overlay controls.
- `PlanMap.tsx` — the SVG map: animated world `<G>`, node/edge rendering, gesture composition, minimap, tween driver.
- `planMap.logic.ts` + `planMap.logic.test.ts` — hit-testing, overlay gating, initial-framing helpers.
- `planMap.gestures.ts` + `planMap.gestures.test.ts` — worklet-marked pan/pinch math, tested for agreement with the shared camera.
- `planMapGlyphs.ts` — lucide path constants + kind→glyph mapping (mirroring rule included).
- `PlanCheckpointSheet.tsx` (+ its logic test if any local derivation grows) — or the M-148 sheet extended in place.
- `useImplementFromHere.ts` — the M-150 seam.
- `apps/mobile/src/Stack.tsx` — two route registrations (`PlanMap`, `PlanCheckpointSheet`) following the existing option presets.
- M-148's history view — one entry control navigating to `PlanMap`.

## Implementation Checklist

Land as stacked commits on `venk/m-149-checkpoint-graph-map-on-touch`; the plan itself as `docs(project): technical plan for M-149 checkpoint graph map on touch`.

- [ ] `refactor(client-runtime): hoist the checkpoint map camera and layout interpolation (M-149)` — create `state/planMap.ts` from `DagExplorer.logic.ts` + `DagExplorer.tsx` pure members; move `d3-dag`/`d3-interpolate` deps; add the subpath export; move the affected tests; re-point web imports; verify M-148's hoist covers `dagLayout`, `condensePlanGraph`, `derivePlanNodePopover`, `positionAfterPick`, freshness sets — hoist any straggler the same way. `vp test run` the moved suites plus web's `DagExplorer` tests.
- [ ] `feat(mobile): checkpoint graph map route (M-149)` — `PlanMapRouteScreen` + `PlanMap` + `planMap.logic.ts` + `planMap.gestures.ts` + `planMapGlyphs.ts`; Stack registration; entry control on the history view. Pinch-around-focal-point, pan, tap hit-testing, fit-on-open, zoom-fade, node grammar (discs, glyphs, corner dots, ring, current path), tween driver with Reduce Motion, fit/jump controls, overflow-gated minimap with UI-thread viewport rect.
- [ ] `feat(mobile): checkpoint detail sheet with Go here and the implement seam (M-149)` — `PlanCheckpointSheet` (or M-148 sheet extension) rendering the shared reading; Go here → `positionAfterPick` + pop to planning space; `useImplementFromHere` stub rendered as the disabled act with its reason; lineage emphasis while the sheet is open; sheet route registration.
- [ ] Don't add: `@shopify/react-native-skia` or any native module; contract/server/ws changes; arrangement or drawing settings; per-node press handlers; Edit-and-branch or Open-session rows; any map-surface path into the position store.
- [ ] Rebase onto the stack's tips before PR; UI change → screenshots (and a short video for the camera motion) per PR conventions.

## Test Plan

Colocated logic tests (`vp test run` targeted), then an AC walk in the running app.

- [ ] `planMap.test.ts` (client-runtime, moved + new): camera-core cases travel unchanged; add a layout-parity pin — one forked-and-merged timeline fixture through `condensePlanGraph` + `dagLayout(sugiyama)` yields identical `SpatialLayout` positions to the web path (same functions, one import site — the "same shape" AC as a test).
- [ ] `planMap.gestures.test.ts`: `pinchAround` agrees with shared `zoomAtPoint` across zoom bounds (clamping included); `panBy` is transform-translation; focal world point is invariant under pinch.
- [ ] `planMap.logic.test.ts`: hit-test returns the nearest node within `max(radius×zoom, 22)` screen pt — a node smaller than 44pt is still hit at 22pt offset; empty space returns null at every zoom; overlapping nodes resolve nearest-first; fit-on-open framing contains `layout.bounds` inside the frame with `MAP_FIT_PADDING`; minimap overflow gating flips exactly when `mapOverflows` does.
- [ ] Sheet derivation is already pinned by the shared `PlanNodePopover.logic` tests (they travel with the hoist); add mobile cases only for the act filtering (implement rendered-but-unavailable via the stub; no edit-and-branch/open-session rows) and Go-here's `positionAfterPick` wiring.
- [ ] Web regression: existing `DagExplorer.logic.test.ts` remainder, `DagExplorer.test.tsx`, and `PlanGraph.logic.test.ts` pass with re-pointed imports.
- [ ] Walk every AC on a simulator via `test-t3-mobile` (seeded plan with a fork and a merge): opens full-screen showing the whole DAG; pinch zooms at the touch point and drag pans with eased flights; node tap opens the sheet with identity/changes/indicators/acts; Go here moves the planning space; a map tap on empty space and a dismissed sheet navigate nothing; glyphs + corner dots + ring + solid/hollow read as on desktop; fit-to-view and minimap recover a lost camera; the same seeded history side-by-side with desktop draws the same shape. Two-platform check: formSheet detents and gestures on iOS and Android per the Git-sheet precedent.
