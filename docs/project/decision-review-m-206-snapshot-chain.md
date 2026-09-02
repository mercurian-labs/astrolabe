# Decision Review — technical-plan-m-206-snapshot-chain.md

_Where the plan's contestable choices are shown, one at a time, so they can be decided at leisure. The durable record is the plan's Decision Log. Grounded 2026-09-01 against the same tree as the plan (`6958be1a7`)._

**How to read this.** Nine decisions. The first five shape structure or are hard to reverse; the last four are local and cheap to change later. Each one opens with a picture of the problem, lists the real alternatives fairly, names the honest cost of the recommendation, and ends with _Keep or change?_ Decisions 1 and 2 were already resolved in conversation and are marked so. Reply with one line, for example: "keep 3–8, change 9."

**Filtered out as settled or noise.** File placement and naming (repo conventions decide). Keeping upstream threads byte-identical (the M-195 plan set that fence and every reactor test enforces it). Departed turns leaving the ref alone rather than following HEAD (the vault resolved it 2026-09-01; the plan only implements it). Kind names in the commit message (free, and derivable either way). The `Astrolabe` author identity on snapshots (already the checkpoint author).

**Grounding corrections.** None that change a decision. One note: the plan cites "ADR 004 §1" through the M-195 plan's phrasing; the actual rule lives in `docs/architecture/fork-baseline.md:25` and reads "Mercurian code is additive where practical — new packages and modules beside upstream's, minimal edits inside upstream-owned files." That wording matters for decision 4 and is quoted there.

---

## 1 (architectural) — How a snapshot remembers where the branch was — **resolved: keep**

Picture each snapshot as a photo of the whole working tree. The question is what we write on the back of the photo to record "the branch pointed here when I took this."

**The plan chose** two parents on every snapshot commit: parent one is the previous snapshot, so the photos form a chain; parent two is the commit HEAD was on (plan: "Chain topology").

**The alternatives:**

- **One parent, branch commit written in the message** as a trailer like `Branch-Head: abc123`. A cleaner chain, and `git log` on a snapshot walks only snapshots. But a trailer is text, not a pointer. A commit the agent later amends away becomes unreachable and git eventually deletes it, so "what happened this turn" silently breaks on exactly the turns that rewrote history — the case most worth explaining.
- **Stash's shape, three parents**, adding the index as a third. Would preserve staged state, which the vault explicitly gave up. Extra cost, no requirement asking for it.
- **Two parents** _(the plan's choice)_. Parent two is a label and a pin at once: the range between two labels is "what the branch did this turn," and git never collects anything a commit points at, so the pinned commit survives any rewrite.

**The honest cost:** `git log <snapshot>` without `--first-parent` wanders into the user's commit history. Every forensics tool must pass `--first-parent` to walk the chain. A rule to write down, not a flaw.

**Recommendation: keep two parents.** The driver already builds commits with `commit-tree`, which takes parents as a flag (`apps/server/src/vcs/GitVcsDriver.ts:771`), and the core driver already runs `rev-list --count` for ahead/behind (`GitVcsDriverCore.ts:1474`). Nothing new to learn, and no other shape delivers the pin.

_Resolved 2026-09-01: keep._

## 2 (architectural) — Where the snapshots live in the ref namespace — **resolved: keep**

Every snapshot needs a name. Today there is one scheme, inherited from upstream: `refs/t3/checkpoints/<thread>/turn/<n>`, one name per turn. M-195 added one per-line name for the partial ref.

**The plan chose** to keep the per-turn thread names for settled and partial turn snapshots, rename the per-line partial ref into the chain head, and add a small per-line bucket for snapshots that belong to no turn — external and recovery (plan: "Chain topology", refs list).

**The alternatives:**

- **Everything under the line.** "A thread is a line, so put it all in `refs/t3/lines/<line>/…`." One namespace, one mental model, and it matches the vault's vocabulary. But turn-number naming is load-bearing three layers deep: the diff query resolves refs by thread and turn count (`CheckpointDiffQuery.ts:79`), the projection row is keyed the same way (`contracts/orchestration.ts:1553`), and the client's diff panel targets turn counts. Re-keying all three buys nothing a user sees, and it breaks the "upstream threads byte-identical" fence, since upstream threads would keep the old names.
- **The split** _(the plan's choice)_. Two prefixes, both already existing, plus one small new bucket.

**The honest cost:** the chain is spread across two prefixes, so anyone reading refs by hand has to know both. The chain-head ref makes that tolerable: walking first-parent from it visits every snapshot regardless of name.

**Recommendation: keep the split, and leave consolidation to M-198.** That is the issue where a thread starts holding many lines and the thread-turn naming actually stops fitting; re-keying then happens against real requirements instead of a guess.

_Resolved 2026-09-01: keep._

## 3 (architectural) — Who owns "take a chained snapshot"

Two pieces of code need the same recipe: the checkpoint reactor at the end of a turn, and the slot service when it finds a dirty slot before switching or reusing it. Find the line's previous snapshot, resolve HEAD and its branch, capture with two parents, move the chain head. Where does the recipe live?

**The plan chose** a new small service, `SnapshotChain`, beside the slot service, with both callers depending on it (plan: "One helper owns chained capture").

**The alternatives:**

- **Extend `CheckpointStore`.** It already owns capture, restore, and diff. But it is upstream-shared, and its own header says it "does not store user-facing checkpoint metadata" (`apps/server/src/checkpointing/CheckpointStore.ts:1`). It knows nothing about lines; teaching it pulls a Mercurian concept into a layer every upstream sync touches. The plan gives it exactly one knob — optional parents and a message — and keeps it blind to their meaning.
- **Put it inside `SlotService`.** The partial-ref helper already lives there and the reactor already imports it. But the reactor imports a plain function today, not the service. Depending on the whole service drags the workflow service and the server config into the reactor for a helper that needs only the checkpoint store and the git driver (`SlotService.ts:132`).
- **Inline it in the reactor**, and have the slot service call the reactor. Backwards: the reactor consumes slot state, and M-195 deliberately hoisted the slot registry into a shared core so the two are siblings (`server.ts:495`).
- **A new service** _(the plan's choice)_.

**The honest cost:** one more service to wire, provided from the same core layer the registry rides.

**Recommendation: keep the new service.** Every Mercurian module in that folder is a `Context.Service` with a `make` and a `layer`; small single-purpose services are how this repo shares behavior between reactors and services, and it is the only option that leaves upstream code content-blind.

_Keep or change?_

## 4 (architectural) — Where the new per-turn facts are stored in the projection

Each turn now produces three small facts beside `partial`: the snapshot's kind, the ref a departed turn left HEAD on, and how the branch moved. They have to survive a server restart, so they belong in the projection database that backs the thread's checkpoint list.

**The plan chose** to ride the existing sidecar: `partial` today is not a column but a field tucked inside the `files` JSON column through `CheckpointFilesStorage.ts`, and the plan adds the three facts to that same object (plan: Conventions, the medium-confidence entry; "The reactor stops committing").

**The alternatives:**

- **Real columns on `projection_turns`.** Cleaner, queryable, honest schema. But that table is upstream's, in upstream's migration sequence. The fork's baseline rule is "new packages and modules beside upstream's, minimal edits inside upstream-owned files" (`docs/architecture/fork-baseline.md:25`), and the Mercurian domain keeps its own migration sequence for exactly this reason (`mercurian/persistence/Migrations.ts`). An upstream migration edit is a conflict at every weekly sync.
- **A Mercurian-owned side table** keyed by thread and turn count, read alongside the projection. Clean ownership, but a second read path for one list, and the client would need to join two sources for a single badge.
- **The sidecar** _(the plan's choice)_. Zero schema change, one storage helper edit, and the same pattern M-195 shipped a day earlier.

**The honest cost:** the facts are not queryable by SQL, and the `files` column name now lies a little more than it already did. If a third feature reaches for the sidecar, it is time for the side table.

**Recommendation: keep the sidecar.** It is the pattern the repo chose under the same constraint one migration ago, and the constraint has not moved.

_Keep or change?_

## 5 (architectural) — How the code view reads "what is not committed yet"

After a settled turn, the working tree is dirty and the branch has not moved. The user needs to see that gap before pushing. The subtlety: a line's slot can be handed to another line, and then the working tree on disk belongs to someone else, while the line's real state lives only in its snapshot.

**The plan chose** a new server query that diffs the line's branch tip against the chain head, exposed as one RPC and one new **Uncommitted** entry in the diff panel's scope list, worktree-independent (plan: "The exit reading").

**The alternatives:**

- **Rely on the existing Working tree scope.** Zero new code; it already shows the dirty tree while the slot is held, and the git control's quick action already reads "Commit & push" on a dirty tree. But it reads the directory, not the line. Once the slot is switched to another line, the session's recorded worktree path still points at that directory (`ws.ts:748` re-points it only on the next claim), so the panel shows the other line's files. That hazard exists today under M-195; the chain makes the correct source available for the first time.
- **Reuse the review preview's `branch-range` source** with custom refs. It already returns a base-to-head diff with hashes and truncation (`GitVcsDriverCore.ts:2342`), and the panel already renders it. But its base is the branch's merge base and its head is `HEAD`, both resolved from a directory; making it accept "branch tip → hidden ref" means threading two arbitrary revisions through a review-shaped API that was built for one purpose. Doable, and closer to reuse, but it bends an upstream contract.
- **Defer to M-197.** The thread code view is where off-slot lines will get git tools at all. Keeps M-206 server-only. But the AC says the code view shows the delta, and the hazard above is live now.
- **A new query and scope** _(the plan's choice)_.

**The honest cost:** a new RPC and a fifth scope entry, both small, both Mercurian-owned; the web surface grows by one line in a dropdown.

**Recommendation: keep the new query and scope.** It is the one option that reads the line rather than the directory, and the diff plumbing it needs is the existing two-revision `diffCheckpoints` (`GitVcsDriver.ts:834`), not new git.

_Keep or change?_

## 6 (local) — What "built" means on a line's branch row

A line's branch is minted eagerly, before any work happens. Until work happens, the product may re-point it if the base branch preference changes. The flag that stops re-pointing is `built`. Under M-195 it flipped when a settle-time commit landed. There is no settle-time commit anymore.

**The plan chose** to flip `built` on the first snapshot of any kind on the line (plan: "The reactor stops committing", step 4).

**The alternatives:**

- **Flip on the first user commit on the branch.** Matches the word "built" most literally. But a line can run ten turns with no commit, and every one of those snapshots pins the base as parent two; re-pointing the branch after that leaves the chain describing a base the branch no longer has.
- **Keep the flag unused and never re-point** once any slot has been claimed for the line. Simpler still, but it retires a small feature (base-ref changes before first work) that M-195 shipped and tested (`LineBranchReactor.ts:158`).
- **First snapshot** _(the plan's choice)_. The earliest moment the chain has an opinion about the base.

**The honest cost:** the name `built` now means "a turn has run," which the plan records in a comment. A rename would be more honest and is cheap, but it touches the migration-012 column name and the store; not worth its own churn here.

**Recommendation: keep first-snapshot, and note the meaning in the store's doc comment.**

_Keep or change?_

## 7 (local) — What a turn's diff is measured against

Today a turn's changed-files card is "turn N minus turn N−1." With the chain, something can happen between turns: a person edits in the slot, a script runs, a pull lands. The plan snapshots that as an "external" snapshot at the next turn's start. The question is whether the turn's diff should include it.

**The plan chose** to diff against the snapshot's first parent — the true "what the tree looked like when this turn started" — so an external change is excluded from the turn's card and shows instead as a work-log line (plan: "The reactor stops committing", step 5; "The opening capture").

**The alternatives:**

- **Keep turn N−1 as the base.** No query change. But the agent gets blamed for edits a human made between turns, which is exactly the attribution the chain exists to get right.
- **Make the external snapshot its own checkpoint row** with a turn number. Then it has a card of its own. But turn numbers belong to turns in every consumer, the pagination merges by turn, and an "external turn" would be a lie the UI would have to explain.
- **First parent as the base, external as an activity line** _(the plan's choice)_.

**The honest cost:** an external change has no diff card; it is visible in git and as one line in the work log, and the whole-session diff still includes it. If people want to see what a script changed between turns, that is a small follow-up.

**Recommendation: keep the first-parent base.** `diffCheckpoints` already interpolates `<ref>^{commit}`, so `<ref>^1` costs one helper and no driver change.

_Keep or change?_

## 8 (local) — Which commit a fork starts from after a departed turn

When a new line forks below a built line, its branch starts where the ancestor's branch stood. Usually that is HEAD. But a departed turn ended with HEAD on some other branch. Now "where the branch stood" has two answers.

**The plan chose** to record the line's own branch tip — `refs/heads/<line branch>` — as the fork start, while parent two on the snapshot still records the real HEAD (plan: "The reactor stops committing", step 2).

**The alternatives:**

- **Record HEAD.** It is where the tree actually was, so a fork gets a branch whose history matches its files. But it starts the new line on a foreign branch's commit, which is precisely the state the departed rule exists to undo.
- **Refuse to fork below a departed turn.** Safe and honest, but a one-way door the vault's teardown floor would frown at, and a line can have one departed turn among fifty good ones.
- **The line's tip, with HEAD kept on the snapshot** _(the plan's choice)_. The fork follows the product-owned ref; the snapshot keeps the truth for anyone investigating.

**The honest cost:** after such a fork, the new line's first restore lays a tree over a branch that never contained it. That is exactly what happens on the departed line's own next claim, so it is one behavior, not two.

**Recommendation: keep the line's tip.** It is the vault's rule stated in one field: the branch is the agent's to move, the ref is the product's to keep.

_Keep or change?_

## 9 (local) — Whether `partial` stays on the wire

M-195 put a `partial: true` boolean on four contracts and every reader in between. The new `snapshotKind` field says the same thing and more.

**The plan chose** to keep `partial` on the wire for this PR, written as `kind === "partial"`, and retire it once the web reads kind (plan: "The reactor stops committing", closing paragraph).

**The alternatives:**

- **Replace it now.** One field instead of two, no redundancy. But `partial` is read in five places today: the timeline badge, the effects derivation, the popover, the reducer, and the projection sidecar. Each is a small edit, but each is also a place a green test can hide a dropped badge, and this PR already touches the reactor, the slot service, the driver, and the contracts.
- **Keep it** _(the plan's choice)_, and file the retirement as a follow-up.

**The honest cost:** two fields that agree by construction, for one release.

**Recommendation: keep it, retire it in the follow-up that moves the web to kinds.** One concern per PR is the house rule for pull requests, and this one has a concern already.

_Keep or change?_

---

**At a glance.** 1 keep (resolved) · 2 keep (resolved) · 3 keep · 4 keep · 5 keep · 6 keep · 7 keep · 8 keep · 9 keep. Reply with any overrides and the plan's Decision Log will be written from your answers.
