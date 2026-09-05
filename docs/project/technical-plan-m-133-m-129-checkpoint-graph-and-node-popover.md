# Technical Plan — M-133 + M-129: the Checkpoint Graph rename, and the node popover

_Generated from the Goal/AC of Linear issues M-133 ("Checkpoint Graph: rename the History pane; checkpoints are the only reading") and M-129 ("Node popover on history views"). Design sources are the almagest vault notes: **Checkpoint Graph** (the whole design, including "How the graph view reads", "The node popover", and the 2026-08-19 resolution of the kind-color Open Decision: **"colored status dots, with no glyphs or text on the map"** — exactly the idea in the issue's comment thread), **Right Sidebar** (the corner icons and pane persistence), **Assistant** (the per-branch model record: `ranUnder` on turn-opening human commits, `generatedBy` on assistant replies, and "the switch is a derived reading over recorded facts, never a commit of its own"), **Specs** (stale-spec / stale-plan indicators), **Splits** ("the plan has moved past this split", the readiness badge, and implement-from-here), **Publishing**, and **Coding Sessions**. The reconstruction boundary is M-137; the conversation-side edit-and-branch is M-134; both out of scope here._

_Amended 2026-08-19, same day: M-110 ("Coding sessions: draft, leaf commit, worktree birth", d5baedf1e) landed on main after this plan was first written. Coding-session leaves are no longer a dataless seam — they cross the wire as a fourth `PlanTimelineItem` tag with a mutable `PlanCodingSessionRecord` beside them, and `resolveActingHead` makes leaves inspectable-but-not-continuable. The affected sections (palette, popover content, acts, checklist, tests) are updated in place; the superseded "seam" framing is gone._

**Goal, in one sentence:** the pane stops calling itself History and starts calling itself **Checkpoint Graph**; the Graph view strips every glyph, caption, and badge off its nodes and reads as colored status dots; and all three views gain one shared, deliberately-summoned **node popover** that carries a checkpoint's identity, model facts, effects, warnings, readiness, and acts — without changing the commit DAG, the checkpoint grouping (M-132), or continuation semantics.

## What discovery found

### M-133 is small and mostly already true

- The string **History** appears in exactly three product places: the pane header ([DagExplorer.tsx:217](../../apps/web/src/components/mercurian/DagExplorer.tsx)), the corner toggle's `aria-label` and tooltip ([PlanningSpace.tsx:710–713](../../apps/web/src/components/mercurian/PlanningSpace.tsx)), and the compressed-columns-pane accessible label `paneSpanLabel` ("History pane: …", [DagExplorer.tsx:981–988](../../apps/web/src/components/mercurian/DagExplorer.tsx)). The user docs also narrate a "history view" ([docs/user/projects-and-threads.md](../user/projects-and-threads.md)).
- **No Detail setting was ever built.** The Graph's display settings are layout/node-size/line-thickness only ([DagExplorer.logic.ts:12–23](../../apps/web/src/components/mercurian/DagExplorer.logic.ts)). Nothing anywhere toggles a commit-level reading — the AC is satisfied by absence, and the tests below pin it so it stays absent.
- **Checkpoints are already the only reading.** M-132 (merged, amendment included) condenses turns — trailing revisions absorbed, `nodeIdByCommit` remapping every member commit and every pick to its checkpoint ([PlanCheckpoints.logic.ts](../../apps/web/src/components/mercurian/PlanCheckpoints.logic.ts)). The explorer is the only surface that selects commits (`SplitSheet` selects split commits, which are standalone checkpoints), so "no affordance offers continuing from an intermediate commit" already holds; M-133's work is the rename plus regression pins.

### M-129 has all its data on the client already

- **Model facts are on the wire.** `ranUnder` (what a human turn-opening message ran under) and `generatedBy` (what produced an assistant reply) ride `PlanMessage` ([mercurian.ts:238–240](../../packages/contracts/src/mercurian.ts)); `PlanningModelSelection` is an abstract `{provider, model}` pair. The conversation already renders it via `ModelAttribution` + `providerLabel` ([PlanTimeline.tsx:257–273](../../apps/web/src/components/mercurian/PlanTimeline.tsx)) — the popover reuses that, with `providers` available in `PlanningSpace` as `planningModel.providers`.
- **The switch is derivable, and no switch entry exists to retire.** Nothing in the timeline renders a switch row. The nearest-ancestor-turn walk the vault prescribes is a pure function over the commit-level `PlanGraph` (which `DagExplorer` still holds alongside the condensed graph).
- **Warnings exist as commit-id sets.** `staleSpecLeafIds` / `stalePlanLeafIds` / `planMayBeStaleAt` ([SpecArtifact.logic.ts:23–58](../../apps/web/src/components/mercurian/SpecArtifact.logic.ts)) are already passed into `DagExplorer` and mapped onto checkpoint nodes. **"The plan has moved past this split" exists nowhere yet** — it is a new derivation (vault Splits: splits hang from their parent; when the parent line continues past that commit, the popover "puts it into words").
- **Readiness has its reason.** `readyCommits` is a `Map<commitId, PlanImplementReady>` and `PlanImplementReady` carries `repositoryName` ([mercurian.ts:350–355](../../packages/contracts/src/mercurian.ts)) — the popover can say _why_ ("covers <repo>"), which the row chips never had room for.
- **Implement-from-anywhere is one parameter away.** `tryImplement({planId, parentCommitId})` already accepts an arbitrary parent; today `PlanningSpace.beginImplement` hardcodes `head` and gates on `planMayBeStaleAt(graph, head)` ([PlanningSpace.tsx:407–434](../../apps/web/src/components/mercurian/PlanningSpace.tsx)). Generalizing the flow to a commit argument gives the popover's "Implement from here" the exact same gate and warning dialog as the composer's button.
- **Edit-and-branch has all its primitives.** Draft seeding is `usePlanComposerStore.setDraftText`/`addAttachments`; message attachments are `ChatAttachment` metadata fetched through the assets door (`useAssetUrl`, [assetUrls.ts](../../apps/web/src/assets/assetUrls.ts)); `toPlanComposerAttachment(file)` ([PlanComposer.tsx:576](../../apps/web/src/components/mercurian/PlanComposer.tsx), currently module-private) converts to the draft's dataUrl shape; and `positionAfterPick` moves the anchor. M-134 will offer the same act from the conversation — the seeding helper should be written for that reuse.
- **The Graph's text layers to remove are enumerable:** the zoom-gated kind glyph (`detailFor`/`MAP_GLYPH_ZOOM`, [DagExplorer.logic.ts:75, 203–208](../../apps/web/src/components/mercurian/DagExplorer.logic.ts); render at [DagExplorer.tsx:1551–1565](../../apps/web/src/components/mercurian/DagExplorer.tsx)), the current-node caption (`planNodeSummary` text, 1566–1574), the "Ready to implement" / "Spec stale" / "Plan may be stale" SVG badges beside nodes (1575–1631), and the always-on hover **detail overlay** (`role="tooltip"`, immediate on hover, cursor-tracking, 1640–1655 plus `detailOverlayPosition` and the measuring machinery). The checkpoint double-ring (1539–1550) is also retired: kind color takes over the turn-vs-standalone distinction.
- **Coding-session leaves are real as of M-110** (d5baedf1e). `PlanTimelineItem` gained `_tag: "coding-session"` — immutable facts on the commit (`repositoryName`, `planRevisionCommitId`) — and the _mutable_ session facts (`branch`, `outcome`, `endedAt`, `prUrl`) ride beside the history as `PlanCodingSessionRecord[]` on `detail.codingSessions`, keyed by leaf commit id ([mercurian.ts](../../packages/contracts/src/mercurian.ts)). Leaves are **human-authored** and structurally childless (the commit store refuses children), so they can never be absorbed into a turn checkpoint — M-132's grouping is untouched. `PlanTimeline` already renders the session card (status wording Running/Completed/Stopped/Ended, branch, PR link) — the popover mirrors those facts. And `resolveActingHead` ([PlanPosition.logic.ts](../../apps/web/src/components/mercurian/PlanPosition.logic.ts)) establishes the semantics the popover's acts must honor: a leaf is inspectable, but acting (send, implement, model choice) continues from its sole parent — `PlanningSpace` already routes everything through it.
- **One AC corner remains thin by design:** _artifact-revision change summaries._ Revisions cross the wire without text (quadratic payload otherwise), so the "concise summary of what changed" is the existing one-line naming (`planCommitSummary`: who touched which artifact, the cause, the split's repository) — a content diff would be new server surface and is deliberately not planned here.
- **Popover mechanics have precedent.** Base UI `Popover` with `openOnHover`/`delay`/`closeDelay` is already used by the thread's `DivergenceBadge`; `PopoverPopup` accepts an `anchor`, so one controlled popover can anchor to whichever row or SVG node summoned it.

## Conventions Detected

- **ADR 004 additive discipline** — every touched file is Mercurian-owned (`components/mercurian/`, `planComposerStore`, user docs). No fork-upstream files. Evidence: fork-baseline.md, every plan in this directory. **High.**
- **Mercurian UI layout** — pure logic in `X.logic.ts` with colocated `.logic.test.ts`; markup assertions as `.test.tsx` via `renderToStaticMarkup`; components carry doc-comment rationale. Evidence: PlanCheckpoints/PlanGraph/DagExplorer. **High.**
- **Derived, never stored** — freshness, readiness mapping, and checkpoint grouping are all pure client projections over the timeline; the model switch and moved-past-split follow the same pattern. Evidence: SpecArtifact.logic.ts, PlanCheckpoints.logic.ts. **High.**
- **Chips style** — `bg-<color>-500/15` + `text-<color>-700 dark:text-<color>-400`; standard Tailwind palette classes are in active use (amber, emerald). **High.**
- **Targeted checks** — `vp test run <files>`, scoped lint/typecheck; CI owns the suite. Browser-walk every AC in the running app before calling it done (AGENTS.md + working memory). **High.**
- **Commits & docs** — plan lands as `docs(project): …`; implementation as `feat(web): … (M-133)` / `(M-129)`; suggested branch `venk/m-133-and-129`. Evidence: `git log`. **High.**

## Design

### M-133 — the rename, and pinning what must stay absent

1. **Pane header** (`DagExplorer.tsx:217`): `History` → `Checkpoint Graph`.
2. **Corner toggle** (`PlanningSpace.tsx:710–713`): `aria-label="Checkpoint Graph"`, tooltip `Checkpoint Graph`. The `GitBranchIcon` stays — the icon was never named History.
3. **Compressed pane label** (`paneSpanLabel`): "History pane: …" → "Checkpoints: <start> to <end>" (and "Empty checkpoint pane" for the empty case) — the label describes a run of checkpoints, so it should say so.
4. **User docs** ([docs/user/projects-and-threads.md](../user/projects-and-threads.md)): the pane and its warnings are narrated under the History name; rename to Checkpoint Graph in the prose that names the pane (the sections at lines ~123, ~151–156, ~198–213).
5. **Code identity stays.** `DagExplorer.tsx` and its logic modules keep their names, as do the localStorage keys (`mercurian:dag-explorer-view:v1`, `…-display:v1`) — the issue renames the _product surface_; churning module names and stored keys would add risk for no user-visible fact. (The component's doc comments get the new name where they say "History".)
6. **Absence pins.** No Detail setting exists to remove; the AC lands as tests: the settings popover exposes exactly layout/node-size/line-thickness, no rendered control mentions Commits/Detail, and a turn's interior commits are not independently selectable in any view (already true via `nodeIdByCommit`; the test makes it a contract).

### M-129 — the Graph strips to colored status dots

Per the resolved Open Decision, nodes carry **no glyph, name, message, current-position label, or any text, at any zoom or selection state**. Removed outright: `detailFor`/`MAP_GLYPH_ZOOM` and the glyph layer, `graphMessageGlyphTransform`, the current-node caption, the three SVG side-badges, the checkpoint ring, and the hover detail overlay with its `detailOverlayPosition`/measurement machinery. What remains on a node: kind color, solid/hollow (published/private), degree-scaled radius, the proximity swell, the current-position ring (`stroke-primary`), and lineage emphasis on hover — hover is emphasis only, never text.

**Kind color.** New `planNodeKindColor(node)` in `PlanCheckpoints.logic.ts` maps the node's reading to a palette class pair (solid fill vs. hollow `fill-background` + stroke):

| Kind                                                                       | Color         |
| -------------------------------------------------------------------------- | ------------- |
| Conversational turn checkpoint (settled, unanswered, or ungrouped message) | `sky-500`     |
| Plan revision (direct human/assistant edit)                                | `violet-500`  |
| Spec revision (any cause)                                                  | `teal-500`    |
| Split (plan revision with a `split` stamp)                                 | `emerald-500` |
| Coding-session leaf                                                        | `orange-500`  |

Standard-palette 500s read on both themes against `background`; emerald deliberately rhymes with the readiness chips (a split is born ready), orange marks the one node kind that is a doing rather than a saying, and nothing else in the pane uses sky/violet/teal/orange. The minimap keeps its monochrome miniature (it reads as shape, and its dots are 2px). Color is never the only account: every node keeps its accessible name (`planNodeAccessibleLabel`), which already words the kind ("You: …; Assistant: …", "You edited the plan", "Spec refreshed…", "Plan for <repo>").

### M-129 — one popover, three views

**Content is one shared component; summoning is per-view.** New `PlanNodePopover.tsx` + `PlanNodePopover.logic.ts` (+ tests) beside the explorer. `PlanNodePopoverContent` renders, top to bottom (vault order):

1. **Identity.** The turn or the standalone act by kind — reusing the checkpoint row grammar: query line (mirrored bubble glyph, **You**), response line (**Assistant**) for turns; kind glyph + name for standalone acts ("You edited the plan", "Spec refreshed from M-12", "Plan for <repository>"). Relative time, and a Published / Private standing chip.
2. **Model facts.** On the response line only, `generatedBy` via the extracted `ModelAttribution` (exported from `PlanTimeline.tsx`; `providers` threaded in) — the query's `ranUnder` stays a stored fact feeding the switch derivation, never a second display line (amended 2026-08-19: first shown on both lines; a settled turn's two records are the same pair by construction, so the repeat was noise). When the turn's recorded pair differs from its ancestor turn's, a switch line names it: "Switched from <provider · model>" — `modelSwitchFor(commitGraph, queryCommitId)` in the logic module walks parents to the nearest ancestor human message carrying `ranUnder` and compares pairs. Derived reading only; no history entry.
3. **What changed.** The query text and response excerpt (clamped, as `planNodeDetail` does today), the derived effect chips (`checkpoint.effects` — commits only, so response prose can never mint a "Plan updated"), with the in-flight `unanswered` suppression the views already apply. Standalone acts show their one-line change summary; splits say what they projected and onto which repository.
   3a. **Session facts** (coding-session leaves). The leaf's immutable facts plus its `PlanCodingSessionRecord` when one is found: repository, status (the timeline's wording — Running while `endedAt` is null, else Completed/Stopped/Ended by `outcome`), branch, and the PR link when recorded. Requires a new `codingSessions` prop threaded from `detail.codingSessions` (the same array `PlanTimeline` now receives). A leaf with no record renders its immutable facts alone — the record is mutable state and may lag.
4. **Position honesty.** "Spec changed since this branch's base" (`staleSpecCommitIds`), "Plan may be stale" (`stalePlanCommitIds`, with the existing description line), and — new — **"The plan has moved past this split"**: `planMovedPastSplit(commitGraph, splitCommitId)` is true when the split's parent has at least one non-split child (planning continued on the parent line). Worded for a user; the popover never says "split" — it says "this plan for <repo>".
5. **Readiness.** The "Ready to implement" badge with its reason: "covers <repositoryName>" from `PlanImplementReady`.
6. **Acts.** Buttons, behaving exactly as those actions do elsewhere:
   - **Continue from here** — `onSelect(node.commitId)` (the terminal state; identical to picking the row/node), then close.
   - **Edit and branch** — offered when the node carries a human query _with a parent_ (a root query would need a second root, which the store doesn't model; deferred until M-134 decides). Seeds the composer draft with the query's text and attachments and moves position to the query's parent. New `onEditAndBranch(query)` prop wired in `PlanningSpace`: `setDraftText`, attachments re-materialized by fetching each `ChatAttachment` through the assets door and running the (now exported) `toPlanComposerAttachment`, then `select(parentId)`. The helper lives where M-134 can reuse it.
   - **Implement from here** — `handleImplementFlow` generalized to carry a `fromCommitId`, resolved through `resolveActingHead` first (M-110's rule: a leaf acts from its parent): same stale-plan gate (`planMayBeStaleAt(graph, actingCommitId)`), same `StalePlanWarning` dialog, `tryImplement({planId, parentCommitId: actingCommitId})`.
   - **Coding-session leaves** offer **Continue from here** only (inspecting the leaf; the composer's session-leaf banner and `resolveActingHead` already explain and route acting to the parent). No Edit-and-branch, no Implement-from-here on a leaf — and no "Open session" here: the timeline's own card carries that affordance (disabled today, pending the Coding Session View), and the popover shouldn't grow a second doorway before the first one opens.

Opening the popover never moves the position — only the acts do.

**Summoning.** One controlled popover instance per view (state: `{anchor: Element, commitId} | null`), rendered through Base UI `Popover` + `PopoverPopup anchor={…}` so dismissal, focus, and positioning are the library's problem. A small shared hook (`usePlanNodePopover`) owns the linger timer (`NODE_POPOVER_HOVER_DELAY ≈ 500ms`) and close-delay so pointer travel between anchor and popup doesn't flap:

- **Thread and Columns rows:** hover-linger on the row opens it; a trailing details affordance (info icon button, visible on row hover/focus — next to the divergence badges) opens it deliberately by click or keyboard. Row click keeps navigating, exactly as today.
- **Graph nodes:** hover-linger opens it, and **click/Enter/Space on a node now opens the popover instead of navigating** — per the vault, on the map "the popover is the only textual detail layer, summoned deliberately (click, or a hover-linger)"; navigation from the map happens through **Continue from here**. Plain hover stays lineage emphasis; focus stays emphasis; the popup is anchored to the node's `<g>` element (works with pan/zoom since the anchor rect is live), non-modal, and Escape/outside-click dismiss it.

Divergence-badge options and compressed-strip dots do **not** get popovers in this pass — the vault mentions badges, but nesting a popover inside the badge's own popup is real interaction risk for entries whose checkpoints are one Columns/Graph hop away. Deferred deliberately; noted for a follow-up if it's missed in use.

**New props on `DagExplorer`:** `providers`, `codingSessions`, `onEditAndBranch`, `onImplementFrom` (all from `PlanningSpace`, which already holds each). `readyCommits` changes from the pre-mapped `ReadonlySet` handling to also thread the `PlanImplementReady` values so the popover has its reason (the node-mapped set stays for the row chips).

### What deliberately does not change

The wire and server (M-110 already carries everything the popover needs; nothing new crosses), the checkpoint grouping and `nodeIdByCommit` (M-132), position/continuation semantics (`resolveActingHead` included), Thread/Columns row rendering and chips (text off the _map_, not off the rows), view persistence, layout engines, camera, minimap, display settings (layout/size/thickness), and module/localStorage names. No reconstruction boundary (M-137), no conversation-side edit-and-branch (M-134), no commit-level reading anywhere.

## Implementation Checklist

M-133 (commit as `feat(web): rename the History pane to Checkpoint Graph (M-133)`):

- [ ] `DagExplorer.tsx`: header string; `paneSpanLabel` wording; doc comments that say History.
- [ ] `PlanningSpace.tsx`: toggle `aria-label` + tooltip.
- [ ] `docs/user/projects-and-threads.md`: pane naming in prose.
- [ ] `DagExplorer.test.tsx`: header reads Checkpoint Graph; toggle accessible name; settings popover exposes exactly layout/node-size/line-thickness; no rendered control mentions Detail or Commits.

M-129 (commit as `feat(web): node popover on the Checkpoint Graph views (M-129)`; graph-strip may land as its own commit first):

- [ ] `DagExplorer.logic.ts`: delete `detailFor`, `MapDetail`, `MAP_GLYPH_ZOOM`, `detailOverlayPosition`, `DetailOverlayPlacement` (+ their tests).
- [ ] `PlanCheckpoints.logic.ts`: `planNodeKindColor` (solid/hollow class pairs, all five kinds incl. coding-session); keep `planNodeDetail` only if the popover content still uses its pieces — otherwise fold into the popover logic.
- [ ] `PlanNodePopover.logic.ts` **(new)**: `modelSwitchFor`, `planMovedPastSplit`, session-record lookup/status wording (shared with the timeline card's derivation), content derivation (identity kind/label, standing, warnings list, readiness reason, offered acts).
- [ ] `PlanNodePopover.tsx` **(new)**: `PlanNodePopoverContent` (sections 1–6 incl. session facts, checkpoint row grammar, `ModelAttribution`), `usePlanNodePopover` hook (linger/close timers, controlled anchor state).
- [ ] `PlanTimeline.tsx`: export `ModelAttribution`.
- [ ] `PlanComposer.tsx`: export `toPlanComposerAttachment`.
- [ ] `DagExplorer.tsx`: Graph — remove glyph layer, caption, SVG badges, checkpoint ring, detail overlay + measurement; apply kind colors; node click/Enter opens the popover (`pickNode` becomes the popover's Continue act); keep swell, ring, lineage emphasis, `aria-label`s (now with `aria-haspopup`). Thread/Columns — trailing details affordance + linger wiring; rows otherwise untouched. Thread the new props into all three views.
- [ ] `PlanningSpace.tsx`: generalize `handleImplementFlow`/`beginImplement` to a `fromCommitId` resolved through `resolveActingHead`; add `onEditAndBranch` (draft seeding + asset re-materialization + `select(parent)`); pass `providers`, `codingSessions` (`detail.codingSessions`), `readyCommits` values, and the new callbacks into `DagExplorer`.
- [ ] Don't add: contract/server changes, switch entries in any view, popovers on divergence-badge options, a Detail setting, text on map nodes.

## Test Plan

Colocated logic tests plus `DagExplorer.test.tsx` markup assertions; run targeted via `vp test run`. Browser-walk every AC afterward (both issues' AC are demonstrable in the running app; the linger/dismiss interactions are browser-walk-only).

- [ ] `planNodeKindColor`: turn (settled/unanswered/ungrouped message) → sky; plan revision → violet; spec revision → teal; split → emerald; coding-session leaf → orange; hollow variants for unpublished; unknown/future kind falls back safely.
- [ ] `modelSwitchFor`: nearest ancestor turn with `ranUnder` compared; no ancestor record → no switch; same pair → no switch; differing provider or model → named switch; walk crosses absorbed interior commits correctly (uses the commit graph, not the condensed one).
- [ ] `planMovedPastSplit`: split whose parent has a later non-split child → true; split whose parent's only children are splits → false; missing parent → false.
- [ ] Popover content derivation: a turn shows You/Assistant identity, `ranUnder`/`generatedBy`, effects from commits only (prose claiming an edit with no revision member yields no chip — the honesty AC), relative time, standing; a split names its repository; a spec refresh names its cause; readiness renders "covers <repo>" from `PlanImplementReady`; warnings render from the stale sets; in-flight suppression hides `unanswered`.
- [ ] Offered acts: turn checkpoint → Continue + Edit-and-branch + Implement; unanswered query → same; root query (no parent) → no Edit-and-branch; standalone acts → Continue + Implement, no Edit-and-branch; coding-session leaf → Continue only.
- [ ] Session facts: a leaf with a record shows repository, status (Running/Completed/Stopped/Ended), branch, and PR link; a leaf without a record shows its immutable facts alone; a leaf is never grouped into a turn (human-authored, childless — pin it).
- [ ] Implement-from-here on any commit resolves through `resolveActingHead` (from a session leaf's _parent line_ nothing changes; a leaf itself offers no implement).
- [ ] Markup: Graph SVG contains **no `<text>` and no glyph icons at any settings/zoom state**; no checkpoint ring; kind-color classes present; current ring present; pane header reads Checkpoint Graph; rows show the details affordance; node `aria-label`s still name author and kind.
- [ ] `PlanningSpace` wiring: implement-from-here gates on `planMayBeStaleAt` at the _chosen_ commit (stale → warning dialog, continue-anyway proceeds with that parent); edit-and-branch seeds text + attachments and moves position to the query's parent (position, not send).
- [ ] Browser walk (per AC): popover opens by linger and by the deliberate affordance in all three views without moving the position; ordinary pointer movement over the map shows emphasis only; map click opens the popover and Continue-from-here navigates; Escape/outside-click dismiss; no affordance anywhere continues from an interior commit.

## Amendment (2026-08-19, second): glyphs stay; color is status, in a corner dot

The first cut of the graph strip over-read the design: it dropped the kind glyphs and colored the disc itself by kind. Venkat's correction (vault `7801ac9`, Linear M-129 AC amended in place): **the glyphs were always meant to stay** — only the _text_ beside nodes leaves the map — and the colored dots are **status**, small filled dots anchored at a node's top-right corner, replacing the former text badges. Kind never gets a color.

Delta against the implemented state:

- **Restore** the pre-strip node treatment: zoom-gated kind glyphs (`detailFor`/`MapDetail`/`MAP_GLYPH_ZOOM` return), `graphMessageGlyphTransform` author mirroring, the checkpoint double-ring + two-bubble glyph, and the monochrome published solid/hollow disc (`fill-muted-foreground` / `fill-background stroke-muted-foreground`).
- **Remove** `planNodeKindColor` and every kind-colored disc class (+ its tests).
- **Add** corner status dots: for each applicable status — ready = `fill-emerald-500`, spec stale = `fill-amber-500`, plan may be stale = `fill-orange-500` — a small filled circle at the node's top-right (anchored at ~45°, radius scaled to the node's), stacked side by side when statuses co-occur, drawn at every zoom (they are marks, not text). A pure helper (`planNodeStatusDots(ready, staleSpec, stalePlan)`) keeps the order and colors testable.
- **Still removed, per the standing AC**: the current-node caption, the ready/stale _text_ badges, and the hover detail overlay. The popover and its summoning are untouched.
- **Popover attribution shows once** (same-day correction): `ModelAttribution` renders on the Assistant line only; the You line keeps its label and glyph. `ranUnder` stays a stored fact feeding `modelSwitchFor`.
- **Header warnings collapse into an alert icon** (same-day correction, space): the pane header's amber count chips ("N stale spec branches", "N plans may be stale") are replaced by a single amber triangle-alert icon button beside the Checkpoint Graph heading, rendered only when a warning applies; its popover lists the warning lines with their descriptions.
- **Map clicks pick** (same-day correction, third): clicking or Enter/Space on a Graph node performs Continue from here immediately — `onSelect(node.commitId)`, closing any open popover — matching row-click semantics and the vault's resolved navigate-on-selection. The popover becomes the hover reading's deliberate second stage (linger opens it, on focus too for keyboard parity); a node whose reading offers no continue act falls back to opening the popover on click.
- **Tests**: markup pins flip — the map SVG _does_ contain glyph icons and the checkpoint ring again, still no `<text>`; status-dot presence/stacking/colors pinned; kind-color assertions deleted; one attribution per settled turn; header chips absent with the alert icon + popover content pinned. User docs re-worded (glyph dots + corner status dots).

## Deferred / flagged

- **"Open session" from the popover** — the timeline's session card owns that affordance (disabled today, pending the Coding Session View); the popover shows facts and Continue only.
- **Richer artifact-revision diff summaries** — would need new server surface (revision text never crosses); the one-line naming satisfies "concise summary" as designed today.
- **Divergence-badge option popovers** — vault-mentioned, deliberately deferred (nested-popover interaction risk).
- **Edit-and-branch on a root query** — needs a second-root story; deferred to M-134's design.
- **Reconstruction boundary in the popover** — M-137, explicitly out of scope per the issue note.
