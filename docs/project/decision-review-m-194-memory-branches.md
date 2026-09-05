# Decision Review — technical-plan-m-194-memory-branches.md

_Where the plan's contestable choices are shown, one at a time, so they can be decided at leisure. The durable record is the plan's Decision Log. Grounded 2026-09-02 against the M-206 branch after its rebase onto main (`3fe37864c`), which is the tree M-194 will build on._

**Resolved 2026-09-03: every recommendation applied, no overrides given; the plan's Decision Log records each. The plan was re-grounded on main (M-196, M-206 build 2) in the same pass.**

**How to read this.** Ten decisions. The first seven shape structure or are hard to reverse; the last three are local and cheap to change later. Each opens with a picture of the problem, lists the real alternatives fairly, names the honest cost of the recommendation, and ends with _Keep or change?_ Decisions 3 and 4 are coupled: the answer to 3 decides 4. Reply with one line, for example: "keep 1–2, change 3 to B and 4 with it, keep the rest."

**Filtered out as settled or noise.** The commit trailer as the amendment mark (the repo already marks memory commits with an `Amended-from-plan` trailer, so a second trailer is the precedent, not a choice). Where the shared membership helper lives (beside the slot service, as M-206's chain helper is). Extracting the memory prompt appendix into one function (a refactor, not a design). The shape of the optional `threadId` on the read contracts (M-206 set the "optional field, absent means the old behavior" pattern). The nested-repository refusal (the vault settled it 2026-09-01).

**Grounding corrections.** Four, none of which changes a decision by itself, but three feed one:

- The plan's merge home uses `git merge-tree --write-tree`, which needs git 2.38 or newer. Nothing in the server or the docs pins a git version today, so the plan introduces a floor silently. Decision 5 carries it.
- The vault's Right Sidebar note says the pane "carries the thread's three standing views," artifact, Checkpoint Graph, and code. A memory tab as a fourth view is a vault tension the plan did not name. Decision 6 carries it.
- Pull-request state is refreshed only when a client asks for git status or when a turn completes (`VcsStatusBroadcaster.refreshStatus` from the websocket layer, `refreshLocalStatus` from the checkpoint reactor). A pull request merged after the session's last turn is not noticed until someone opens the session. Decision 7 carries it.
- M-206 shipped `SnapshotKind` as a closed union of four literals. The plan's `curated` kind widens it, which is additive and fine, but the M-206 glossary sentence listing the four kinds will need the fifth.

---

## 1 (architectural) — How the memory repository joins the slot

_Resolved 2026-09-03: keep._

Picture a project's slot as a shelf holding one working copy of every repository the project links, arranged as they sit on disk. Today the memory repository is not on that shelf unless someone happened to link it as a code repository, so it gets no line branch, no snapshot, and no place in the pool.

**The plan chose** a small pure function, "the project's linked repositories plus the memory source's repository when it is not among them," used by both the line-branch reactor and the slot service in place of their own filtering (plan: "Membership").

**The alternatives:**

- **Require designation to pick a linked repository.** No new helper: the memory is a slot member because it is a linked repository. But a linked repository is also a planning grounding root in its own right and a candidate for a coding session's repository, and the designation dialog today lists every registered repository precisely so a design vault can live apart from the code. Forcing the link changes what designation means.
- **A memory-specific member path** keyed off the memory-sources table, beside the code members. Keeps memory conceptually separate, but it duplicates branch minting, slot layout, recovery, and inheritance, which is exactly the machinery M-206 just made uniform.
- **The union helper** _(the plan's choice)_. One repository set, two call sites, everything M-206 built applies unchanged.

**The honest cost:** the memory repository gets a line branch minted on every fork even for projects that never amend memory, one ref per line per repository, and it is materialized into every slot of the project. Both are cheap for a folder of markdown.

**Recommendation: keep the union helper.** The two call sites already filter the same links today (`LineBranchReactor.reconcile`, `SlotService.projectMembers`), and the memory's designation deliberately does not require linking (`MemorySourceStore.designate` checks only that the repository exists).

_Keep or change?_

## 2 (architectural) — How the product reads a line's memory

_Resolved 2026-09-03: keep._

Picture a note open in the transient reader inside a thread. Which version should it show, and where should the product go to get it, given that the line's slot may currently be lent to another line?

**The plan chose** tree reads from refs for every product read: list and read files from the line's chain head when it has one, else its branch tip, restricted to the memory root, never from a directory (plan: "Reads: a `MemoryTreeSource`").

**The alternatives:**

- **Read the slot member's files when the line holds a slot, refs otherwise.** Faster in the common case and no `git show` per file. But two code paths for one read, and the fast one is wrong the moment the slot switches, which is exactly the hazard M-206's uncommitted-diff decision closed for code.
- **Materialize a per-line checkout of the memory tree and read files from it.** One mechanism for product reads and provider grounding. But that is a worktree per line, the disk shape the pool was built to avoid, and the product would be reading a directory again.
- **Tree reads** _(the plan's choice)_. Worktree-independent, one path, and the chain head already names the line's complete state including unmarked edits.

**The honest cost:** every note read is a git process. For a vault of a few hundred notes the index build is a single `ls-tree` and a `show` per note, cached by resolved object id, so a moved ref is a cache miss and an unmoved one is free. It is slower than reading a folder and needs measuring on a large vault.

**Recommendation: keep tree reads.** M-206's `getLineUncommittedDiff` already reads the line from refs for the same reason, and the memory index's cache is keyed by root today (`MemoryIndex.ts` `cache` map), so keying it by object id is the same shape.

_Keep or change?_

## 3 (architectural) — Where a planning turn's memory files come from

_Resolved 2026-09-03: change to B — planning turns claim the slot._

Picture the assistant answering a planning message. It needs the memory as this line sees it, as real files on disk, because providers read paths. Today planning turns run read-only in the project's primary checkouts, outside the slot pool, and the memory root they get is the designated folder on main.

**The plan chose** a materialized read-only checkout of the line's memory tree, one detached worktree per line under the worktrees directory, created on demand and handed to the provider as the memory root (plan: "Grounding").

**The alternatives:**

- **A. The detached per-line memory checkout** _(the plan's choice)_. Small, memory-only, no pool pressure. But it is a third working-state mechanism beside slots and snapshots, a worktree per line that nothing prunes until M-115, and one the thread unification (M-197) would retire when planning and building share a slot.
- **B. Planning turns claim the project slot.** The slot already holds the memory member on the line's branch, so the provider gets its path for free, and it also gets every code repository at the line's own state, which is what the vault says grounding should read. The Threads note settled this on 2026-08-31: "every turn claims a slot now," and "at the cap, a send waits for a slot, and says so." Cost: planning turns now compete for a pool of three, a project's first planning turn materializes the whole project, and a planning-only project pays for a slot it never edits in.
- **C. Keep reading the designated folder on main.** Zero work, and wrong: a line would plan against memory it did not amend.

**The honest cost of B:** pool contention reaches planning. A person planning on three lines while three builds run waits, visibly. The read-only provider policy stays, so a planning turn never dirties the slot, but its claim holds the slot for the turn's duration.

**Recommendation: change to B, planning turns claim the slot.** It is the vault's stated model, it removes a mechanism M-197 would remove anyway, and the claim path with a `turn` holder already exists for sessions (`ws.ts` `acquireCodingSessionSlot`). If the pool pressure is unacceptable today, A is a legitimate interim with a note that M-197 retires it.

_Keep or change?_

## 4 (architectural, follows 3) — How an amendment commit is made

_Resolved 2026-09-03: follows 3 — reuse the existing commit path._

Picture the propose tool landing a note. Somewhere a commit has to be created on the line's branch of the memory repository, and the files a running turn is reading must agree with it afterwards.

**The plan chose** git plumbing: build the tree from the branch tip with the changed blobs swapped in, commit it, move the branch ref with a compare-and-swap, then refresh only the amended paths in any slot member that has the branch checked out (plan: "Writes").

**The alternatives:**

- **Plumbing** _(the plan's choice)_. Needs no worktree, so it works for planning turns that hold no slot. Costs a second commit mechanism beside the one M-181 built, a refresh step that writes into a worktree a turn may be using, and a subtle rule that the snapshot's second parent must catch up to the moved tip.
- **Write files in the slot member and commit with the existing `commit --only` path.** This is what M-181 built (`MemoryIndex.commitPaths` takes any root and commits only the named paths). The working tree and HEAD agree by construction, the snapshot chain's head tracking needs nothing, and the drift guard compares against the member's files, which are the line's tree. It requires the turn to hold a slot, which under decision 3B every turn does.

**The honest cost of the second option:** the write path depends on decision 3. Under 3A, planning turns have no slot and this option is not available to them.

**Recommendation: follow 3.** With 3B, reuse the existing commit path in the slot member and drop the plumbing and the refresh step. With 3A, keep the plumbing as planned.

_Keep or change?_

## 5 (architectural) — How a standalone memory merges home

_Resolved 2026-09-03: keep, with the git-version floor._

Picture a design vault that is its own repository, checked out in the person's own folder on `main`, and a line's branch of it ready to come home. The product has to produce a merge commit on `main` without wrecking the person's folder.

**The plan chose** plumbing: compute the merge with `git merge-tree --write-tree`, commit it with both parents, move `main` with a compare-and-swap, then refresh the memory paths in the person's checkout if they are clean, refusing when they are dirty (plan: "The merge home", step 3).

**The alternatives:**

- **Run `git merge` inside the designated checkout.** Simplest and most familiar. But it runs the person's hooks, uses the person's git identity, touches their index, and on conflict leaves their folder mid-merge, which the vault's "a human's edits outside the product are theirs" argues against.
- **Merge in a slot member of the memory repository.** Slots hold line branches, and `main` is checked out in the person's folder, so git refuses to check it out anywhere else. Not available.
- **Plumbing** _(the plan's choice)_. Never touches the person's index or hooks, refuses cleanly when their folder is dirty, and conflicts come back as data for the conversation.

**The honest cost:** `merge-tree --write-tree` needs git 2.38 or newer, and nothing in the repo or docs states a git floor today. The plan must add one, with a typed refusal naming the version when the machine's git is older.

**Recommendation: keep plumbing, and add the git-version floor as an explicit check and a documented requirement.** The repo drives git through one driver (`GitVcsDriver.execute`), so the check has one home.

_Keep or change?_

## 6 (architectural) — Where the memory tab lives

_Resolved 2026-09-03: keep as interim, vault note owed._

Picture the right side of a thread. The vault says the pane "carries the thread's three standing views," artifact, Checkpoint Graph, and code. Today the built pane has two, artifact and graph. Where does the list of a line's memory changes go?

**The plan chose** a third corner toggle in the planning space's right pane, a `memory` view beside artifact and graph (plan: "The memory tab", Web).

**The alternatives:**

- **A fourth standing view** _(the plan's choice)_. Direct, one toggle, but it contradicts the Right Sidebar note's three-view rule and would need a vault amendment.
- **A slice of the code view.** The vault's code view is "the working machinery, per repository the thread touches." The memory repository is now one of those repositories, so its marked commits, unmarked delta, review, and revert are that repository's working machinery. This fits the vault exactly. But the code view is not built; it arrives with the thread unification (M-197), and M-194 cannot wait for it.
- **On the workspace Memory page.** Contradicts the AC's placement: the browse surface reads the main line, and "what a line changed is visible from the thread."

**The honest cost:** whichever interim is chosen, the tab moves once when the code view lands, and the vault needs a sentence either way.

**Recommendation: keep the third toggle as an interim, and say so in both the plan and the vault: the memory tab is the memory repository's slice of the code view, mounted as its own toggle until the code view exists.** That turns a contradiction into a recorded transition.

_Keep or change?_

## 7 (architectural) — What "the work shipped" means

_Resolved 2026-09-03: keep, refresh PR status on tab open._

Picture the moment the product should suggest merging a line's memory home. The vault says "when the work ships, the code merged, the thread published." Neither exists as a fact the product records today.

**The plan chose** a `pr_state` column on the session, written whenever pull-request status is refreshed, with the suggestion appearing when the state is merged or the plan is archived, and an ungated Merge home action in the tab regardless (plan: "The merge home", the signal).

**The alternatives:**

- **Manual only.** No column, no suggestion; the tab's Merge home action is the whole story. Simplest, and honest about what the product knows. But the vault's "recommends" becomes a menu item nobody is nudged toward.
- **The recorded pull-request state** _(the plan's choice)_. One column and one write in an existing refresh path. But that refresh runs only when a client asks for status or a turn completes, so a merge that happens after the last turn is seen only when the session is next opened.
- **Wait for the publish signal** (Publishing, not built). Correct in the vault's terms and unavailable.

**The honest cost:** the suggestion can lag until the session is opened, which is also the only place it renders, so in practice the lag is invisible. The column is a small piece of state the thread unification will want anyway.

**Recommendation: keep it, and refresh pull-request status when the memory tab opens,** so the one place the suggestion shows is also a place that asks. The refresh entry point exists (`VcsStatusBroadcaster.refreshStatus`).

_Keep or change?_

## 8 (local) — Where review state is kept

_Resolved 2026-09-03: keep._

Picture the unreviewed count on the tab. Something has to remember which memory commits a person has looked at.

**The plan chose** a small table, one row per reviewed commit keyed by line and repository, with migration 015 (plan: "The memory tab", Server).

**The alternatives:**

- **Git notes or a hidden ref per reviewed commit.** Keeps the fact beside the commit in the memory repository, portable with it. But review is a fact about a person in this product, not about the note's content, and the vault's law is that the substrate writes nothing into the memory but amendments.
- **Client-only "seen" state.** Zero server work, lost across devices and reloads, and the merge home needs it server-side to walk the unreviewed set.
- **A table** _(the plan's choice)_. The house pattern for a keyed fact beside a commit (`plan_implement_verdicts` is the precedent).

**The honest cost:** one more Mercurian table and store.

**Recommendation: keep the table.**

_Keep or change?_

## 9 (local) — How an unmarked change is reverted without a slot

_Resolved 2026-09-03: keep._

Picture a note the agent edited by hand. It is in the line's snapshot but not on its branch, the line's slot may be lent out, and the person wants it gone.

**The plan chose** a new snapshot on the chain whose tree is the chain head with the memory paths restored from the branch tip, with a fifth kind, `curated`, so the next claim lays it over the branch (plan: "Revert").

**The alternatives:**

- **Claim the line's slot and restore the paths there.** Reuses the claim path and capture. But the tab acts outside any turn, so it needs a new lease holder kind (turn, terminal, and preview exist today) and a slot may be busy or at capacity for a two-second act.
- **Commit the change, then revert the commit.** Two commits on the branch for something that was never meant to be on it.
- **A curated snapshot** _(the plan's choice)_. Worktree-independent, consistent with decision 2, one added literal on M-206's kind union.

**The honest cost:** a fifth snapshot kind, and the M-206 glossary sentence that lists four.

**Recommendation: keep the curated snapshot.**

_Keep or change?_

## 10 (local) — What ships first

_Resolved 2026-09-03: change — phase 1 carries the read-only list._

Picture phase 1 landing on its own: the propose tool commits amendments on the line's branch with no confirmation, and the tab that shows them does not exist until phase 2. For that window an amendment is invisible in the product.

**The plan chose** three phases: write path, then tab, then merge home (plan: "Implementation Checklist").

**The alternatives:**

- **Three phases as planned.** Smallest first PR, but a real gap: the vault gave up pre-landing review only because "the memory tab's review is the net," and phase 1 has no net.
- **Phases 1 and 2 together.** No gap, one larger PR.
- **Phase 1 carries the read-only list.** The write path lands with the tab's list of marked commits and the unmarked delta, without review state or revert. Nothing lands unseen; review and revert follow.

**The honest cost:** phase 1 grows by the tab's list and the pane toggle.

**Recommendation: phase 1 carries the read-only list.** It keeps the first PR reviewable and keeps the vault's own justification for retiring confirmation true from the first day.

_Keep or change?_

---

**At a glance.** 1 keep · 2 keep · 3 **change to B** (planning turns claim the slot) · 4 follows 3 (reuse the existing commit path) · 5 keep + git floor · 6 keep as interim + vault note · 7 keep + refresh on tab open · 8 keep · 9 keep · 10 **change** (phase 1 carries the read-only list). Reply with any overrides and the plan's Decision Log will be written from your answers.
