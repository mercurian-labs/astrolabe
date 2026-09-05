# Project memory

Project memory is a collection of Markdown notes and maps that records durable product and design
knowledge. A project can designate one registered repository, or a folder inside one, as its
memory. The memory repository does not need to be one of the project&rsquo;s code repositories.

## Designate memory

Open the project menu in the sidebar and choose its repository settings. In the **Memory** section,
pick any registered repository and optionally enter a folder within it. The folder must already
exist. Removing the designation disconnects the project from the memory without deleting files.

When notes contain containment declarations and no product map exists yet, the same dialog offers
to generate `Product.skillmap.md` beside the notes. The generated skill map carries the containment
arrangement in its frontmatter and a starter teaching body explaining how to use it. The offer
states how many declarations it found. Generation is a one-time action; if the declarations form a
cycle, the dialog explains the refusal instead of writing a partial map.

## Browse memory

Choose **Memory** in the sidebar footer after selecting a project. The left rail lists maps, notes,
and unresolved references. A skill map is a `.skillmap.md` file beside the notes: YAML frontmatter
declares its edge vocabulary and ordered arrangement, while its Markdown body teaches when and how
to use that view. The page shows the vocabulary, renders the teaching with navigable wikilinks, and
shows an ordered tree for a forest, a layered flow for an acyclic non-forest, or a relational web
when the edges contain cycles. A map can explicitly choose any of the three readings. Select any
arranged note to open it. A refused map remains visible with the
reason it could not be read, and index problems are called out above the list. Legacy tree-YAML
files under `maps/` remain visible as refusals until rewritten as skill maps.

Map graphs pan, zoom, and carry a minimap like the Checkpoints history map.

Notes show their Markdown body and backlinks. Wikilinks open other notes. A dashed red link means
the target is referenced but has not been written yet; opening it shows which existing notes point
to it. Memory is read fresh from its files, so edits made outside the app appear the next time the
index or note is read.

## How notes change

A thread line works on its own memory branch. When a turn earns a durable memory change, the
assistant lands it there directly as an amendment: one commit on the line's branch, marked with
the turn that made it. Nothing asks you to confirm each amendment as it lands, and nothing reaches
the memory's shared main line until you review the line's changes and merge them home. There is
no in-app note editor — to change a note directly, use any editor on the memory's own files; the
change appears on the next read and shows in the line's Memory panel as a hand-made change. For
an unresolved reference, **Write this note** opens a new draft seeded with a message asking for the
note; the note is written when that turn lands its amendment.

## Mention notes in a thread

In a thread line's composer, type **@** to search memory notes alongside repository files, or type
**[[** to search notes only. Picking a note inserts a note chip into the message. A sent note chip
opens the line's **Memory** panel addressed at that note: if the line changed it, the change is
selected; otherwise the note's current version opens read-only in Files.

Mentioning a note also tells the assistant which memory note to consult. Memory is durable
design truth; repository files still describe what is actually built.

## Review memory changes

Add **Memory** to a thread line's right panel from the plus menu. It reads the line at the same
checkpoint the rest of the thread view is showing, so picking an earlier checkpoint in Checkpoints
shows memory as it was captured then. The panel's tab carries the number of changes that still
need review, even while the panel is closed.

The panel reads top to bottom:

- **Reading position.** Whether you are at the latest captured work or an earlier checkpoint, and
  whether a turn is still running. Memory shows saved captured work only; a running turn's
  unsaved edits are not here yet.
- **Needs review.** Every amendment you have not reviewed: assistant amendments, hand-made
  commits, and the line's captured but uncommitted tail. **Mark reviewed** records your review of
  that exact change. Opening a change never marks it reviewed.
- **Local graph.** The notes this line changed and the prose links between them, with added,
  removed, and unchanged links told apart in words as well as strokes. Skill maps are listed as
  documents and never drawn as nodes. Selecting a node selects its document below, and selecting
  a document or amendment lights up its notes.
- **Changes.** Each changed document with its history (added, modified, renamed from, deleted,
  restored) and each amendment, including which earlier amendment a revert undoes. **Open in
  Files** shows the document read-only at its recorded version; a deleted document opens as its
  former version. **View changes** opens the exact comparison in the Diff panel, where a skill map
  is summarised as structure and body changes above the raw patch, even when the map cannot be
  parsed.

When a line has not changed memory, **Browse memory** lists the memory as captured at that
position so you can open any file read-only. Comments you leave on a memory document or
comparison join the composer's pending review context for this line; they are sent only when you
send the message.

**Revert** undoes one amendment as a new amendment on the line. It refuses, without touching your
edits, while a turn is running, while the line's working slot is leased or holds uncaptured edits,
at an earlier checkpoint, or when later changes overlap the revert; in that last case you can add
a reconciliation request to your draft instead. Every revert is pinned to the memory snapshot you
reviewed. If a new capture or amendment arrives, refresh and review it before trying again. A dirty
standalone home checkout does not prevent a safe revert on the line.

## Merge memory home

**Merge home** first prepares a review: it lists what still needs review and any parser warnings,
and promotes nothing. Mark the remaining changes reviewed, prepare again, then **Confirm merge
home**. If memory changed in between, confirming returns a fresh review instead of merging; nothing
retries on your behalf. For a memory folder inside a code repository, confirming approves this
exact review for the repository's next push or pull request; it is not merged home until that
ships, and pushes carry commits only, so commit any pending memory work first. For a standalone
memory repository, confirming creates the merge commit when Git can merge cleanly; a conflict
comes back with the paths involved and a **Reconcile in the conversation** action that seeds your
draft. Host-side merge, auto-merge, and host revert of a pull request that carries shared memory
stay refused until the host contracts can check the exact remote head.

Assets and configuration files inside the designated memory folder need review too. Their
amendments retain the exact changed paths even when there are no changed Markdown documents or
graph nodes.

App push and pull request publishing from an unregistered branch, including main, are currently
unavailable in shared memory repositories. Use a registered thread line and review its memory
changes, or use external Git outside the app's review boundary. Combined commit-and-push actions
can commit pending work, then refuse publication because the new commit needs a fresh review.
They never approve that new commit automatically.
