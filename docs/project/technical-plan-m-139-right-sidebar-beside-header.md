# Technical Plan — M-139: Right sidebar stands beside the plan header, not under it

_Generated from the Goal/AC of Linear issue M-139 (see the issue for the full AC). Amends the layout that `docs/project/technical-plan-m-106-right-sidebar-dag-explorer.md` shipped. Design source: the almagest vault's "Right Sidebar" note — which pins the pane's behavior (two views behind corner icons, persistence, resize) but says nothing about header nesting; the one phrase this plan must keep true is "icons in the top-right corner of the planning space."_

**Goal, in one sentence:** make the right sidebar a full-height column standing beside the plan header — one aligned top bar per column, ending the double-header read — the way ChatView already lays out the thread view and the Coding Session View.

**Scope, stated plainly:** placement only. What the pane shows, the persistence of its state, its resize behavior, and its mobile stacking order are all unchanged. Nothing crosses the wire; every change lives in `apps/web/src/components/mercurian/`.

## Conventions Detected

- **The two-column precedent** — ChatView puts the header _inside_ the chat column (`apps/web/src/components/ChatView.tsx:5974-5982`) and the right panel as a full-height sibling in the outer row (`ChatView.tsx:5972`, panel at `:6360`). Both columns' top bars share one height token: the chat header and the panel's tab strip each carry the `workspace-topbar` class (`ChatView.tsx:5988,5993`; `components/RightPanelTabs.tsx:388`), backed by `--workspace-topbar-height` (52px, titlebar-aware under `.wco` — `apps/web/src/index.css:98,122,325`). Confidence: high.
- **Controls move between containers with the panel** — ChatView renders its panel controls in the header when the panel is closed and in the panel region when open (`ChatView.tsx:5973,5997`), keeping one visual corner in both states. Confidence: high.
- **Breakpoint-driven layout via `useMediaQuery`** — `PlanningSpace.tsx:275` already derives `usesSideBySideLayout` from `useMediaQuery("sm")` and gates overlay behavior on it; ChatView gates sheet-vs-inline the same way (`ChatView.tsx:1344`). Confidence: high.
- **Styling** — Tailwind semantic tokens composed with `cn()`; slot props for header controls already exist on the pane views (`titleControl`, `readOnlyAction` on `PlanArtifact.tsx:69` / `SpecArtifact.tsx:133`). Confidence: high.
- **Logic/component split** — pure logic in `<Component>.logic.ts` with colocated tests. This change is JSX/CSS arrangement with no new decision logic, so no new logic module is warranted; existing tests assert on aria-labels and text (`DagExplorer.test.tsx:216-221`), not on the classes this plan touches. Confidence: high.
- **Verification** — targeted `vp test run <files>`, never repo-wide; `pnpm tc` for types (AGENTS.md §Verifying; root `package.json:25-29`). Every AC is then demonstrated in the running app, not inferred from a green suite. Confidence: high.
- **Commits & branch** — conventional, scoped, issue-tagged: `fix(web): … (M-139)`; branch `venk/m-139-right-sidebar-stands-beside-the-plan-header-not-under-it` (Linear's `gitBranchName`). PR wants before/after screenshots (AGENTS.md §Pull requests). Confidence: high.
- **Plan documents** — `docs/project/technical-plan-m-<n>-<slug>.md`. Confidence: high.

## Design

### What is wrong, structurally

`PlanningSurface` (`PlanningSpace.tsx:1199-1225`) renders a full-width `<header>` above its children; the content row (`:588-591`, `relative flex … flex-col-reverse sm:flex-row`) lives below it, and the pane (`:665-754`) is a column of that row — so the pane starts under the header. Each pane view then brings its own title bar (`PlanArtifact.tsx:71`, `SpecArtifact.tsx:135`, `DagExplorer.tsx:235`) with `py-2` padding that doesn't match the header's `sm:py-3`: two stacked, misaligned bars.

### The move: header into the conversation column, pane beside it

`PlanningSurface` slims to a shell — `SidebarInset` plus the outer flex column — and stops rendering the header. The bar becomes its own small component in the same file:

- **`PlanningHeader({ title, actions })`** _(new, in `PlanningSpace.tsx`)_ — the existing `<h1>` + actions row, restyled from `py-2 sm:py-3` vertical padding to the `workspace-topbar` height class (plus `border-b border-border px-3 sm:px-5` and `COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS` as today). One height token shared with the session screen's header and the pane bars below is what makes "aligned" hold by construction rather than by padding luck.

Callers place it. `PlanningSpace` already holds `usesSideBySideLayout`, and placement follows it:

- **Side-by-side (`sm+`):** the header renders as the first child of the conversation column (`:594`), and the row becomes the surface's direct child — so the pane column, a row sibling, runs the full height of the space, `sm:border-l` as its left edge. The header's `border-b` and each pane bar's `border-b` now meet at the same y, reading as one continuous line broken by the pane border.
- **Stacked (below `sm`):** the header renders above the row, exactly as today — full width on top, pane above conversation beneath it (`flex-col-reverse`, the deliberate M-106 ordering). Placement is a JS conditional on `usesSideBySideLayout`, the pattern the component already uses for overlay behavior; no dual render, no duplicate `<h1>` in the DOM.

The other `PlanningSurface` call sites (`:548` loading/missing, `:1126`/`:1140` draft) have no pane; they render `PlanningHeader` unconditionally at the top and look as they do today, at the new shared height.

### The corner icons follow the ChatView rule

The vault pins the toggles to "the top-right corner of the planning space." With the pane full-height, that corner belongs to the pane's title bar when open. Following `ChatView.tsx:5973,5997`:

- **Pane closed, or stacked layout:** `PlanPaneToggle` stays in `PlanningHeader`'s actions slot (`:575`), top-right as today.
- **Pane open, side-by-side:** the header's actions slot renders nothing, and the toggle renders at the right end of the pane's title bar instead. Each pane view gains a **`cornerControl?: ReactNode`** slot prop (the `titleControl`/`readOnlyAction` precedent), rendered last in its title bar: after Edit/Save on `PlanArtifact`, after the reconcile/edit controls on `SpecArtifact`, after the view `ToggleGroup` on `DagExplorer`. `PlanningSpace` passes `<PlanPaneToggle …>` as `cornerControl` only when `usesSideBySideLayout`, so the stacked layout never shows the icons twice.

Pressing the pressed icon still closes the pane (`PlanPaneToggle`'s existing semantics, `:949-989`) — the toggle keeps one identity and merely changes address, so open/close/switch behavior is untouched.

### Pane title bars adopt the shared height

The three title bars (`PlanArtifact.tsx:71`, `SpecArtifact.tsx:135`, `DagExplorer.tsx:235`) swap `py-2` for the `workspace-topbar` class, keeping `border-b border-border px-3 sm:px-4` and their contents. `workspace-topbar` already is `display:flex; align-items:center; flex-shrink:0` (`index.css:325-331`), so the wrapper's `flex items-center` duplicates away.

The pane's two loading placeholders (`PlanningSpace.tsx:695-704`, "Reading the plan/spec as of then…") currently render with **no** title bar. Under the new layout that would leave the open pane without its corner — and without the close affordance. Each placeholder gains a title bar (same `workspace-topbar` classes) carrying the `ArtifactPicker` and the `cornerControl`, matching what `PlanArtifact`/`SpecArtifact` show once loaded.

### What the row restructure touches, and what it must not

- **`planningSpaceRef` and the width model:** the ref stays on the row, which remains full-width in both layouts (side-by-side: the row is the surface's whole area; stacked: full width below the header). `rightPaneOverlays`, `useResizableWidth`, and the caps (`:250-291,358-361`) are untouched.
- **Overlay mode:** the pane's `absolute inset-y-0 right-0 z-20 shadow-lg` (`:668`) now resolves against a row that includes the header band, so the floating pane also runs full height — consistent with its docked shape. Its close affordance is its own corner toggle, which overlay mode now carries (pane open ⇒ toggle in pane bar), so nothing is lost by covering the header's right edge. The drag separator's overlay variant (`:649-664`) needs no change beyond living in the restructured row.
- **DOM order:** conversation column before pane, as today; `SplitSheet`, dialogs, and the `EditAndBranchAttachmentLoader` stay where they are as `PlanningSurface` children outside the row (sheets portal; the loader renders null).
- **Not adopted:** absolute `workspace-titlebar-controls`-style pinning for the toggle (`index.css:398`). It solves window-control insets ChatView has and the planning space doesn't, and would force every pane bar to reserve right padding; the in-flow `cornerControl` slot gets the same corner with none of that.

## Implementation Checklist

- [ ] Work on `venk/m-139-right-sidebar-stands-beside-the-plan-header-not-under-it` off latest `main`.
- [ ] `PlanningSpace.tsx`: extract `PlanningHeader({ title, actions })` from `PlanningSurface`; restyle the bar to `workspace-topbar` height; slim `PlanningSurface` to the `SidebarInset` + outer-column shell.
- [ ] `PlanningSpace.tsx` (main space): render `PlanningHeader` above the row when `!usesSideBySideLayout`, else as the conversation column's first child; keep the row, ref, separator, and pane structure otherwise intact.
- [ ] `PlanningSpace.tsx`: gate the header's `actions` to `pane.open && usesSideBySideLayout ? null : <PlanPaneToggle …>`; pass `<PlanPaneToggle …>` as `cornerControl` into `DagExplorer` / `PlanArtifact` / `SpecArtifact` only when `usesSideBySideLayout`.
- [ ] `PlanArtifact.tsx`, `SpecArtifact.tsx`, `DagExplorer.tsx`: add the `cornerControl?: ReactNode` prop rendered at the right end of the title bar; swap the bar's `py-2` for `workspace-topbar`.
- [ ] `PlanningSpace.tsx`: give the two pane loading placeholders a `workspace-topbar` title bar with `ArtifactPicker` + `cornerControl`.
- [ ] `PlanningSpace.tsx` (loading/missing and draft call sites): render `PlanningHeader` at the top unconditionally.
- [ ] No new dependencies; no wire or state-schema changes (`RightPaneState`, storage keys untouched).
- [ ] Commit as `fix(web): right sidebar stands beside the plan header, not under it (M-139)`.

## Test Plan

No new logic module ⇒ no new unit tests; the change is arrangement. Existing suites guard against regressions in what the bars contain:

- [ ] `vp test run apps/web/src/components/mercurian/DagExplorer.test.tsx` — header contents and aria-labels still render (markup assertions are class-independent).
- [ ] `vp test run apps/web/src/components/mercurian/PlanArtifact.logic.test.ts apps/web/src/components/mercurian/PlanCheckpoints.logic.test.ts` — untouched logic stays green.
- [ ] `pnpm tc` for the workspace.

Browser walk (every AC demonstrated live, per house practice):

- [ ] Open a plan at desktop width with the pane open: header spans only the conversation area; pane runs full height; the two top bars align at one height with a continuous border line.
- [ ] Toggle each pane view (artifact ↔ explorer) and artifact (plan ↔ spec): a single title bar in the pane each time; corner icons sit at the pane bar's right end — the space's top-right corner.
- [ ] Close the pane from its corner; icons return to the header's top-right; reopen from there; state and view survive (unchanged persistence).
- [ ] Drag-resize the pane edge; narrow the window until overlay mode engages: the floating pane runs full height and its corner toggle still closes it.
- [ ] Below `sm`: header on top, pane stacked above the conversation beneath it, icons in the header — one header bar visible at the top, no doubled bars.
- [ ] Stand on an earlier commit so the pane shows "Reading the plan as of then…": the pane keeps its title bar with picker and corner icons.
- [ ] Draft ("New plan") and loading surfaces: header renders as today at the shared height.
