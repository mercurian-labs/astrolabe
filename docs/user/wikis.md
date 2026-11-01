# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads. Its filter narrows the list to one or several wikis, or to the documents an open change request touches (**Has changes**, also a one-tap pill under the title while any document has changes), and holds **Add a wiki**, which works like adding a project: start a new wiki, choose a git repository you already have, or clone one. **Add wiki** in the command palette does the same. A wiki's settings (its folder, mirror, and removing it) open from the gear on its row in the filter.

Notes are the repository's top-level `.md` files. `README.md`, `AGENTS.md` and `CLAUDE.md` are left out, files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them, and `.base` files are [bases](#bases). A wiki is not a project: no thread works in its folder. Agents reach it from threads in your projects, and every change they make goes to a change request.

## Link a wiki to a project

Link a wiki to the projects it plans, so their agents know where research and plans live. After you add a wiki or a project, the command palette offers to link it to one on the same computer; **Not now** skips it. Change links any time with **Projects** in a wiki's settings, or **Wikis** in a project's settings (**Settings → Projects**). A wiki can plan several projects, and a project can have several wikis.

When a conversation starts in a linked project, its agent is told which wikis hold that project's research and plans: to look there first when it researches, plans, or builds a feature, and to write what it learns back to the wiki.

## Read and edit notes

Documents are listed newest first. Above them, **Open changes** counts the wiki's open change requests and takes you to them in **Changes**. Clicking one shows it in the focused pane's tab in front, unless that tab is a conversation or something with unsaved edits, which keep their tab. The tab remembers what it showed: the arrows at the start of its header, `mod+[` and `mod+]` go back and forward, as in a browser. A document already open in another tab comes to the front there instead. Option-click (Alt-click on Windows and Linux), middle-click, or **Open in new tab** in its right-click menu opens a new tab; **Open to the right** in that menu opens it in a new pane beside the current one. ⌘-click (Ctrl-click) and Shift-click select several, as in the thread list; a selected row's right-click menu opens them all in new tabs. Drag a row, or a selection, onto a pane's tabs to open it there, or onto a pane's content to open it in a new pane. Documents open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), so a document can stand beside a chat or a file. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents whose name holds what you type. **New document** starts one: type its name and choose **Write**.

When you change a note, **Save to change request** keeps your edit in a change request instead of writing it into the wiki directly. Closing a tab with unsaved edits asks first.

## Bases

A base is a saved question over a wiki's notes: which notes, filtered and sorted by their properties and links, shown as a table or as cards. It uses Obsidian's Bases format, so a base written in Obsidian works here and the other way round. Its results are worked out each time you look, never stored, so a base keeps up as the wiki grows. A useful shape for an index note is a hand-ordered list of the notes to read first, then a base listing everything else in the area.

To make one, write a `base` code block in a note and save it to a change request. The block shows its view while you read, and its YAML while you edit it. A `.base` file made in Obsidian and committed to the wiki's repository lists among its documents and opens as its view. Click a row's name to open that note. Give notes properties with YAML frontmatter at the top (`status: open`), which bases can filter, sort and show. On the phone, a note's base blocks show their first view, and a `.base` file lists among the documents and opens as its view, with a View menu at the top when it has several. Agents read a base's rows too.

Bases here support part of Obsidian's syntax:

- **Filters**: `and`, `or` and `not` groups, for the whole base and per view.
- **Statements**: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!` and arithmetic over text, numbers, `true`, `false`, `null` and lists.
- **Properties**: `status`, `note.status`, `note["due date"]`.
- **File**: `file.name`, `basename`, `path`, `folder`, `ext`, `size`, `mtime` (the last commit that changed it), `tags`, `links`, `backlinks` and `properties`, and `file.hasLink()`, `hasTag()`, `hasProperty()`, `inFolder()` and `asLink()`.
- **`this`**: the note a block sits in, or the base file itself, as in `file.hasLink(this.file)`.
- **Functions**: `date()`, `now()`, `today()`, `link()` and `list()`; a date plus or minus a duration such as `"1 week"`.
- **Methods**: `contains`, `containsAll`, `containsAny`, `startsWith`, `endsWith`, `isEmpty`, `lower` and `.length`.
- **Views**: table and cards, with `order`, `sort`, `limit`, `groupBy`, and each property's `displayName`.

Formulas, summaries, `groupOrder`, other view types (list, kanban, map), regular expressions, `file.ctime` and other functions are not supported yet. A base that uses one names it instead of showing results. A base's rows are the wiki's notes; skill maps and other bases are left out.

## Documents beside your work

A document can open beside a conversation, and a conversation beside a document. **Document** in a pane's New tab (its **+**) finds or writes one in that tab's place. A change request's **Open thread** shows its thread's conversation after the chat in front.

## Change requests

Change requests are listed in **Changes** in the icon rail, beside your pull requests: open ones first, then a folded **Merged and closed** shelf. When the Wikis filter picks a single wiki, **Open changes** in Wikis narrows them to that wiki. Each opens as a tab, and its documents open beside it.

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a change request. The change request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a change request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a change request conflicts only when both sides changed the same sentence.

When the thread that wrote a change request has pull requests, the change request lists them with their state, and **Open** shows one beside it. Each is still reviewed and merged in its own place. Once one of them merges, the change request offers to merge the docs too; once all of them close without merging, it offers to close. Merging the docs while a pull request is still open asks first, since they would describe code that isn't on main yet.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Agents in wikis

Agents in any thread can read, search and amend your wikis. Their amendments go into that thread's own change request on the wiki, one per thread, which you review and merge like any other.

To point an agent at a note, type `[[` in a thread's message and pick the note; the agent reads it. Notes from the project's linked wikis come first. While the project has no linked wiki, the list also offers to link one.

When an agent amends a note you have open in that change request, its changes appear in the editor as it makes them, marked as its own, and deletions stay visible so you can restore them. Anything you type while the agent's turn is running is saved to the change request when the turn ends.

## Keep a copy elsewhere

In a wiki's menu, **Mirror** sets a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
