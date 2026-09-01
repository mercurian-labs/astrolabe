# Technical Plan — M-195: Working state: a pooled worktree slot per repository

_Generated from M-195's Goal/AC and the almagest Threads note (2026-08-31 amendment: "the pool replaces per-line worktrees; the runtime commits"). Replaces the per-session worktree with a capped pool of interchangeable slots per repository; lines own eager branches and checkpoints; settled turns end in a runtime-made commit; revert-to-message is removed._

**Goal, in one sentence:** working trees become a small per-repository pool of slots that turns claim, switch, and release — lines owning only branches and checkpoints — so several lines build at once while disk and install cost stay bounded by one adjustable knob.

**Scope fences.** The thread unification (M-197), multi-repo turns (M-196), and code-turns-in-the-DAG (M-198) are not built; this plan builds the substrate against the product as it stands — the planning DAG plus coding sessions — so those issues inherit working machinery rather than a per-session worktree to unwind. Teardown/pool-shrink is M-115 (this plan makes the slots it shrinks). The memory repository joining the slot machinery is M-194's concern. Upstream t3code thread worktrees (`ThreadTurnStartBootstrapPrepareWorktree`, `t3code/` branches, the desktop/mobile `workspaceMode: "worktree"` flow) are **untouched** — the pool is Mercurian-only, which is also what keeps mobile out of the blast radius (`apps/mobile` has no Mercurian surface; its only revert reference is a comment).

## Conventions detected

- **Event-sourced core with additive fork placement** (high): commands/events in `packages/contracts/src/orchestration.ts` → `decider.ts` → `projector.ts` → reactors; Mercurian domain lives in `apps/server/src/mercurian/**` with its own SQLite migration sequence (`mercurian/persistence/Migrations.ts`), per ADR 004 §1 (never append to upstream's migrations).
- **Runtime state is not persisted** (high): `PlanTurnRegistry` is an in-memory `Ref` — "a server restart rightly starts with no turns" (ADR 002 §3). Slot *leases* follow this; slot *directories* are disk facts and get rows.
- **Store shape** (high): `<Feature>Store.ts` as `Context.Service` + `SqlSchema`, `schema.ts` domain types, `wire.ts` mappers, RPC in `ws.ts`, layer merged in `server.ts` (`Layer.provide`, never `provideMerge`, for the Mercurian SqlClient).
- **Keyed mutual exclusion precedent** (medium): `provider/providerMaintenanceCommandCoordinator.ts` holds a `Ref<Map<string, Semaphore>>`; there is no `git worktree lock`, no `git stash`, and no per-repo semaphore anywhere today — mutual exclusion for slots is ours to add, application-level.
- **Tests beside sources** (high): `*.test.ts` same basename, suffixed variants for large suites (`decider.checkpointRevert.test.ts` exists and dies with revert); integration under `apps/server/integration/`. Server suite runs `fileParallelism: false`.
- **Plans in `docs/project/technical-plan-m-NNN-*.md`** (high); conventional commits with plain-language titles (recent `git log`).
- **`server.test.ts` partially mocks services** (high, hazard): signature changes must reach the mock or the wire suite fails in CI only.

## What discovery found: the seams the pool replaces

- **One `git worktree add` site.** `GitVcsDriverCore.ts:2823-2882` (`createWorktree`, path = `worktreesDir/<repo>/<branch-with-slashes-dashed>`, 300s timeout, submodule + `gh-merge-base` post-steps), fronted by `GitWorkflowService.createWorktree`. The path is *derived from the branch name* — the slot model breaks exactly this coupling.
- **Session birth is the claimant to convert.** `CodingSessionService.start` (`mercurian/codingSessions/CodingSessionService.ts:226-427`) mints `mercurian/<slug>-<hex>` (`branch.ts`), creates the worktree, dispatches `thread.meta.update {branch, worktreePath}`, and lands the DAG leaf — all under `withCodingSessionBirthCompensation` (all-or-nothing, CAS branch delete). The session row (`coding_sessions`, migration 010) already carries `branch, worktreePath, baseRef`; `getByWorktreePath` assumes path↔session is 1:1 (PR attach, `ws.ts:418-434`) — a pooled path serves many lines over time, so PR attach must re-key.
- **Checkpoints are orphan snapshots, thread-addressed.** `refs/t3/checkpoints/<b64(threadId)>/turn/<n>` (`checkpointing/Utils.ts`), captured via temp-index `commit-tree` with **no parent** (`GitVcsDriver.ts:712-793`), restored via `restore --source … && clean -fd` (L798-828), orchestrated by `CheckpointReactor.ts` (pre-turn baseline L629-687, post-turn capture+diff L225-355). Refs live in the common git dir, so they survive slot moves; only `resolveThreadWorkspaceCwd` (= `worktreePath ?? workspaceRoot`) must resolve through the slot table.
- **Revert is a closed loop, enumerable.** `thread.checkpoint.revert` (`contracts/orchestration.ts` ~921) → `decider.ts:1134-1160` → `CheckpointReactor.handleRevertRequested` (L690-819: restore, `providerService.rollbackConversation`, delete later refs) → `thread.revert.complete`. Client: `commands.ts:311`, `threadCommands.ts:195`, `threadReducer.ts:613`, `orchestrationEventEffects.ts:26`, `ChatView.tsx:5253` + `isRevertingCheckpoint`, `MessagesTimeline.tsx:1092` (`RevertUserMessageButton`) and `.logic.ts` `revertTurnCount` plumbing. No mobile surface.
- **The claim precedent exists.** `PlanTurnRegistry` claims chains, in-memory, refusing same-chain seconds — the conceptual template for slot claims. Planning turns already run in the repository checkout read-only (`PlanningAssistant.buildRebuildMaterials`, `approvalPolicy: "never"`), so planning needs no slot.
- **Settings homes.** Machine-scoped `ServerSettings` holds `newWorktreesStartFromOrigin` (`contracts/settings.ts:662`); the fork's Preferences page (`PreferencesSettings.tsx` + `.logic.ts`) holds exactly one `NumberField` setting today (fetch interval) — the pool size copies that block. `RepositoryHasLiveWorktreesError` is already the one per-repo worktree count in the app.
- **Where partial marks render.** `PlanCheckpointEffect` (`PlanGraph.logic.ts:14`) + `EFFECT_LABELS`/`effectsFor` (`PlanCheckpoints.logic.ts`) + `InterruptedBadge` (`PlanTimeline.tsx:183`); `OrchestrationCheckpointStatus` is `ready|missing|error`. The changed-files card reads `OrchestrationCheckpointSummary.files`.
- **Nothing tears worktrees down today** — deletion leaks them (`ThreadDeletionReactor` stops sessions and terminals only); `coding_sessions.endedAt/outcome` is written by no production path. The pool bounds what M-115 will shrink.

## Design

### The load-bearing idea: lines own refs and snapshots; repositories own directories

A **line** is a maximal first-parent chain of the plan DAG, identified by its opening commit (`lineRootCommitId` — a DAG root, or the first commit whose parent has other children). Lines get durable per-repository **branch rows**; working trees become **slots** — interchangeable directories under `worktreesDir/<repo>/slot-<n>` whose current branch is data, not identity.

### Line branches: eager, cheap, reset-until-built

New table `line_branches(line_root_commit_id, repository_id, branch, base_oid, built, created_at)` (migration `0NN_LineBranches.ts`) + `LineBranchStore.ts` beside `commitTree/`. A new `LineBranchReactor` subscribes to planning-store appends: when a commit *opens a line* (fork or root), it mints `mercurian/<slug>-<hex>` branches (reusing `branch.ts`, generalized `buildLineBranchName`) in every repository the project links, via `git branch <name> <start>` — no worktree, no checkout, ~free. Start point: the fork-point's recorded settled-commit OID where an ancestor built in that repository, else the repository's base ref (default from `ServerSettings.newWorktreesStartFromOrigin` semantics, resolved as `CodingSessionService` does today at L256-370). While `built = false` the branch is re-pointable: a base-ref change before first build is `git branch -f`, and M-115 may prune never-built branches. The system never pushes these refs.

**Why eager:** predicting whether a turn will edit was rejected in design (memory made every turn a candidate); a ref costs nothing and removes the prediction machinery entirely.

### The slot pool: claim, switch, settle — never wait on a specific slot

New module `apps/server/src/mercurian/worktreeSlots/`:

- `schema.ts` — `WorktreeSlot { slotId, repositoryId, path, currentLineRootCommitId | null, currentBranch | null, createdAt, lastUsedAt }`.
- `SlotStore.ts` + migration `0NN_WorktreeSlots.ts` — slot rows are disk facts and persist.
- `SlotRegistry.ts` — in-memory leases (ADR 002 §3): `Map<SlotId, Lease>` where `Lease = { holder: "turn" | "terminal" | "preview", threadId/terminalId, acquiredAt }`, plus a per-repository `Semaphore` map (the `providerMaintenanceCommandCoordinator` shape) serializing claim/switch decisions. A server restart starts leaseless; recovery is below.
- `SlotService.ts` — the one protocol:
  1. **claim(repositoryId, lineRootCommitId)** under the repo semaphore: prefer a free slot already on the line's branch (affinity — no churn); else any free slot (**switch**); else if `count < poolSize` **materialize** a new slot (`createWorktree` on the line's branch — the existing 300s-timeout path, submodules included); else fail typed `SlotPoolAtCapacityError { repositoryId, poolSize }`. The claim never blocks — multi-repo callers claim per repo independently, and since nothing waits on a held slot, there is no deadlock.
  2. **switch** (free slot → another line): refuse if leased; if `git status` is dirty, capture a **partial snapshot** first (below), then `restore`+`clean` to pristine, `git checkout <line-branch>`, and restore the line's latest checkpoint state when it has one (partials restore over the branch commit). Never `git stash`.
  3. **release(slotId, holder)** — lease bookkeeping only; the directory stays warm (that reuse — node_modules, build state — is the pool's whole economy).
  4. **recovery**: a claim that finds a leaseless-but-dirty slot (crash, restart) captures a recovery partial snapshot attributed to the slot's `currentLineRootCommitId` before any switch. Nothing is ever discarded by reuse.
- Leases mirror to `git worktree lock`/`unlock` as a belt: a leased slot cannot be removed by our own cleanup or a stray `git worktree remove`.

Pool size: `ServerSettings.worktreePoolSize` (contracts `settings.ts` + `ServerSettingsPatch`), default 3, min 1, applying per repository; surfaced as a second `NumberField` row on `PreferencesSettings.tsx` (clamp helper beside `normalizeFetchIntervalSeconds`).

### Coding sessions become the first claimant

`CodingSessionService.start` changes from *create worktree* to *claim slot*: mint nothing worktree-shaped, look up (or eagerly find minted) the parent line's branch row, `slotService.claim(...)`, dispatch `thread.meta.update { branch, worktreePath: slot.path }`, lease held by the session's thread. Birth compensation releases the lease instead of removing a worktree (the CAS branch delete survives for the just-minted-branch failure case). `SlotPoolAtCapacityError` joins `CodingSessionBlockedError.reason` as `"pool-at-capacity"` — the draft sheet renders it with the existing gate-don't-fail grammar and re-enables when the slot stream reports a free slot. (Full queueing with the visible composer wait is deferred to M-197's unified composer; the contracts error carries what that UI will need.)

Lease lifetime: acquired at session start; **held while the session's turn runs, a terminal is open on the slot's cwd (`TerminalManager` open/close hooks), or a preview is running**; released on settle when none of those hold. A released session's next turn re-claims (affinity makes this a no-op while the slot is unclaimed by others). PR attach re-keys from `getByWorktreePath` to the session's branch (`coding_sessions.branch` is already unique per session).

### The runtime commits; partials stay snapshots

`CheckpointReactor`'s post-turn capture forks by workspace kind (slot-backed Mercurian thread vs upstream thread — upstream keeps today's behavior wholesale):

- **Settled turn** on a slot: `add -A` + `commit` on the line's branch (author `Astrolabe`, the checkpoint author already used), then `update-ref refs/t3/checkpoints/<b64(threadId)>/turn/<n> <commit-oid>` — the existing diff/changed-files machinery keeps working unchanged because the ref now simply points at a parented commit instead of an orphan tree. The OID lands on the session record (and marks the line's branch row `built = true`). This is what makes "committed whether or not the agent committed" true: the harness commit is the invariant, agent diligence is not.
- **Interrupted/cancelled/crashed turn**: today's orphan-tree capture path, plus `partial: true` on the checkpoint. Contracts: `OrchestrationCheckpointSummary` gains `partial?: boolean` (status stays `ready|missing|error`). The next settled commit on the line absorbs the partial (its content is the working tree the next turn continued from).
- Pre-turn baseline logic is unchanged.

Fork-point inheritance falls out: a new line forked below a built ancestor starts its branch at that checkpoint's commit OID — real ancestry, no restore dance; forked from planning-only ancestry it starts at the base ref.

### Revert is removed

Delete the loop end to end: `ThreadCheckpointRevertCommand`, `thread.checkpoint-revert-requested`, `ThreadRevertedPayload`/`thread.reverted`, `ThreadRevertCompleteCommand` from contracts and both client command unions; `decider.ts:1134-1160` + `:1357`; `CheckpointReactor.handleRevertRequested` (L690-819) and its ref-deletion (checkpoint refs are now history and are never deleted by a rewind); client `commands.ts:311`, `threadCommands.ts:195`, `threadReducer.ts:613`, `orchestrationEventEffects.ts:26`; web `ChatView.tsx` (`isRevertingCheckpoint`, `onRevertToTurnCount`, the three props), `MessagesTimeline` button + `revertTurnCount` row plumbing; `decider.checkpointRevert.test.ts` replaced by a test asserting the command type no longer exists in the dispatchable union. Forking from a checkpoint (the existing planning-DAG fork) is the rewind.

### What renders

- The plan DAG's session popover and timeline gain the partial mark: `PlanCheckpointEffect` adds `"partial"` (`PlanGraph.logic.ts:14`), label in `EFFECT_LABELS`, emitted by `effectsFor` when the session/turn record carries it; `InterruptedBadge` gets a partial sibling in `PlanTimeline.tsx`.
- The session header keeps gating on `worktreePath !== null` — under slots that is "this session's line currently holds a slot"; the shell (`_chat.sessions.$threadId.tsx`) reads the same field, now slot-fed, so scripts/Open In/git actions appear exactly when a working tree exists. No gate re-expression needed at this stage because a session holds its slot for its on-screen lifetime except between turns with no terminal/preview — and claims are affinity-first, so the path is stable in practice.

## File & module layout

| File | Change |
| --- | --- |
| `apps/server/src/mercurian/worktreeSlots/{schema,SlotStore,SlotRegistry,SlotService,wire}.ts` | **(new)** the pool: rows, leases, claim/switch/release/recovery protocol. |
| `apps/server/src/mercurian/persistence/Migrations/0NN_WorktreeSlots.ts`, `0NN_LineBranches.ts` + `Migrations.ts` | **(new)** slot and line-branch tables, additive per ADR 004. |
| `apps/server/src/mercurian/commitTree/LineBranchStore.ts` + `LineBranchReactor.ts` | **(new)** line identity (`lineRootCommitId`), eager branch minting on line-opening appends, `git branch -f` re-point until built. |
| `apps/server/src/mercurian/codingSessions/{CodingSessionService,branch}.ts` | Start claims a slot; compensation releases; `buildLineBranchName` generalized; `pool-at-capacity` refusal. |
| `apps/server/src/orchestration/Layers/CheckpointReactor.ts` | Settled-turn commit-on-branch path for slot-backed threads; `partial` marking; revert handler deleted. |
| `apps/server/src/orchestration/decider.ts`, `projector.ts` | Revert command/event cases removed. |
| `packages/contracts/src/{orchestration,settings,mercurian}.ts` | Revert types removed; `partial` on checkpoint summary; `worktreePoolSize`; `pool-at-capacity` reason. |
| `packages/client-runtime/src/{operations/commands,state/threadCommands,state/threadReducer}.ts` | Revert builders/reducer removed. |
| `apps/web/src/components/{ChatView.tsx,chat/MessagesTimeline*.ts*,…}` + `orchestrationEventEffects.ts` | Revert UI removed. |
| `apps/web/src/components/mercurian/{PreferencesSettings*,PlanGraph.logic,PlanCheckpoints.logic,PlanTimeline}.tsx/ts` | Pool-size setting; partial effect + badge. |
| `apps/server/src/mercurian/repositories/RepositoryStore.ts` | `countLiveWorktrees` gains the slot table as its store-side source (the comment already promises this). |
| `apps/server/src/server.test.ts` | Mock signatures follow (CI-only hazard). |
| `apps/server/src/ws.ts` | Slot RPC surface (snapshot + change stream for the sheet's re-enable), PR-attach re-key. |

## Implementation Checklist

- [ ] Contracts first: remove the revert command/event family; add `partial`, `worktreePoolSize`, `pool-at-capacity`; keep `server.test.ts` mocks compiling in the same commit.
- [ ] Land migrations + `SlotStore`/`LineBranchStore` with wire mappers and RPC snapshot/stream.
- [ ] Build `SlotRegistry` + `SlotService` (claim/switch/release/recovery under per-repo semaphores; partial-snapshot-then-switch; `git worktree lock` mirroring; no stash anywhere).
- [ ] Mint line branches eagerly from the planning store's line-opening appends; re-point until built; never push.
- [ ] Convert `CodingSessionService.start` to slot claims with lease lifetime (turn + terminal + preview holds) and the capacity refusal.
- [ ] Fork `CheckpointReactor`'s settled path to commit-on-branch + ref-update for slot-backed threads; mark partials; leave upstream threads byte-identical.
- [ ] Delete the revert loop server → client-runtime → web; forking from a checkpoint is the only rewind.
- [ ] Surface pool size on Preferences; partial badges on the DAG and timeline.
- [ ] Re-key PR attach off `worktreePath`; point `countLiveWorktrees` at the slot table.
- [ ] Do not touch upstream thread worktree bootstrap, mobile, `ThreadEnvMode`, or teardown (M-115); do not add queueing beyond the typed capacity refusal (M-197).

## Test Plan

House pattern: Effect service tests beside sources; suffixed suites for the reactor; integration where git is real.

- [ ] `SlotService.test.ts`: affinity reuse; switch refuses on lease; dirty-idle switch captures a partial then switches clean; at-capacity claim fails typed; two claims on one repo serialize under the semaphore; recovery snapshot on leaseless-dirty (AC: never switched away from unsettled work; orphaned slot snapshotted).
- [ ] `LineBranchReactor.test.ts`: fork mints branches in every linked repo at the right start points; base-ref change re-points an unbuilt branch; built branches never move (AC: eager refs, nothing pushed).
- [ ] `CodingSessionService.test.ts`: start claims instead of creating; compensation releases the lease; `pool-at-capacity` refusal shape (AC: pool permitting, two sessions on one repo isolated in their own slots).
- [ ] `CheckpointReactor.commitOnSettle.test.ts`: settled turn commits on the line branch with the checkpoint ref pointing at it and diffs unchanged; interrupted turn yields `partial: true` orphan snapshot; upstream (non-slot) thread behavior byte-identical (AC: committed whether or not the agent committed; partial continues).
- [ ] `decider.test.ts`: `thread.checkpoint.revert` is no longer dispatchable; no event type remains (AC: revert no longer exists).
- [ ] Client-runtime: reducer no longer folds `thread.reverted`; web logic tests for the partial badge and the pool-size clamp.
- [ ] Integration (`apps/server/integration/`): full arc — fork → eager branch → session claims slot → settle commits → second line claims second slot on the same repo → first slot switches to a third line after release, node_modules surviving (the pool's economy, observed).
- [ ] Targeted `vp test run` on touched suites + `tsgo --noEmit`; no repo-wide runs.

_The two-lines-one-repo walk and the at-capacity refusal are demonstrated live per house practice; the mock provider's seeded turns drive the DAG side, and a small pool size (1) makes the capacity case walkable._
