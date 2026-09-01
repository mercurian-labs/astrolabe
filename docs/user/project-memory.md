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

Map graphs pan, zoom, and carry a minimap like the checkpoint graph.

Notes show their Markdown body and backlinks. Wikilinks open other notes. A dashed red link means
the target is referenced but has not been written yet; opening it shows which existing notes point
to it. Memory is read fresh from its files, so edits made outside the app appear the next time the
index or note is read.

## How notes change

The app carries exactly one write path into memory: the assistant proposes an amendment, and
nothing lands until you confirm it. There is no in-app note editor — to change a note directly,
use any editor on the memory's own files; the change appears on the next read. For an unresolved
reference, **Write this note** starts that path for you: it opens a new draft seeded with a message
asking for the note, and the note is written only when you confirm the proposed amendment.

## Mention notes in a plan

In a planning composer, type **@** to search memory notes alongside repository files, or type
**[[** to search notes only. Picking a note inserts a note chip into the message. Sent note chips
open a transient reader over the planning space, where wikilinks and backlinks stay navigable.
Closing the reader returns to the plan exactly as it was.

Mentioning a note also tells the planning assistant which memory note to consult. Memory is durable
design truth; repository files still describe what is actually built.

## Review memory amendments

The planning assistant can propose an amendment when a conversation earns a durable memory
change. The proposal writes nothing by itself: you review the exact note and map diff, then choose
**Amend memory** or **Not now**. Confirming lands the change in the memory&rsquo;s history and adds a
muted amendment marker to the plan&rsquo;s history.

## Use suggested next messages

When the current plan mentions a memory note with unresolved **Open Decisions**, suggested next
messages appear above the composer. Choosing one sends an ordinary message that names the note and
asks to resolve that decision. You can dismiss the row; it returns during the session only when a
new suggestion appears.
