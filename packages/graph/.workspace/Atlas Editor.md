# Atlas Editor

A WYSIWYG Markdown editor built on CodeMirror 6, in the manner of Obsidian — the primary way a person reads and writes an [[Atlas]] inside the product, and the human's half of the two-peer document a [[Threads|thread]] carries. (Silkdown is an open-source editor of this kind, built on CodeMirror 6.)

## Why CodeMirror 6

> Agent native. We fundamentally want to work with agents, and they are far better off working with Markdown files straight off the filesystem. Editing the Markdown itself, rather than a document tree that has to be converted to Markdown on disk and back, means there is no round trip to get wrong — the file the agent reads is the file you are editing.

> Collaboration built in. CodeMirror carries an operational-transform collaboration package (which may only fit older versions) and a CRDT binding through Yjs built for CodeMirror 6.

## Two peers on one document

A thread has one human and one agent runtime at a time ([[Threads]]). The agent writes a note as a file in the thread's working state; you write the same file through the editor. **The file is the source of truth.** The editor's buffer is a live view over it: the agent's writes flow into the buffer as they land, your edits flush to the file, and the CRDT merges the two where they overlap — which is what gives the agent a cursor of its own in your editor and keeps either peer's edit from being lost. The buffer is ephemeral working state, like the slot's tree; what lasts is the commit ([[Memory]]). Two peers is the whole problem: nothing here converges across people, who meet through publish, fork, and transfer ([[Collaborative DAG]]).

## Edits steer the running turn

While a turn is running, your edits are delivered to it as a steer — not keystrokes, but "you changed this passage of this note to say this", batched at a natural pause, shown in the [[Composer]] as sent, and holdable: you can keep edits back until you choose and release them as one steer. A provider that takes a steer in place continues; one that cannot is interrupted and restarted with the edit in hand, its earlier attempt kept beneath the turn ([[Threads]]). Outside a turn an edit summons no one, and the next message carries it ([[Assistant]]). This is the workflow the editor exists for: a person and an agent shaping one note at the same time, the agent told what the person changed while it is still working. _(2026-09-24.)_

# AI Integration

[[Atlas Chat]]

## Open Decisions

### Is an editor inside the product compatible with memory's one write path?

[[Memory]] narrowed itself (2026-08-28) to a lens: the product carries exactly one write path, the amendment commit, and direct human edits happen outside the product. This editor is inside it. Two readings. **An outside editor that happens to be embedded:** its writes are hand edits like any other, shown as unmarked on the memory tab, landing only through the ordinary commit — Memory's rule stands verbatim. **One durable write path:** Memory's rule is amended to say that what must be unique is the durable write — the commit — while a live buffer is working state the way the slot's tree is. **Recommendation:** the second, recorded on Memory when Atlas moves from research to design; the first reading is what the design already is until then, and it costs nothing to keep. Given up, if the second is taken: the product never carrying an editor of its own.

### What does the agent see of an edit you hold back?

Nothing until you release it, in the plain reading — the hold exists so a half-formed edit is not narrated to the agent. The cost is the agent continuing against a passage you are mid-way through changing. **Recommendation:** nothing until released, with the composer showing that edits are held, so the silence is visible rather than surprising. Raised with the workflow; resolve from use.
