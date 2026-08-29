# Technical Plan — M-181: Project memory: amendments

Generated from the Goal/AC of [M-181](https://linear.app/mercurian/issue/M-181/project-memory-amendments) on branch `venk/m-181-project-memory-amendments`, stacked on M-180 (`venk/m-180-project-memory-designation-and-grounded-reading`, PR #82). Goal in a sentence: what planning decides returns to memory as reviewed amendments — the assistant proposes, a human confirms, and the confirmed change lands as a commit in the memory's own git history, attributed to the plan. The issue also asks two adjacent doors to open: memory-note Open Decisions surfacing as suggested next messages, and direct in-product note editing. The Goal flags one open decision — whether a confirmed amendment also lands in the plan's history — to be resolved during planning; §6 resolves it.

Design authority: the almagest vault's **Memory** note (Amendments, Open Decisions in memory, Staleness sections), **Splits** ("the confirmation is the human act"), **Commit Tree** invariants (assistant never writes structure; proposal-acceptance is the reserved path), and **Composer** (suggested next messages; memory ODs as the deterministic third source). The Assistant note's permission-modes resolution ("if the assistant ever gains write actions beyond the planning space, this reopens") is honored by construction: the assistant gains no write action — it gains a proposal tool, and every write is a human-confirmed command.

## Conventions Detected

| Convention                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                  | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Assistant proposals are MCP tool calls, never parsed reply text                                                                                                                                                             | `save_implement_proposal` — `apps/server/src/mcp/toolkits/planning/tools.ts:86`, handler `handlers.ts:35`, stash `PlanningAssistant.ts:1742` ("do not treat narration as the result" in `PlanningPrompt.ts:222-236`)      | High       |
| Model emits plain strings; server projects to typed identity at settle; the human's confirm command is what lands                                                                                                           | `settleImplement` `PlanningAssistant.ts:583-743`; `confirmSplits` `ws.ts:2190-2229`                                                                                                                                       | High       |
| Proposals are transient: in-memory `Map<PlanId, …>` + stream frames, folded onto `PlanDetail` in `subscribePlan`; no clock expiry, discrete invalidation events only                                                        | `PlanningAssistant.ts:466,1624-1666`; `ws.ts:2469-2482`; `planReducer.ts:203-297`; design record `technical-plan-m-107-…md:92`                                                                                            | High       |
| New commit _kinds_ need a migration (frozen SQL `CHECK`); flavored payloads on existing kinds don't                                                                                                                         | `001_CommitGraph.ts:31` CHECK pinned by tests; `spec-revision` encoded down at `CommitStore.ts:255-267`; `split` stamp on `plan-revision` (`PlanningStore.ts:112-122`) resolved on the Splits vault note as the precedent | High       |
| Immutable external identity goes in `payload_json`; mutable/late facts go in commit-keyed side tables                                                                                                                       | spec `issueId` in payload (`PlanningStore.ts:177-187`) vs `coding_sessions` / `plan_origins` side tables (`010_CodingSessions.ts`, `008_PlanOrigins.ts`)                                                                  | High       |
| Confirm commands are guarded by `activeChainMember` before payload validation; commits land `authorKind: "human"` on confirmation                                                                                           | `PlanningStore.ts:2038-2040`, `saveSplits` `:2071-2098`                                                                                                                                                                   | High       |
| Diffs: server emits a unified patch string; web parses with `getRenderablePatch` → Pierre components; no client diff lib                                                                                                    | `apps/web/src/lib/diffRendering.ts:110`; `StyledDiffCodeView.tsx`; contracts carry `diff: Schema.String` (`review.ts:16-26`)                                                                                              | High       |
| Markdown document editing is a plain `<textarea>` with Edit/Cancel/Save, no-op guarded, refusal notice inline; Lexical is composer-only                                                                                     | `PlanArtifact.tsx:67-85,206`; `SpecArtifact.tsx:74-91`; sole Lexical consumer `ComposerPromptEditor.tsx`                                                                                                                  | High       |
| Memory writes: `fs.writeFileString` + `git add` + `git commit --only -m … -- <paths>` via `processRunner`, then `cache.delete(rootPath)`; non-git roots write without committing; no `--author` override (ambient identity) | `MemoryIndex.ts:245-280` (`generateProductMap`)                                                                                                                                                                           | High       |
| Memory wire: contracts types cross unmapped; handlers inline in `ws.ts` wrapped in `observeRpcEffect`, domain errors passed through, everything else wrapped in `MercurianMemoryError`                                      | `ws.ts:2651-2748`; `mercurianMemory.ts`; `wire.ts`                                                                                                                                                                        | High       |
| Auth: reads → `AuthOrchestrationReadScope`, mutations → `AuthOrchestrationOperateScope`                                                                                                                                     | `RpcAuthorization.ts:53-56,74-79`                                                                                                                                                                                         | High       |
| Pure prose-convention parsers live in `memoryModel.ts` and strip code first                                                                                                                                                 | `stripMarkdownCode`/`parseWikilinks`/`parseContainsLines` (`memoryModel.ts:33-62`)                                                                                                                                        | High       |
| Composer surface state: menu/mention/suggestion-shaped things derived client-side in pure `.logic.ts` files; drafts in `planComposerStore`                                                                                  | `PlanComposer.logic.ts`, `planMentions.logic.ts`, `planComposerStore.ts:280-343`                                                                                                                                          | High       |
| Tests: `@effect/vitest` `layer(...)` + `it.effect` with real git/FS temp dirs for the memory module; pure logic in `describe/it`; web `.logic.test.ts` + catalog four-place registration                                    | `MemoryIndex.test.ts:38-59,124`; `memoryModel.test.ts`; `catalog.test.ts`, `coverage.test.ts`                                                                                                                             | High       |
| Commit messages: sentence subjects in design terms                                                                                                                                                                          | `"Generate product map from containment declarations"` (`MemoryIndex.ts:262`); repo git log                                                                                                                               | High       |

Gaps the AC outruns: **suggested next messages do not exist anywhere in the product** (verified — no derivation, contract, or component; the vault itself records "the composer surfaces no suggested next messages"). This plan builds the first, deliberately minimal, with memory ODs as its only source. There is also **no Open Decisions parser** and **no file-backed markdown editor** — both new here, both placed beside their nearest kin.

## 1. Design

### 1.1 The proposal rides the reply turn

Splits use a dedicated one-shot `flavor: "implement"` turn because the human invokes an analysis. Amendments are different by design: they "propose at the moments planning earns them … never as ambient churn" — which means they arise **inside ordinary conversation**, usually because the human just asked for one (often via a suggested next message). So no new turn flavor. Instead the ordinary reply turn's MCP toolkit gains one tool, `propose_memory_amendment`, and the reply prompt gains a stanza (emitted only when the project has a designated memory) telling the assistant what an amendment is and when to propose one: when the human asks, or when the conversation has just resolved something memory records — and that a proposal accompanies the reply, never replaces it, and that proposing is not writing.

The tool takes **plain strings** (the splits contract shape):

- `title` — one line, design terms; becomes the memory commit subject.
- `notes` — array of `{ name, markdown }`, each the **full new content** of one note (full snapshot, the `plan-revision` precedent). A name that doesn't exist in the index is a new note (a red-link fill is exactly this); an existing name is an edit.
- `placements` — optional array of `{ map, parent, note }`: insert `note` as a child of `parent` in the named map's arrangement.

Handler stashes the raw payload as `pendingMemoryAmendment` on the live reply `TurnRuntime` (last call wins), gated exactly like `saveImplementProposalFromThread` — live, non-settling reply turn only. Nothing publishes.

### 1.2 Settle-time projection and validation

At reply settle (alongside the existing settle path), a pending payload is projected against real identity, mirroring `settleImplement`:

1. Resolve the plan's project and its designated memory source; none → the proposal is dropped and a refusal notice frame is published (the assistant proposed against nothing).
2. Note names must be non-empty, unique, valid as file stems (no path separators, no leading dot, no `.md` suffix); each resolves to its indexed path or, for a new note, `<root>/<name>.md`.
3. **Open-Decision preservation (the AC's non-deletion rule, enforced, not requested):** for every edited note, each `### ` heading inside the old content's `## Open Decisions` section must still appear in the new content. A proposal that deletes a question is refused as invalid — resolving lands a recorded resolution or it doesn't land.
4. Placements: the named map must exist and parse; `parent` must be present in its arrangement; `note` must not already appear in the map; and the prose-edge rule must hold **against the post-amendment graph** (the new note's markdown typically carries the `[[parent]]` link — validated here so a confirmed amendment can never land a map refusal).
5. Changes are materialized as `{ path, before, after }` (before `null` for new files; map changes reserialized via the existing parse→mutate→`serializeMemoryMap` path), and a **unified patch string** is computed server-side for rendering (§1.3), plus a base fingerprint per touched file for the drift guard (§1.5).

The projected proposal — `{ turnId, title, kind summary, changes, patch, placements }` — is stored in an in-memory `Map<PlanId, MemoryAmendmentProposal>` and published as a transient `memory-amendment-proposed` stream item; `subscribePlan` folds it onto `PlanDetail.memoryAmendmentProposal` so a window joining mid-proposal sees it. Validation failure publishes a `memory-amendment-failed` frame naming the reason (loud refusal, never silent).

### 1.3 The rendered diff

The wire shape is the established one: a unified patch string the client hands to `getRenderablePatch` → `StyledDiffCodeView`. The server synthesizes it per changed file by writing `before`/`after` to scratchpad temp files and running `git diff --no-index --src-prefix … --dst-prefix …` (exit code 1 = differences, not an error), normalizing headers to memory-relative paths (`Memory.md`, `maps/product.yaml`). New notes render as all-addition file diffs. This keeps diff computation server-side and adds no dependency anywhere. Reserializing a map loses hand-authored YAML formatting; the diff shows exactly what will land, so the cost is visible, and dogfood maps are product-generated anyway — accepted, noted in the user doc.

### 1.4 One pending proposal per plan; discrete invalidation

Same lifecycle as the implement proposal, same reducer shape:

- A new reply turn starting on the plan supersedes it (client clears on `turn-started`; server clears when stashing a new pending payload or at teardown).
- **Decline** = `cancelMemoryAmendment` → `memory-amendment-cancelled` (turn-id matched) — nothing lands anywhere, matching the AC literally: decline is a transient act, not a commit.
- **Confirm** clears it server-side; the landed commit arriving on the stream is the client's closing signal (the `closesImplementProposal` pattern).
- An interrupted reply turn drops its pending payload unprojected — an interrupted proposal never happened.

No editing inside the proposal card in v1: the diff is a review surface; refinement is conversational ("tighten the second paragraph") and re-proposal replaces. This is where amendments deliberately differ from split cards, whose text the human finishes; an amendment's text is note content the human can also revise directly after landing (§1.7).

### 1.5 Confirmation lands two commits

`confirmMemoryAmendment { planId, parentCommitId }` — guarded by `activeChainMember` first (the `saveSplits` order), then:

1. Look up the stored proposal (`no-proposal` refusal otherwise). Re-resolve the memory source.
2. **Drift guard:** every touched file's current disk content must still match the proposal's recorded base. Any mismatch → `memory-changed` refusal; the proposal stays standing so the human can decline it and re-ask against the new state. Shown, never auto-reconciled.
3. Apply: write files (`fs.makeDirectory` recursive as needed), `cache.delete(rootPath)`.
4. **The memory commit:** `git add -- <paths>` then `git commit --only -m <message> -- <paths>` via the existing `runGit`, ambient author identity (the `generateProductMap` precedent — the human confirmed; the commit is theirs). Message = the proposal title as subject, blank line, trailer `Amended-from-plan: <plan name> (<planId>)` — design-terms subject, attribution in the trailer. Capture the landed SHA with `git rev-parse HEAD`. A non-git memory root writes without committing (the standing M-180 posture) and records no SHA.
5. **The plan commit** (§6's resolution): a human `message` commit at `parentCommitId` whose payload carries the flavor stamp `memoryAmendment: { title, memoryCommitSha (nullable for non-git), notes: [names] }` and whose `text` is the title — a client that never learns the stamp still renders something honest. `message` is an existing kind, so the frozen SQL `CHECK` is untouched and **this feature needs no migration**. The commit lands through a dedicated `PlanningStore` append (not `appendPlanMessage`) so it opens no turn and summons no assistant. The SHA is immutable external identity → payload, per the spec-`issueId` precedent.
6. Return the landed commit id; the commit stream carries it to every window. Failure between 4 and 5 leaves the memory commit landed and the plan unrecorded — surfaced as an error, no rollback (the `generateProductMap` failure posture; the memory history is still truthful).

Ordering is memory-first because the plan commit references the memory SHA.

### 1.6 Timeline and sheet rendering

- **The proposal card** renders in `PlanningSpace` when `detail.memoryAmendmentProposal` is set, in the `SplitSheet` position and auto-open pattern: title, the rendered diff (`getRenderablePatch` → `StyledDiffCodeView`), a placement line per placement ("Placed under _Composer_ in the product map"), and two buttons — confirm ("Amend memory") and decline ("Not now"). Confirm disabled while a turn is active on the chain.
- **The landed commit** renders in `PlanTimeline` as a muted one-line row in the spec-revision-row style: "You amended the memory: _<title>_" — distinct from a chat bubble, and the graph/popover summaries say the same.

### 1.7 Direct note editing

`MemoryPage`'s note detail gains the `PlanArtifact` editor pattern: Edit → `<textarea>` → Save/Cancel, no-op guarded, refusal notice inline. The reader's "Not yet written" state gains "Write this note" opening the same editor empty — the frontier's manual fill door. Saving calls a new `writeMemoryNote { projectId, name, markdown, baseMarkdown }`:

- Baseline check: current disk content must equal `baseMarkdown` (`null` for a new file) — drift refuses with "This note changed on disk" and the page's existing refresh is the recovery. Optimistic concurrency in the `saveSpecRevision` spirit, without a reconciliation editor.
- Write + commit `Edit <Name>` / `Write <Name>` (sentence subjects, no plan trailer — a direct edit is a standalone human act), same non-git posture, same cache invalidation.
- It touches no assistant path whatsoever, so "summons no assistant turn" holds by construction; the M-180 mention stanza is how the next message carries what changed.

The transient in-planning reader stays read-only — it is a reading surface mid-conversation; the browse surface is where you edit. (Non-goal below.)

### 1.8 Suggested next messages — the first source

The composer suggestion surface does not exist; this builds it minimally, with memory-note Open Decisions as its only source — the deterministic one the vault singled out.

- **Server:** `parseOpenDecisions(markdown)` joins the pure convention parsers in `memoryModel.ts` (code stripped first): the `## Open Decisions` section's `### ` headings, each `{ title, resolved }` where resolved = the subsection contains a line starting `**Resolved`. `MemoryNote` gains `openDecisions` on the wire, so no client re-parse and the reader/page can show decisions later for free.
- **Client derivation ("planning touches that note"):** the note names mentioned as `[[…]]` tokens in the messages of the current path — collected from the already-loaded timeline with the existing shared token collector (`includeNotes`), deduped; each is fetched once per plan via the existing `readMemoryNote` command into local state. Unresolved decisions become suggestions: one chip per decision, labeled by note + question. Grounding-consulted notes are deliberately **not** a trigger yet — the grounding record can't name notes until M-185 lands.
- **Rendering:** a suggestions row docked above the composer in `PlanningSpace` (pure derivation in a `.logic.ts`, dumb row component — the `SessionPreviewOffer` shape). **Choosing one sends** — the AC's words — as the user's own message via the surface's existing send path: `Let's resolve the open decision on [[<Note>]]: "<question>"`. The `[[Note]]` token makes M-180's mention stanza carry the note to the turn, so the assistant lands grounded in the right place. Suggestions are offers: the row is dismissible (session-local state, the reverse door), disabled whenever the composer itself can't send, and a resolved decision disappears from the row on the note's next read — which the amendment's own landing triggers.

Plan-text Open Decisions and the stale-contract offer are explicitly _not_ built (the former is pinned on provider behavior on the Plans note; the latter is its own issue when wanted) — but the row's derivation is a list of sources with one entry, so they slot in later without reshaping anything.

### 1.9 Errors and refusals

New contract errors in `packages/contracts/src/mercurianMemory.ts` / `mercurian.ts`, closed literals as established: `ConfirmMemoryAmendmentBlockedError` (`no-proposal` | `memory-changed` | `not-designated`), `WriteMemoryNoteBlockedError` (`note-changed` | `invalid-name` | `not-designated`), and the `memory-amendment-failed` frame's reason strings for settle-time refusals (invalid names, deleted decision headings, bad placement, prose-edge violation). Every refusal is worded in product terms and rendered where the act was attempted. `PlanTurnActiveError` and `MercurianMemoryError` are reused as-is. New mutations take `AuthOrchestrationOperateScope`.

### 1.10 Non-goals

- Bootstrap-by-extraction, the unresolved working queue, staleness advisories on grounded records — M-182 (blocked on M-184/M-185).
- Plan-text OD suggestions and the stale-contract offer (§1.8).
- Editing amendment content inside the proposal card; editing inside the transient reader.
- Formatting-preserving YAML edits (reserialization accepted; the diff shows it).
- Mobile surfaces (memory has none yet — the M-180 posture, unchanged).
- No new SQLite tables, no migration, no durable proposal store — the written memory _is_ the record, and unlike readiness verdicts an amendment has no immutable-commit anchor to remember a verdict against.

## 2. File & module layout

**Contracts** — `packages/contracts/src/mercurianMemory.ts` (`MemoryAmendmentProposal`, `MemoryNoteChange`, `openDecisions` on `MemoryNote`, new errors); `packages/contracts/src/mercurian.ts` (`PlanDetail.memoryAmendmentProposal?`, stream items `memory-amendment-proposed/-failed/-cancelled`, `PlanMessage.memoryAmendment?` stamp, method names `confirmMemoryAmendment`/`cancelMemoryAmendment`/`writeMemoryNote` in the right method map); `packages/contracts/src/rpc.ts` + `WsRpcGroup`; `apps/server/src/auth/RpcAuthorization.ts`.

**Server** — `apps/server/src/mercurian/memory/memoryModel.ts` (`parseOpenDecisions`, `missingOpenDecisionHeadings`, `insertMapPlacement`, note-name validation); `apps/server/src/mercurian/memory/MemoryIndex.ts` (extract a shared `commitPaths` git helper from `generateProductMap`; add `writeNote`; add `applyAmendment` — or a sibling `MemoryAmendments.ts` service beside it if `MemoryIndex` grows past taste, Sol's call, stated in the brief); `apps/server/src/mcp/toolkits/planning/tools.ts` + `handlers.ts` (the tool); `apps/server/src/mercurian/assistant/PlanningAssistant.ts` (pending stash, settle projection, proposal map, cancel/confirm/teardown plumbing, `APPROVED_PLANNING_MCP_TOOLS`); `apps/server/src/mercurian/assistant/PlanningPrompt.ts` (the amendment stanza, memory-gated); `apps/server/src/mercurian/planning/PlanningStore.ts` (`MessageCommitPayload.memoryAmendment?`, an `appendMemoryAmendment` writer that opens no turn); `apps/server/src/ws.ts` (three handlers + `PlanDetail` fold).

**Client runtime / web** — `packages/client-runtime/src/state/planReducer.ts` (fold the three frames + commit-closes-proposal); `packages/client-runtime/src/state/mercurianPlanning.ts` + `mercurianMemory.ts` (commands); `apps/web/src/state/mercurian.ts` + `mercurianMemory.ts` (hooks); **(new)** `apps/web/src/components/mercurian/MemoryAmendmentSheet.tsx` + `.logic.ts` (card + pure state, catalog entries beside the split sheet's); **(new)** `apps/web/src/components/mercurian/PlanSuggestions.tsx` + `planSuggestions.logic.ts` (derivation + row); `apps/web/src/components/mercurian/PlanningSpace.tsx` (mount both, wire confirm/decline/send); `PlanTimeline.tsx` + `PlanGraph.logic.ts`/`PlanNodePopover.tsx` (the amended-memory row/summary); `MemoryPage.tsx` (+`.logic.ts`) and `MemoryNoteReader.tsx` ("Write this note" hand-off to the page editor); catalog/coverage four-place registration for the new components.

**Docs** — `docs/user/project-memory.md` (amendments, editing, suggestions); `docs/internals/glossary.md` (Amendment; Suggested next message).

## 3. Open decision resolved during planning

**Does a confirmed amendment land in the plan's history? Yes — as recommended on the Memory note:** a commit in the plan's own history, cross-referencing the memory commit it landed. One history per plan loses its force if some events are invisible, and deciding to change durable design truth is exactly what a plan's history should explain. Mechanically it is a flavored human `message` commit (the split-stamp precedent), not a new kind — the product says "You amended the memory", the payload carries the SHA. The vault resolution is recorded on the Memory note as part of this issue's work.

## 4. Implementation checklist

Server half:

- [ ] Contracts: proposal/change types, `openDecisions` on `MemoryNote`, stream items, `PlanMessage.memoryAmendment?`, three methods, errors, rpc + group + auth scopes.
- [ ] `memoryModel.ts`: `parseOpenDecisions`, `missingOpenDecisionHeadings`, `insertMapPlacement` (once-per-map + parent-present + post-amendment prose-edge), note-name validation — all pure, code-stripped where prose is parsed.
- [ ] Memory service: extract `commitPaths`; `writeNote` (baseline guard, `Edit`/`Write <Name>` messages); `applyAmendment` (drift guard, multi-file write, one commit with title + `Amended-from-plan` trailer, SHA capture, non-git posture, cache invalidation).
- [ ] MCP tool `propose_memory_amendment` (plain-string schema) + handler + approval allowlist + reply-flavor gating stash.
- [ ] `PlanningPrompt.ts`: amendment stanza appended only when a memory root exists; states earned-moments, proposal-accompanies-reply, no-write-without-confirmation.
- [ ] Settle projection: resolve source, validate names/OD-preservation/placements, materialize changes + patch (git `--no-index` temp-file diff, normalized headers) + base fingerprints; publish proposed/failed frames; store in per-plan map.
- [ ] `PlanningStore.appendMemoryAmendment`: human message commit with stamp, turn-guarded, no turn kickoff.
- [ ] `ws.ts`: `confirmMemoryAmendment` (guard order: chain-active → proposal → drift → apply → commit → append → clear), `cancelMemoryAmendment`, `writeMemoryNote`; `PlanDetail` fold; **mirror every new assistant-facing method onto the `server.test.ts` mock** (the known CI-only failure).
- [ ] No migration; assert nothing widens the commits `CHECK`.

Web half:

- [ ] Reducer folds + commit-closes-proposal + turn-started supersession.
- [ ] Commands/hooks in client-runtime and web state modules.
- [ ] `MemoryAmendmentSheet` (diff via `getRenderablePatch`/`StyledDiffCodeView`, placements line, confirm/decline, turn-active disable) + logic + catalog entries + a11y-clean (use `text-destructive-foreground` for any destructive text).
- [ ] Timeline/graph/popover rendering of the amended-memory commit row.
- [ ] `PlanSuggestions` row + derivation logic (mention-collected notes → `openDecisions` → unresolved → chips; dismiss; send-gated; sends the `[[Note]]`-bearing message through the existing send path).
- [ ] `MemoryPage` editor (Edit/Save/Cancel, baseline-drift refusal notice, red-link "Write this note") wired to `writeMemoryNote`; reader hand-off.
- [ ] Catalog/coverage/classification four-place updates; `docs/user/project-memory.md` + glossary.

## 5. Test plan

Server (`@effect/vitest`, existing suites' idioms):

- [ ] `memoryModel.test.ts`: `parseOpenDecisions` (resolved detection, code-fence immunity, no-section case); `missingOpenDecisionHeadings` (deletion caught, reword caught, resolution-appended passes); `insertMapPlacement` (parent missing, duplicate note, prose-edge against post-amendment graph, serialization round-trips validation).
- [ ] Memory service tests (real git temp dirs, the `MemoryIndex.test.ts:124` fixture pattern): `writeNote` creates/edits + commits with the right subject, baseline drift refuses, non-git root writes without committing; `applyAmendment` lands one commit for note+placement with title subject and `Amended-from-plan` trailer (assert via `git log -1 --pretty=%B`), drift refuses and leaves the proposal's files untouched, red-link fill resolves the reference on next read.
- [ ] `PlanningStore` test: `appendMemoryAmendment` lands a human message commit carrying the stamp, refuses while a turn is active, opens no turn.
- [ ] Wire-level (`server.test.ts`): confirm/cancel/write methods round-trip; proposal frame folds onto `PlanDetail`.

Web (vitest + logic tests + catalog):

- [ ] `planSuggestions.logic.test.ts`: mention collection over a timeline, unresolved-only, dedupe, dismiss, message text carries the `[[Note]]` token.
- [ ] `MemoryAmendmentSheet.logic.test.ts`: confirm/decline payloads, turn-active disable, proposal supersession.
- [ ] `MemoryPage.logic` additions: editor state machine, drift refusal notice, write-this-note path.
- [ ] Catalog: sheet entries (proposal with diff; failed refusal) registered in all four places; run the design-system browser a11y project locally (`cd apps/web && vp test run --project design-system src/design-system/design-system.browser.test.tsx`).
- [ ] Targeted typechecks for contracts, server, client-runtime, web.

AC walk (after implementation, live app against the scratch almagest clone): propose→diff→confirm lands both commits with attribution; decline lands nothing; new-note-with-placement in one confirmation; OD suggestion appears on mention, click sends my message; resolution preserves the question; direct edit commits silently; no assistant path writes without confirmation (verify the tool alone never touches disk).
