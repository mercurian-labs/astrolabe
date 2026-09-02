# Technical Plan — M-194: Memory branches: a line's amendments stay its own until merged home

_Preliminary. Generated 2026-09-02 from M-194's Goal/AC as re-scoped on 2026-09-01, plus three clarifications proposed the same day and not yet in Linear: the write-path commit is the one commit the product makes on a line's branch, only ever at the agent's request; an unmarked change is one the line's latest snapshot holds beyond its branch, and reverting it needs no slot; a note edited outside the product on main is current on the browse surface at once and reaches a line only through git. Grounded against the M-206 tree as implemented (`technical-plan-m-206-snapshot-chain.md`), whose landing this plan assumes._

**Goal, in one sentence:** a thread's amendments land on the line's own branch of the memory repository, each line reads the memory its ancestry left it, and nothing reaches the memory's main line except through the human merge home.

**Scope fences.** Staleness stamps at landing are M-203. The deterministic utilities are M-193. Pruning memory branches and chains rides M-115. Memory grounding for the unified thread (M-197) is not built; this plan grounds the two turn kinds that exist today, planning turns and coding-session turns. Mobile has no memory surface and is untouched. The Open Decisions parser and heading guard are gone (M-202); nothing here reads a note's meaning.

## Conventions detected

- **Mercurian domain under `apps/server/src/mercurian/` with its own migration sequence** (high): `persistence/Migrations.ts` entries, `NNN_Name.ts` + `.test.ts` pinning `PRAGMA table_info`. Tail is 14 after M-206; this plan adds 015.
- **Memory module shape** (high): `memory/MemorySourceStore.ts` (designation rows, `resolveRoot` realpath containment), `memory/MemoryIndex.ts` (per-`rootPath` cache keyed on a file fingerprint, `listFiles` via `git ls-files`, `prepareAmendment`/`applyAmendment`/`commitPaths` through `ProcessRunner` git), `memory/memoryModel.ts` (graph, skill maps, placements), `memory/schema.ts` + `wire.ts`; tests beside each. Contracts in `packages/contracts/src/mercurianMemory.ts` (`MERCURIAN_MEMORY_WS_METHODS`), RPC scopes in `auth/RpcAuthorization.ts:82`.
- **Amendment flow is a turn-scoped proposal** (high): `mcp/toolkits/planning/tools.ts:52-137` `propose_memory_amendment` → `PlanningAssistant.proposeMemoryAmendmentFromThread` (`:1898`) stashes `pendingMemoryAmendment` on the turn → `settleMemoryAmendment` (`:618-649`) prepares and publishes `memory-amendment-proposed` → `ws.ts:2478-2522` `confirmMemoryAmendment` applies and `PlanningStore.appendMemoryAmendment` (`:1938-1964`) records a flavored message with `memoryCommitSha`.
- **Line identity and membership** (high, from M-195/M-206): `commitTree/LineBranchReactor.ts` mints `mercurian/<slug>-<hex>` in every `projectRepositories`-linked repo per line root; `worktreeSlots/SlotService.ts` `projectMembers` builds slot membership from the same links; `worktreeSlots/SnapshotChain.ts` owns `lineSnapshotRef`, chained capture, `isDrifted`; `checkpointing/CheckpointDiffQuery.getLineUncommittedDiff` diffs `refs/heads/<line branch>` → the chain head from the repository's own path.
- **Planning turns run read-only in primary checkouts, never in a slot** (high): `PlanningAssistant.runRebuild` (`:1186-1224`) `approvalPolicy: "never"`, roots = linked repositories + the memory root as `kind: "memory"` (`buildRebuildMaterials` `:1096-1170`). Coding sessions hold a slot and have no memory root at all (`codingSessions/CodingSessionService.ts:171-175`).
- **Web planning space right pane is a two-state toggle** (high): `PlanningSpace.tsx:151-164` `RightPaneState { open, view: "artifact" | "explorer", artifact }` persisted under `mercurian:plan-right-pane:v2`; corner icons in `PlanPaneToggle` (`:1271-1314`). Memory reader overlay at `:1052-1068`; amendment sheet dialog at `:1150-1159`; `PlanSuggestions.tsx` + `planSuggestions.logic.ts` derive suggested next messages from memory content only.
- **Tests beside sources; `server.test.ts` mocks drift in CI only** (high): any new `MemoryIndex`, `CodingSessionStore`, or planning-assistant method must reach that mock in the same commit.
- **Medium:** git for the memory repository runs through `ProcessRunner` in `MemoryIndex.ts:105`, not `GitVcsDriver`. This plan moves the new ref-level operations onto `GitVcsDriver.execute` like the rest of the Mercurian git code, and leaves the existing calls in place — a reviewer may prefer migrating all of them at once.

## What discovery found: the seams this plan moves

- **There is one memory root and it is the human's checkout.** `MemorySourceStore.getResolvedSource` → `rootPath` under the registered repository's own path (`MemorySourceStore.ts:172-203`); every read (`MemoryIndex.listFiles :173-197`, `loadRoot :230-289`) and every write (`commitPaths :119-154`, `commit --only` on whatever branch that checkout is on) targets it. Reads take `{ projectId }` only (`mercurianMemory.ts:106-113`). This is exactly the main line the browse surface should keep reading, and exactly the wrong place for a line's writes.
- **Designation and membership do not meet.** `designate` (`MemorySourceStore.ts:205-232`) accepts any registered repository with no `projectRepositories` check; the web picker lists all repositories (`ManageProjectRepositoriesDialog.tsx:223-260`). Line branches and slot members come only from `projectRepositories`. A standalone memory repository therefore has no line branch and no slot member today.
- **The proposal is per-plan and in-memory.** `memoryAmendmentProposals: Map<PlanId, …>` (`PlanningAssistant.ts:506`), one entry, lost on restart, not keyed by line. Under this plan the proposal disappears: the tool call lands the commit.
- **The drift guard exists at the right shape.** `applyAmendment` (`MemoryIndex.ts:490-521`) re-reads each path and refuses with `ConfirmMemoryAmendmentBlockedError { reason: "memory-changed" }` when it differs from the proposal's `before`. It compares against the designated working tree; it needs to compare against the line.
- **Nothing lists what a line changed.** No path-scoped `git log`, no per-commit review state, no store for either. `PlanTimeline.tsx:107-118` renders a landed amendment as one muted line and ignores the recorded SHA.
- **Nothing says "shipped."** `PlanCodingSessionRecord.prUrl` is written once at PR creation (`ws.ts:424-442`) and never updated; PR state (`open | closed | merged`) lives in the git layer's status (`contracts/git.ts:45-47`, `GitManager.ts`), keyed by branch, never joined back to a session or plan.
- **The chain already gives a line's memory state a name.** `lineSnapshotRef(lineRoot)` is the tree of everything the line holds, marked or not; `refs/heads/<line branch>` is what it committed. "Unmarked" is the difference between the two restricted to the memory root — the same reading `getLineUncommittedDiff` already computes for code.

## Design

### The load-bearing idea: the memory is a member, and a line's memory is a tree, not a folder

Two moves. First, the memory repository becomes a member of every slot and gets a line branch per line, through the same reactor and the same claim path as code, so nothing about memory needs its own worktree machinery. Second, every product read of a line's memory is a **tree read** from refs — the chain head when the line has a snapshot, else the branch tip — restricted to the memory root, so reads never depend on which slot the line holds or whether it holds one. Only a running turn touches files by path, and it does so in the slot it holds. The main line keeps being read from the designated checkout exactly as today.

### Membership: one repository set for lines, slots, and branches

**(new)** `apps/server/src/mercurian/worktreeSlots/projectWorkingRepositories.ts`, a pure function over `RepositoriesSnapshot` + `MemorySource`: the project's linked repositories, plus the memory source's repository when it is not among them. `LineBranchReactor.reconcile` and `SlotService.projectMembers` both call it instead of filtering `projectRepositories` themselves. Consequences that fall out: a standalone memory repository gets `mercurian/…` line branches minted at fork time, a slot member at its relative on-disk position, recovery and external snapshots, and the fork inheritance M-206 built. A memory inside a linked code repository is already a member and needs nothing. `CodingSessionService.start` keeps requiring the _session's_ repository to be linked (`:258-266`); the memory member rides along in the slot without being offered as a session's repository.

**Nested-repository refusal.** `MemorySourceStore.resolveRoot` (`:139-170`) gains one check through `GitVcsDriver`: `rev-parse --show-toplevel` of the candidate must equal the repository's own toplevel, else `MemorySourceInvalidError { reason: "nested-repository" }`; the contract's reason union (`mercurianMemory.ts`) grows the literal and the dialog names the two accepted shapes.

### Reads: a `MemoryTreeSource` beside the working-tree root

`MemoryIndex` today has one notion of where memory is: `ResolvedMemorySource.rootPath`. It gains a second, **(new)** in `memory/schema.ts`:

```
MemoryTreeSource = { kind: "worktree", rootPath } | { kind: "ref", repositoryPath, ref, subpath }
```

- `listFiles` for a `ref` source runs `git ls-tree -r --name-only <ref> -- <subpath>`; `readIfExists` runs `git show <ref>:<subpath>/<path>`; both through `GitVcsDriver.execute` in `repositoryPath`. The cache key becomes `(kind, rootPath | repositoryPath + resolved oid + subpath)`, so a moved ref is a new entry and the per-`rootPath` fingerprint path is untouched for the main line.
- **(new)** `MemoryIndex.resolveLineSource({ projectId, threadId })` → the line for the thread (`LineBranchStore.listAll` matched on the memory repository id and the thread's line branch, resolved the way `getLineUncommittedDiff` does), then `ref = lineSnapshotRef(lineRoot)` when it resolves, else `refs/heads/<line branch>`. The thread's line comes from `lineRootCommitIdFor(detail, commitId)` for planning threads (`LineBranchReactor.ts:39`) and from the session's branch for coding sessions.
- Contracts: `MercurianReadMemoryIndexInput` and `MercurianReadMemoryNoteInput` gain optional `threadId`; absent means the main line. `ws.ts` handlers pass it through; the standalone Memory page sends none, the in-thread reader and mentions send the thread's.
- **Grounding.** A planning turn's memory root becomes the line's tree materialized on demand: `PlanningAssistant.buildRebuildMaterials` asks `MemoryIndex.materializeLineRoot({ projectId, threadId })`, which checks the line's tree out into a per-line read-only directory under the worktrees dir (`git worktree add --detach <path> <ref>` when absent, `git checkout --detach <ref>` when present) and hands that path to the provider as the `kind: "memory"` root. This keeps planning turns out of the slot pool, which they never needed, and gives the provider a real path. A coding session's turn already holds a slot; `CodingSessionService.start` (`:171-175`) adds the memory member's path as an additional root and the same prompt appendix `PlanningPrompt.ts:65-80` builds, extracted into a shared `memoryAppendix(...)`.

### Writes: the tool lands the commit, on the line's branch, through plumbing

The proposal round-trip retires. `propose_memory_amendment` keeps its input shape (`tools.ts:52-66`) and its description changes to "lands an amendment on this line's memory branch". The handler calls **(new)** `MemoryIndex.landAmendment({ projectId, threadId, turnId, amendment })`:

1. `prepareAmendment` as today, with `before` read from the **line's tree source**, not the designated root. A mismatch between `before` and the line's current tree is the drift guard: `MemoryAmendmentValidationError { reason: "memory-changed" }` returned to the tool, in the turn, so the agent re-reads and retries.
2. Build the new tree by plumbing, no worktree required: temp index ← `read-tree <line branch tip>`; `update-index --add --cacheinfo` (or `hash-object -w` + `update-index`) for each changed path under the subpath; `write-tree`; `commit-tree <tree> -p <line branch tip> -m <message>`; `update-ref refs/heads/<line branch> <new> <old>` (compare-and-swap on the old tip). Message: the title, then trailers `Astrolabe-Amendment: <turnId>` and the existing `Amended-from-plan: <plan> (<planId>)`. The trailer is the **mark**.
3. If a slot member currently has the line branch checked out (the running coding-session turn, or an idle slot on the line), refresh only the amended paths in that worktree: `git checkout <line branch> -- <paths>` in the member path, so the working tree and HEAD agree and the next snapshot's parent 2 is the new tip. Planning turns, which run in the materialized read-only directory, get the same refresh there.
4. Record the landing in the plan history as today: `PlanningStore.appendMemoryAmendment` with `memoryCommitSha`, plus the branch name.

This is the one place the product commits to a line's branch, always inside a turn the agent is running, which is what keeps M-206's "the runtime never commits" true in spirit: the runtime's own bookkeeping still never touches it, and M-206's `branchMovement` will report these commits as "added", which is correct.

`confirmMemoryAmendment` / `cancelMemoryAmendment`, the `memory-amendment-proposed` stream item, `PlanDetail.memoryAmendmentProposal`, and `MemoryAmendmentSheet` as a modal retire with the gate; the sheet's diff rendering moves into the memory tab (below). The prompt's "proposing is not writing" stanza (`PlanningPrompt.ts:75-77`) becomes "an amendment lands on this line's memory branch as its own commit; one amendment per call, nothing else in it," which is the base teaching's rule stated where the agent reads it (M-192 carries the full teaching).

### The memory tab: marked commits, the unmarked delta, review state, revert

**Server.** **(new)** `MemoryIndex.readLineChanges({ projectId, threadId })`:

- **Marked**: `git log --first-parent --format=<oid>%x00<subject>%x00<trailers>%x00<author date> <base>..refs/heads/<line branch> -- <subpath>` from the repository path, where `<base>` is the line-branch row's `baseOid`; entries carrying the `Astrolabe-Amendment` trailer are amendments (turn attribution from the trailer), the rest are commits a person or the agent made by hand and show as such.
- **Unmarked**: `diff <line branch tip> <lineSnapshotRef> -- <subpath>` via `CheckpointStore.diffCheckpoints`; non-empty means one unmarked entry with that diff.
- Review state from **(new)** table `memory_amendment_reviews(line_root_commit_id, repository_id, commit_oid, reviewed_at)` (migration `015_MemoryAmendmentReviews.ts` + `MemoryReviewStore.ts`); `unreviewedCount` = marked entries without a row, plus one when the unmarked entry exists.
- RPCs in `mercurianMemory.ts`: `readLineMemoryChanges`, `markMemoryChangeReviewed`, `revertMemoryChange`.

**Revert**, one act, no slot:

- A marked commit: new commit on the line branch whose tree is the current tip's tree with the amended paths restored from the commit's parent (`read-tree <tip>`; for each path, `update-index --cacheinfo` from `<commit>^:<path>` or `--remove` when the commit added it; `write-tree`; `commit-tree -p <tip>`; CAS `update-ref`). Message "Reverted: <title>" with the amendment trailer, so the revert itself lists as marked and reviewed. The refresh step from writes applies to any member on the branch.
- The unmarked entry: a new snapshot on the chain whose tree is the chain head's tree with the memory paths restored from the branch tip, parents `(chain head, HEAD)`, kind **`curated`** — one new literal on M-206's `SnapshotKind`, and **(new)** `SnapshotChain.captureTree({ treeOid, … })` beside `capture`. The next claim on the line restores it over the branch as it restores any snapshot, and a slot already on the line refreshes the memory paths as writes do.

**Web.** `RightPaneState.view` gains `"memory"` (storage key bumped to `v3` with a tolerant decode of `v2`), a third corner `Toggle` in `PlanPaneToggle` (`BookOpenCheckIcon`, already used by the timeline row), and **(new)** `apps/web/src/components/mercurian/MemoryTab.tsx` + `.logic.ts` + `.logic.test.ts` + `.catalog.tsx`: the list (marked with attribution and review state, the unmarked entry, hand commits), the unreviewed count badge on the toggle, each entry expanding to the diff through the viewer `MemoryAmendmentSheet.tsx` uses today, **Reviewed** and **Revert** actions. State module `apps/web/src/state/mercurianMemory.ts` gains the three requests; `packages/client-runtime/src/state/mercurianMemory.ts` gains the atoms. The timeline row (`PlanTimeline.tsx:107-118`) links to the tab.

### The browse surface reads main; what a line changed is visible from the thread

Unchanged for the Memory page: `readMemoryIndex` without `threadId` reads the designated checkout. Nothing on that page shows a line's changes, per the AC's placement; the tab is the thread-side reading. A note opened in the transient reader inside a thread reads the line's tree, so a mention of a note the line amended shows the amended text.

### The merge home

**The signal.** No shipped state exists, so the plan defines it narrowly and keeps the act always reachable:

- **(new)** `CodingSessionStore.recordPullRequestState(threadId, state)` and a `pr_state TEXT` column in migration 015; `GitManager`'s PR status refresh (`refreshLocalStatus` path on `turn.completed`, `CheckpointReactor.ts:639-663`, and the `VcsStatusBroadcaster` remote refresh) writes it through `attachPullRequest`'s sibling when the branch matches a session. A session whose `pr_state` becomes `merged` is "shipped".
- `planSuggestions.logic.ts` gains a second source beside open decisions: `memoryMergeHomeSuggestion(detail, lineChanges)` → one row, "Merge this line's memory home", when the line has any marked or unmarked memory change and (the session's `pr_state` is `merged`, or the plan is archived). Choosing it sends the message as today. The memory tab carries a **Merge home** action too, ungated, since the vault says the act is reachable at every step.

**The walk and the act.** The message opens a turn whose responding step is the product's, not the agent's: **(new)** stream item `memory-merge-home-review { entries, unreviewed }` renders in the memory tab as a walk through every unreviewed entry (the sheet's diff viewer, entry by entry, **Reviewed** on each), ending in **Merge home** / **Not now**. Confirming calls **(new)** RPC `mergeMemoryHome({ threadId })`:

1. If the unmarked entry exists, land it first as a marked commit titled "Unmarked memory changes" with trailer `Astrolabe-Amendment: unmarked`, so nothing crosses uncommitted.
2. **Memory inside a code repository:** there is nothing to merge locally; the walk is the pre-push review and the pull request is the merge. The act records `memory_merged_home_at` on the session (migration 015) and returns; the exit's existing offer to commit and push (`GitActionsControl`) ships it.
3. **Standalone memory repository:** `git merge-tree --write-tree <main tip> <line tip>` in the repository path. Clean → `commit-tree <tree> -p <main tip> -p <line tip>` with message "Merge memory from <plan title>", CAS `update-ref refs/heads/<main>`; if the designated checkout has `<main>` checked out and its memory paths are clean, `git checkout <main> -- <subpath>` there so the human's folder matches — dirty memory paths in that checkout refuse with `MergeMemoryHomeBlockedError { reason: "checkout-dirty" }`, since the vault says a human's edits outside the product are theirs. Conflicts → the RPC returns `{ conflicts: [{ path, ours, theirs, base }] }` and dispatches a `memory-merge-home-conflict` stream item; the assistant's next turn is seeded with a message proposing a reconciled amendment against current main, which lands on the line's branch through the ordinary write path; the human re-runs the merge home. Nothing merges on its own.
4. Declining leaves both branches standing: no state changes.

`<main>` is the repository's default branch as `LineBranchReactor.repositoryDefaultOid` resolves it (`origin/HEAD` when `newWorktreesStartFromOrigin`, else `HEAD` of the primary checkout).

## File & module layout

| File                                                                                                                                                              | Change                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/mercurian/worktreeSlots/projectWorkingRepositories.ts` (+ `.test.ts`)                                                                            | **(new)** linked repositories ∪ memory repository; used by `LineBranchReactor` and `SlotService.projectMembers`.                                                  |
| `apps/server/src/mercurian/commitTree/LineBranchReactor.ts`, `worktreeSlots/SlotService.ts`                                                                       | Membership through the shared function.                                                                                                                           |
| `apps/server/src/mercurian/memory/MemorySourceStore.ts`                                                                                                           | Nested-repository refusal via `GitVcsDriver`.                                                                                                                     |
| `apps/server/src/mercurian/memory/{schema,MemoryIndex}.ts`                                                                                                        | `MemoryTreeSource`; ref reads; `resolveLineSource`; `materializeLineRoot`; `landAmendment` by plumbing with the line-tree drift guard; `readLineChanges`; revert. |
| `apps/server/src/mercurian/memory/MemoryReviewStore.ts` (+ `.test.ts`), `persistence/Migrations/015_MemoryAmendmentReviews.ts` (+ `.test.ts`)                     | **(new)** review rows; `pr_state` and `memory_merged_home_at` on `coding_sessions`.                                                                               |
| `apps/server/src/mercurian/worktreeSlots/SnapshotChain.ts`                                                                                                        | `captureTree` and the `curated` kind.                                                                                                                             |
| `apps/server/src/mercurian/assistant/{PlanningAssistant,PlanningPrompt}.ts`, `mcp/toolkits/planning/{tools,handlers}.ts`                                          | Tool lands the commit; proposal state, `settleMemoryAmendment`, and the proposed/cancelled stream items retire; line root materialized; shared `memoryAppendix`.  |
| `apps/server/src/mercurian/codingSessions/{CodingSessionService,CodingSessionStore}.ts`                                                                           | Memory member as a session root; `recordPullRequestState`.                                                                                                        |
| `apps/server/src/ws.ts`, `auth/RpcAuthorization.ts`, `server.test.ts`                                                                                             | New RPC handlers and scopes; confirm/cancel removed; mocks follow.                                                                                                |
| `packages/contracts/src/{mercurianMemory,mercurian,orchestration,rpc}.ts`                                                                                         | `threadId` on reads; line-changes, review, revert, merge-home RPCs and stream items; `curated` kind; `nested-repository` reason; proposal types removed.          |
| `packages/client-runtime/src/state/mercurianMemory.ts`, `apps/web/src/state/mercurianMemory.ts`                                                                   | Atoms and hooks for the new reads and acts.                                                                                                                       |
| `apps/web/src/components/mercurian/MemoryTab.{tsx,logic.ts,logic.test.ts,catalog.tsx}`                                                                            | **(new)** the tab.                                                                                                                                                |
| `apps/web/src/components/mercurian/{PlanningSpace,PlanTimeline,PlanSuggestions,MemoryNoteReader,ManageProjectRepositoriesDialog}.tsx`, `planSuggestions.logic.ts` | Third pane view; timeline link; merge-home suggestion; line-scoped reader; refusal copy. `MemoryAmendmentSheet` modal removed, its viewer kept.                   |
| `docs/internals/glossary.md`, `docs/user/projects-and-plans.md`, `docs/user/memory.md` (if present)                                                               | Memory branch, memory tab, merge home in the vault's words.                                                                                                       |

## Implementation Checklist

Phased so each phase ships green on its own; the AC is met only at the end of phase 3.

**Phase 1 — membership, line reads, the write path**

- [ ] `projectWorkingRepositories` and its two call sites; a standalone memory repository gets line branches and slot members; nested-repository refusal at designation with the contract reason.
- [ ] `MemoryTreeSource` + ref reads in `MemoryIndex`; `threadId` on the two read contracts and handlers; the in-thread reader and mentions send it; the Memory page does not.
- [ ] `landAmendment` by plumbing with CAS on the branch tip and the line-tree drift guard; worktree refresh for a member on the branch; plan-history record keeps the SHA and adds the branch; the tool description and prompt stanza rewritten; proposal state, confirm/cancel RPCs, stream items, and the modal retire; `server.test.ts` mocks follow.
- [ ] `materializeLineRoot` for planning turns; the memory member as an additional root for coding sessions with the shared appendix.

**Phase 2 — the memory tab**

- [ ] Migration 015 with `memory_amendment_reviews`, `pr_state`, `memory_merged_home_at`; `MemoryReviewStore`.
- [ ] `readLineChanges` (marked via first-parent path-scoped log with trailers, hand commits, the unmarked delta), `markMemoryChangeReviewed`, `revertMemoryChange` (marked by plumbing commit; unmarked by `SnapshotChain.captureTree` with kind `curated`).
- [ ] Web: `"memory"` pane view with storage-key bump, `MemoryTab`, unreviewed badge, timeline link.

**Phase 3 — the merge home**

- [ ] `pr_state` written from PR status refresh; merge-home suggestion beside open decisions; ungated **Merge home** in the tab.
- [ ] `memory-merge-home-review` walk; `mergeMemoryHome` RPC: unmarked landed first; subpath memory records and defers to the push; standalone memory merges by `merge-tree` + CAS with the clean-checkout refresh and the dirty-checkout refusal; conflicts returned to the conversation with a seeded reconciliation message; decline is a no-op.
- [ ] Docs.
- [ ] Do not add a memory editor, a setting, or a second write path; do not touch mobile, M-203 stamps, M-193 utilities, or M-115 pruning; the runtime's own bookkeeping never commits to a line's branch — only `landAmendment`, `revertMemoryChange`, and `mergeMemoryHome` do, each at a person's or the agent's request.

## Test Plan

House pattern: real temp git for `MemoryIndex` and `SnapshotChain`, mocked stores for reactors and the slot service, `it.layer` sqlite-memory for stores and migrations, logic tests beside web components.

- [ ] `projectWorkingRepositories.test.ts`: linked-only, memory-linked, memory-standalone, memory-as-subpath cases; `LineBranchReactor.test.ts` mints a branch in a standalone memory repository; `SlotService.test.ts` lays it out as a member.
- [ ] `MemorySourceStore.test.ts`: a folder that is its own repository nested inside the repository's tree is refused with `nested-repository`; a subpath and a standalone repository are accepted (AC 1).
- [ ] `MemoryIndex.test.ts` (real git): ref reads list and read notes from a branch tip and from a chain head; the line cache misses when the ref moves; `landAmendment` lands one commit on the line branch with the trailer and leaves `main` untouched; a stale `before` refuses with `memory-changed`; a member worktree on the branch has only the amended paths refreshed; `readLineChanges` returns marked, hand, and unmarked entries; revert of a marked commit restores the paths in a new trailer-bearing commit; revert of the unmarked entry writes a `curated` snapshot whose tree matches the branch for the memory paths (AC 2, 3, 6).
- [ ] `PlanningAssistant` tests: the tool call lands (no proposal state), a drift refusal reaches the agent in-turn, `materializeLineRoot` is the memory root handed to the provider; `CodingSessionService.test.ts`: the memory member path is a session root (AC 4).
- [ ] Fork case (integration, real git): fork below a line that amended; the new line reads the amended note from its inherited chain head; a fork from before the amendment does not (AC 4).
- [ ] `015_MemoryAmendmentReviews.test.ts`: tail is 15; columns pinned. `MemoryReviewStore.test.ts`: unreviewed count with and without the unmarked entry.
- [ ] Merge home (real git): standalone repository clean merge updates `main` and refreshes a clean designated checkout; dirty checkout refuses; conflicting main returns conflicts and merges nothing; subpath memory records and returns without touching git; decline changes nothing (AC 7, 8, 9).
- [ ] `planSuggestions.logic.test.ts`: the merge-home row appears only with memory changes and a merged PR or archived plan; `MemoryTab.logic.test.ts`: list shaping, count, review toggling.
- [ ] `server.test.ts` wire suite by hand, since it is the only coverage of the Mercurian route mocks.
- [ ] Targeted `vp test run` on touched suites + `tsgo --noEmit` per package; no repo-wide runs.

_The walk: designate a standalone memory repository and confirm a fork mints its line branch; ask a planning turn to amend a note and confirm the memory tab lists one marked commit while the Memory page still shows the old text; edit a note by hand in the slot and confirm the unmarked entry; revert both; fork below the amendment and read the note in the new thread; merge home from the tab and confirm the Memory page updates._
