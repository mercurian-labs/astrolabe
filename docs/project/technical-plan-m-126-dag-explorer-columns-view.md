# Technical Plan — M-126: DAG explorer: add a branch-segment column view (Miller columns)

_Generated from the Goal/AC of Linear issue M-126 (see the issue for the full AC). Assumes M-125 has landed (`docs/project/technical-plan-m-125-dag-explorer-thread-view.md`): the explorer's views are Thread and Graph, and `PlanThread.logic.ts` exists with `branchOption` / `mostRecentTip`. Builds on the m-106 explorer under the same ADRs. Design sources: the almagest vault notes DAG Explorer, Commit Tree, Merges — note this view is tree-style, so the dormant Merges contract ("one occurrence is the real node and the others are visibly marked references that jump to it") comes back into force here._

**Goal, in one sentence:** a third explorer view that lays the history out as left-to-right panes — one pane per linear run of commits, a new pane at each fork — so every decision point on the displayed path is standing structure, with the unchosen branches visible beside the chosen one; and the explorer's view switcher becomes three icon buttons with tooltips.

**Scope, stated plainly:** the Thread and Graph views are unchanged; history semantics are unchanged; selection semantics are identical to the thread view (navigate-on-pick through the same `onSelect` contract) — deliberately, so preference between the two walking views measures presentation, not behavior.

## Conventions Detected

Carried over from M-125's report, all still high confidence and re-verified against the same files: pure logic in colocated `*.logic.ts` + `*.logic.test.ts` modules (`apps/web/src/components/mercurian/`); `vite-plus/test` with hand-built ASCII-diagram fixtures, run scoped via `vp test run <files>`; view preference via `useLocalStorage` + `Schema.Literals` under `mercurian:dag-explorer-view:v1` with decode-failure fallback; per-window transient rendering state in component `useState`/refs (spatial `prior`, thread `parentChoices`); `lucide-react` glyphs shared across views via `commitGlyph`; no new dependencies, no continuously repainting animations.

Specific to this issue:

- **Icon toggles with tooltips are an established composite** — `PlanPaneToggle` in `apps/web/src/components/mercurian/PlanningSpace.tsx`: `ToggleGroup` of `Toggle`s, each wrapped `Tooltip → TooltipTrigger render={<Toggle aria-label=… />} → TooltipPopup`. The explorer's switcher adopts this exact shape. Confidence: high.
- **`lucide-react` ^0.564.0 carries the needed glyphs** — verified in the installed package: `git-commit-vertical`, `columns-3`, `waypoints` (per the icon decision recorded on the Linear issue). Confidence: high.
- **Horizontal pane mechanics precedent** — the right pane itself resizes via `useResizableWidth` and the app avoids animated layout; the columns view uses plain `overflow-x-auto` scrolling and `scrollIntoView`, the same idiom `useCurrentRowScroll` already uses vertically. Confidence: medium (no existing multi-column widget to copy; composed from existing idioms).

## Design

### Segments, not generations: the layout logic

New module **`apps/web/src/components/mercurian/PlanColumns.logic.ts` (new)** + **`PlanColumns.logic.test.ts` (new)**, pure over the same `PlanGraph`.

The unit that nests is the branch: a **pane** is a maximal linear run of commits, ended by a fork, a leaf, or a merge boundary. The displayed path is defined by a choice of child at every fork it crosses:

- `defaultBranchChoices(graph, head) → ReadonlyMap<string, MercurianCommitId>` — at forks on `head`'s ancestry, the child that leads to `head`; at forks below `head`, the first child (agreeing with `advance` and the thread view's downward walk).
- `columnLayout(graph, head, branchChoices) → { panes }` — walk from the root: accumulate commits into the current pane until the walk hits a node that ends it. Each `Pane` carries its `rows` and a `terminal`:
  - `fork` — the node's `childrenIds` as branch options (reusing `branchOption` from `PlanThread.logic.ts`: summary, last activity, published, tip), with the chosen child marked; the chosen child's run is the next pane.
  - `leaf` — the path ends; last pane.
  - `merge-entry` / `merge-reference` — the Merges contract, below.
  - Overrides in `branchChoices` (per-window state) replace the defaults; entries for forks no longer on the displayed path are ignored, same temperament as the thread's `parentChoices`.
- A fully linear history yields exactly one pane with a `leaf` terminal — pinned by test, since it is an AC line.

**Merges.** A merge sits on the displayed path through exactly one of its parents — the one the path walked. That pane contains the merge as its **real row**. Every _other_ parent whose own run is currently visible (it can be: an unchosen fork branch expanded later, or a parent line inside the same pane sequence) terminates in a `merge-reference` row: visibly marked (merge glyph + "merges ↗"), not a commit, and activating it jumps to the real row — implemented as scroll-plus-focus to the real row's pane, adjusting no position and no choices. This is the vault's tree-style contract revived verbatim: one real node, references that jump.

### The view: panes, compression, keyboard

**`ColumnsView` (new, in `DagExplorer.tsx`)**, third sibling of `ThreadView` and `GraphView`, sharing `CommitRow`, `commitGlyph`, `ROW_HEIGHT`, and the `onSelect` contract.

- **Layout:** a horizontal `flex` in an `overflow-x-auto` container; each pane a fixed-width (`w-56`), independently `overflow-y-auto` column of `CommitRow`s, `border-l` between panes. A pane whose terminal is a fork renders the branch options as a distinct block under its last commit — each option a button row styled like the thread flyout's options (summary, relative time, published treatment), the chosen one marked. Choosing a different option updates `branchChoices` (per-window `useState`, like the thread's `parentChoices`) and thereby replaces every pane to the right; choosing does **not** navigate — picking a _commit row_ navigates, identically to every other view.
- **Compression:** panes left of the **active pane** (the one containing the current commit, else the rightmost) collapse to slim strips (`w-8`): a vertical stack of published/private dots, no text, `aria-label` naming the pane's span. Clicking a strip expands that pane (state: `expandedPaneIndex`, defaulting to the active pane) and collapses the ones right of it no further — expansion never loses the path, only reallocates width, which is the AC's "restored without losing your place". At the sidebar's default width (`RIGHT_PANE_DEFAULT_WIDTH` 480px) one expanded pane plus several strips fit without horizontal scroll; more panes than fit simply scroll.
- **Opening:** derive panes from `defaultBranchChoices(graph, head)`, expand the active pane, and `scrollIntoView` the current commit — same one-shot scroll idiom as `useCurrentRowScroll`.
- **Keyboard:** roving focus across the view — ArrowUp/ArrowDown move focus within a pane, ArrowLeft/ArrowRight move focus across panes (expanding a strip on entry), Enter/Space activate the focused row (`CommitRow` is already a `button`, so activation _is_ navigation; branch-option rows activate their choice). Focus movement alone never calls `onSelect`. Implemented with a `tabIndex` rover on the container, no dependency.

### The switcher: three icons, tooltips, one storage key

The explorer header's text toggle becomes the `PlanPaneToggle` composite: three `Toggle`s in the `ToggleGroup`, each `Tooltip`-wrapped with `aria-label` and a `TooltipPopup` label — **`GitCommitVerticalIcon` "Thread"**, **`Columns3Icon` "Columns"**, **`WaypointsIcon` "Graph"** (the icon decision recorded on the Linear issue; all verified in the pinned `lucide-react`). The pressed state is the active-view indication `Toggle` already renders. `ExplorerView` literals become `["thread", "columns", "graph"]` — same `mercurian:dag-explorer-view:v1` key, same decode-fallback behavior, default still `"thread"`. Persistence across close/reopen and across plans is what the existing key already provides; no new machinery.

### Gaps and findings

- **Merge references ship against fixtures** (M-111 still unbuilt), like every merge rendering before them; the contract is pinned in logic tests.
- **`published` still uniformly `false`** on this surface; strips and option rows inherit the dark distinction.
- **Coding-session leaves don't reach this surface yet** (wire skip, m-106): when they do, they arrive as ordinary rows in whatever pane their run occupies; nothing here special-cases them.
- **The active-pane compression is the one genuinely new interaction pattern** in the explorer; it is deliberately CSS-and-state only (width classes, no animation, no measurement loop), conforming to the no-repaint temperament. If real histories make strip-count unwieldy, semantic collapse (grouping strips) is a later issue, not this one.

## Implementation Checklist

- [ ] `apps/web/src/components/mercurian/PlanColumns.logic.ts` (new): `defaultBranchChoices`, `columnLayout`, `Pane` / terminal types; reuse `branchOption` and `mostRecentTip` from `PlanThread.logic.ts` — do not duplicate them.
- [ ] `apps/web/src/components/mercurian/PlanColumns.logic.test.ts` (new): cases below.
- [ ] `apps/web/src/components/mercurian/DagExplorer.tsx`: add `ColumnsView` (panes, branch-option blocks, strip compression, roving keyboard focus, merge-reference jump); switcher → three icon toggles with tooltips per `PlanPaneToggle`'s composite; `ExplorerView` → `["thread", "columns", "graph"]`, key and default unchanged.
- [ ] Icons imported from `lucide-react` only (`GitCommitVerticalIcon`, `Columns3Icon`, `WaypointsIcon`); no icon-pack dependency added.
- [ ] No changes to `PlanThread.logic.ts` beyond exporting what M-125 already exports; no changes under `packages/contracts`, `apps/server`, `PlanningSpace.tsx`, or `PlanPosition.logic.ts`.

## Test Plan

`PlanColumns.logic.test.ts` on `vite-plus/test`, colocated, shared fixture style; run `vp test run apps/web/src/components/mercurian/PlanColumns.logic.test.ts`.

- [ ] **Linear chain → one pane**, `leaf` terminal, every commit in order.
- [ ] **Single fork:** pane 1 ends at the fork with both branches as options, chosen child per `defaultBranchChoices` (through `head` when on-path, first child below `head`); pane 2 is the chosen branch's run; overriding `branchChoices` swaps pane 2's contents and drops stale downstream choices.
- [ ] **Nested forks:** pane count equals forks crossed + 1; panes read left-to-right as one root-to-tip path.
- [ ] **Merge:** the real merge row appears in exactly one pane (the walked parent's); the other parent's visible run terminates in a `merge-reference` naming the merge; no commit appears twice as a real row.
- [ ] **Interior head:** the displayed path runs through `head` and continues to a leaf; the active pane is the one containing `head`.
- [ ] **Degradation:** dangling parent edges truncate a run rather than throw; empty graph → no panes.
- [ ] Thread and Graph suites untouched and green.

UI verification (on request, per AGENTS.md): seeded forked+merged history — three icon toggles with tooltips and a visible pressed state; view choice survives close/reopen and plan switches; sibling choice fills the pane to the right without moving the planning surface; picking a commit navigates; arrow keys move focus without navigating; strips expand without losing the path; merge reference jumps to the real row.

## Amendment (2026-08-11): pane polish and width behavior

Follow-up scope after the first implementation landed. The M-125 thread view's content stays unchanged — the width cap below touches the sidebar chrome around it, not its rows.

1. **Fork separator bar** — the fork block's bare top border becomes a slim labeled bar: "forks" beside a `lucide-react` down-arrow glyph, in the app's muted label treatment. It reads as "the run continues into one of these".
2. **Row highlight inset** — `ColumnsView`'s commit list gets the same horizontal inset as the fork-option block, so row hover/focus background keeps a margin from the pane border. `CommitRow` itself is unchanged; the thread view is unaffected.
3. **Right-anchored panes, flexible last pane** — the columns container packs content to the sidebar's right edge (auto left margin on the first pane: packs right while content fits, degrades to ordinary left-origin horizontal scrolling when it overflows). The rightmost pane flexes between the current fixed width (min) and a new maximum (~1.5×), so spare width goes to the pane being read. Strips stay fixed-width.
4. **Per-view sidebar cap** — the stored width key stays singular; each view renders `min(storedWidth, viewCap)`. The thread view gets a fixed cap; the columns view's cap derives from the pane model (strips × strip width + expanded panes + the flexible last pane at its max) so the sidebar never exceeds what the columns can fill; the graph view and plan artifact keep the existing maximum. `PlanningSpace` learns the explorer's active view reactively through the existing same-window `useLocalStorage` subscription on `mercurian:dag-explorer-view:v1` — no state lifting, same decode-failure fallback. Clamping happens at render, so a wider dragged width survives view switches.
5. **Main-pane minimum, overlay fallback** — a constant names the conversation's minimum readable width. At `sm+`, when the planning space is too narrow to fit that beside the right pane's effective width, the right pane renders as a right-anchored overlay above the conversation (existing border/background treatment, resize handle still live) instead of squeezing it. Measurement is event-driven only (one observer on the space's root; no loops). Below `sm`, the stacked layout is unchanged.

**Amended AC:** fork options separated from the run by the labeled "forks" bar; commit-row hover/focus highlight inset like the option rows; panes hug the right edge with the rightmost pane flexing min→max and no dead space beside it; sidebar width capped in thread and columns views only (one stored width, clamped at render); the conversation keeps a fixed minimum width, with the right pane overlaying it when the viewport cannot fit both.

**Checklist deltas:** `DagExplorer.tsx` (items 1–4), `PlanningSpace.tsx` and possibly `useResizableWidth.ts` (items 4–5) — the original "no changes to `PlanningSpace.tsx`" fence is lifted by this amendment, for these items only. Logic tests change only if a pure helper is added for the columns width cap; if so, pin it in `PlanColumns.logic.test.ts`.
