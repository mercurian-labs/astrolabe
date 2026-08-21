# Technical Plan — M-158: Concurrent planning turns across branches

_Generated from M-158's Goal/AC, the almagest Composer/Plans/Assistant notes, and the M-157 plan this branch stacks on. Narrows "one turn at a time" from per-plan to per-branch across registry, store, assistant runtime, wire, and client._

**Goal, in one sentence:** a planning turn claims only the chain it is writing, so replies on different branches of one plan run concurrently, while one-turn-at-a-time-with-no-queueing stays true on each branch.

**Scope fences:** merges (not yet built — `CommitStore` still refuses multi-parent assistant commits and no human merge path exists), coding sessions (already concurrent), the mobile app, provider instance plumbing, and the checkpoint graph's rendering remain untouched. At most one _implement_ analysis per plan still (rationale below). No migration: turns are runtime state (ADR 002 §3) and nothing here persists.

## What discovery found: the serialization is three plan-keyed maps and one plan-wide guard

- **The claim is plan-keyed.** `PlanTurnRegistry` (`apps/server/src/mercurian/planning/PlanTurnRegistry.ts`) holds `Map<PlanId, ActivePlanTurn>`; `open` refuses a second turn per plan. Its `getByThread` already resolves MCP tool calls by provider thread, not by plan — the disambiguation concurrency needs already exists.
- **The guard is plan-wide but the danger is chain-local.** `PlanningStore.requireNoActiveTurn` (~line 1865) refuses _every_ human write in the plan during a turn; its own comment names the real hazard: a human commit "onto the same history" would fork the assistant's linear chain. Five writes call it — `appendMessage`, `savePlanRevision`, `saveSpecRevision`, `saveTrackerSpecRevision`, `saveSplits` — and all of them funnel through the shared `appendAt` transaction helper, which resolves the parent commit. One chain-local check at that choke point replaces five plan-wide ones.
- **The runtime is three plan-keyed maps.** `PlanningAssistant.ts` holds `turns`, `sessions`, `proposals` as `Map<PlanId, …>` (~lines 446–448). `startTurn` decides continue-vs-rebuild by whether the new message hangs from the cached session's tip (`parentParents.includes(existing.tipCommitId)`) — a per-branch fact already. `stopTurn`/`answerQuestion` take only `planId`; `status` returns `Map<PlanId, PlanTurnStatus>`.
- **The wire carries one turn.** `PlanDetail.inFlightTurn` is singular (`packages/contracts/src/mercurian.ts` ~449); `turn-started`/`turn-delta`/`turn-settled`/`turn-refused` frames already carry `turnId`, and `PlanInFlightTurn` already carries `parentCommitId` — the frames need no reshaping, only the snapshot and its reducer do.
- **The reducer is hoisted and single-slot.** `packages/client-runtime/src/state/planReducer.ts` folds turn frames into `detail.inFlightTurn` and drops frames for a stale `turnId`. Multi-turn state means a keyed collection here, and it lands in client-runtime where mobile will inherit it.
- **The client gates plan-wide on purpose today.** `resolveComposerControl` (`PlanComposer.logic.ts`) flips send→stop on `turnActive`; `PlanningSpace.tsx` ~651 comments "Stop is offered even when the reply is on another branch"; `stopTurn(planId)` takes no turn id. `PlanTimeline` receives `inFlight` as a prop, so the surface chooses which turn a timeline shows.
- **Different plans already run turns concurrently**, so the provider layer needs nothing; and `ws.ts` kicks turns off fork-detached (`kickOffPlanningTurn`, ~1201) so concurrent starts are already structurally fine.
- **Test hazards on record:** `server.test.ts` mocks `planningAssistant` partially (~423) — signature changes must reach the mock or the wire suite dies in CI only. `PlanTurnRegistry.test` does not exist (registry is tested through `PlanningAssistant.test.ts` and `PlanningStore.test.ts`).

## Design

### The load-bearing idea: a turn claims a chain, not a plan

An active turn owns a growing set of commits — the parent it opened from plus every assistant commit it has landed (the registry already tracks the tip; it now accumulates the chain):

```ts
interface ActivePlanTurn {
  flavor: "reply" | "implement";
  planId: PlanId;
  turnId: PlanTurnId;
  threadId: ThreadId;
  parentCommitId: CommitId;
  tipCommitId: CommitId;
  /** parentCommitId + every commit this turn landed; membership = "on this chain". */
  chain: ReadonlySet<CommitId>;
}
```

Registry state becomes `Map<PlanId, Map<PlanTurnId, ActivePlanTurn>>`:

- `open` refuses (`PlanTurnActiveError`) only when the new turn's `parentCommitId` is a member of any existing turn's `chain` in that plan — the same-branch case, including the two-windows-race. Different branches have disjoint chains and both claims stand.
- `close(planId, turnId)`, `advanceTip(planId, turnId, tip)` (also adds to `chain`), `reassignThread(planId, turnId, threadId)` — turn-addressed.
- `get(planId)` → `getTurns(planId): ReadonlyArray<ActivePlanTurn>`; `getByThread` unchanged (flat scan).
- New `activeChainMember(planId, commitId): boolean` — the store guard's one question.

**Why a materialized chain set instead of DAG queries:** the chain is short-lived, append-only, and already maintained by `advanceTip`; asking `CommitStore.ancestors` per write would put a history walk inside every append transaction for a fact the registry holds for free.

### Store: one chain-local guard at the append choke point

`requireNoActiveTurn(planId)` is replaced by a check inside `appendAt`, after `resolveParent`: refuse when `activeChainMember(planId, parent.commitId)`. All five human writes inherit it; writes parenting elsewhere in the plan proceed mid-turn (AC 6). The assistant's own write path (which hardcodes `authorKind` differently) is untouched. `PlanTurnActiveError`'s shape is unchanged — client wording carries the branch meaning.

Splits note: `saveSplits` lands sibling branches under one parent; that parent flows through the same check, so "implement attempts touching a branch with an active turn are refused the same way" (AC 6) needs no extra code. Merges are out of scope (none exist to guard).

### Assistant runtime: turn-addressed maps, branch-keyed sessions

- `turns: Map<PlanTurnId, TurnRuntime>` with a per-plan index for `status` and teardown. Every internal path that did `turns.get(planId)` resolves through the event's `threadId` (provider events) or explicit `turnId` (RPCs) — the provider-event pump already knows its thread, and `registry.getByThread` maps thread→turn.
- `sessions` re-keys by the session's `tipCommitId` (with the plan index for teardown): the continue-vs-rebuild check becomes "find a cached session whose tip is a parent of the new message, under the same instance and model" — the same predicate as today, now finding the _branch's_ session instead of the plan's. A rebuild evicts only the session it replaces; plan teardown evicts all. Live sessions per plan are bounded by branches being actively worked — no cap is added, matching today's discipline of eviction-on-rebuild rather than pooling.
- `stopTurn({planId, turnId})` and `answerQuestion({planId, turnId, answers})` gain the turn id; stopping settles only that turn (AC 4), answering resumes only the asking turn (AC 7).
- `proposals` stays `Map<PlanId, PlanImplementProposal>` — **decision: implement analyses stay one-per-plan.** An implement turn claims its chain like any turn (so it coexists with replies on other branches), but `tryImplement` still clears/replaces the plan's single standing proposal, and `PlanDetail.inFlightImplement`/`implementProposal` stay singular. The implement moment is modal (it opens a sheet and a decision), and two simultaneous split proposals on one plan have no UI to land in; the narrowing this issue promises is about _replies_, and the chain rule already delivers "implement from an unaffected branch while another branch streams."
- `status` still answers `Map<PlanId, PlanTurnStatus>` — `isWorking` = any turn live, `hasPendingInput` = any turn with questions up. The sidebar rollup (`composePlanRowStatus`, `wire.ts`) is untouched (AC 9).

### Wire: the snapshot carries every in-flight turn

- `PlanDetail.inFlightTurn?: PlanInFlightTurn` → `inFlightTurns: Schema.Array(PlanInFlightTurn)` (default empty; a joining or reconnecting window is coherent for every streaming reply at once — AC 5). Turn frames are unchanged — `turnId` was already on all of them.
- `MercurianStopPlanTurnInput`/`MercurianAnswerPlanQuestionInput` gain `turnId`. `ws.ts` threads it through; `server.test.ts`'s `planningAssistant` mock gets the new signatures in the same commit.
- `turn-refused` reason `"turn-active"` keeps its name; only client wording changes.

### Client: the branch you stand on is the turn you're gated by

- `planReducer` (client-runtime) holds `inFlightTurns` keyed by `turnId`: `turn-started` inserts, deltas/grounding/questions update their own turn, `turn-settled`/the settling commit removes, snapshot replaces wholesale. The stale-`turnId`-drop discipline generalizes to "unknown turnId ⇒ ignore".
- New pure helper `turnForBranch(graph, inFlightTurns, actingHead)` in `PlanThread.logic.ts` (beside the existing thread-path logic): a turn is _on this branch_ when walking first-parent ancestry from `actingHead` reaches the turn's `parentCommitId` — during streaming the branch grows by the turn's own commits, so the walk from the ridden-forward head hits the turn's parent in a handful of steps; a bounded walk with the turn's chain length as a natural cap.
- `PlanningSpace`: composer control reads `turnActive = turnForBranch(...) !== undefined` — Stop only on the streaming branch (AC 1, 3), targeting that turn's id (AC 4); `PlanTimeline` gets the branch's own turn as `inFlight` so neither reply's text/grounding/questions bleeds across (AC 2); question answering passes the asking turn's id (AC 7).
- `turnRefusalNotice("turn-active")` (`PlanComposer.logic.ts`) rewords to "The assistant is already replying on this branch."
- Per-branch model recording needs nothing: `ranUnder` stamping and standing-choice derivation are per-message ancestry already (M-128); AC 8 verifies, not builds.
- M-157's per-branch drafts are assumed beneath this: composing on branch B while A streams edits B's own draft.

## File & module layout

| File                                                                                               | Change                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/mercurian/planning/PlanTurnRegistry.ts`                                           | Chain-claiming registry: nested map, `chain` set, turn-addressed ops, `activeChainMember`.                                          |
| `apps/server/src/mercurian/planning/PlanningStore.ts`                                              | Guard moves into `appendAt` as the chain-membership check; five call-site guards deleted.                                           |
| `apps/server/src/mercurian/assistant/PlanningAssistant.ts`                                         | Turn-addressed `turns`, tip-keyed `sessions`, `stopTurn`/`answerQuestion` signatures, per-turn settle/teardown, status aggregation. |
| `packages/contracts/src/mercurian.ts`                                                              | `inFlightTurns` array; `turnId` on stop/answer inputs.                                                                              |
| `apps/server/src/mercurian/planning/wire.ts` + `apps/server/src/ws.ts`                             | Snapshot assembly of `inFlightTurns`; RPC threading of `turnId`.                                                                    |
| `apps/server/src/server.test.ts`                                                                   | `planningAssistant` mock signatures updated (CI-only failure otherwise).                                                            |
| `packages/client-runtime/src/state/planReducer.ts`                                                 | Keyed `inFlightTurns` folding.                                                                                                      |
| `apps/web/src/components/mercurian/PlanThread.logic.ts`                                            | `turnForBranch` (new logic + tests).                                                                                                |
| `apps/web/src/components/mercurian/PlanningSpace.tsx`, `PlanComposer.logic.ts`, `PlanTimeline.tsx` | Branch-scoped gating, per-turn stop/answer wiring, refusal wording.                                                                 |
| `almagest/Composer.md`, `almagest/Plans.md` (vault)                                                | "One turn at a time" narrowed to per-branch in both notes; committed to the vault repo.                                             |

No new server files: the registry keeps its acyclic-dependency role, so the reshape stays inside it.

## Implementation Checklist

- [ ] Reshape `PlanTurnRegistry` to chain-claiming turns (nested map, `chain` accumulation in `advanceTip`, turn-addressed `close`/`reassignThread`, `getTurns`, `activeChainMember`); `open` refuses only same-chain parents.
- [ ] Move the store guard into `appendAt` (post-`resolveParent` chain-membership refusal); delete the five `requireNoActiveTurn` call sites and the helper.
- [ ] Re-key `PlanningAssistant`'s `turns` by `PlanTurnId` and `sessions` by tip; route provider events by thread→turn; scope settle, failure teardown, and rebuild-eviction per turn.
- [ ] Add `turnId` to `stopTurn`/`answerQuestion` end-to-end (contracts → ws.ts → client mutations → `server.test.ts` mock).
- [ ] Change `PlanDetail` to `inFlightTurns` array; assemble every active turn into snapshots; keep `inFlightImplement`/`implementProposal` singular.
- [ ] Fold keyed `inFlightTurns` in `planReducer`; generalize stale-turn frame dropping.
- [ ] Add `turnForBranch` and gate the composer, timeline, stop, and question-answer wiring on the branch's own turn; reword the `turn-active` refusal notice.
- [ ] Amend the almagest `Composer.md` and `Plans.md` notes and commit the vault.
- [ ] Do not add queueing, a merge guard, a session pool cap, or any persistence of turn state.

## Test Plan

House pattern: Effect-based service tests beside the service; pure logic tests beside the logic; reducer tests in client-runtime.

- [ ] Registry: two turns with disjoint parents both open in one plan; a parent on an active chain refuses; `advanceTip` grows the chain; close releases only its turn (`PlanningAssistant.test.ts` / a new `PlanTurnRegistry.test.ts` beside it).
- [ ] Store: human append onto an active chain refuses with `PlanTurnActiveError`; append/revision/spec/tracker-spec/splits onto another branch land mid-turn (`PlanningStore.test.ts`) (AC 6).
- [ ] Assistant: two concurrent `startTurn`s stream and settle one commit each on their own branches; stop settles only the addressed turn as interrupted; a question pauses only its own turn and its answer resumes it; per-branch sessions continue without rebuild when their own tip matches (`PlanningAssistant.test.ts`) (AC 2, 4, 7).
- [ ] Wire: snapshot carries both in-flight turns; reconnect mid-two-streams is coherent (`wire.test.ts`, `server.test.ts`) (AC 5).
- [ ] Reducer: interleaved deltas for two turn ids never cross; settle removes one and leaves the other (`planReducer.test.ts`) (AC 2).
- [ ] Logic: `turnForBranch` finds the turn from a ridden-forward head, answers nothing on the other branch, and gates the composer faces accordingly (`PlanThread.logic.test.ts`, `PlanComposer.logic.test.ts`) (AC 1, 3).
- [ ] Status: plan rolls up working while either turn or any coding session lives (`wire.test.ts`) (AC 9).
- [ ] Full-suite regression: `vp test` across `apps/server`, `apps/web`, `packages/client-runtime`; `tsgo --noEmit` clean.

_AC 8 (two branches under two models, each reply recording its pair) and the concurrent-streams walk are demonstrated live in the app per house practice — the mock provider's seeded turns make the two-branch walk drivable._
