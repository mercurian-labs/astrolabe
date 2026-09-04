# Technical Plan — M-212: Codex's mid-turn diff makes the checkpoint reactor settle the turn before the agent is done

_Generated from M-212's Goal/AC and the almagest vault (Threads, "Every turn ends in a snapshot" and "The branch is the agent's to move"; the "Built" paragraph already records this defect as a known divergence). Plan authored 2026-09-04 against main @ `78c759c3d0` (M-196 and M-206 merged)._

**Goal, in one sentence:** on a coding session, a Codex turn's settled snapshot is taken when the turn completes, so commits and edits the agent makes after its first diff report land on that turn's record instead of surfacing as "changes outside a turn" on the next one.

**Scope fences.** Upstream t3code threads (no coding session) keep their placeholder replacement byte-for-byte. The mock provider's turn-id problem is M-211. Codex's `turn/aborted` notification is not a reactor input today and stays that way; interrupted turns already settle as partial through `turn.completed` with a non-completed state. No contract, migration, or client change.

## Conventions Detected

- **Reactor shape** (high): `CheckpointReactor.ts` is a `Layer.effect` of `Effect.fn`-named handlers fed by one drainable worker (`makeDrainableWorker`, line ~1210) over two streams: domain events (`thread.turn-start-requested`, `thread.message-sent`, `thread.turn-diff-completed`) and runtime events (`turn.started`, `turn.completed`). Every handler resolves the thread through `resolveThreadDetail` and bails with a `Effect.logDebug` / `logWarning` on the skip conditions. The coding-session lookup is `codingSessions.getByThreadId(threadId)` returning an `Option` (used at `captureCheckpointForTurn` line ~617 and `captureExternalSnapshot` line ~879).
- **Tests beside sources; harness-driven** (high): `CheckpointReactor.test.ts` builds a real engine + reactor over temp git repositories (`createHarness({ slotBackedSession, multiRepositorySlot, threadBranch })`), drives it with `harness.provider.emit(...)` for runtime events and `harness.engine.dispatch({ type: "thread.turn.diff.complete", status: "missing", ... })` for the placeholder, then `await harness.drain()` and asserts on git (`runGit`, `gitShowFileAtRef`), on `harness.recordedSnapshots` / `recordedRepositorySnapshots` / `builtRepositories`, and on `harness.readModel()`. Existing placeholder cases: lines 907 and 952. Multi-repository precedent: line 1752.
- **Receipts and drains, never sleeps** (high, AGENTS.md): tests wait on `harness.drain()` and `waitForGitRefExists`; no timeouts.
- **Verification is targeted** (high): `vp test run <file>` for touched suites, `tsgo --noEmit` for the package; no repo-wide checks.
- **Docs split by audience** (high): contributor-facing behavior goes in `docs/internals/overview.md` ("Checkpointing"); the vault records design intent, not code.
- **Plans in `docs/project/technical-plan-m-NNN-*.md`; conventional commits with plain-language titles** (high).

## What discovery found (verified against this worktree)

- **The placeholder is born in ingestion.** `ProviderRuntimeIngestion.ts:1956-1994`: on the first `turn.diff.updated` runtime event for a turn (Codex's `turn/diff/updated`, mapped at `CodexAdapter.ts:1423-1436`; no other adapter emits it), ingestion dispatches `thread.turn.diff.complete` with `status: "missing"`, `checkpointRef: provider-diff:<eventId>`, `files: []`, and `checkpointTurnCount = max + 1`. Later diff updates are no-ops because `hasCheckpointForTurn` already finds the turn.
- **The reactor settles on the placeholder.** `CheckpointReactor.ts:815-866` (`captureCheckpointFromPlaceholder`) reacts to the `thread.turn-diff-completed` domain event with status `missing` and calls `captureCheckpointForTurn` with `settled: true`, `status: "ready"`. On a slot-backed session that runs the whole chained capture (`captureMemberSnapshot` in every member, `recordSnapshot` / `recordRepositorySnapshot` with kind `settled`, branch movement, built) and dispatches the real checkpoint plus the "Checkpoint captured" activity.
- **Completion then skips.** `captureCheckpointFromTurnCompletion` (line 741) returns early when any non-`missing` checkpoint exists for the turn (line 779). It already handles the other half correctly: when only a `missing` placeholder exists it reuses the placeholder's `checkpointTurnCount` (line 787) and captures with `settled = state === "completed"` (partial otherwise).
- **The read model and clients already tolerate a lingering placeholder.** `projector.ts:643-668` and `client-runtime/state/threadReducer.ts:511-530`: a `missing` checkpoint never overwrites a `ready` one, and a `thread.turn-diff-completed` for a turn the session is still running does not settle `latestTurn`. `ProjectionPipeline.ts:1269-1290` mirrors the same "turn still running" guard for the turn row. Nothing renders a `missing` checkpoint as settled.
- **`turn.completed` delivery is reliable.** The reactor's comment at line 1156 ("streamEvents PubSub does not reliably deliver turn.completed") predates upstream fix #595 (`e8b0126371`, which changed `ProviderService.ts`); every non-Codex coding-session turn (Claude, Mock) settles through `turn.completed` today, and the harness race test at line 952 proves the runtime path reaches the reactor. Codex maps `turn/completed` → `turn.completed` with state `completed | failed | cancelled | interrupted` (`CodexAdapter.ts:1372-1388`).
- **Live evidence** (issue body): thread `ca5752bc…`, event 49 placeholder at 03:12:09.656, reactor capture at the same instant, Codex commits at 03:12:29, next turn's opening capture records them as `external` with "Changes outside a turn were snapshotted" (`CheckpointReactor.ts:919`).

## Design

### 1. A coding session settles on completion; the placeholder only marks the turn

`captureCheckpointFromPlaceholder` gains one early return: after resolving the thread and before resolving the cwd, look up `codingSessions.getByThreadId(threadId)`; when it is `Some`, log at debug ("placeholder left unsettled: coding session settles on turn completion") and return. Everything else in the handler is untouched, so a thread without a coding session (upstream t3code) replaces its placeholder exactly as before.

Why gate on the session rather than on the slot: the design invariant is per line ("every turn ends in a snapshot"), and `captureCheckpointForTurn` already branches on the session for the chained-versus-plain capture. A session without a slot (legacy or degraded) still settles on completion through the plain `captureAndDispatchCheckpoint` path, which is what it does for Claude today.

Why not let completion re-capture over a real checkpoint: it would produce two snapshots for one turn ref, two session-row writes, and two "Checkpoint captured" activities, and would need de-duplication that the single-capture design does not.

What the placeholder still does on a session: ingestion keeps dispatching it, so the thread carries a `missing` checkpoint with `files: []` and the `provider-diff:` ref while Codex runs (AC 4: shown as not settled), `latestTurn` stays running via the existing guards, and the placeholder's `checkpointTurnCount` is reused by completion so the turn numbering is stable.

### 2. Completion is unchanged in code, changed in meaning

`captureCheckpointFromTurnCompletion` already does the right thing once the placeholder is left alone: it finds the `missing` placeholder, reuses its turn count, and runs the chained capture in every member with `settled` derived from the runtime state. The capture happens after Codex's last action, so `^2` of the turn ref is the post-commit HEAD in each member, `branchMovement` reads `added`/`rewritten` from the chain, `built` flips where the tree changed, and the next turn's opening capture finds nothing drifted (AC 1–3).

### 3. Comments and docs

- Replace the stale reasoning in the reactor's two placeholder comments (line ~807 and ~1156): the placeholder path is upstream's immediate replacement for plain threads; on a coding session the settled capture waits for `turn.completed`.
- `docs/internals/overview.md` "Checkpointing": one sentence stating that a provider's mid-turn diff report records a placeholder for the turn, that upstream threads replace it immediately, and that a coding session's settled snapshot is taken at turn completion.
- After the AC walk: drop the "Divergence worth knowing" sentence from the vault's Threads "Built" paragraph (almagest, separate commit).

## File & module layout

- `apps/server/src/orchestration/Layers/CheckpointReactor.ts` — the session gate in `captureCheckpointFromPlaceholder`; comment updates.
- `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts` — rewrite the line-907 case and add the cases below.
- `docs/internals/overview.md` — the Checkpointing paragraph.
- Untouched: `ProviderRuntimeIngestion.ts`, `CodexAdapter.ts`, contracts, projector, clients.

## Implementation Checklist

- [ ] In `captureCheckpointFromPlaceholder`, after the thread resolves, return early when `codingSessions.getByThreadId(threadId)` is `Some`, with an `Effect.logDebug`.
- [ ] Do not change the ingestion placeholder, the completion handler's skip/reuse logic, or `captureCheckpointForTurn`.
- [ ] Update the two reactor comments that justify the placeholder path so they describe the split (plain thread: immediate replacement; coding session: settle on completion).
- [ ] Add the Checkpointing sentence to `docs/internals/overview.md`.
- [ ] No new dependencies, contracts, or migrations.

## Test Plan

All in `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`, harness-driven, drained, no sleeps. Run with `vp test run apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`, then `vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` to confirm the placeholder dispatch is unchanged, and `tsgo --noEmit` in `apps/server`.

- [ ] **Placeholder waits for completion (single repository).** `slotBackedSession: true`; emit `turn.started`, wait for the baseline ref, drain; dispatch the `missing` placeholder for turn count 1; drain; assert `recordedSnapshots` is empty and the read model's checkpoint for the turn has status `missing`. Then edit and `git commit` in the slot; emit `turn.completed` with state `completed`; drain; assert `${turnRef}^2` is the post-commit HEAD, `recordedSnapshots` is exactly `[settled]`, the checkpoint is `ready` with `checkpointTurnCount` 1 and `branchMovement { kind: "added", count: 1 }`, and the session row's `branchTipOid` is the new commit.
- [ ] **No external snapshot on the next turn.** Continue the case above: emit `turn.started` for a second turn; drain; assert no `external` snapshot was recorded and no `checkpoint.external` activity was appended (AC 3).
- [ ] **Every member settles at completion (multi-repository).** `multiRepositorySlot: true`; placeholder, then commit in both members, then `turn.completed`; assert `recordedRepositorySnapshots` has one `settled` row per member, each member's `${turnRef}^2` is its post-commit HEAD, and the read model's `repositories` groups carry `branchMovement.kind === "added"` for both (AC 1–2).
- [ ] **Placeholder and completion still capture once.** Keep the existing line-952 race case; it must still record exactly one `settled` snapshot.
- [ ] **A plain thread keeps upstream behavior.** `hasSession: false` (or default harness without a coding session) in a git worktree: dispatch the `missing` placeholder alone; drain; assert a `ready` checkpoint for the turn exists (immediate replacement, AC 5).
- [ ] **Interrupted turn stays partial.** `slotBackedSession: true`; placeholder, then `turn.completed` with state `interrupted`; assert exactly one snapshot of kind `partial` (settle-on-completion did not upgrade it).
