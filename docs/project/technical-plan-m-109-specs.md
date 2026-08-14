# Technical Plan — M-109: Specs

_Updated from Linear issue M-109's Goal/AC, product-doc commit `700388058a0ff232590924aad8628afd19f27e4c`, and the two-prose-field clarification in almagest commit `fb0a306`. The implementation plan is grounded in the astrolabe repository as it stands on 2026-08-13. Product intent comes from **Specs**, **Commit Tree**, **DAG Explorer**, **Composer**, **Plans**, **Assistant**, **Issue Import**, **Issues**, **Coding Sessions**, **Trackers**, and the rename record **Issue Revisions**._

**Goal, in one sentence:** generalize the imported-issue root that M-101 already writes into a path-specific **spec** artifact parallel to the plan; give users and the planning assistant equal, direct revision mechanisms while retaining human-only structural control; absorb tracker and in-loop contract changes without rewriting history; and present the resulting multi-commit turns as continuable checkpoints with raw commits available as an audit view.

## Conventions Detected

| Convention                                                                                                                                | Evidence                                                                                                                                                                                    | Confidence |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The server is command/event/projector shaped; immutable commits and edges are the source of truth                                         | `apps/server/src/mercurian/commitTree/CommitStore.ts`; `apps/server/src/mercurian/planning/PlanningStore.ts`; `docs/internals/overview.md`                                                  | High       |
| Human writes name a parent and are blocked during an active assistant turn; assistant writes use one parent and advance the live turn tip | `PlanningStore.requireNoActiveTurn`; `PlanningStore.savePlanRevision`; `PlanningStore.saveAssistantPlanRevision`; `PlanningAssistant.saveRevisionFromThread`; `PlanTurnRegistry.advanceTip` | High       |
| Structural assistant limits live at the generic commit boundary                                                                           | `CommitStore` assistant fork/merge errors; `PlanningStore.appendAssistantAt`                                                                                                                | High       |
| Artifact content crosses once on the snapshot; history rows carry facts and historical content is fetched by commit                       | `packages/contracts/src/mercurian.ts`; `PlanningStore.getPlanTextAt`; `packages/client-runtime/src/state/planReducer.ts`                                                                    | High       |
| Public wire contracts are Effect schemas and RPCs, mapped at one server boundary                                                          | `packages/contracts/src/mercurian.ts`; `packages/contracts/src/rpc.ts`; `apps/server/src/mercurian/planning/wire.ts`                                                                        | High       |
| All DAG Explorer modes consume the same `PlanGraph`, while position remains a per-window commit id                                        | `PlanGraph.logic.ts`; `PlanThread.logic.ts`; `PlanColumns.logic.ts`; `DagExplorer.tsx`; `PlanPosition.logic.ts`                                                                             | High       |
| Explorer preferences are schema-decoded local storage, separate from server state                                                         | `DagExplorer.tsx` storage keys; `DagExplorer.logic.ts`; `PlanningSpace.tsx`                                                                                                                 | High       |
| Pull-only tracker connectors expose normalized issue values behind `TrackerStore` and one total registry                                  | `apps/server/src/mercurian/trackers/connector.ts`; `TrackerStore.ts`; `connectors/registry.ts`; `connectors/LinearConnector.ts`                                                             | High       |
| Focused tests sit next to pure logic and Effect services; server async tests wait on durable changes rather than sleeping                 | existing `*.test.ts`/`*.test.tsx`; repository `AGENTS.md`                                                                                                                                   | High       |

## Pickup decisions and scope

### Pin the open placement decision: one artifact pane, compact Spec/Plan picker

The existing right-sidebar artifact pane becomes one standing view whose header uses the same compact dropdown pattern as the project selector to choose **Spec** or **Plan**. `Plan` remains the default so this issue does not relocate an already-shipped artifact. The selected artifact persists with the existing pane preference.

This keeps “planned from” and “planned toward” adjacent without opening another resize/visibility model, and it works in the existing narrow and wide planning layouts. The timeline and DAG remain history views; they do not become substitute artifact readers.

### The spec is a two-field prose snapshot, not a second tracker issue model

Persist `{ goal, acceptanceCriteria }` as the complete spec document. Both fields are prose, not metadata: `goal` holds the user story, outcome, and behavioral context rather than a short title, while `acceptanceCriteria` holds the observable conditions for completion. The editor therefore gives Goal / user story a multiline surface with at least six visible lines and keeps Acceptance criteria in its own multiline surface. Tracker id, URL, provider, and connection remain origin metadata rather than fields of the spec.

The full snapshot follows plan-revision semantics: ancestry determines the current document, earlier documents are immutable, and a merge can later resolve to one ordinary complete revision instead of replaying patches.

### Checkpoints are a projection over commits, not another history

The commit DAG stays authoritative. A checkpoint is derived client-side by grouping commits that already express a turn or a standalone act. Do not persist checkpoint rows, effect badges, a separate spec-change log, or turn summaries. `Plan updated` and `Spec updated` are computed only from included artifact commits; assistant prose cannot manufacture either effect.

The projection uses an included commit as its stable id and continuation target, so picking a checkpoint still sends an ordinary commit id to the existing position/composer model. The raw commit graph remains available unchanged under `Detail: Commits`.

### Explicitly out of scope

- Automatic tracker sync, webhooks, or background refresh. Refresh remains an explicit pull.
- A mutable shadow copy of tracker content in `plan_origins`; the last imported upstream snapshot is recoverable from spec-revision provenance.
- Rebuilding old SQLite history to rename `issue-revision`. Existing rows keep their persisted literal and decode into the new domain vocabulary.
- Assistant-created planning spaces, forks, or merges. Direct artifact authority does not grant structural authority.
- A native mobile planning-space implementation. Mobile has no Mercurian planning UI today; contracts must remain decodable, but this issue does not create that surface.
- Zoom-dependent semantic grouping. Zoom changes geometry only; the shared Detail setting changes checkpoint versus commit semantics.

## Design

### 1. Generalize `issue-revision` into domain `spec-revision` without rewriting history

Add `"spec-revision"` to the domain commit-kind schema and use that name everywhere above persistence. Preserve compatibility in `CommitStore`:

- decoding a stored `"issue-revision"` yields domain `"spec-revision"`;
- encoding a new domain `"spec-revision"` continues to store `"issue-revision"` until a future storage migration deliberately changes the literal;
- all new store, wire, reducer, and UI branches switch on `spec-revision` only.

Rename `PlanIssueRevision` to `PlanSpecRevision` and the timeline tag to `spec-revision`. Because contracts are shared, update snapshot/event decoding atomically across server, web, and client-runtime. Do not accept both public tags indefinitely; persistence is the only compatibility seam.

The imported issue remains a tracker **issue** while browsing, selecting, refreshing, and showing origin metadata. Once its content enters planning history, the commit and standing artifact are a **spec**.

### 2. Persist full spec snapshots with enough provenance to refresh safely

Introduce the stored document and revision payload:

```ts
interface SpecDocument {
  readonly goal: string;
  readonly acceptanceCriteria: string;
}

type SpecRevisionSource =
  | { readonly kind: "import"; readonly issueId: string }
  | { readonly kind: "tracker-refresh"; readonly issueId: string }
  | {
      readonly kind: "tracker-reconciliation";
      readonly issueId: string;
      readonly upstream: SpecDocument;
    }
  | { readonly kind: "direct" };

interface SpecRevisionCommitPayload {
  readonly document: SpecDocument;
  readonly source?: SpecRevisionSource;
}
```

`source` is optional only for compatibility with M-101 roots. Decode both the existing flat `{ title, description }` payload and M-109's earlier nested `{ document: { title, description } }` payload into `{ goal, acceptanceCriteria }`; convert a legacy reconciliation's nested upstream snapshot too. New writes use only the semantic field names and stamp a source. Import and refresh map tracker title to `goal` and tracker description to `acceptanceCriteria` deterministically. `authorKind` already distinguishes direct human and assistant edits, so provenance must not duplicate authorship. A reconciliation may intentionally preserve local changes, so it separately carries the upstream snapshot reviewed at that point. Walking spec ancestry can therefore recover both current contract and last-known upstream content without adding mutable columns to `plan_origins`.

The wire timeline item stays compact: `PlanSpecRevision` carries commit facts, cause, and optional origin issue id, but not every historical document. Add `PlanSpecAt = { revisionCommitId, document }`, current `spec: PlanSpecAt | null`, and origin summary to `PlanDetail`; add the same `PlanSpecAt` shape for one historical read. A spec-revision commit event carries its new `spec` once so `planReducer.ts` can advance current state. This prevents websocket growth from becoming quadratic as revisions accumulate.

M-101 import changes only at the boundary: its published root becomes a `spec-revision` with `source.kind: "import"`. Existing imported roots decode through the same payload compatibility path.

### 3. Project the spec at the selected path

Add `PlanningStore.getSpecAt({ planId, commitId })`. It walks that commit's ancestry to the nearest domain `spec-revision` and returns its document/revision id, or `null` for a blank path. Add a unary `mercurian.getSpecAt` read RPC symmetric with `getPlanTextAt`.

The live `PlanDetail.spec` is the document at the globally latest tip. `PlanningSpace.tsx` already computes the visible ancestry for a deliberately selected commit. When the visible path's latest spec revision differs from the live snapshot revision, fetch `PlanSpecAt` once and freeze it with the selected path just as historical plan text is frozen. A commit arriving elsewhere in the DAG must not change the Spec pane under someone who is looking back.

Use one pure helper in `SpecArtifact.logic.ts` for nearest-revision lookup, source labels, live-versus-historical selection, and the last-known upstream baseline. Server projection and client selection tests should share equivalent fixtures even though the helper itself remains client-side.

### 4. Give human and assistant spec revisions the same direct mechanism as plan revisions

Add two store entry points parallel to the plan artifact:

- `saveSpecRevision` is the human RPC path. It requires no active turn, a named live parent, a complete document, and the spec revision id the editor was based on.
- `saveAssistantSpecRevision` is the assistant path. It calls `appendAssistantAt` with one explicit parent and `authorKind: "assistant"`.

Extend `appendAssistantAt` to accept `spec-revision`. Do **not** add a spec-specific assistant prohibition. The existing generic `AssistantForkError` and `AssistantMergeError` remain the structural law: the assistant may advance the current linear turn and may not create a sibling or merge. Human-only creation of planning spaces remains outside this service entirely.

Expose `read_spec` and `save_spec_revision` in the planning MCP toolkit. `save_spec_revision` takes the full `SpecDocument`; its handler resolves the calling provider thread to an active **reply** turn, calls `PlanningAssistant.saveSpecRevisionFromThread`, then advances `PlanTurnRegistry.tipCommitId` to the returned revision exactly as `saveRevisionFromThread` does. Repeated plan and spec tool calls therefore create one linear chain in call order, and `settleTurn` parents the terminal assistant message on the last artifact revision. A successful revision necessarily precedes the terminal response and is in its ancestry.

`read_spec` reads at the calling turn's current registry tip, not the plan's global latest commit. This matters after the assistant has already revised either artifact in the turn and when another branch is globally newer.

Update `planningSystemAppendix` to say:

- the spec describes behavior, user story, and acceptance criteria;
- the plan describes approach;
- both artifacts are changed only by their save tools after reading current state;
- a claim in response prose is not an artifact change;
- if discovery changes the contract, save the spec directly and then reconcile the plan in the same turn;
- suggesting a separate planning space is allowed, creating one is not.

Remove the old proposal/acceptance plan entirely: no `propose_spec_revision`, proposal payload on messages, accept RPC, proposal card, or `AssistantSpecRevisionError`. Version history and the human's ability to branch from the prior contract are the safety mechanism.

For human editors and tracker reconciliation, retain an optimistic `expectedSpecRevisionCommitId`. In the append transaction, recompute the parent's current spec revision and return `SpecRevisionOutdatedError` if the editor reviewed a different base. This is concurrency protection, not an authorship gate. The UI reloads the newer contract instead of silently overwriting it.

### 5. Refresh one tracker origin and reconcile three ways

Extend `TrackerConnector` with `getIssue(token, issueId)`, implemented by the currently supported Linear connector using its existing mapping/auth/error conventions. Add `TrackerStore.getIssue({ connectionId, issueId })` to own connection/secret lookup and normalized error mapping. Do not implement refresh by re-listing a page and searching it. The total `TrackerConnectors` registry remains the provider dispatch boundary, so a future tracker must implement the same read before its `TrackerKind` can compile.

`PlanningStore.prepareSpecRefresh` reads, in one effect:

1. origin metadata for the plan;
2. current local `SpecDocument` at the named path tip;
3. the last upstream snapshot from spec ancestry;
4. the live upstream issue from the provider.

Feed those values into a pure `classifySpecRefresh({ base, local, upstream })`:

- `unchanged`: upstream equals the last upstream baseline; write nothing, even if local differs;
- `committed`: upstream changed and local still equals base; append one human `tracker-refresh` revision;
- `committed-converged`: upstream changed and local already equals the new upstream document; append one human `tracker-refresh` revision with the same document so the commit records that this tracker version was absorbed and advances the ancestry-derived upstream baseline;
- `reconciliation-required`: both upstream and local changed from base and differ from each other; write nothing and return base/local/upstream;

Only an actually unchanged upstream value is a no-op. A converged refresh still changes the path's tracker baseline, so that provenance is a meaningful revision even though the visible document matches its parent. This prevents a later refresh from falsely treating the already-absorbed tracker version as an unmerged local edit, without introducing a hidden mutable shadow.

The Spec pane opens `SpecReconciliationDialog.tsx` for the third result. Show base, local, and upstream; provide **Use local** and **Use upstream**; seed an editable resolved document from local. Confirming calls `refreshSpec` with the reviewed upstream snapshot, resolved document, expected spec revision id, and path parent. The server re-fetches upstream before append. If tracker content or the path base moved, return a fresh reconciliation rather than accepting stale review. Otherwise append one `tracker-reconciliation` revision carrying the live upstream snapshot.

Refresh and direct human spec edits are allowed only while standing live. Choosing an old commit is how a person chooses a branch point; sending a message from there creates the branch before an artifact editor becomes available. This keeps artifact edits from accidentally becoming an unlabeled fork.

### 6. Absorb a spec change into the plan without restarting planning

There are two absorption paths:

1. **In-loop assistant discovery:** `save_spec_revision` advances the active turn tip. The assistant reads the plan and, when approach is now inconsistent, calls `save_plan_revision` before its terminal response. Spec revision, plan revision, and response are one linear turn/checkpoint.
2. **Standalone human edit or tracker refresh:** after the spec commit succeeds, `ws.ts` calls `PlanningAssistant.startSpecReconciliation` at that commit. The new turn is a response to the durable spec act, may save a plan revision, and settles a normal assistant message. Model unavailability emits the existing `turn-refused` frame; it never rolls back the contract commit.

Build the reconciliation prompt from the new spec, previous spec, and current plan:

```text
The planning contract changed on this path.
Revise the plan to absorb what changed; do not restart it.
Use read_plan and save_plan_revision when the approach must change.
Explain what was absorbed in the terminal response.
```

Do not start a recursive reconciliation turn for an assistant-authored spec revision: it is already inside the active turn that owns the subsequent plan update and response. Import roots also do not auto-run a reconciliation turn; the initial imported contract is the starting state, not a revision to an existing plan.

### 7. Derive continuable checkpoints from the immutable commit graph

Add `PlanCheckpoints.logic.ts` with a pure projection over the complete raw `PlanGraph`. A `PlanCheckpoint` contains:

```ts
interface PlanCheckpoint {
  readonly checkpointId: MercurianCommitId;
  readonly continuationCommitId: MercurianCommitId;
  readonly commitIds: ReadonlyArray<MercurianCommitId>;
  readonly authorKind: "human" | "assistant";
  readonly state: "settled" | "unanswered" | "interrupted" | "standalone";
  readonly effects: ReadonlyArray<"plan-updated" | "spec-updated">;
}
```

Use the continuation commit as `checkpointId`; it already has stable identity and is the commit the composer must parent on. Group by graph structure and authorship, not wall-clock gaps:

- a human message starts a turn checkpoint; follow its single linear chain of assistant-authored plan/spec revisions through the terminal assistant message;
- a standalone human spec revision or tracker refresh may anchor the immediate reconciliation chain of assistant artifact revisions and terminal response;
- assistant artifact commits are never pulled across another human act, fork, merge, or branch boundary;
- a human message whose assistant chain has no terminal response remains `unanswered`; any successful assistant artifact revisions already descended from it stay inside that checkpoint and still produce authoritative effects;
- an assistant terminal message with `interrupted: true` makes the group `interrupted`;
- a direct human artifact edit with no reconciliation output, an upstream refresh, merge, split, and coding-session leaf remain singleton/standalone checkpoints;
- unknown future commit kinds degrade to standalone nodes instead of disappearing.

Effects come only from included `plan-revision` and `spec-revision` commits. A terminal response saying “I updated the spec” without such a commit gets no badge. Multiple revisions of the same artifact collapse to one effect badge, while raw history remains inspectable.

The projection returns both a checkpoint graph and `checkpointByCommitId`. Collapse edges between groups, deduplicate parent checkpoint ids, and preserve merge parents. Do not mutate the raw graph or timeline. A selected raw commit maps to its containing checkpoint for highlighting, but the canonical per-window `PlanPosition` continues to store a raw commit id.

Picking a checkpoint calls the existing selection path with `continuationCommitId`. For settled turns that is the terminal assistant response, so continuing from the ordinary product view necessarily includes every artifact revision made during the turn.

### 8. Add one shared Checkpoints | Commits detail setting to all explorer views

Introduce `PlanHistoryDetail = "checkpoints" | "commits"` and a schema-decoded local-storage key owned by `PlanningSpace.tsx`, defaulting to `checkpoints`. Keep it separate from graph-only geometry (`layout`, node size, line thickness) and from the Thread/Columns/Graph view preference. Pass the selected graph and detail value into `DagExplorer`, so Thread, Columns, and Graph switch together and the choice persists across plans and views.

Reuse the existing layout engines by projecting checkpoints into a `PlanGraph`-compatible shape whose ids are continuation commit ids and whose nodes carry optional checkpoint metadata. Update summaries, glyphs, popovers, and rows to render:

- `You` or `Assistant` authorship;
- human query / terminal response excerpt when present;
- `Plan updated` and `Spec updated` effects;
- `Interrupted`, `Unanswered`, or standalone act labels.

At `Commits` detail, render the current raw graph exactly: every message, plan revision, spec revision, merge, and future supported commit is selectable. Zoom/pan state survives detail toggles where geometry allows and never changes semantic detail by itself.

`PlanThread.logic`, `PlanColumns.logic`, and spatial graph code should continue operating on graph topology rather than learning checkpoint grouping independently. All grouping belongs in `PlanCheckpoints.logic.ts`; this prevents the three views from disagreeing.

### 9. Make intermediate continuation and edit-and-branch explicit in the composer

Add `describeContinuationBoundary(rawGraph, checkpointByCommitId, selectedCommitId)`. When Detail is `Commits` and the selected commit is inside—but not at the end of—a checkpoint, the composer shows an exact boundary summary, for example:

> Continue exactly here — Spec updated is included; Plan updated and the assistant response are excluded.

Derive this from commit membership and order. Never infer included effects from text. Sending uses the selected raw commit as parent, so this is a human-authored fork and the old branch remains intact.

Add **Edit and branch** for an earlier human query in its node/message action surface. Copy the original text and attachments into the composer, move standing to the original query's parent, and show “Sending creates a new branch; the original remains in history.” The new send uses the ordinary `appendMessage` command. It must never mutate the old message or rewrite descendants. If the original parent is not present in a partial snapshot, disable the action with a clear reason rather than guessing a parent.

This behavior needs no edit RPC and no checkpoint persistence. Existing attachment ids are reused through the same asset-reference validation as an ordinary resend.

### 10. Render the current spec beside the plan

Extend the right-pane state schema with `artifact: "spec" | "plan"` and bump its local-storage version rather than partially decoding an old shape. Default to Plan.

`SpecArtifact.tsx` provides:

- separately labeled, rendered Goal / user story and Acceptance criteria for the current selected path;
- origin/last-refresh context when tracker-backed;
- latest revision author and cause;
- **Edit** for a live human path;
- **Refresh from issue** for a live tracker-backed path;
- historical read-only state while looking back;
- “No spec yet — draft the contract” for blank plans.

The blank and existing states expose the same **Edit** action. Editing uses two textareas: Goal / user story is not a title control and shows at least six lines; Acceptance criteria is a separate multiline field. Save writes one complete two-field snapshot.

Saving a blank draft calls the same guarded human `saveSpecRevision`; there is no special blank-plan table or acceptance flow. During an active assistant turn, the human editor is disabled for the same reason the Plan editor is disabled: a concurrent human append would force an illegal assistant fork. Assistant changes still stream into the Spec pane as ordinary commit events.

### 11. Rename visible artifact vocabulary and compute staleness from ancestry

Use **spec** for planning artifacts everywhere:

- timeline/checkpoint rows: “Spec imported from M-109”, “You revised the spec”, “Assistant revised the spec”, “Spec refreshed from M-109”;
- artifact tabs, historical labels, node summaries, effect badges, and stale indicators;
- empty-state and reconciliation copy.

Keep **issue** for tracker browse/import/search, tracker origin links, and “Refresh from issue.” Do not rename provider APIs whose object really is a tracker issue.

Derive stale branches from the raw DAG:

1. collect all `spec-revision` nodes;
2. choose the highest-sequence revision as the newest spec revision;
3. compute its descendant closure;
4. for each raw leaf, mark it stale when it is not in that closure and its own nearest spec revision differs from the newest revision;
5. attach the badge to the checkpoint containing that leaf in Checkpoints detail, or the raw leaf in Commits detail.

A merge that includes the newer spec clears staleness naturally through ancestry. No mutable branch flag, timestamp comparison, or special propagation job is needed. If the plan has no spec revision, no branch is stale.

### 12. Preserve transport, provider, and documentation boundaries

- **Web/desktop:** implement once in `apps/web`; desktop inherits the web surface. Do not add Electron IPC.
- **Public/local/remote/tunnel:** spec snapshots and commits use the existing websocket snapshot/event stream and unary historical reads; no origin URLs or localhost assumptions enter the bundle.
- **Mobile:** update shared contracts/reducer decoding so streams remain compatible. No native planning UI exists to update.
- **Providers:** Codex, Claude, Cursor, Grok, and OpenCode receive the same planning toolkit. Exact normalized tool-name and approval tests cover `read_spec` and `save_spec_revision`; no adapter-specific code is needed.
- **Performance:** snapshots carry one current spec; commit events carry no historical document fan-out; checkpoint projection is one memoized O(V + E) pass when timeline/detail changes, not work on animation frames.
- **Docs:** update shipped behavior in `docs/user/projects-and-plans.md` and `docs/user/trackers.md`; add spec, checkpoint, and refresh/reconciliation vocabulary to `docs/internals/glossary.md`; update planning/tracker seams in `docs/internals/overview.md`.

## File and module layout

### Existing files to change

- `packages/contracts/src/mercurian.ts` — `SpecDocument`, compact `PlanSpecRevision`, `PlanSpecAt`, current spec/origin fields, refresh inputs/results, and public `spec-revision` tag.
- `packages/contracts/src/rpc.ts` — register get/save/refresh-spec RPCs and concurrency errors.
- `packages/client-runtime/src/state/planReducer.ts` — fold current spec and compact spec commit events while retaining one snapshot document.
- `apps/server/src/mercurian/commitTree/schema.ts` and `CommitStore.ts` — domain `spec-revision`, persisted `issue-revision` compatibility codec, and assistant spec revisions under the existing fork/merge invariants.
- `apps/server/src/mercurian/planning/PlanningStore.ts` — spec payload decode, current/historical projection, human/assistant saves, tracker baselines, guarded refresh/reconciliation, and compact events.
- `apps/server/src/mercurian/planning/wire.ts` — spec/current/origin/refresh mappings.
- `apps/server/src/mercurian/assistant/PlanningAssistant.ts` — spec read/save MCP doors, registry-tip advancement, and standalone spec-reconciliation turns.
- `apps/server/src/mercurian/assistant/PlanningPrompt.ts` — behavior/approach register boundary, direct authority, tool-only artifact truth, and same-turn absorption instruction.
- `apps/server/src/mercurian/assistant/GroundingFold.ts` — hide spec artifact tool progress from grounding just as plan saves are hidden.
- `apps/server/src/mcp/toolkits/planning/tools.ts` and `handlers.ts` — `read_spec` and `save_spec_revision`.
- `apps/server/src/mercurian/trackers/connector.ts`, `TrackerStore.ts`, `connectors/registry.ts`, and `connectors/LinearConnector.ts` — single-origin issue lookup for refresh.
- `apps/server/src/ws.ts` — spec RPC handlers, scopes, event sequencing, and post-human-revision reconciliation start.
- `apps/server/src/auth/RpcAuthorization.ts` — get-spec read scope; save/refresh operate scope.
- `apps/web/src/state/mercurian.ts` — hooks for get/save/refresh spec.
- `apps/web/src/components/mercurian/PlanningSpace.tsx` — selected-path spec resolution, compact artifact picker, shared detail preference, checkpoint projection, composer boundary/edit state.
- `apps/web/src/components/mercurian/PlanArtifact.tsx` — share read-only/edit shell primitives with Spec without coupling their document shapes.
- `apps/web/src/components/mercurian/PlanTimeline.tsx` — spec vocabulary and direct assistant attribution.
- `apps/web/src/components/mercurian/PlanGraph.logic.ts` — projected checkpoint node metadata and summaries while retaining raw topology utilities.
- `apps/web/src/components/mercurian/PlanThread.logic.ts`, `PlanColumns.logic.ts`, `DagExplorer.logic.ts`, and `DagExplorer.tsx` — consume the selected graph, render checkpoint effects/state, detail control, stale badges, and exact-continuation/edit actions.
- `apps/web/src/components/mercurian/PlanPosition.logic.ts` — map checkpoint picks to raw continuation commits without changing canonical position semantics.
- `apps/web/src/components/mercurian/ImportIssueDialog.tsx` — preserve issue vocabulary before import and spec vocabulary after it lands.
- user/internal docs named in §12.

### New files

- `apps/web/src/components/mercurian/SpecArtifact.tsx` **(new)** — standing spec reader/editor/refresh surface.
- `apps/web/src/components/mercurian/SpecArtifact.logic.ts` **(new)** — pure selected-path snapshot, provenance labels, and stale-spec derivation.
- `apps/web/src/components/mercurian/SpecReconciliationDialog.tsx` **(new)** — base/local/upstream review and explicit resolution.
- `apps/web/src/components/mercurian/PlanCheckpoints.logic.ts` **(new)** — pure commit grouping, collapsed topology, effects, raw-to-checkpoint mapping, and continuation-boundary descriptions.
- matching focused `*.test.ts`/`*.test.tsx` files for each new logic/component module.

## Implementation Checklist

- [ ] Rename domain/wire/timeline vocabulary from issue revision to spec revision; keep `issue-revision` only in migration 001 and the persistence codec.
- [ ] Add `SpecDocument`, compact `PlanSpecRevision`, current/historical spec projections, origin/provenance, and typed refresh results to contracts.
- [ ] Implement ancestry-derived current and historical spec reads; ensure snapshot/event payloads never repeat all historical documents.
- [ ] Implement guarded human `saveSpecRevision` and assistant `saveAssistantSpecRevision`; retain generic assistant fork/merge refusals and remove all proposal/acceptance concepts.
- [ ] Add `read_spec` and `save_spec_revision`; map only active reply sessions, advance the registry tip after every save, and settle the terminal response on the final artifact commit.
- [ ] Update the planning prompt and MCP approvals so the assistant treats Spec as behavior, Plan as approach, commits changes through tools, and absorbs spec changes in the same turn.
- [ ] Add single-issue tracker lookup and pure base/local/upstream refresh classification; make unchanged upstream a no-op, converged tracker changes advance provenance, and divergent paths require explicit reconciliation.
- [ ] Start a follow-on reconciliation turn after committed human edit/refresh, but never after import or an in-turn assistant spec revision.
- [ ] Add path-aware Spec/Plan dropdown, blank-spec draft, historical read-only state, two-field prose editing with a six-line Goal surface, refresh, and reconciliation.
- [ ] Add pure checkpoint projection and make Checkpoints the default shared detail for Thread, Columns, and Graph; retain Commits as the raw audit view.
- [ ] Derive checkpoint authorship, effects, interrupted/unanswered state, and continuation target only from included commits.
- [ ] Add exact intermediate-boundary composer copy and edit-and-branch for earlier human queries without rewriting the original branch.
- [ ] Derive stale-spec branch tips from raw ancestry and map badges onto checkpoint nodes in the default detail.
- [ ] Replace visible artifact “issue” vocabulary with “spec” while preserving issue wording at tracker-origin boundaries.
- [ ] Update user and internal docs for direct spec authorship, commit-authoritative effects, checkpoints/commits detail, refresh, reconciliation, and issues as origins.
- [ ] Commit in reviewable slices, for example: `feat(server): add direct spec revisions (M-109)`, `feat(server): refresh tracker specs with reconciliation (M-109)`, `feat(web): add spec artifact and stale branches (M-109)`, `feat(web): group planning turns into checkpoints (M-109)`, and `docs: document specs and checkpoints (M-109)`.

## Test Plan

Use focused suites only, per repository guidance. Do not run repo-wide `vp check` or recursive tests.

### Commit store and planning store

- [ ] `apps/server/src/mercurian/commitTree/CommitStore.test.ts`
  - [ ] Stored `issue-revision` decodes as domain `spec-revision`; new domain writes round-trip through the compatibility codec.
  - [ ] Assistant spec appends succeed only on the current single-parent tip; attempted assistant forks and merges still refuse through generic invariants.
  - [ ] Human spec appends retain ordinary human structural behavior.
- [ ] `apps/server/src/mercurian/planning/PlanningStore.test.ts`
  - [ ] Import produces a published root spec with origin metadata and current spec projection.
  - [ ] Blank plan returns `spec: null`; first human or assistant direct revision becomes current only on descendants.
  - [ ] `getSpecAt` returns the nearest revision on each branch and the reconciled revision after a merge.
  - [ ] Human and assistant revision rows have correct authorship/cause; compact timeline events omit full historical documents.
  - [ ] Expected-base mismatch refuses atomically and writes no commit.
  - [ ] Refresh: unchanged → no row; clean or already-converged upstream change → one refresh row that advances the baseline; divergence → no row plus reconciliation payload; confirmed reconciliation → one row with live upstream baseline.
  - [ ] A race changing upstream or local base during review returns a fresh reconciliation and never overwrites.

### Tracker connector

- [ ] Focused `LinearConnector`, `TrackerStore`, and connector-registry tests
  - [ ] Single-issue lookup maps id/title/description/url/status exactly like browse and accepts provider-native shorthand.
  - [ ] Missing issue, expired auth, rate limit, malformed response, and unsupported provider map to typed tracker errors.
  - [ ] Refresh calls one issue endpoint and does not page through browse results.

### Assistant and MCP ordering

- [ ] `apps/server/src/mercurian/assistant/PlanningPrompt.test.ts`
  - [ ] Appendix names Spec behavior versus Plan approach, both read/save tool pairs, direct revision authority, tool-only truth, same-turn absorption, and human-only planning-space creation.
- [ ] `apps/server/src/mercurian/assistant/PlanningAssistant.test.ts`
  - [ ] `read_spec` reads at the active turn tip and refuses non-planning/coding sessions.
  - [ ] `save_spec_revision` commits an assistant spec revision and advances the registry tip.
  - [ ] Sequences `spec → plan → response`, `plan → spec → response`, and repeated saves are strictly linear in call order; terminal response parents the last revision.
  - [ ] Failed save does not advance the tip or let response prose claim an effect.
  - [ ] Stop/provider exit lands an interrupted terminal response after any successful artifact revisions.
  - [ ] Human/refresh reconciliation can save the plan and settle without rolling back its causal spec revision when the provider is unavailable.
- [ ] `apps/server/src/mcp/toolkits/planning/tools.test.ts`, `McpHttpServer.test.ts`, and approval-normalization tests
  - [ ] Exact `read_spec`/`save_spec_revision` names and schemas appear for every provider path.
  - [ ] Active reply sessions auto-approve both artifact read/save doors; implement and coding sessions cannot call spec tools.
  - [ ] No proposal or accept-spec tool remains.

### RPC and shared client state

- [ ] Focused websocket tests in `apps/server/src/server.test.ts`
  - [ ] Import subscription emits `spec-revision`, one current spec, and origin using new vocabulary.
  - [ ] Save/refresh emit one sequenced commit and typed result; follow-on assistant output is later in ancestry.
  - [ ] Historical get-spec reads require read scope; save/refresh require operate scope.
  - [ ] Remote/reconnected subscribers converge from snapshot plus events without duplicate documents or checkpoints on the wire.
- [ ] `packages/client-runtime/src/state/planReducer.test.ts`
  - [ ] Snapshot plus ordered/duplicate/gapped events converge for spec revisions.
  - [ ] A current spec document crosses once and compact history rows remain complete enough for checkpoint/staleness derivation.

### Checkpoint, continuation, and staleness logic

- [ ] `apps/web/src/components/mercurian/PlanCheckpoints.logic.test.ts`
  - [ ] Human query + zero/many assistant plan/spec revisions + terminal response becomes one checkpoint at the response commit.
  - [ ] Effect badges are derived from commits, deduplicated, and unaffected by response wording.
  - [ ] Human query without response is unanswered; partial response is interrupted; direct edit/refresh/merge/split/leaf remains legible.
  - [ ] Grouping never crosses a human act, fork, merge, or branch; parent checkpoint edges remain correct for forks and n-ary merges.
  - [ ] Every raw commit maps to exactly one checkpoint and unknown kinds degrade to singleton nodes.
  - [ ] Selecting a checkpoint resolves to its terminal/continuation commit.
  - [ ] Intermediate-boundary copy correctly reports included/excluded plan/spec effects and terminal response.
- [ ] Existing `PlanGraph`, `PlanThread`, `PlanColumns`, `DagExplorer`, and `PlanPosition` logic tests
  - [ ] Both projected and raw graphs preserve branch choices, merges, selection, current-path emphasis, and stable detail toggling.
  - [ ] Checkpoints default and one persisted Detail setting drives Thread, Columns, and Graph; zoom does not change it.
  - [ ] Newest spec revision marks only raw leaf paths outside its descendant closure; checkpoint mapping puts the badge on the correct default node; merge clears it; no spec means no badge.

### Web components

- [ ] `SpecArtifact` tests
  - [ ] Segmented pane persists; Plan remains default; selected branch shows its own spec and latest path shows the live spec.
  - [ ] Blank draft, direct edit, and tracker refresh call the correct guarded RPC; historical/active-turn states are read-only with accurate copy.
  - [ ] User and assistant attribution/cause labels use spec vocabulary.
- [ ] `SpecReconciliationDialog` tests
  - [ ] Base/local/upstream are visible; local seeds the editor; Use local/Use upstream are explicit; confirmation sends resolved content and expected base.
  - [ ] Cancel writes nothing; a refreshed conflict replaces stale review.
- [ ] `DagExplorer`/`PlanTimeline`/composer tests
  - [ ] Checkpoint rows show author, excerpts, effects, unanswered/interrupted state, and navigate to terminal commits.
  - [ ] Commits detail shows every underlying spec/plan/message commit and exact continuation boundary copy.
  - [ ] Edit-and-branch copies text/attachments, stands at the original query parent, announces the new branch, and leaves old history unchanged.
  - [ ] Tracker browse/import copy still says issue; post-import artifact, timeline, effects, and indicators say spec.

### Focused verification commands and surfaces

- [ ] Run only touched focused suites, for example:

  ```bash
  vp test run apps/server/src/mercurian/commitTree/CommitStore.test.ts
  vp test run apps/server/src/mercurian/planning/PlanningStore.test.ts
  vp test run apps/server/src/mercurian/assistant/PlanningAssistant.test.ts
  vp test run apps/server/src/mcp/toolkits/planning/tools.test.ts
  vp test run packages/client-runtime/src/state/planReducer.test.ts
  vp test run apps/web/src/components/mercurian/PlanCheckpoints.logic.test.ts
  vp test run apps/web/src/components/mercurian/SpecArtifact.logic.test.ts
  vp test run apps/web/src/components/mercurian/DagExplorer.logic.test.ts
  ```

- [ ] Run targeted lint/typecheck commands only for affected workspaces after implementation.
- [ ] Inspect representative snapshot/event fixtures with many spec revisions: the snapshot contains one current document, events contain at most one newly relevant document, and no checkpoint structure crosses the wire.
- [ ] If maintainers request an integrated visual pass, use `test-t3-app` once after implementation and only after permission: blank spec draft → assistant directly revises spec and plan → one checkpoint with two effects → Commits detail exact continuation → divergent branch stale badge → tracker refresh reconciliation. UI changes will require before/after images for a PR, but no PR is part of this planning task.

## Decision review notes

The choices most worth pressure-testing at implementation pickup are:

1. structured `{ goal, acceptanceCriteria }` prose snapshots, with legacy title/description decoding rather than a storage rewrite;
2. persistence-only `issue-revision` compatibility rather than a SQLite rewrite;
3. direct assistant spec writes through the existing turn registry, with generic fork/merge law as the safety boundary;
4. reconstructing checkpoints from immutable topology/authorship rather than persisting turn ids or checkpoint rows;
5. anchoring checkpoint identity/continuation on the terminal included commit;
6. base/local/upstream refresh provenance without a mutable tracker-content shadow.

Run `technical-plan-decision-review` if a separate adversarial pass is desired before implementation.
