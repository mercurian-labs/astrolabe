# Technical Plan — M-132: DAG Explorer: group assistant turns into continuable checkpoints

_Generated from the Goal/AC of Linear issue M-132 (see the issue for the full AC). Design sources are the almagest vault notes: **DAG Explorer** ("Continuable checkpoints" — the M-132 design essentially in full, including invariant wording quoted below), **Commit Tree** (invariant 3: "During an assistant turn, every artifact revision lands before the terminal response, making that response the turn's continuation point"), **Assistant** (a stopped response is "a commit, marked as interrupted"), **Specs**, **Composer** ("sending continues from that checkpoint's terminal state"), **Splits**, **Merges**, and **Coding Sessions**. The Detail setting that toggles Checkpoints/Commits is M-133; the node popover is M-129; edit-and-branch is M-134 — all out of scope here._

**Goal, in one sentence:** the explorer's three views stop rendering every commit uniformly and adopt the vault's continuable-checkpoint reading — a settled assistant turn (query + in-turn artifact revisions + terminal response) becomes one selectable node whose effects are derived from landed commits, while acts outside a turn stay their own nodes — without changing the commit DAG, the wire, or the server in any way.

## What discovery found

- **The whole change is client-side.** The explorer is "a second _rendering_ of the plan subscription" ([PlanGraph.logic.ts](../../apps/web/src/components/mercurian/PlanGraph.logic.ts) header): `buildPlanGraph(timeline)` derives `PlanGraph` from `PlanTimelineItem[]`, and [threadLayout](../../apps/web/src/components/mercurian/PlanThread.logic.ts), [columnLayout](../../apps/web/src/components/mercurian/PlanColumns.logic.ts), and [dagLayout](../../apps/web/src/components/mercurian/PlanGraph.logic.ts) are all pure functions over that graph. Nothing in `packages/contracts` or `apps/server` needs to change.
- **The grouping is structurally inferable, with no turn id needed.** A turn id "never lands in a commit; the settled message is the record" ([mercurian.ts:78-83](../../packages/contracts/src/mercurian.ts)). But the shape is guaranteed: every turn settles through `settleTurn` in [PlanningAssistant.ts:486](../../apps/server/src/mercurian/assistant/PlanningAssistant.ts) with exactly one assistant message commit — stopped and provider-error paths included, marked `interrupted: true` — whose parent is the turn's tip _after_ any assistant revisions landed. In-turn revisions are assistant-authored `plan-revision`/`spec-revision` commits; direct human edits, refreshes (`cause: "refresh"`/`"reconciliation"`/`"import"`), and splits (human-authored `plan-revision` with a `split` stamp) are human-authored and thus structurally outside any turn. Forks and merges are human-driven only (Commit Tree invariant 1), so a commit never has two assistant children.
- **Continuation is already the node id, if we pick the right one.** Selecting a node calls `onSelect(commitId)` → `positionAfterPick` ([PlanPosition.logic.ts:50](../../apps/web/src/components/mercurian/PlanPosition.logic.ts)) → the composer's `parentCommitId` and the artifact-as-of-then reads. If a checkpoint node's id **is** its terminal response's commit id, "continuing from a turn checkpoint starts after its terminal response and includes every successful artifact revision" falls out of the existing position machinery with zero new plumbing.
- **What consumes node identity today.** `anchoredCommitId` (the head, possibly an _interior_ commit — a live position advances through revision commits as they land mid-turn), `readyCommits` (keyed by arbitrary commit ids — the commit an implement was tried from), `stalePlanCommitIds`/`staleSpecCommitIds` (leaf ids), `parentChoices`/`branchChoices` maps, and `branchOption`'s summary/recency. All are commit-id-keyed and survive condensation via a member→node lookup.
- **`coding-session` exists as a commit kind** ([commitTree/schema.ts:33](../../apps/server/src/mercurian/commitTree/schema.ts)) but nothing writes it and the wire's `PlanTimelineItem` union doesn't carry it — `buildPlanGraph` already tolerates edges to absent commits. Merges are representable (`parents` is an array) but nothing writes multi-parent commits yet.
- **Glyphs today are author-blind:** `commitGlyph` in [DagExplorer.tsx:1902](../../apps/web/src/components/mercurian/DagExplorer.tsx) returns `MessageSquareIcon` for every message. Lucide `0.564` ships both `message-square` (tail bottom-**left**) and `messages-square` (two bubbles) — verified in the installed package.
- **Vault specifics the AC leaves implicit** (DAG Explorer note, quoted): "A human message whose turn produced no response is still a checkpoint, honestly marked **unanswered**"; "The glyphs keep their You and Assistant labels wherever there is room"; effects are "**Plan updated**, **Spec updated**, interrupted, or no artifact change — response prose never creates an effect badge"; "Expanding a checkpoint reveals its commits in their real order" (that expansion is M-133's Commits detail, not this issue); at Checkpoints detail the Graph draws "a disc whose treatment distinguishes a conversational turn from a standalone act". The kind-color Open Decision is unresolved with a recorded recommendation to **stay monochrome** — this plan follows it.

## Conventions Detected

- **ADR 004 additive discipline** — Mercurian code beside upstream's; every file touched here is Mercurian-owned (`components/mercurian/`). Evidence: [fork-baseline.md](../architecture/fork-baseline.md), every plan in this directory. **High.**
- **Mercurian UI layout** — pure logic in `Component.logic.ts` with colocated `.logic.test.ts`; markup tests as `.test.tsx` via `renderToStaticMarkup` + `vite-plus/test`. Evidence: `PlanGraph.logic.ts`/`.test.ts`, `DagExplorer.test.tsx`. **High.**
- **Pure-graph derivations carry doc-comment rationale** and pin representable-before-creatable shapes in tests ("forks, n-ary merges… representable long before anything can create them"). Evidence: PlanGraph/PlanThread/PlanColumns headers and tests. **High.**
- **Targeted checks only** — `vp test run <files>`, scoped lint/typecheck; CI owns the full suite (AGENTS.md). **High.**
- **Styling** — Tailwind utilities over fork theme tokens; monochrome badges as `bg-*/15` chips (existing "Ready to implement"/"Spec stale" chips). **High.**
- **Commits & docs** — `feat(web): … (M-132)` style subjects; plan lands as `docs(project): …` in `docs/project/`; branch `venk/m-132-dag-explorer-group-assistant-turns-into-continuable`. Evidence: `git log`, this directory. **High.**

## Design

### A condensed graph, not a second history

New module **`PlanCheckpoints.logic.ts` (new)** exports `condensePlanGraph(graph: PlanGraph): CondensedPlanGraph` — a pure projection from the commit-level `PlanGraph` to a checkpoint-level one of the _same shape_ (`nodes`/`byId`/`roots`/`latest`), plus `nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>` mapping every member commit to its node. Because the output is a `PlanGraph`, `threadLayout`, `columnLayout`, `dagLayout`, `ancestorClosure`, `hasFork`, and `mostRecentTip` all work on it **unchanged**. `PlanGraphNode` gains one optional field, `checkpoint?: PlanCheckpoint` (type declared beside `PlanGraphNode` in `PlanGraph.logic.ts` to keep imports acyclic):

```ts
interface PlanCheckpoint {
  readonly query: PlanTimelineItem; // the human message that opened the turn
  readonly revisions: ReadonlyArray<PlanTimelineItem>; // in-turn artifact revisions, real order
  readonly response?: PlanTimelineItem; // absent = unanswered
  readonly effects: ReadonlyArray<"plan-updated" | "spec-updated" | "interrupted" | "unanswered">;
}
```

`PlanningSpace` keeps feeding the commit graph — position, follow, and the conversation's ancestor closure stay commit-grained — and `DagExplorer` condenses internally with `useMemo`. This is exactly the seam M-133 needs: its Detail setting will feed the views either `graph` or `condensePlanGraph(graph)` and touch nothing else.

### The grouping rule, precisely

Walk nodes in sequence order. A commit **opens a turn checkpoint** when it is a human-authored _message_ with at most one parent (a multi-parent message is a merge — a standalone checkpoint per the AC; nothing writes one today, and how a merge's responding turn groups is decided when merges land). From the opener, follow children: absorb the unique assistant-authored child while it is a `plan-revision` or `spec-revision`; stop and close the group when the assistant child is a _message_ — that message is the terminal response and the **node's identity** (`commitId`, `item`, `sequence`, `createdAt`, `published` all come from it, so recency, ordering, and the solid/hollow published axis read from the continuation point). If at any step there is no assistant child, the opener stands as a single-member checkpoint marked **unanswered**; any assistant revisions stranded without a terminal (possible only if the settle append itself failed — logged as an error server-side) stay individual commits rather than pretending to be a settled turn. If a step ever sees _two_ assistant children (impossible under "forks are human-driven only", but the projection must be total) the opener's group is abandoned and its commits render individually — determinism over cleverness.

Everything not absorbed into a turn is its own node, unchanged: direct human plan/spec revisions, refresh/reconciliation/import spec revisions, splits, merges, future coding-session leaves, and assistant messages with no grouped opener.

Edges remap through membership: every node's parent list is the _entry_ commit's parents (the query's, for a checkpoint) mapped member→node and deduplicated. A historical fork hanging off an _interior_ commit (someone continued from a mid-turn revision before this issue landed) therefore re-anchors to the checkpoint node — the projection stays total and the same history reads the same on every branch; the commit-exact truth is one Detail switch away once M-133 lands. `isBranchPoint`/`isMerge` are recomputed on the condensed graph.

Effects derive **only from member commits**: any plan-revision member → `plan-updated`; any spec-revision member → `spec-updated`; `response.interrupted` → `interrupted`; no response → `unanswered`. A response whose prose claims an edit that never landed produces no chip, by construction — the AC's honesty requirement costs nothing. One suppression: `DagExplorer` gains an optional `inFlightAnchorCommitId` prop (from `detail.inFlightTurn?.parentCommitId` in [PlanningSpace.tsx](../../apps/web/src/components/mercurian/PlanningSpace.tsx)); a would-be-unanswered opener on the in-flight chain (anchor within its descendant closure) renders without the `unanswered` chip — a query being answered right now is not "unanswered". Mid-turn, commits that have landed but not settled keep rendering individually and collapse into the checkpoint when the terminal arrives — progressive and honest, matching "a **settled** assistant turn appears as one checkpoint".

### Rendering

**Summaries.** `PlanCheckpoints.logic.ts` exports `planNodeSummary(node)` / `planNodeDetail(node)`: for checkpoint nodes the summary is the _query's_ first line (what a person calls the turn — this is what branch switches, fork options, compressed-pane labels, and the Graph's current-node caption should say), the detail is query + effects + response; plain nodes delegate to the existing `planCommitSummary`/`planCommitDetail`. `branchOption` ([PlanThread.logic.ts:147](../../apps/web/src/components/mercurian/PlanThread.logic.ts)) switches to `planNodeSummary`; `paneSpanLabel`, Graph `aria-label`s, and the detail overlay follow.

**Author glyphs.** A small `MessageAuthorGlyph` in `DagExplorer.tsx`: assistant = `MessageSquareIcon` as shipped (tail bottom-left — the left-aligned bubble), human = the same icon mirrored (`-scale-x-100` in HTML rows; a `scale(-1,1)` transform group in the Graph's SVG) so its tail sits bottom-right — the right-aligned bubble. Applied _everywhere a message renders_: inside checkpoint rows, on individual message commit rows (`commitGlyph` becomes author-aware for `_tag: "message"`), and on Graph nodes for ungrouped messages. Accessible names carry the author ("You: …" / "Assistant: …"), so identity never rides color — or the mirror — alone.

**Thread and Columns rows.** `CommitRow` keeps its single 34px line for plain nodes. Checkpoint nodes render a new `CheckpointRow` (same button/roving-focus contract, auto height): a query line using the conversation's own grammar — text end-aligned with the mirrored bubble glyph and a "You" label trailing on the right; an effects line of monochrome chips (**Plan updated**, **Spec updated**, **Interrupted**, **Unanswered**) alongside the existing ready/stale chips; a response line left-aligned with the assistant glyph and "Assistant" label, plus the timestamp. Labels render where there is room and truncation eats them last (vault: "wherever there is room"). Selection, `aria-current`, trailing divergence badges, and keyboard focus keys are untouched — a checkpoint is one row like any other.

**Graph.** One node per checkpoint. The disc distinguishes a conversational turn from a standalone act _monochromatically_ (per the unresolved-color recommendation): turn checkpoints draw a second concentric ring and carry the `MessagesSquareIcon` two-bubble glyph; standalone acts keep today's single disc and kind glyph (message discs now author-oriented). Published solid/hollow and the current-node primary ring are unchanged. The detail overlay renders `planNodeDetail` — query, chips, response excerpt.

**Id-keyed marks.** `DagExplorer` computes, per memoized condensation: `currentNodeId = nodeIdByCommit.get(currentCommitId) ?? currentCommitId` (an anchored interior commit highlights its containing checkpoint), and ready/stale sets mapped member→node so a verdict or staleness on any member surfaces on the checkpoint. `effectivePlanExplorerView`/`hasFork` read the condensed graph, so the Columns toggle reflects what is actually rendered.

### What deliberately does not change

The wire (`PlanTimelineItem`, `PlanDetail`), the server, `buildPlanGraph`, `PlanPosition` logic and the live-follow rule, the conversation timeline (`PlanTimeline` already renders bubbles per M-123), `threadLayout`/`columnLayout`/`dagLayout` algorithms, minimap, camera, and display settings. No Detail setting (M-133), no node popover (M-129), no edit-and-branch (M-134), no kind colors (open decision — monochrome).

## Implementation Checklist

- [ ] `PlanGraph.logic.ts`: add the `PlanCheckpoint` interface and the optional `checkpoint` field on `PlanGraphNode`; make `commitGlyph`'s message case author-aware (or move glyph choice wholly into `DagExplorer.tsx` where the icons live).
- [ ] `PlanCheckpoints.logic.ts` **(new)**: `condensePlanGraph` (grouping rule + edge remap + recomputed flags + `nodeIdByCommit`), effect derivation, `planNodeSummary`/`planNodeDetail`, and a `mapMarksToNodes(set, nodeIdByCommit)` helper for ready/stale sets.
- [ ] `PlanThread.logic.ts`: `branchOption` summary via `planNodeSummary`.
- [ ] `DagExplorer.tsx`: condense with `useMemo`; derive `currentNodeId` and mapped mark sets; accept optional `inFlightAnchorCommitId`; `MessageAuthorGlyph`; `CheckpointRow` for thread and columns (auto height, chips, You/Assistant labels); Graph turn-disc treatment (`MessagesSquareIcon`, double ring), author-oriented message glyphs with SVG mirroring, checkpoint-aware overlay and `aria-label`s.
- [ ] `PlanningSpace.tsx`: pass `inFlightAnchorCommitId={detail?.inFlightTurn?.parentCommitId}`.
- [ ] Don't add: contract or server changes, a second subscription, a Detail setting, popovers, colors keyed to commit kind, or any edit outside `components/mercurian/`.
- [ ] Plan document lands as `docs(project): technical plan for M-132`; implementation commits as `feat(web): … (M-132)` on the suggested branch.

## Test Plan

New colocated `PlanCheckpoints.logic.test.ts` plus extensions to `DagExplorer.test.tsx` (static markup) and, where summaries changed, `PlanThread.logic.test.ts`; run targeted via `vp test run`.

- [ ] A settled turn (human msg → assistant plan-revision → assistant spec-revision → assistant msg) condenses to one node whose id is the terminal response, members in real order, effects `plan-updated` + `spec-updated`.
- [ ] An interrupted terminal groups identically and adds `interrupted`; a bare interrupted reply (stop before any text/revision) still forms query+response.
- [ ] A human message with no assistant child is a single-member checkpoint with `unanswered`; with `inFlightAnchorCommitId` on its chain, the chip is suppressed.
- [ ] Direct human plan revision, refresh/import spec revisions, and split revisions stay standalone nodes; a multi-parent human message is never absorbed; two assistant children abandon the group (representable-before-creatable, per house pattern).
- [ ] A fork hanging off an interior revision re-anchors to the checkpoint node; ancestry/`threadLayout`/`columnLayout` over the condensed graph stay coherent (no lost or duplicated rows).
- [ ] Effects derive from commits only: a turn whose response text claims changes but carries no revision members yields no artifact chips.
- [ ] `nodeIdByCommit` maps every member; ready/stale marks on interior members surface on the node; `currentNodeId` resolves an interior anchor to its checkpoint.
- [ ] Markup: checkpoint row shows query line (mirrored glyph + "You"), effect chips, response line (assistant glyph + "Assistant"); an individual human message commit row carries the mirrored glyph class; graph output contains the two-bubble turn glyph and double ring for a checkpoint node; accessible labels name the author.
- [ ] Summaries: a branch option rooted at a checkpoint reads as its query's first line; recency reads the terminal's timestamp.
