# Technical Plan — M-109: Specs

_Generated from the pasted Goal/AC for Linear issue M-109. The full acceptance criteria remain on the issue; this document plans their implementation against the repository as it stands on 2026-08-13. Product intent is grounded in the almagest vault notes **Specs**, **Plans**, **Commit Tree**, **Issue Import**, **Issues**, **Trackers**, **Assistant**, **DAG Explorer**, **Right Sidebar**, and the rename record **Issue Revisions**._

**Goal, in one sentence:** generalize the imported-issue root that M-101 already writes into a path-specific **spec** artifact parallel to the plan, let people draft and accept spec revisions without giving the assistant any direct spec-write path, refresh tracker origins as append-only revisions with explicit reconciliation when local and upstream content diverge, and make branches that have not absorbed the newest spec revision visibly stale in the DAG Explorer.

## Pickup decisions and scope

### Pin the open placement decision: one artifact pane, segmented Spec | Plan

The vault deliberately leaves placement open and recommends a segmented artifact view. This plan **pins that recommendation for M-109**: the existing right-pane `artifact` view remains one of the two corner choices in `PlanningSpace.tsx`, and the pane itself gains **Spec | Plan** segments, with **Plan** as the first-open default. The other corner choice remains History. The selected artifact segment is remembered with the existing browser-local pane preference and follows the person across plans.

This is an implementation choice made at pickup, not a claim that the vault already resolved the Open Decision. If maintainers want the third-corner-icon alternative instead, decide that before implementation; the data and server design below do not change.

### The spec is a structured snapshot, not a second issue model

The built M-101 root already stores the exact two durable fields the artifact needs: `title` and Markdown `description`. M-109 renames and generalizes that snapshot as `SpecDocument`; an imported tracker issue derives into it, while a blank plan may create the same shape directly. Tracker status, labels, assignees, and other issue metadata remain outside the spec and outside Mercurian, preserving the narrow tracker boundary.

The plan title remains its own navigation identity. Import initializes it from the issue title as today, but later spec refreshes do **not** silently rename the plan; a refreshed spec title and the plan's navigational title may differ until someone deliberately renames plans in a future feature.

### Explicitly out of scope

- Tracker write-back or synchronization; refresh remains a manual pull.
- A separate spec table, spec event log, or spec-change timeline.
- Automatic cross-branch propagation. Spec revisions land on the current path; later human merges propagate them.
- Full merge creation or a spec-specific merge primitive. The refresh reconciliation described below lands one ordinary human-authored spec revision on the current path.
- The richer universal node popover tracked by M-129. M-109 supplies staleness facts and visible badges to all three existing DAG views; M-129 can later include the same fact in its popover without changing the model.
- A Mercurian planning surface on mobile. No such surface exists in `apps/mobile`; desktop wraps the web surface, and local web plus `app.t3.codes` use the same web bundle and websocket contracts.

## Conventions Detected

| Convention | Evidence | Confidence |
| --- | --- | --- |
| A planning space has one append-only, multi-parent commit history; artifact state is derived from full snapshots in commits rather than stored in a document row | `apps/server/src/mercurian/commitTree/CommitStore.ts`; `apps/server/src/mercurian/planning/PlanningStore.ts`; `docs/project/technical-plan-m-94-multi-parent-commit-model.md`; `technical-plan-m-100-plan-artifact-and-plan-revisions.md` | High |
| Commit kinds are domain facts with opaque kind-specific payloads owned by `PlanningStore`; all graph invariants are refusals in `CommitStore` | `commitTree/schema.ts`; `commitTree/CommitStore.ts`; `PlanningStore.ts` (`MessageCommitPayload`, `PlanRevisionCommitPayload`) | High |
| Current artifact content crosses once on `PlanDetail`/commit events; historical content is fetched once by commit to avoid quadratic websocket growth | `packages/contracts/src/mercurian.ts` (`PlanRevision`, `PlanDetail`, `PlanStreamItem`); `PlanningStore.getPlanTextAt`; `planReducer.ts` | High |
| Planning RPCs are declared in `packages/contracts/src/mercurian.ts` and `rpc.ts`, authorized explicitly, handled in `apps/server/src/ws.ts`, scheduled in `packages/client-runtime`, and wrapped by web hooks | End-to-end path for `savePlanRevision`, `getPlanTextAt`, `importPlan`; `RpcAuthorization.ts`; `mercurianPlanning.ts`; `apps/web/src/state/mercurian.ts` | High |
| Server-owned plan state is read through `mercurian.subscribePlan`: snapshot, sequenced commit events, synchronized marker; transient assistant frames ride the same stream | `PlanStreamItem`; `packages/client-runtime/src/state/planReducer.ts`; ADR 002 `docs/architecture/event-streaming-model.md` | High |
| External trackers are pull-only adapters behind `TrackerConnector`; issue browse is live, credentials stay in the secret store, and every tracker maps to the five-field `TrackerIssue` | `apps/server/src/mercurian/trackers/connector.ts`, `TrackerStore.ts`, `connectors/LinearConnector.ts`; `packages/contracts/src/mercurianTrackers.ts` | High |
| Linear can read a single issue by shorthand identifier with `issue(id: ...)`, so refresh need not scan or search the backlog | [Linear GraphQL documentation](https://linear.app/developers/graphql) | High |
| The assistant's only artifact powers are typed MCP tools approved for an active planning session; proposal-only flows keep pending output in the turn and require a separate human confirm RPC to write history | `apps/server/src/mcp/toolkits/planning/tools.ts`; `PlanningAssistant.ts`; M-107's `save_implement_proposal` + `confirmSplits` precedent | High |
| Mercurian web UI lives under `apps/web/src/components/mercurian/`, with pure `.logic.ts` helpers and co-located `*.test.ts(x)` tests; UI state that is personal and local uses schema-decoded local storage | `PlanningSpace.tsx`; `PlanGraph.logic.ts`; `DagExplorer.logic.ts`; `useLocalStorage.ts`; sibling tests | High |
| The existing right pane has two corner views, a persisted open/view choice, a shared resize model, and path-aware reads when the selected branch does not match the subscription's latest artifact | `PlanningSpace.tsx`; `PlanArtifact.logic.ts`; `getPlanTextAt`; M-106 plan | High |
| User-visible behavior is documented in `docs/user/`, architecture/vocabulary in `docs/internals/`; verification is focused with `vp test run <files>` and package-scoped typechecks, never repo-wide checks | `AGENTS.md`; `docs/user/projects-and-plans.md`; `docs/user/trackers.md`; `docs/internals/glossary.md` | High |
| Conventional commits use plain `feat(scope): ... (M-n)` / `fix(scope): ...`; issue work uses `venk/m-...` branches | Recent `git log`; existing M-94 through M-127 plans | High |

## Design

### 1. Generalize `issue-revision` into the domain's `spec-revision` without rewriting history

M-101 already writes imported issue content as the published root commit and M-123 already renders that root in the timeline. M-109 should reuse those rows; replacing them or creating a parallel artifact would violate the issue's mechanism-unchanged premise.

Rename the **domain and wire** kind to `spec-revision`:

- `apps/server/src/mercurian/commitTree/schema.ts`: `CommitKind` becomes `message | plan-revision | spec-revision | coding-session`.
- `apps/server/src/mercurian/planning/PlanningStore.ts`: `IssueRevisionCommitPayload`, `PlanIssueRevision`, and the `issue-revision` timeline arm become `SpecRevisionCommitPayload`, `PlanSpecRevision`, and `spec-revision`.
- `packages/contracts/src/mercurian.ts`: expose `SpecDocument`, `PlanSpecRevision`, and the `spec-revision` timeline arm. Retire the public `PlanIssueRevision` vocabulary.
- Web summaries, timeline labels, graph glyph labels, tests, docs, and comments say **spec**. The word **issue** remains in import, origin, tracker connection, and origin-link UI only.

Do **not** rebuild the `commits` table merely to rename the stored discriminator. Migration 001 is already deployed and its `CHECK` admits `issue-revision`, not `spec-revision`. Add a narrow persistence codec inside `CommitStore.ts`:

- `PersistedCommitKind` retains the historical literals, including `issue-revision`.
- Row decode maps persisted `issue-revision` → domain `spec-revision`.
- Insert encode maps domain `spec-revision` → persisted `issue-revision`.
- The rest of the server never sees the legacy name; it survives only in migration history and this storage adapter.

This preserves every existing root commit and avoids a risky SQLite table/foreign-key rebuild for a vocabulary change. Tests must pin both directions so a later cleanup cannot accidentally make old databases undecodable. No Mercurian migration is required for M-109.

### 2. Spec revisions are full snapshots with provenance

Define the artifact once in `packages/contracts/src/mercurian.ts` and mirror it in `PlanningStore.ts`:

```ts
SpecDocument = {
  title: string
  description: string
}
```

`SpecRevisionCommitPayload` holds the full `SpecDocument` plus optional provenance:

```ts
source?:
  | { kind: "import" }
  | { kind: "tracker-refresh" }
  | { kind: "tracker-reconciliation"; upstream: SpecDocument }
  | { kind: "human-edit" }
  | { kind: "assistant-proposal"; proposalCommitId: CommitId }
```

The whole snapshot follows the plan-revision precedent: current state is the nearest spec revision in the selected commit's ancestry, with `null` when no such commit exists. Full snapshots make branches independent and make a future merge's reconciled spec one ordinary revision rather than a patch replay problem.

`source` is optional on decode for M-101 roots already on disk. A root `spec-revision` with a matching `plan_origins` row and no source is treated as legacy `import`. This is compatibility at projection time, not a data rewrite.

For a normal import or refresh, the committed document itself is the last known upstream snapshot. A reconciliation may intentionally differ from upstream, so its source carries the upstream snapshot separately. This lets the next refresh distinguish “what the tracker last said” from “what this path accepted” without a mutable origin-content column or a second truth in `plan_origins`.

The timeline form stays constant-size: `PlanSpecRevision` carries commit facts, a user-facing cause (`import`, `refresh`, `reconciliation`, `human-edit`, `assistant-proposal`), and the origin issue id when applicable, but not every historical title/body. The current `SpecDocument` crosses once as `PlanDetail.spec`, and a historical document is read once through `getSpecAt`, symmetric with `planText`/`getPlanTextAt`. This removes M-101's root body card from the timeline, replacing it with a compact “Spec imported from M-109” row; the full contract is now where it belongs, in the standing Spec artifact.

### 3. Path-aware spec projection

Extend `PlanDetail` with:

- `spec: PlanSpecAt | null`, where `PlanSpecAt` is `{ revisionCommitId, document }`;
- `origin?: PlanOrigin`, exposing the stored `connectionId`, `issueId`, and `issueUrl` required by the Spec pane's Refresh and “Open in tracker” actions.

Extend commit events with optional `spec`, present only when the commit changed the spec. `planReducer.ts` folds it exactly as it folds `planText`. Messages and plan revisions leave it unchanged.

Add `PlanningStore.getSpecAt({ planId, commitId })`, walking ancestry backward to the nearest domain `spec-revision`, and the unary `mercurian.getSpecAt` RPC. In `PlanningSpace.tsx`, derive the visible ancestor path as today; if the whole-history snapshot's last spec revision is not the visible path's last spec revision, fetch the frozen `PlanSpecAt` once. A blank path returns `{ spec: null }`, not an empty document.

Keep the existing `getPlanTextAt` RPC rather than introducing a combined artifact read. The two reads are independently needed, immutable, and usually avoided; coupling them would resend whichever artifact the caller already has.

### 4. Make the acceptance gate structural

There are three human ways a spec revision can land and zero assistant ways:

1. **Direct edit/draft:** `mercurian.saveSpecRevision` writes the document the person edited in the Spec pane. This is how a blank plan drafts its first spec.
2. **Accept assistant proposal:** `mercurian.acceptSpecRevisionProposal` reads a proposal embedded in an assistant message and writes that exact document.
3. **Tracker refresh/reconciliation:** `mercurian.refreshSpec` writes a tracker snapshot directly when safe, or writes the person's explicit reconciliation after review.

All three append `authorKind: "human"` through new `PlanningStore` methods. There is intentionally no `saveAssistantSpecRevision` service method and no MCP tool that writes a spec commit.

Close the gate at the generic write boundary too: `CommitStore.writeCommit` refuses any `kind: "spec-revision"` with `authorKind: "assistant"` using `AssistantSpecRevisionError`, before insertion. This is the hard guarantee that an accidental future caller cannot bypass the workflow. Import remains human-authored because selecting/importing is a human act.

Every non-import write carries:

- the `parentCommitId` where the window currently stands;
- `expectedSpecRevisionCommitId: MercurianCommitId | null`, captured when the editor/proposal/reconciliation opened.

Inside the same transaction as append, `PlanningStore` recomputes the current path's spec revision id and refuses with `SpecRevisionOutdatedError` if it no longer matches. This prevents a second window, a newly accepted proposal, or a refresh from silently overwriting a spec the person did not review. The UI then reloads/reopens reconciliation against the new base.

As with plan edits, direct spec editing is offered only while standing live. A spec revision therefore cannot be the act that opens a branch; people open branches with messages, then revise the spec on that current path.

### 5. Assistant proposals live in conversation; acceptance creates the spec commit

Follow the M-107 proposal/confirm precedent but make the proposal durable because it belongs in the conversation record:

- Add `propose_spec_revision` and `read_spec` to `apps/server/src/mcp/toolkits/planning/tools.ts` and its handlers.
- `propose_spec_revision` accepts a complete `SpecDocument`; it never calls `PlanningStore`. The active `TurnRuntime` keeps the latest proposal, stamped server-side with the spec revision id at the turn's current tip.
- At settle, `appendAssistantMessage` stores the proposal as optional `MessageCommitPayload.specProposal = { document, baseSpecRevisionCommitId }`. It crosses on `PlanMessage`, so reconnecting or rebuilding the timeline retains it.
- Add both tool names to the exact approved planning MCP allowlist. They remain scoped to an active reply turn through `PlanTurnRegistry`, like `save_plan_revision` and `read_plan`.
- Update `planningSystemAppendix` to define the register boundary: the spec contains behavior/user story/acceptance criteria; the plan contains approach. It explicitly says the assistant may only **propose** a full spec revision through `propose_spec_revision`, never use `save_plan_revision` to smuggle contract changes into the plan and never claim a proposal was accepted.
- Extend rebuilt-session projection with spec-revision markers and the current spec once, alongside the current plan. A new session therefore knows both what it plans from and what it plans toward.

`PlanTimeline.tsx` renders `specProposal` inside the assistant message, adjacent to its reasoning, with **Review** and **Accept revision** actions. Acceptance calls `acceptSpecRevisionProposal` with the proposal message id, current path head, and expected base. The server decodes the proposal from that assistant-authored message, verifies it is in the current head's ancestry, and appends a human `spec-revision` whose source records `proposalCommitId`. The client derives “Accepted” by finding such a descendant revision; an unaccepted proposal remains honestly visible as proposed and lands nothing else. Review opens the same editor used by refresh reconciliation, allowing the person to adjust the document before saving it as a `human-edit` based on that proposal.

This design makes the negative AC testable: the assistant-facing door can produce only message payload, while the only store write is a human RPC and the commit store refuses assistant attribution regardless.

### 6. Refresh reads one origin issue and either appends or reconciles

Add an internal single-issue read without widening the public tracker browse RPC:

- `TrackerConnector.getIssue(token, issueId)` returns the existing five-field `TrackerIssue` or `TrackerIssueNotFoundRefusal`.
- `TrackerStore.getIssue({ connectionId, issueId })` resolves the connection/secret and maps refusals to typed `TrackerConnectionNotFoundError`, `TrackerAuthError`, `TrackerUnreachableError`, or new `TrackerIssueNotFoundError`.
- `LinearConnector.ts` adds a named, query-only `LINEAR_ISSUE_DOCUMENT` using `issue(id: $id)` and the same five-field selection as browse. Include it in `LINEAR_GRAPHQL_DOCUMENTS`, so the existing pull-only operation-type test continues to prove that no connector document writes tracker-ward.

`mercurian.refreshSpec` belongs to the planning RPC surface because it acts on a plan. `ws.ts` coordinates the boundaries: ask `PlanningStore` for the path's origin/current spec/baseline, fetch through `TrackerStore`, then pass the live snapshot back to `PlanningStore` for a guarded decision and append.

The server compares three documents:

- **base** — the latest tracker snapshot in spec-revision ancestry (legacy/import/refresh document, or `source.upstream` for a prior reconciliation);
- **local** — the current path's spec document;
- **upstream** — the just-fetched tracker title/description.

Outcomes are a discriminated `PlanSpecRefreshResult`:

- `unchanged`: upstream equals base; append nothing.
- `committed`: upstream differs from base and local equals base; append a human `tracker-refresh` spec revision on the named parent.
- `reconciliation-required`: upstream differs and local differs from base; append nothing and return `{ base, local, upstream, expectedSpecRevisionCommitId }`.

The Spec pane opens `SpecReconciliationDialog.tsx` for the third outcome. It shows base/local/upstream, provides explicit **Use local** and **Use upstream** choices, and an editable resolved title/body seeded from local (the non-destructive default). **Accept reconciliation** calls the same `refreshSpec` RPC with the reviewed upstream snapshot, resolved document, and expected spec revision id. The server re-fetches before append; if upstream or the path base moved, it returns a fresh reconciliation instead of accepting stale review. Otherwise it writes one `tracker-reconciliation` revision carrying the live upstream snapshot in provenance.

There is no blind overwrite, no mutable “latest issue” row, no polling, and no conflict markers written into the contract. A closed dialog writes nothing; Refresh can be run again.

### 7. Every landed spec revision starts plan absorption, not restart

After `saveSpecRevision`, `acceptSpecRevisionProposal`, or a committed `refreshSpec`, `ws.ts` starts a normal planning turn from the new spec commit through a new `PlanningAssistant.startSpecReconciliation` entry point. The spec write succeeds independently; an unavailable model produces the existing `turn-refused` frame rather than rolling the contract back.

Add pure `specReconciliationTurnInput` assembly in `PlanningPrompt.ts`. It includes the previous and current spec snapshots and instructs the assistant to:

- absorb the changed contract into the existing plan;
- call `read_plan`, then `save_plan_revision` only if the plan needs revision;
- explain the reconciliation in its reply;
- preserve prior planning that remains valid rather than restart.

This is a provider stimulus, not a synthetic human message. The spec revision is already the durable cause in the timeline; assistant plan revisions and the settled assistant reply append after it on the same path. Rebuilt sessions project spec revisions, so reconnect/restart remains coherent.

Only one turn may run per plan. The spec mutation RPCs share `requireNoActiveTurn` with plan edits and are serialized on the existing per-plan client scheduler key. The assistant therefore always reconciles a fixed parent chain, and the commit store's assistant-fork refusal remains the concurrency backstop.

### 8. The right pane renders two artifacts in one standing view

In `PlanningSpace.tsx`:

- Extend the schema-decoded pane preference to remember `artifact: "spec" | "plan"`; bump the storage key to `v2` rather than accepting a half-decoded legacy shape. Default `{ open: true, view: "artifact", artifact: "plan" }`.
- Keep the two corner icons **Artifact** and **History**. Inside Artifact, render a compact `ToggleGroup` for **Spec | Plan**.
- `PlanArtifact.tsx` remains plan-only. Add `SpecArtifact.tsx` **(new)** using the same sanitized Markdown/read-edit structure, with title input, Markdown description editor, current revision attribution, origin link, and Refresh when an origin exists.
- A blank plan's Spec segment says “No spec yet — draft the contract” and offers Draft. Saving creates its first human spec revision through the same guarded RPC; there is no special blank-plan table or creation flow.
- Looking at an earlier commit makes both artifact segments read-only and shows **Back to now**. Historical spec content comes through `getSpecAt` only when needed.

The pane width model, overlay threshold, responsive stacked layout, and desktop/web behavior remain shared. No third right pane and no continuously repainting UI are introduced.

### 9. Timeline and DAG vocabulary become spec vocabulary

Update all user-visible readings of the old root:

- `PlanTimeline.tsx`: “Spec imported from M-109”, “You revised the spec”, “Spec refreshed from M-109”, or “You accepted the assistant's spec revision”. Never “Imported issue” for the artifact commit.
- `PlanGraph.logic.ts`: spec summaries use the same vocabulary; detail explains cause without carrying the historical body.
- `DagExplorer.tsx`: spec glyph/accessible label/row labels say spec.
- `ImportIssueDialog.tsx` continues to say **issue** while browsing and selecting tracker origins; after import, it navigates to a plan whose root is a spec revision.
- Settings and `docs/user/trackers.md` continue to say issues for tracker backlog items and origin links.

### 10. Derive stale-spec branches from the DAG already on the client

No server flag or second read is required. Add pure helpers in `PlanGraph.logic.ts`:

- `latestSpecRevision(graph)`: highest-sequence `spec-revision` in the history.
- `specStalenessAt(graph, commitId)`: returns that revision when it is not in `commitId`'s ancestor closure, otherwise `null`.
- `staleSpecTips(graph)`: evaluates graph tips, which are the branches a person can actually continue.

A branch is therefore stale exactly when its tip does not descend from the newest spec revision. A merge that includes the revised path clears the indicator naturally because the spec revision enters the merged tip's ancestry. No timestamps, mutable branch flags, or special propagation exist.

Render **Spec changed off this branch** in all existing Explorer readings:

- Thread: a badge/banner for the checked-out tip and badges on sibling branch choices.
- Columns: a badge on each stale terminal/branch option.
- Graph: a small warning ring/badge on stale tips and the same sentence in the existing detail overlay.

Do not badge every commit on a stale line; that adds noise and suggests staleness is a stored property of historical nodes. The branch tip is the actionable place. M-129's node popover can consume `specStalenessAt` later.

### 11. Surface and documentation coverage

- **Web, local and remote:** all functionality uses the existing typed websocket surface and primary-environment runtime; no baked origin or local-only server call.
- **Desktop:** receives the web implementation unchanged through the Electron wrapper; no IPC is required.
- **Mobile:** no Mercurian planning routes/components exist, so there is no M-109 entry point to update. The shared contracts/reducer remain mobile-safe for the future.
- **Providers:** Codex, Claude, Cursor, Grok, and OpenCode see the same planning MCP toolkit. The exact tool-name normalization/approval tests must cover `read_spec` and `propose_spec_revision`; no adapter-specific implementation is added.
- **Reverse states:** proposals may remain unaccepted; reconciliation may be cancelled without writes; blank specs can be created and later revised; tracker refresh reports unchanged rather than minting no-op commits.
- **Docs:** update shipped behavior in `docs/user/projects-and-plans.md` and `docs/user/trackers.md`; rename/add spec, spec revision, and refresh/reconciliation vocabulary in `docs/internals/glossary.md`; update the Mercurian planning/tracker seams in `docs/internals/overview.md`.

## File and module layout

### Existing files to change

- `packages/contracts/src/mercurian.ts` — spec document/current/revision/proposal shapes; three spec mutation RPC inputs/results; `getSpecAt`; plan detail/origin and commit-event extensions; public vocabulary rename.
- `packages/contracts/src/mercurianTrackers.ts` — `TrackerIssueNotFoundError` only; the internal single-issue read does not become a browse RPC.
- `packages/contracts/src/rpc.ts` — register save/accept/refresh/get-spec RPCs and errors in `WsRpcGroup`.
- `packages/client-runtime/src/state/mercurianPlanning.ts` — schedule the three mutations on `serialPerPlan`; add frozen `getSpecAt` read.
- `packages/client-runtime/src/state/planReducer.ts` — fold `event.spec`; proposal content arrives on the ordinary message commit and needs no transient reducer state.
- `apps/server/src/mercurian/commitTree/schema.ts` — domain `spec-revision` name.
- `apps/server/src/mercurian/commitTree/CommitStore.ts` — persisted-kind compatibility codec and `AssistantSpecRevisionError` invariant.
- `apps/server/src/mercurian/planning/PlanningStore.ts` — spec payload/projection/ancestry reads, origin exposure, guarded human write paths, proposal acceptance, tracker baseline comparison, compact timeline events.
- `apps/server/src/mercurian/planning/wire.ts` — spec/current/origin/proposal/result mappings.
- `apps/server/src/mercurian/trackers/connector.ts` — internal `getIssue` seam and not-found refusal.
- `apps/server/src/mercurian/trackers/TrackerStore.ts` — authenticated single-issue read.
- `apps/server/src/mercurian/trackers/connectors/LinearConnector.ts` — query-only single-issue document/decoder.
- `apps/server/src/mercurian/assistant/PlanningPrompt.ts` — spec context, register boundary, and absorption prompt.
- `apps/server/src/mercurian/assistant/PlanningAssistant.ts` — proposal-only runtime/tool handlers, durable proposal-on-message settle, spec read, and reconciliation turn entry point.
- `apps/server/src/mcp/toolkits/planning/tools.ts` and `handlers.ts` — `read_spec` and `propose_spec_revision`.
- `apps/server/src/mcp/McpHttpServer.test.ts` — mock service completeness for the added assistant methods.
- `apps/server/src/ws.ts` — RPC handlers, tracker/store coordination, and post-commit reconciliation turn.
- `apps/server/src/auth/RpcAuthorization.ts` — `getSpecAt` read scope; save/accept/refresh operate scope.
- `apps/server/src/server.test.ts` — websocket integration for typed spec flows and tracker refresh.
- `apps/web/src/state/mercurian.ts` — hooks for spec reads/mutations.
- `apps/web/src/components/mercurian/PlanningSpace.tsx` — path-aware spec read, segmented artifact pane preference, actions, and reconciliation dialog state.
- `apps/web/src/components/mercurian/PlanTimeline.tsx` — spec vocabulary and durable assistant proposal card.
- `apps/web/src/components/mercurian/PlanGraph.logic.ts` — spec summaries and pure staleness derivation.
- `apps/web/src/components/mercurian/DagExplorer.tsx` — staleness rendering in Thread, Columns, and Graph plus spec glyph/vocabulary.
- `apps/web/src/components/mercurian/ImportIssueDialog.tsx` — comments/copy at the boundary only if they currently call the root an issue artifact; browse terminology remains issue.
- `docs/user/projects-and-plans.md`, `docs/user/trackers.md`, `docs/internals/overview.md`, `docs/internals/glossary.md` — behavior and vocabulary described above.

### New files

- `apps/web/src/components/mercurian/SpecArtifact.tsx` **(new)** — the standing spec reader/editor/refresh header, beside `PlanArtifact.tsx` because the two are segments of the same pane.
- `apps/web/src/components/mercurian/SpecArtifact.logic.ts` **(new)** — pure revision attribution, path/snapshot match, proposal acceptance lookup, and reconciliation view-model helpers.
- `apps/web/src/components/mercurian/SpecArtifact.logic.test.ts` **(new)** — co-located pure tests.
- `apps/web/src/components/mercurian/SpecReconciliationDialog.tsx` **(new)** — explicit three-input review and editable resolved document, beside `ImportIssueDialog.tsx` as the other tracker-to-plan boundary dialog.
- `apps/web/src/components/mercurian/SpecReconciliationDialog.test.tsx` **(new)** — user-act tests for cancel/choose/edit/accept.

No database migration, new dependency, new table, mobile module, desktop IPC, or tracker write method is added.

## Implementation Checklist

- [ ] Work on `venk/m-109-specs`.
- [ ] Rename the domain/wire/timeline vocabulary from issue revision to spec revision; keep `issue-revision` only as the persisted compatibility literal in migration 001 and the `CommitStore` codec.
- [ ] Add round-trip tests proving old persisted issue roots decode as domain specs and new domain spec writes remain readable on the old schema.
- [ ] Add `AssistantSpecRevisionError` in `CommitStore.writeCommit`; prove every assistant-authored spec append/root refuses and equivalent human writes succeed.
- [ ] Introduce `SpecDocument`, compact `PlanSpecRevision`, `PlanSpecAt`, proposal/provenance shapes, `PlanDetail.spec`, and `PlanDetail.origin` in contracts and planning projection.
- [ ] Add path-aware `PlanningStore.getSpecAt` and `mercurian.getSpecAt`; wire read authorization, client command, hook, and one-shot branch lookup.
- [ ] Add `saveSpecRevision` for direct human edits/drafting with explicit parent and expected-base guard; no assistant equivalent.
- [ ] Add durable `MessageCommitPayload.specProposal`, `read_spec`, and proposal-only `propose_spec_revision`; approve exact provider tool spellings and stamp the base spec server-side.
- [ ] Add `acceptSpecRevisionProposal`; read the assistant message's proposal server-side, require it on the current ancestry, enforce expected base, and append one human spec revision referencing the proposal commit.
- [ ] Extend rebuilt planning transcripts/system appendix with current spec, spec-revision markers, and the behavior-vs-approach rule.
- [ ] Add `TrackerConnector.getIssue`, `TrackerStore.getIssue`, typed not-found handling, and Linear's query-only `issue(id:)` document with the existing five-field mapping.
- [ ] Add `refreshSpec` result union and guarded base/local/upstream algorithm; no-op unchanged content, direct append without local divergence, explicit reconciliation otherwise.
- [ ] Add `PlanningAssistant.startSpecReconciliation` and pure prompt assembly; call it after every landed non-import spec revision without making the spec write conditional on assistant availability.
- [ ] Extend `PlanStreamItem` and `planReducer` so current spec updates arrive on the existing plan subscription; do not start another stream or resend historical spec bodies.
- [ ] Pin the segmented artifact pane in `PlanningSpace.tsx`, remember Spec/Plan with a `v2` schema-decoded preference, and retain Plan as default.
- [ ] Add `SpecArtifact.tsx` for imported, blank, current, and historical states; origin link and Refresh appear only for imported plans.
- [ ] Add durable proposal review/accept UI in the assistant timeline and `SpecReconciliationDialog.tsx` for refresh/local collisions; cancellation writes nothing.
- [ ] Replace every user-visible artifact label “issue”/“issue revision” with “spec”/“spec revision” while retaining issue language in tracker browse/import/origin contexts.
- [ ] Derive stale branch tips in `PlanGraph.logic.ts` and render “Spec changed off this branch” in Thread, Columns, and Graph; merges clear it through ancestry alone.
- [ ] Update user and internal docs; explicitly describe refresh as manual pull, proposal acceptance as the only assistant-originated landing path, and issues as tracker origins only.
- [ ] Do not add a spec table, spec event log, polling/sync loop, automatic branch propagation, database migration, new merge primitive, mobile surface, desktop IPC, or dependency.
- [ ] Commit in reviewable slices, for example: `feat(server): spec revisions and human acceptance gate (M-109)`, `feat(server): refresh tracker specs with reconciliation (M-109)`, `feat(web): spec artifact proposals and stale-branch indicators (M-109)`, and `docs: document specs and refresh behavior (M-109)`.

## Test Plan

Use focused `vp test run <files>` invocations and package-scoped typechecks/lint only; do not run repo-wide checks.

### Commit store and planning store

- [ ] `apps/server/src/mercurian/commitTree/CommitStore.test.ts`
  - [ ] Existing `issue-revision` database rows decode as domain `spec-revision`; a new domain spec revision persists through the compatibility codec and round-trips.
  - [ ] Assistant-authored spec root and append both refuse with `AssistantSpecRevisionError`; human import/edit/refresh shapes succeed.
  - [ ] Existing assistant message/plan-revision behavior and fork/merge refusals are unchanged.
- [ ] `apps/server/src/mercurian/planning/PlanningStore.test.ts`
  - [ ] Imported M-101-style roots project as current specs, preserve origin, remain published, and leave `planText` empty.
  - [ ] A blank plan returns `spec: null`; its first direct save lands a human spec revision and later saves derive by ancestry.
  - [ ] Two branches derive different specs; `getSpecAt` returns the nearest revision on each path and `null` above the first spec.
  - [ ] Timeline events stay compact while snapshot/commit event carries the current document once.
  - [ ] Direct edit refuses when expected base moved or a planning turn is active.
  - [ ] Accept proposal reads the document from an assistant message, requires proposal ancestry/current base, attributes the landed revision human, and records the proposal id.
  - [ ] A forged/missing/human-message proposal refuses; no rejection path writes a commit.
  - [ ] Refresh comparison: unchanged → no row; clean upstream change → one refresh commit; local divergence → no row plus reconciliation payload; accepted reconciliation → one commit with upstream baseline preserved.
  - [ ] A concurrent spec revision between refresh review and acceptance returns a fresh conflict/refusal rather than overwriting.
  - [ ] Legacy imported roots with no provenance still establish the tracker baseline.

### Tracker adapter

- [ ] `apps/server/src/mercurian/trackers/connectors/LinearConnector.test.ts`
  - [ ] Single-issue query maps id/title/description/url/status exactly like browse and accepts a shorthand id.
  - [ ] `null` issue maps to not found; GraphQL auth and transport errors keep their existing distinctions.
  - [ ] Every document including `LINEAR_ISSUE_DOCUMENT` parses as a query, never a mutation/subscription.
- [ ] `apps/server/src/mercurian/trackers/TrackerStore.test.ts`
  - [ ] `getIssue` resolves connection and secret, passes the origin issue id, and returns typed missing-connection/auth/unreachable/not-found failures without storing issue content.

### Assistant and MCP gate

- [ ] `apps/server/src/mercurian/assistant/PlanningPrompt.test.ts`
  - [ ] Appendix names Spec vs Plan roles, read/propose tools, and the no-unilateral-commit rule.
  - [ ] Rebuilt transcript carries current spec once and labels accepted spec revisions without duplicating every historical body.
  - [ ] Reconciliation prompt says absorption, includes before/after contract, and instructs plan revision rather than restart/spec rewrite.
- [ ] `apps/server/src/mercurian/assistant/PlanningAssistant.test.ts`
  - [ ] `propose_spec_revision` from an active reply persists only on the settled assistant message; repeated calls use the last complete proposal.
  - [ ] Coding/non-active threads cannot read or propose specs.
  - [ ] Proposal tool never changes spec state or advances the turn tip before the assistant message settles.
  - [ ] `startSpecReconciliation` emits ordinary turn frames, can save a plan revision, and refuses cleanly when model/instance is unavailable without undoing the spec commit.
  - [ ] Codex/Claude/OpenCode tool-name normalization approves the two new tools and still rejects unknown dynamic tools.
- [ ] `apps/server/src/mcp/McpHttpServer.test.ts` and planning toolkit tests — schemas/titles/handlers expose proposal/read only; no `save_spec_revision` tool exists.

### RPC and shared client state

- [ ] `apps/server/src/server.test.ts`
  - [ ] Import subscription emits compact root `spec-revision` plus `PlanDetail.spec`/origin using spec vocabulary.
  - [ ] Save/accept/refresh RPCs stamp server time, return typed results/errors, emit one sequenced spec commit, and start reconciliation only after a commit.
  - [ ] Refresh uses the plan origin and internal single-issue read; disconnected/missing origin cases are typed and append nothing.
  - [ ] Resume/snapshot behavior folds spec commits exactly once across two windows.
- [ ] `packages/client-runtime/src/state/planReducer.test.ts`
  - [ ] Spec commit updates current spec/timeline/sequence once; replay is ignored; message/plan revision leaves spec untouched.
  - [ ] Assistant proposal survives as ordinary message content across snapshot and event paths.
- [ ] Contracts build plus authorization coverage proves all four new RPC tags are in `WsRpcGroup` and `RPC_REQUIRED_SCOPES` with the intended read/operate scopes.

### Web logic and components

- [ ] `apps/web/src/components/mercurian/SpecArtifact.logic.test.ts`
  - [ ] Whole-history spec is reused only when its last revision matches the visible path; divergent paths trigger `getSpecAt`.
  - [ ] Proposal acceptance is derived only from a descendant spec revision naming the proposal.
  - [ ] Import/refresh/human/proposal causes produce the exact spec vocabulary.
- [ ] `apps/web/src/components/mercurian/SpecReconciliationDialog.test.tsx`
  - [ ] Base/local/upstream are all visible; local seeds the editor; Use local/Use upstream are explicit; editing and accepting returns the resolved document.
  - [ ] Cancel/close writes nothing; a refreshed conflict replaces stale review rather than silently accepting it.
- [ ] `apps/web/src/components/mercurian/PlanGraph.logic.test.ts`
  - [ ] Linear history with latest spec in ancestry is current.
  - [ ] Sibling branch whose tip lacks the newest spec is stale; revised branch is current.
  - [ ] Human merge with the spec-revised parent clears staleness; an older spec on the branch does not mask a newer off-branch one.
  - [ ] No spec revisions means no stale indicator.
- [ ] `apps/web/src/components/mercurian/PlanTimeline.test.tsx` — import/refresh/edit/accepted-proposal rows say spec; assistant proposal buttons call review/accept; tracker browse language remains issue.
- [ ] DAG Explorer focused component/logic tests — Thread, Columns, and Graph expose the stale-tip indicator and accessible sentence without badging every historical node.
- [ ] `PlanningSpace` focused tests (extract pure preference/path logic if needed) — first open is Artifact → Plan, selection persists across plans, Spec works for imported/blank/historical paths, and History remains the other corner toggle.

### Verification and surfaces

- [ ] Run targeted package typechecks for contracts, client-runtime, server, and web, plus lint/format for touched files.
- [ ] Review payload shape with tests/fixtures containing many spec revisions: snapshot and each commit event carry at most one current document, never all historical documents.
- [ ] Confirm web/local/remote use only websocket RPCs and desktop needs no special path; record mobile as not applicable because no Mercurian planning surface exists there.
- [ ] If maintainers request an integrated visual pass, use `test-t3-app` once after implementation (with permission per `AGENTS.md`) to exercise: blank spec draft → assistant proposal → explicit acceptance → divergent branch stale badge → tracker refresh reconciliation. UI changes will need before/after images for a PR, but no PR is part of this planning task.

---

_Decision-review note: the choices most worth pressure-testing are the structured `{title, description}` spec snapshot, retaining `issue-revision` only as a persistence codec instead of rebuilding SQLite, persisting assistant proposals inside their message commit, the base/local/upstream refresh protocol, and marking stale branch tips rather than every stale-path commit. Run `technical-plan-decision-review` if you want a separate adversarial pass over those calls._
