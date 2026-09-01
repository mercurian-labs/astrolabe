# Technical Plan — M-206: The snapshot chain

_Generated from M-206's Goal/AC and the almagest Threads note ("The working state", amended 2026-09-01: "the runtime snapshots; only people and agents commit"). Replaces M-195's settle-time runtime commit on the line's branch with a hidden, parented, per-line snapshot chain; the line's branch moves only when a person or agent commits._

**Goal, in one sentence:** the branch a person pushes carries only the commits they or their agent made, while a hidden snapshot chain beside it records every turn's whole tree — so a pull request never shows commits nobody made, nothing a turn produced is lost, and every checkpoint restores from its snapshot alone.

**Scope fences.** Upstream t3code threads (no coding session, no slot) keep today's orphan-snapshot behavior byte for byte — every change below is gated on the slot-backed path the M-195 reactor already forks on. Memory joining the slot machinery is M-194. Pruning snapshot chains at teardown is M-115. Merges (M-111) are not built; nothing here needs them, and the chain continues through a merge turn by construction. Multi-repository turns (M-196) are not built: the reactor snapshots the session's repository, as today, and the slot service's recovery capture covers every member — M-196 widens the reactor. Mobile reads only `files.length` and `status` from checkpoint summaries (`apps/mobile/src/features/review/reviewModel.ts:131-151`) and is untouched.

## Conventions detected

- **Event-sourced core, additive fork placement** (high): reactors under `apps/server/src/orchestration/Layers/`, Mercurian domain under `apps/server/src/mercurian/**` with its own migration sequence (`mercurian/persistence/Migrations.ts`, entries `[NN, "Name", MigrationNNNN]`, `NNN_Name.ts` files, sibling `NNN_Name.test.ts` asserting `PRAGMA table_info`).
- **Optional wire fields spread conditionally** (high): M-195's `partial` rides `OrchestrationCheckpointSummary`, `ThreadTurnDiffCompletedPayload`, `PlanCodingSession`, and `PlanCodingSessionRecord` as optional/defaulted fields; the projector (`projector.ts:593-602`), the checkpoint projection (`ProjectionCheckpoints.ts:168,188` via `CheckpointFilesStorage.ts`), and the client reducer (`packages/client-runtime/src/state/threadReducer.ts:484`) each spread it explicitly. New per-turn facts follow the same four-place path.
- **Hidden refs under `refs/t3/`** (high): `refs/t3/checkpoints/<b64 threadId>/turn/<n>` (`checkpointing/Utils.ts:4-10`) and `refs/t3/lines/<b64 lineRoot>/partial` (`SlotService.ts:118`). Nothing under `refs/t3/` appears in `git branch` or is pushed by default.
- **Git through the driver, never a shell** (high): `GitVcsDriver.execute({ operation, cwd, args, env?, allowNonZeroExit? })`; checkpoint plumbing runs on a temp index with the `Astrolabe` author env (`GitVcsDriver.ts:713-790`).
- **Effect service shape** (high): `Context.Service` tag + `make` as top-level `Effect.gen` + `export const layer = Layer.effect(Tag, make)`; every internal function wrapped in `Effect.fn("<Namespace>.<verb>")`; errors as `Schema.TaggedErrorClass`. `SlotRegistryLayerLive` is hoisted into `MercurianRuntimeCoreDependenciesLive` (`server.ts:495-507`) so the reactor and the slot service share one registry — any new layer needing leases is provided the same core.
- **Tests beside sources** (high): reactor tests drive a real temp git repo with mocked stores and wait on `harness.drain()` (`CheckpointReactor.test.ts:217-283, 356-430`); `SlotService.test.ts` mocks the driver and asserts on a recorded `gitCalls` array; `worktreeSlots.integration.test.ts` runs real git for the pool. Server suite runs `fileParallelism: false`.
- **Runtime receipts are test-only** (high): `RuntimeReceiptBusLive` is a no-op (`Layers/RuntimeReceiptBus.ts:22-25`); production behavior never waits on them.
- **Plans in `docs/project/technical-plan-m-NNN-*.md`** (high); conventional commits with plain-language titles (recent `git log`).
- **`server.test.ts` partially mocks services** (high, hazard): any new `CodingSessionStore` method must reach that mock in the same commit or the wire suite fails in CI only.
- **Medium:** the checkpoint projection stores `partial` inside the `files` JSON column through `CheckpointFilesStorage.ts` rather than as its own column. This plan rides that sidecar for the new per-turn facts rather than adding columns to `projection_turns`; it is the one place the convention is weak, and a reviewer may prefer real columns.

## What discovery found: the seams this plan moves

- **The settle-time commit is one block.** `CheckpointReactor.ts:418-480`: on `turn.completed` with `state === "completed"` for a slot-backed thread, `add -A` + `commit --allow-empty -m "Astrolabe checkpoint turn=N"` on the checked-out branch, `update-ref <turn ref> HEAD`, delete the line's partial ref, `recordSettledCommit(HEAD)`, `recordPartial(false)`, `markBuilt`. The interrupted branch (`:481-497`) keeps the orphan capture and marks `partial: true`. This block is what M-206 replaces.
- **Snapshots are orphan trees by construction.** `GitVcsDriver.checkpoints.captureCheckpoint` (`GitVcsDriver.ts:713-790`) runs `read-tree HEAD`, `add -A`, `write-tree`, `commit-tree <tree> -m …` with **no `-p`**, `update-ref`. Parents are one flag away. `restoreCheckpoint` (`:798-830`) and `diffCheckpoints` (`:834-889`, `git diff <from>^{commit} <to>^{commit}`) read trees only — parentage is invisible to both, and to `CheckpointDiffQuery.ts` (`getTurnDiff` :79-186, `getFullThreadDiff` :188-280), which diffs turn refs by count.
- **The line's restore point is a single ref.** `linePartialCheckpointRef` (`SlotService.ts:118`) is written by the switch-time and recovery captures (`:235-278`) and restored after `checkout <line branch>` (`:305-308`). It is exactly the slot the chain head needs, under the wrong name and with the wrong semantics ("partial" rather than "latest").
- **Affinity claims never re-checkout.** `SlotService.claim` (`:416-460`): a free slot already on the line runs `captureRecoveryPartials` and is handed back as is. An agent that left HEAD on another branch is therefore handed back on that branch. The departed rule needs a check here.
- **Fork inheritance reads the session record.** `LineBranchReactor.inheritedCommitOid` (`LineBranchReactor.ts:62-77`) starts a new line's branch at the nearest built ancestor session's `settledCommitOid`; `SlotService.projectMembers` refuses a line without a branch row. Nothing today lays the ancestor's uncommitted tree over the new branch — under M-195 there was none, because settle committed everything.
- **Branch drift is followed, not refused.** `followWorktreeBranchDrift` (`CheckpointReactor.ts:667-727`) adopts whatever branch a turn left checked out as the thread's branch when the worktree is the thread's own. Under the vault's departed rule ("the line's ref is the product's to keep") this is the opposite behavior for slot-backed threads; upstream threads keep it.
- **The pre-turn baseline is written once.** `ensurePreTurnBaselineFromTurnStart` (`:596-635`) and its domain twin (`:733-780`) capture `turn/<current>` only when that ref is missing — in practice only `turn/0`. An external snapshot at turn start is a dedupe-guarded extension of this hook.
- **The exit already offers to commit.** After settle the slot's working tree stays dirty under M-206, so `VcsStatusLocalResult.hasWorkingTreeChanges` (`contracts/git.ts:216`) is true, and `GitActionsControl.logic.ts` `resolveQuickAction` already prefers `commit_push` over `push` on a dirty tree, with the plain `push` kept in the menu; `GitManager.ts:1545-1590` takes a custom message or generates one the user reviews. The session header mounts the control gated on `worktreePath !== null` (`CodingSessionHeader.tsx:225`). AC 8's offer is therefore mostly the existing control; what is missing is the worktree-independent _reading_ of the delta.
- **Where per-turn facts render.** `PlanCheckpointEffect` union + `EFFECT_LABELS` + `effectsFor` (`PlanGraph.logic.ts:14-25`, `PlanCheckpoints.logic.ts:34-40, 176-190`), `PartialBadge`/`InterruptedBadge` (`PlanTimeline.tsx:183, 226, 358-367`), node popover session facts (`PlanNodePopover.logic.ts:144-161`, rendered `:291-299`). The changed-files card reads only `summary.files` (`MessagesTimeline.tsx:1583-1650`). Diff scopes live in `DiffPanel.tsx:528-600` over `ReviewDiffPreview` sources (`contracts/review.ts:13-26`).
- **Session record surface.** `coding_sessions` gained `settled_commit_oid` and `partial` in migration 012; `CodingSessionStore.recordSettledCommit`/`recordPartial` (`CodingSessionStore.ts:217-225`) and `wire.ts` map them to `PlanCodingSessionRecord` (`contracts/mercurian.ts:110-124`), held client-side in `planReducer.ts:165-182`.

## Design

### The load-bearing idea: two records per line, one is hidden

Every slot-backed line keeps, per repository, **the line's branch** — `refs/heads/mercurian/<slug>-<hex>`, minted eagerly by `LineBranchReactor`, moved only by a person's or an agent's own git — and **the snapshot chain** — parented commits under `refs/t3/`, written by the runtime, never listed, never pushed. The runtime writes to the second and only ever _reads_ the first. That inversion is the whole change; everything else is plumbing that already exists pointed at the other record.

### Chain topology: two parents, one head ref

A chained snapshot is the existing temp-index capture with parents:

- **parent 1** — the line's previous snapshot (the chain), absent only for the first snapshot of a line with nothing to inherit;
- **parent 2** — the commit `HEAD` resolved to when the tree was captured. This is the pin: however the branch is later rewritten, the commit stays reachable, and "what the branch did during this turn" is `prev^2..this^2` — derived from git, no table.

The tree is always the whole working tree (tracked and untracked, ignored excluded), exactly as today; parent 2 supplies nothing to restore, only provenance. The commit message names the kind: `t3 snapshot kind=<settled|partial|recovery|external> ref=<ref>`.

Refs:

- `refs/t3/checkpoints/<b64 threadId>/turn/<n>` — unchanged; turn snapshots (settled and partial) keep their addressable names so `CheckpointDiffQuery`, the projection, and the changed-files card work untouched.
- `refs/t3/lines/<b64 lineRoot>/snapshot` — **(renamed from `/partial`)** the line's latest snapshot of any kind, the chain head. Every capture on the line re-points it. `lineSnapshotRef` replaces `linePartialCheckpointRef` in `SlotService.ts`.
- `refs/t3/lines/<b64 lineRoot>/snapshots/<kind>-<iso-compact>` — **(new)** external and recovery snapshots, which belong to no turn. They are on the chain (the next turn snapshot's parent 1) and reachable by name for forensics.

A snapshot's **kind** is what M-195's `partial` boolean was reaching for. Settled and partial ride turn refs; recovery is what `captureRecoveryPartials` and the switch-time dirty capture write today (a dirty slot with no turn attached); external is new (below).

### The driver grows parents; nothing else about it changes

`VcsCaptureCheckpointInput` (`VcsDriver.ts:17-20`) and `CaptureCheckpointInput` (`CheckpointStore.ts`) gain `parents?: ReadonlyArray<string>` and `message?: string`. `GitVcsDriver.checkpoints.captureCheckpoint` appends `-p <oid>` per parent to `commit-tree` and uses the message when given. Upstream callers pass neither, so their orphan capture is byte-identical. The driver stays content-blind: it does not know what a kind or a line is.

### One helper owns chained capture: `SnapshotChain`

**(new)** `apps/server/src/mercurian/worktreeSlots/SnapshotChain.ts`, beside `SlotService` because both the reactor and the slot service capture on a line and both would otherwise duplicate the parent resolution. Placement justified by `linePartialCheckpointRef` already living in `SlotService.ts` and being imported by the reactor. Shape, in the house `Context.Service` + `layer` form, depending on `CheckpointStore`, `GitVcsDriver`, `LineBranchStore`:

- `capture({ cwd, lineRootCommitId, kind, ref })` — resolves `prev = rev-parse -q <line snapshot ref>`, `headOid = rev-parse -q HEAD^{commit}`, `headRef = symbolic-ref -q HEAD` (non-zero exit → detached); calls `checkpointStore.captureCheckpoint({ cwd, checkpointRef: ref, parents: [prev?, headOid?], message })`; `update-ref <line snapshot ref> <new>`; returns `{ oid, previousOid, headOid, headRef }`. For `kind` recovery/external, `ref` is minted under `snapshots/`.
- `branchMovement({ cwd, previousOid, lineBranch })` — the derived reading: `prevHead = rev-parse -q <previousOid>^2` (or the line-branch row's `baseOid` when there is no previous snapshot); `tip = rev-parse refs/heads/<lineBranch>`; equal → `{ kind: "unchanged" }`; `merge-base --is-ancestor prevHead tip` → `{ kind: "added", count: rev-list --count prevHead..tip }`; else `{ kind: "rewritten" }`.
- `departure({ headRef, lineBranch })` — `headRef === refs/heads/<lineBranch>` → `null`; otherwise the ref name, or `"detached"`.
- `isDrifted({ cwd, lineRootCommitId, lineBranch })` — `status --porcelain --untracked-files=all` non-empty, or `HEAD` ≠ the line snapshot's parent 2 (or ≠ the branch tip when there is no snapshot). The dedupe guard for the opening capture.

### The reactor stops committing

`CheckpointReactor.captureCheckpointFromTurnCompletion` (`:380-520`), slot-backed path, both settled and interrupted:

1. `snapshotChain.capture({ cwd, lineRootCommitId: slot.currentLineRootCommitId, kind: settled ? "settled" : "partial", ref: turn ref })`.
2. `movement = snapshotChain.branchMovement(...)`, `departedRef = snapshotChain.departure(...)`. Branch tip for the record is `rev-parse refs/heads/<session.branch>` — the line's own ref, never HEAD — so a departed turn's recorded tip is where the _line's_ branch stands.
3. `codingSessions.recordSnapshot(threadId, { snapshotOid, kind, branchTipOid, departedRef, branchMovement })`, which also writes `settled_commit_oid = branchTipOid` on settled turns (so `LineBranchReactor.inheritedCommitOid` keeps its meaning: where the line's branch stood at its last settled snapshot) and `partial = kind === "partial"` (so every current `partial` reader is unchanged).
4. `lineBranches.markBuilt` on the **first snapshot of any kind** on the line. Semantic shift, recorded here: `built` now means "a turn has run on this line," because a snapshot pins the base as parent 2 and re-pointing the branch afterwards would desync the chain. Previously it meant "a settled commit landed."
5. `captureAndDispatchCheckpoint({ …, capture: false, kind, departedRef, branchMovement })` with `fromCheckpointRef` = **`<turn ref>^1`** when parent 1 exists, else the previous turn ref as today. A new `chainParentRef(ref)` in `checkpointing/Utils.ts` builds the `^1` suffix; `diffCheckpoints` already interpolates `${from}^{commit}`, and `refs/…^1^{commit}` is a valid revision. This is what keeps an external snapshot out of the following turn's diff.

Deleted: the `add -A` / `commit` / `update-ref HEAD` block, `deleteCheckpointRefs([partial ref])`, `recordSettledCommit` and `recordPartial` as separate calls (folded into `recordSnapshot`). The `Effect.ensuring` release of the turn lease stays.

`ThreadTurnDiffCompletedPayload` and `OrchestrationCheckpointSummary` gain optional `snapshotKind`, `departedRef`, `branchMovement` beside `partial`; the projector, `CheckpointFilesStorage.ts`, `ProjectionCheckpoints.ts`, and `threadReducer.ts:474-521` spread them the way `partial` is spread. `partial` stays on the wire for this PR (it is `snapshotKind === "partial"`); retiring it is a follow-up once the web reads kind.

### The opening capture: external snapshots

`ensurePreTurnBaselineFromTurnStart` and `ensurePreTurnBaselineFromDomainTurnStart` keep their `turn/0` behavior for every thread. For a slot-backed thread (same `codingSessions.getByThreadId` + slot match the completion path uses), after the baseline check: `if (yield* snapshotChain.isDrifted(...))` → `snapshotChain.capture({ kind: "external", ref: snapshots/external-<ts> })` and `thread.activity.append { kind: "checkpoint.external", summary: "Changes outside a turn were snapshotted" }` — the activity kind already renders in the thread's work log as `checkpoint.captured` does (`:311-338`). A clean, unmoved tree writes nothing, so idle turns add nothing.

### Departed turns: the ref is the product's

- **Detect** at capture (above): `departedRef !== null` lands on the session record and the turn's checkpoint.
- **Never follow.** `refreshLocalGitStatusFromTurnCompletion` skips `followWorktreeBranchDrift` when the thread has a coding session (the slot-backed gate); upstream threads keep adopting drift.
- **Return on next claim.** `SlotService.claim`'s affinity branch (`:432-437`) checks each member's `symbolic-ref -q HEAD` against `refs/heads/<member.currentBranch>`; any mismatch runs the same per-member settle the switch path runs — recovery capture if dirty, `reset --hard`, `clean -fd`, `checkout <line branch>`, restore the line snapshot — extracted from `switchSlot` into a `settleMember` helper so both paths share it. The work comes back as uncommitted changes on the line's own branch; the departed commits stay in git under their own ref.
- **Never commit outside the namespace.** The runtime's only writes are `update-ref` under `refs/t3/` and `checkout`/`branch` of `mercurian/…` refs, which is already true once the settle commit is gone; the SnapshotChain helper never runs `commit`. The AC's "a branch checked out in my own working copy cannot be checked out in a slot" is git's own worktree guard and needs no code — the integration test asserts it.

### Restore reads the chain head, and forks inherit it

- `SlotService.switchSlot` restores `lineSnapshotRef` after checkout (`:305-308`, ref renamed). Because the ref is now the latest snapshot of any kind, this one rule covers partials, recovery captures, and inheritance.
- `LineBranchReactor.reconcile`: when a new line's branch is created from an inherited ancestor, also `update-ref refs/t3/lines/<new>/snapshot <ancestor snapshotOid>` — read from the ancestor session record's new `snapshotOid` (same walk as `inheritedCommitOid`). The new line's first claim checks out the branch at the ancestor's recorded tip and lays the ancestor's tree over it; its first turn snapshot chains to the ancestor's as parent 1. The existing limitation stands: a session record carries its _latest_ snapshot, so a fork below a session's leaf inherits the latest — unchanged from M-195's `settledCommitOid`.
- `captureRecoveryPartials` and the switch-time dirty capture become `snapshotChain.capture({ kind: "recovery" })`.

### The exit reading: the delta beyond the branch, from refs

**(new)** `CheckpointDiffQuery.getLineUncommittedDiff({ threadId })`: diff `refs/heads/<session.branch>` → the line snapshot ref, via `checkpointStore.diffCheckpoints` (both sides are revisions; `CheckpointRef` is a branded string and the branch ref name passes through `^{commit}` unchanged). Exposed as `mercurian.readLineUncommittedDiff` in `contracts/mercurian.ts` and handled in `ws.ts` beside the slot RPCs, returning the same unified-diff shape `orchestration.getTurnDiff` returns. Web: one new entry in the `DiffPanel.tsx:528-600` scope list, **Uncommitted**, shown for Mercurian sessions, backed by a `line-uncommitted` source. This is worktree-independent, which also closes an M-195 hazard: a session's `worktreePath` keeps pointing at a slot after another line takes it, so **Working tree** can show the other line's files; **Uncommitted** cannot.

The offer to commit first is the existing `GitActionsControl` (`commit_push` quick action on a dirty tree, plain `push` in the menu, message reviewed or custom through `GitManager`). No change beyond verifying it in the walk. Off-slot exits (a line whose slot was switched away) stay gated off by `worktreePath !== null` exactly as today — the thread code view (M-197/M-198) is where that gate moves.

### What renders

- `PlanCodingSessionRecord` gains `snapshotOid`, `snapshotKind`, `departedRef`, `branchMovement` (`wire.ts` maps them; `planReducer.ts` holds them).
- Node popover session facts (`PlanNodePopover.logic.ts:144-161`): a **Branch** line reading "no commits", "N commits added", or "history rewritten", and a **Departed to `<ref>`** line when set.
- `PlanCheckpointEffect` gains `"departed"` with an `EFFECT_LABELS` entry and a `DepartedBadge` sibling of `PartialBadge` in `PlanTimeline.tsx`. `partial` keeps rendering from the record as today.
- External snapshots surface as the work-log activity line; no new component.

## File & module layout

| File                                                                                                                    | Change                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/vcs/VcsDriver.ts`, `GitVcsDriver.ts`, `checkpointing/CheckpointStore.ts`                               | `parents?` + `message?` on capture; `-p` per parent on `commit-tree`; orphan path unchanged when absent.                                                 |
| `apps/server/src/checkpointing/Utils.ts`                                                                                | `chainParentRef(ref)` (`^1` suffix).                                                                                                                     |
| `apps/server/src/mercurian/worktreeSlots/SnapshotChain.ts` (+ `.test.ts`)                                               | **(new)** chained capture, branch movement, departure, drift check; `lineSnapshotRef`, `lineExtraSnapshotRef`.                                           |
| `apps/server/src/mercurian/worktreeSlots/SlotService.ts`                                                                | `linePartialCheckpointRef` → `lineSnapshotRef`; recovery captures chain; `settleMember` extracted; affinity claim returns a departed member.             |
| `apps/server/src/orchestration/Layers/CheckpointReactor.ts`                                                             | Settle block replaced by chained capture + `recordSnapshot` + movement/departure; `^1` diff base; external snapshot at turn start; drift-follow skipped. |
| `apps/server/src/checkpointing/CheckpointDiffQuery.ts`                                                                  | Adjacent-turn diffs prefer `<to>^1` when it resolves; `getLineUncommittedDiff`.                                                                          |
| `apps/server/src/mercurian/commitTree/LineBranchReactor.ts`                                                             | Seeds the new line's snapshot ref from the inherited ancestor's `snapshotOid`.                                                                           |
| `apps/server/src/mercurian/codingSessions/{schema,CodingSessionStore,wire}.ts`                                          | `snapshotOid`, `snapshotKind`, `departedRef`, `branchMovement`; `recordSnapshot` (writes `settled_commit_oid` and `partial` for compatibility).          |
| `apps/server/src/mercurian/persistence/Migrations/014_SnapshotChain.ts` (+ `.test.ts`) + `Migrations.ts`                | **(new)** four columns on `coding_sessions`; entry `[14, "SnapshotChain", …]`.                                                                           |
| `packages/contracts/src/{orchestration,mercurian}.ts`                                                                   | Optional `snapshotKind`, `departedRef`, `branchMovement` on summary/payload; record fields; `readLineUncommittedDiff` RPC.                               |
| `apps/server/src/persistence/{CheckpointFilesStorage.ts,Layers/ProjectionCheckpoints.ts}`, `orchestration/projector.ts` | Sidecar carries the new facts beside `partial`.                                                                                                          |
| `apps/server/src/ws.ts`, `apps/server/src/server.test.ts`                                                               | RPC handler; mock gains `recordSnapshot` (CI-only hazard).                                                                                               |
| `packages/client-runtime/src/state/{threadReducer,planReducer}.ts`                                                      | Conditional spreads for the new fields.                                                                                                                  |
| `apps/web/src/components/mercurian/{PlanGraph.logic,PlanCheckpoints.logic,PlanNodePopover.logic,PlanTimeline}.ts(x)`    | `departed` effect + badge; popover branch and departed lines.                                                                                            |
| `apps/web/src/components/DiffPanel.tsx`, `apps/web/src/diffPanelStore.ts`                                               | **Uncommitted** scope for Mercurian sessions.                                                                                                            |
| `docs/internals/glossary.md`, `docs/internals/overview.md`, `docs/user/projects-and-plans.md`                           | Checkpoint/baseline/revert entries and the session worktree paragraph rewritten for the chain; the stale "Revert to this message" line removed.          |

## Implementation Checklist

- [ ] Contracts first: optional `snapshotKind`, `departedRef`, `branchMovement` on `OrchestrationCheckpointSummary` and `ThreadTurnDiffCompletedPayload`; the four record fields on `PlanCodingSessionRecord`; `readLineUncommittedDiff`; keep `partial` on the wire; keep `server.test.ts` mocks compiling in the same commit.
- [ ] Driver: `parents`/`message` on capture through `VcsDriver` → `GitVcsDriver` → `CheckpointStore`; `-p` per parent; no behavior change when absent.
- [ ] Migration 014 + `CodingSessionStore.recordSnapshot` + `wire.ts`; `recordSettledCommit`/`recordPartial` removed once the reactor no longer calls them.
- [ ] `SnapshotChain` service: capture (parents + head ref + kind message + head-ref move), `branchMovement`, `departure`, `isDrifted`; provided from `MercurianRuntimeCoreDependenciesLive` so the reactor and `SlotService` share it.
- [ ] `SlotService`: rename the line ref; recovery captures chain; extract `settleMember`; affinity claim checks for a departed member and settles it; restore reads the chain head.
- [ ] Reactor: replace the settle block; `^1` diff base; external snapshot in both turn-start hooks; skip drift-follow for coding sessions; `markBuilt` on first snapshot; leave upstream threads byte-identical.
- [ ] `LineBranchReactor`: seed the inherited line's snapshot ref.
- [ ] `CheckpointDiffQuery`: prefer `^1` for adjacent-turn diffs when it resolves; `getLineUncommittedDiff`; `ws.ts` handler.
- [ ] Projection sidecar + projector + client reducers spread the new fields.
- [ ] Web: `departed` effect, badge, popover lines; **Uncommitted** diff scope.
- [ ] Docs: glossary (Checkpoint, Checkpoint baseline, Revert — the last is already stale from M-195), overview's Checkpointing section, user doc's session paragraph.
- [ ] Do not add a setting; do not touch upstream thread bootstrap, `ThreadEnvMode`, mobile, memory (M-194), or teardown (M-115); do not make the runtime run `git commit` anywhere.

## Test Plan

House pattern: real temp git for the reactor and the driver, mocked driver with a recorded `gitCalls` array for the slot service, integration where the pool and git meet.

- [ ] `CheckpointStore.test.ts` / `GitVcsDriver.test.ts`: capture with two parents yields a commit whose `rev-parse <ref>^1`/`^2` match; without parents the commit has none and the message is unchanged (AC: chain is parented; upstream byte-identical).
- [ ] `SnapshotChain.test.ts` (real git, mocked stores): first capture on a line has parent 2 = HEAD and no parent 1; second chains to the first; `branchMovement` reports unchanged / added N (after `git commit` in the repo) / rewritten (after `commit --amend`); `departure` names a checked-out foreign branch and `"detached"`; `isDrifted` is false on a clean, unmoved tree.
- [ ] `CheckpointReactor.test.ts` — replace the two slot-backed cases (`:647`, `:708`): a settled slot-backed turn leaves `HEAD`, `branch --show-current`, and `log -1` unchanged, the turn ref is a two-parent commit with the worktree's tree, the working tree is still dirty afterwards, the line snapshot ref moved, `recordSnapshot` captured kind `settled`, `markBuilt` fired (AC 1, 2, 5); an interrupted turn yields kind `partial` with `partial: true` still on the summary (AC 3); a turn that checked out `main`'s sibling branch before completing records `departedRef` and leaves the line's branch untouched (AC 6); a dirty tree at `turn.started` writes an external snapshot and activity, a clean one writes nothing (AC 4); the turn diff excludes the external change (`^1` base); a non-slot thread still captures an orphan and still follows branch drift (AC: upstream unchanged).
- [ ] `SlotService.test.ts`: recovery capture calls carry parents; switch restores the renamed ref; an affinity claim whose member reports a foreign `symbolic-ref` runs reset/clean/checkout/restore before handing the slot back; a matching one does not.
- [ ] `LineBranchReactor.test.ts`: an inherited line's creation also `update-ref`s its snapshot ref to the ancestor's `snapshotOid`; a root line does not.
- [ ] `CheckpointDiffQuery.test.ts`: adjacent-turn diff uses `<to>^1` when the store resolves it, the previous turn ref otherwise; `getLineUncommittedDiff` diffs branch tip → snapshot.
- [ ] `014_SnapshotChain.test.ts`: migration tail is 14; `PRAGMA table_info(coding_sessions)` lists the four new columns.
- [ ] Client-runtime: reducer spreads the new optional fields; web logic tests for `departed` label and the popover branch line.
- [ ] `worktreeSlots.integration.test.ts` extended (real git): a settled turn's slot shows a dirty `status --porcelain` and an unmoved branch; `git checkout main` inside a slot fails while the primary checkout has `main` out (AC 10, git's guard observed); forking a built line yields a new slot whose branch starts at the ancestor's recorded tip with the ancestor's uncommitted file present (AC 7).
- [ ] Targeted `vp test run` on touched suites + `tsgo --noEmit` for `apps/server`, `packages/contracts`, `packages/client-runtime`, `apps/web`; no repo-wide runs.

_The walk: settle a mock-provider turn, confirm the branch did not move and the session header's quick action reads Commit & push with Push still in the menu; check out another branch in the slot from a terminal, settle a turn, confirm the Departed badge and that the next turn returns the slot to the line's branch with the file present; edit a file in the slot between turns and confirm the external snapshot line in the work log._
