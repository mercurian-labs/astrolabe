# DAG

A project's threads form a directed acyclic graph — the **DAG**. Its nodes are [[Threads|threads]], each a single line of checkpoints; its edges are the relationships between them. A **fork** is a thread that continues from another thread's checkpoint. A **transfer** is a thread taking context from another thread — what a [[Merges|merge]] is. A **spawn** is a child thread an agent's turn opened and whose result returned to it. Every thread knows its parent, what made it, the checkpoint it started from, and the root of its family; the graph never cycles, because a thread can only fork from or take context from what already exists. _(2026-09-24: written up from the note's one line, "a DAG is composed of threads, because threads can be forked and threads can grab context from other threads"; this is the model of the orchestrator the product sits on — [[Strategy]] — and the successor of the branching history each thread once carried inside itself, see [[Threads]].)_

Its contained concepts are [[Merges]].

## The edges

- **Fork.** A human act, from a completed checkpoint — yours, or any thread's you can see. The new thread's branches in every repository start at the commit that checkpoint's snapshot recorded, with the snapshot's files laid over them, and its conversation carries what the source knew up to that checkpoint: natively where the provider can fork its own conversation, otherwise rebuilt from the record, resolved at the fork's first message and recorded either way ([[Threads]]). Forking is cheap by design — nothing runs, materializes, or summarizes until the first message.
- **Transfer.** A human act, positional: from the thread you are in, you pick a checkpoint on another thread, and your next turn takes what that thread learned or did since the two diverged, compacted ([[Merges]]). Drawn dashed wherever the graph is drawn — the product-wide rule that a dashed line means compacted context ([[Visual Language]]).
- **Spawn.** An agent's act: a turn opens a child thread, runs it, and takes its result back into the same turn. The child is a thread — forkable, readable, its checkpoints its own — but it advances no count of the parent's turns, and it shows as the agent's, never as yours.

## Invariants

1. **Forks and transfers are human-driven only.** You return to any earlier point and take a different direction; you bring another thread's work into yours. The assistant only ever continues from where its thread left off; it never opens a sibling thread on its own and never takes context on its own. _(Carried from the deleted Commit Tree note, where it read "forks and merges"; the 2026-07 guarantee below stands.)_ Spawns are the one agent-driven edge, and they are marked as such: the invariant guarded the _human's_ history from being restructured, and a spawn restructures nothing the human did — it works beneath one turn and returns to it.
2. **Nothing is destroyed.** Every rewind is a fork ([[Threads]]); no edge is ever removed, and a thread whose work another took in stays a thread.
3. **Divergence stays legible.** A fork opens with a message you send — often a suggestion staged in the [[Composer]] from a standing fork the project's [[Memory|memory]] carries — so each thread corresponds to a direction a human chose, and the graph reads as the record of what was tried.

## Seeing it

The [[Checkpoint Graph]] is the surface: a thread's line of checkpoints, its siblings held open, or the whole family laid out in space, with transfers dashed. What of it is shared is a matter of [[Publishing]]: publishing a checkpoint publishes its thread's earlier checkpoints and the ancestry it forked from. The DAG shared across people is the [[Collaborative DAG]].

## Open Decisions

### Is "the assistant never forks or merges" a guarantee or a habit?

_(Moved from the deleted Commit Tree note, 2026-09-24.)_ Today the invariant holds because of how the app happens to behave, not because anything refuses an assistant-created branch. **Recommendation:** make it a hard rule the product enforces before more kinds of things write history.

**Resolved (2026-07): a guarantee.** The product refuses assistant-created forks and merges as a hard rule. Given up: room for a future assistant that structures history directly; if that's ever wanted, it arrives as a proposal a human accepts, never as a direct structural write. _(2026-08: the retired design's splits were exactly this — proposed by the agent, landed by your confirmation; they retired 2026-09-16, and the reserved proposal-acceptance path stands unused. 2026-09-24: re-read for the DAG of threads — the guarantee covers forks and transfers; a spawn is an agent's own child thread beneath its turn, marked as the agent's, and is not what the guarantee guards.)_
