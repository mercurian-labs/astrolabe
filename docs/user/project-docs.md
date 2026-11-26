# Project docs

Every project can hold its own docs: notes, canvases, bases and skill maps, kept as files beside
its code. They can sit in any of the project's folders: the project folder and every repository
it covers (see [Projects with several repositories](multi-repo-projects.md)). There is nothing to
turn on. Your agents read and edit them with the same tools they use for code.

- **Notes** are `.md` files, joined by `[[links]]`.
- **Skill maps** are `*.skillmap.md` files. They arrange notes and teach agents how to work in
  them.
- **Bases** are `.base` files: saved questions over a folder's files (see [Bases](#bases)).
- **Canvases** are `.canvas` files: boards of cards and arrows (see [Canvases](#canvases)).

All four use Obsidian's formats, so a folder you keep as an Obsidian vault works here as it is.

## Find your docs

Open **Projects** in the icon rail. **Docs** in its filter narrows the tree to docs: notes,
canvases, bases, skill maps and the files they link to, with the folders that hold them. The file
you have open always stays in the list. **All files**, or the **Docs** pill under the title, shows
every file again. Switching only changes the list: your tabs and the file in front stay as they
are.

A folder of the project that lives outside the project folder gets a section of its own in the
tree, with its worktrees. If the folder is gone from disk, its section says so.

Notes, canvases and bases open as documents in Projects tabs. On the phone they open from the
**Projects** tab and its file tree, which has the same **Docs** / **All files** choice.

## Links

`[[Name]]` finds a note the way Obsidian does, wherever it is in its folder. With several
folders in a project, a bare link looks in this order:

1. The linking note's own folder.
2. If the name isn't there, the one note with that name in any other folder.
3. If several other folders have it, the link is ambiguous. It is marked, opens nothing, and
   tells you which folders fit.

To point at a note in another folder, put the folder's key first: `[[api:Plan]]`, or
`[[api:plans/Launch#Goals]]` for a heading. A folder's key is its name in lower case, with spaces
and other symbols turned into dashes; a second folder with the same name gets `-2`. You rarely type
it: when `[[` suggests a note from another folder, picking it writes the key for you.

Other things to know about links:

- Files and folders whose names start with a dot, such as `.obsidian`, are left out when a link
  searches by name. An exact path still reaches them.
- New links are written the shortest way that finds the note: a bare name when only one file has
  it, otherwise the whole path, with the title after a `|`.
- ⌘-click (Ctrl-click) a link in a note to follow it in the same tab.
- A link to a note that doesn't exist yet opens an empty note. Write in it, and it saves where
  the note says. A folder in the link always wins: `[[plans/Launch]]` makes `plans/Launch.md`
  from the top of the folder. A `./` or `../` link to nothing makes no note, and says so.
- `![[image.png]]`, or `![[image.png|200]]` for its width, draws an image in the note. The name
  is found the way a link is, and needs its extension.
- Backlinks count links from every folder of the project.

### Link types

A link can say what it means. Add an `@` word to its display text, as in
`[[Auth|the login flow @depends_on]]`. Types can be anything, a link can have several, and they
read one way, from this note to the linked one. Every mention of a note in a note adds to the same
link, so `[[Auth|@depends_on]]` and `[[Auth#Login|@blocks]]` give that link both types. Typing `@`
inside a link suggests the types the project already uses.

When reading, the word stays where you wrote it, marked and without its `@`. A link with nothing
but types, like `[[Auth|@blocks]]`, shows the note's name beside them. Only links in a note's body
have types, not those in frontmatter, embeds or code. Every `@` word at the start of the display
text or after a space is a type; write `\@sam` to keep it as text.

Hover over a link to preview its note and types. On a phone, press and hold a link while reading.

Obsidian keeps these links working and shows the `@` word as you wrote it, including the backslash
in `\@sam`. Its Bases can't read types, so a filter using the functions in
[Bases](#bases) shows nothing there.

## Where your edits go

Edits save by themselves a moment after you stop typing. Where they land depends on the checkout
you opened the document in:

- **A hosted repository's main checkout, on its default branch.** A repository with a pull
  request host, such as GitHub or GitLab, keeps your edits in your draft. Your main checkout and
  its branch don't change. When you're ready, choose **Open pull request** from the draft's menu in
  the document's header. It opens a pull request on the host, a draft one where the host has them,
  to review and merge there like any other. Nothing reaches the host before you choose it.
- **Anywhere else.** Another branch, a worktree, a repository with no host remote, or a plain
  folder: edits are written to the file on disk. Commit them with git as you would any change.
- **A thread's worktree.** A document opened from a thread's worktree saves there, so it travels
  with the thread's other changes on its branch.

You have one draft per repository, the same on every device connected to that computer, and only
you see it. A document in the draft shows your edits; any other shows the default branch. **Discard
draft…** in the same menu throws the draft away. When the host's default branch moves, your draft
follows it and keeps your edits.

Code files are always written on disk, wherever you open them.

### Where new files land

The **New files** settings on a project's page in **Settings → Projects** decide where new files
go. They apply to every project on that computer.

- **Attachments** land at the top of the document's folder by default, or in a folder you name,
  beside the document, or in a subfolder beside it, with missing folders made. A pasted image is
  named `Pasted image` and the time; a dropped file keeps its name; a name that's taken gets ` 1`,
  ` 2`.
- **New notes** from a link land beside the linking file by default, or at the top of its
  folder, or in a folder you name, which falls back to the top if it's missing.

## Move and rename

Ask an agent to move or rename a note, a canvas or a folder. It moves them through Astrolabe, so
every link to them follows, in every folder of the project its thread can write. If some folder
is out of its reach, the agent tells you which links still name the old place. A file moved in
Finder, a terminal or another editor keeps its old links.

A moved link is written the shortest way that still finds the file, and a link that would have
started finding it instead gets its full path, so it stays where it was. A folder's move is a move
of each file in it, attachments included. A note's attachments stay put when the note moves alone.
Links in frontmatter and canvases follow; plain text doesn't, and neither do bases, unless the note
is renamed in place.

## Bases

A base is a saved question over every file in its folder: which files, filtered, sorted and
grouped by their properties, links and formulas, with summaries such as a column's sum or
earliest date. It uses Obsidian's Bases format and gives the same results as Obsidian 1.14: a base
written in Obsidian works here and the other way round. Its results are worked out each time you
look, never stored, so a base keeps up as the folder grows. A useful shape for an index note is a
hand-ordered list of the notes to read first, then a base listing everything else in the area.

To make one, write a `base` code block in a note, or embed a `.base` file with `![[Name.base]]`
(or `![[Name.base#View]]` for one view) on a line of its own. A `.base` file opens as its view.
Click a row's name to open it: a note, base or canvas opens as a document, and any other file,
such as an image or a code file, opens as a file. Give notes properties with YAML frontmatter at
the top (`status: open`), which bases can filter, sort and show.

A view shows as a table, cards (with a cover image from a property), a list, a board with a column
per group, or a map. A map places each file at the coordinates in the property you choose
(`"48.85837, 2.294481"`, or a two-item list), as Obsidian's Maps plugin does, on OpenFreeMap's
tiles unless the view names others; it needs the internet to draw. **Map backgrounds** on a
project's page in **Settings → Projects** holds the tiles maps use on that computer: the first is
the default, and a map can switch between several. They stay in the computer's settings, so an
address with an access key never reaches a project's files. A view that names its own tiles keeps
them, and those are saved in the `.base` file. On the phone, a map lists its places instead.

A `.base` file's tab edits in place, as in Obsidian: switch, add, rename and delete views, change a
view's layout, sort, filter, group and shown properties, add formulas, rename and summarize columns
from their headings, edit a note's property in its cell, drag a board's card to another column,
and add notes with New, which fills in what the view's filters and columns ask for. Changes show
at once and save like a note's (see [Where your edits go](#where-your-edits-go)). On the phone, a
`.base` file's cells edit the same way, a board's card moves with the column picker on it, and its
view settings are read only.

When a note is renamed where it is, names in bases that link to it or compare a file's name with
it follow the new name. A move to another folder leaves bases alone, as Obsidian's rename does.

As in Obsidian, a base with no filters lists every file in its folder: notes in every subfolder,
other bases, canvases and attachments. Folders starting with a dot, such as `.git` and
`.obsidian`, are left out. Add a filter such as `file.ext == "md"` or `file.inFolder("projects")`
to narrow it. In a git repository, a file's created and modified times are those of the first and
last commit that changed it.

Bases support Obsidian's whole language: filters, formulas, every function, regular expressions,
summaries, `groupBy` and `groupOrder`. Two details catch people out, in Obsidian too. A property's
`displayName` is keyed by its full id (`note.status`, `formula.total`), and a bare `status` is
ignored. And `Average` divides by every row, a missing value counting as nothing. A base that names
a function or property that doesn't exist says so instead of showing results. One that runs but
holds something nothing reads, such as a key Bases doesn't have, columns listed anywhere but
`order`, or a sort written among them, shows its results with a warning above them naming each
part.

Astrolabe adds two functions for [link types](#link-types). `file.linksOfType("depends_on")` lists
the links a file makes with that type, and `file.backlinksOfType("depends_on")` the files linking
to it with that type. A base embedded in Auth can show what depends on it with the filter
`file.linksOfType("depends_on").contains(this.file)`.

### Code in a base

In a git repository whose code index is on (see
[Project settings](project-settings.md#code-index)), each code file in a base carries what the
index read of it, read only: `code.language`, `code.lines`, `code.package` (the `package.json`
package it sits in), `code.isTest`, `code.exports`, and `code.definitions`, each written as its
kind and name (`function query`). A file's imports are its links, so `file.links`,
`file.backlinks` and `file.hasLink()` work on code. Each import's link has the type `imports`,
plus `calls`, `extends` or `implements` when the file uses an imported name that way, for
`file.linksOfType()` and `file.backlinksOfType()`. Read a linked file's facts with
`value.asFile().code`.

- Code no test imports: `code.language && !code.isTest && file.backlinks.filter(value.asFile().code.isTest).isEmpty()`
- What imports a file: `file.linksOfType("imports").contains(link("src/jobs/retry.ts"))`. An
  import of a package links to the file the package's name opens, often its index, not to the
  file that defines the name.
- A base that should stay empty, such as contracts reaching into apps:
  `file.inFolder("packages/contracts") && file.links.filter(value.asFile().path.startsWith("apps/")).length > 0`

Only imports make links: a name used without importing it links nothing. Until the index has read
the repository once, code files show only their file fields, and the base says so. In Obsidian,
code files have no links, so a base made there that counts links counts more here on code files.

## Canvases

A canvas is a board of cards and arrows, stored as a JSON Canvas `.canvas` file, so the same file
opens in Obsidian. You can edit one by hand on web, desktop and the phone.

To start one, make a `.canvas` file in any of the project's folders, ask an agent to draw one, or
[keep a canvas from a thread](html-renders.md#canvases). A kept canvas goes where you choose: it
asks which of the project's repositories when there are several, and saves the way your own edits
do (see [Where your edits go](#where-your-edits-go)). Each code card on it links to the code in
its own repository, at a commit that repository's remote has.

An agent says what goes on a board, and Astrolabe finds the room: nothing already there moves,
except that a section can grow to fit a new card. A code card can point at a file in any of the
project's folders.

Open a canvas like any document. Scroll to pan, hold ⌘ and scroll to zoom, hold Space and drag to
pan, ⇧1 fits the board, and ⇧2 zooms to the selection. Far zoomed out, cards show only their names.
**Jump to section** lists a canvas's labelled sections, from the board's menu (☰ at its top right)
or the command palette. The zoom chip at the bottom right shows the zoom; click it to fit the
board, and ⇧0 goes to 100%.

Click a card to select it, and its content becomes live: links open, a note scrolls, a web page
loads, and media plays. Double-click a file card's name to open the file. A web page that refuses
to be framed stays blank on its card, so open it from the link instead.

### Edit a canvas

Edits save by themselves a moment after you stop, as a note's do. There is no Save. A canvas you
can't write to only reads, and **Read-only** in the board's menu, or E, turns it on for that board
alone. The same menu holds both kinds of snapping and **Keys and help** (?).

- **Tools:** the row at the top picks what a drag does: **Hand** (H) pans, **Select** (V) selects
  and moves, **Lasso** (L) selects what a loop goes round, **Card** (C) draws a card, or drops one
  where you click, **Section** (S) draws a section around cards, **Arrow** (A) draws an arrow,
  **Pen** (D) draws freehand, **Eraser** (X) erases drawings, and **Shape** (O) draws an ellipse or
  a diamond, picked from the small choice above it. After one card, section, arrow or shape you're
  back on Select, as Escape also does; the Lasso, Pen and Eraser stay in hand until you press
  Escape or V. Space-drag pans whatever the tool. **Done** stops editing.
- **Add:** double-click the board for a text card, right-click it, drag Note or Media from the tool
  row, or paste text, an address or an image. Drop files from your computer, a folder's files with
  them, or drag files from the Projects tree. A folder dragged from the tree adds a card for every
  file in it, its subfolders' too, up to 200. Dropped and pasted files land where
  [New files](#where-new-files-land) says.
- **Select and move:** click a card, Shift-click to add, or drag across the board to select
  everything you touch. With the Lasso, draw a loop round what you want: it selects only what lies
  wholly inside, and Shift adds to the selection. Drag something already selected to move it
  without leaving the Lasso. Cards snap to a grid of 20 and to the cards near them; hold ⌃ during a
  drag to turn snapping off, Shift to hold to one direction, and Alt to leave a copy behind. Arrow
  keys nudge the selection, further with Shift.
- **Draw:** an arrow drawn between two cards is the card's arrow other apps show. One that starts
  or ends on empty board is a drawing, and an end on a card holds to it as the card moves or
  resizes; drag that end onto a card to hold it there. Dropped near the card's edge, it holds where
  you drop it, or at a side's middle when you're close to one. Select a stroke or drawn arrow by
  clicking its line, then move, style or remove it as you would a card.
- **Bend:** double-click a drawn arrow, or select it and press Enter, to edit its points. Drag a
  point to move it, drag the small dot between two points to add a bend, and click a bend and press
  Backspace to take it out. Enter or Escape finishes. A bent arrow, or one ending off a side's
  middle, stays a drawing, which other apps don't show. **Edit label** in its toolbar labels it.
  Shapes are text cards with an outline, and other apps that open the file show them as ordinary
  cards, without your drawings.
- **Style:** the panel at the board's top left sets the stroke colour, background, stroke width,
  dashed or dotted lines, sharp or round edges, sloppiness, and opacity of what's selected, all of
  it at once and as one step to undo. With nothing selected, it sets how the next cards, sections,
  shapes, arrows and strokes you draw look, for the rest of the session. Its button hides and shows
  it; on a small board or the phone it starts hidden. Other apps that open the file keep the stroke
  colour, and show cards plain. **Sloppiness** gives cards, sections, shapes, arrows and older
  strokes a hand-drawn look: **Architect** is clean, **Artist** and **Cartoonist** are rougher. An
  item keeps the same wobble every time it's drawn, on every device and in an exported image. For
  arrows, **Arrow type** picks **Sharp**, **Curved** or **Elbow**, which runs at right angles around
  the cards in its way, and **Arrowheads** puts a head at either end, or neither for a plain line.
  Other apps draw every card's arrow curved.
- **Pen:** a stroke follows how hard you press with a pen, or with a finger on a screen that senses
  force, and with a mouse it thins as you draw faster. Its stroke width is its width at middling
  pressure. Pen strokes are hand-drawn already, so sloppiness leaves them alone.
- **Order:** cards, arrows and drawings share one order, so a stroke can sit under a card or over
  it. Select something and use **Layers** in the style panel, or ⌘] and ⌘[ to bring it forward or
  send it backward past what it overlaps, and ⌘⇧] and ⌘⇧[ for the front or the back. Sections stay
  beneath everything else and order among themselves. Moving a card leaves it where it stacks. The
  board, an exported image, and the phone draw the same order. Agents can order cards and arrows
  too: ask one to put a card in front of or behind another. They can draw elbow or straight arrows
  when you ask for them.
- **Connect:** drag from the dot on a card's side. Drop on another card, or in empty space to make
  a new one. Drag an arrow to move its nearer end, and double-click it to label it.
- **Resize:** drag just outside a selected card's edge. Double-click the bottom or right edge to
  fit its text. Several things selected, or any drawing, get one dashed box: drag its edges or
  corners to scale everything in it, Shift to keep its shape and Alt to scale from the middle.
  Cards change size, not their text, and nothing shrinks below a card's smallest size.
- **Erase:** drag the Eraser over strokes and drawn arrows. What it touches fades, and goes when
  you let go, as one step to undo; hold Alt to spare what you pass back over. Cards, sections,
  shapes and the arrows between cards hold writing, so the Eraser leaves them alone.
- **Section:** select cards and choose **Create section**, or draw one with the Section tool. A
  section carries whatever sits fully inside it, and you pick it up by its label. An unlabelled
  section is reached by dragging across it.
- **Edit text:** double-click a card, or click a selected one. Escape or clicking away leaves it. A
  note card edits the note itself.

A selected card shows what you can do with it above it, and right-clicking (or ⇧F10) gives the
rest: **Align**, **Convert to file…**, **Swap file…**, **Narrow to heading…**, and a section's
background. **?** on the board lists the keys. Undo steps back one gesture at a time, through what
has already saved, but not through other people's changes. If someone else changes a card while
you type in it, the board keeps both versions and says so.

**Export image…**, in the board's menu or the command palette, saves a PNG on web and desktop.
Text cards draw as plain text, and what only a live card can show draws as its name: Mermaid,
math, a note's body, a web page, a base, a PDF.

**Canvases** on a project's page in **Settings → Projects** holds what the wheel does, when card
names show, both kinds of snapping, the zoom at which card content hides, and where a new canvas
goes. They apply to every board on that computer.

On the phone, drag to pan and pinch to zoom; with the Pen, Lasso or Eraser, one finger draws, loops
or erases. Tap a card to select it and show its toolbar, tap again to follow a link in it or open a
code card, and double-tap to edit. A selected card can be dragged, and shows handles and dots for
your finger. Touch and hold a card or the board for its menu, and **Several** in the tool row turns
tapping and dragging into selecting several, for **Align** and **Create section**. Tap a selected
file card's name to open the file; Back returns to the board. **Jump to section** is in the header.
A PDF on a card opens in the app's viewer from its **Open** button, as does audio or video the
phone can't play in place, and a link card opens in your browser. The phone doesn't export images
or take pasted images.

A file card can narrow a note to a heading or block, or pin a base to one view, as in Obsidian. A
card linking to code marks when its file has changed or gone, and never changes itself.

A file card or a link in a text card counts as a backlink, and a link in a text card to something
unwritten is a red link. Arrows never count as links. Renaming a note updates the canvases that
show it. Link to a canvas with its extension, as `[[Board.canvas]]`: `[[Board]]` doesn't find it.
`![[Board.canvas]]` on a line of its own shows a picture of the board, and clicking it opens the
canvas. `![[Board.canvas#Section]]` shows just that labelled section, with the rest of the board
dimmed round it, and `[[Board.canvas#Section]]` links to it. On web and desktop either opens the
canvas on that section, and renaming the canvas keeps the section in the link.

Agents read a canvas as an outline of its cards, sections and arrows. They see a shape's name and
how many drawings a board has, not what was drawn.

## Agents and docs

An agent works on docs in the folders its thread already has: the project's own checkouts, or the
thread's worktrees. It reads and edits notes, bases and canvases with its own file tools, so its
changes go on the thread's branch in each repository, and reach review in that repository's pull
request with the code they describe. Astrolabe gives it tools for what plain file edits can't do
safely: moving and renaming with links kept, running a base, finding links and backlinks across
folders, and changing a canvas without moving what's on it.

The thread's folder list tells the agent, folder by folder, how far its tools reach. When its
provider can't edit a folder directly, the agent hands the job to a helper thread that works in
that repository. A thread never writes to the main checkout of a repository it left out of its
worktrees.

To point an agent at a note, type `[[` in a thread's message and pick it. It goes in as a link to
the file, as `@` does.

When a turn ends, Astrolabe checks the documents the turn changed. If a base no longer works as
written, or a bare link now fits notes in several folders, it sends the agent one message naming
each problem, and the agent fixes them in a new turn.

## Wikis from earlier versions

Earlier versions kept docs in separate wikis, with their own section in the icon rail. Each wiki
became part of a project when you updated:

- A wiki linked to projects became a folder of each of them. You'll find it under
  **Repositories** on the project's page in **Settings → Projects**, and as a section of the
  Projects tree.
- A wiki linked to no project became a project of its own. A wiki kept on a git host joined the
  project already made for its repository.
- Mirrors are gone. To keep a copy elsewhere, push the repository to a remote of your own.
- Old links to wiki notes, and tabs you had open, open the same documents in Projects.
