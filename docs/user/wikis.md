# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads. Its filter narrows the list to one or several wikis, or to the documents an open change request touches (**Has changes**, also a one-tap pill under the title while any document has changes), and holds **Add a wiki**, which works like adding a project: start a new wiki, choose a git repository you already have, or clone one. **Add wiki** in the command palette and **Add a wiki** in **Settings → Wikis** do the same. **Settings → Wikis** lists every wiki; the gear on a wiki's row in the filter opens its page there, with its folder, linked projects, mirror, and removing it.

Notes are the repository's top-level `.md` files. `README.md`, `AGENTS.md` and `CLAUDE.md` are left out, files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them, and `.base` files are [bases](#bases), which can list every file in the repository. A wiki is not a project: no thread works in its folder. Agents reach it from threads in your projects, and every change they make goes to a change request.

## Link a wiki to a project

Link a wiki to the projects it plans, so their agents know where research and plans live. After you add a wiki or a project, the command palette offers to link it to one on the same computer; **Not now** skips it. Change links any time under **Projects** on a wiki's page in **Settings → Wikis**, or **Wikis** in a project's settings (**Settings → Projects**). A wiki can plan several projects, and a project can have several wikis.

A linked project's chats show each of its wikis in the header; click one to open it.

When a conversation starts in a linked project, its agent is told which wikis hold that project's research and plans: to look there first when it researches, plans, or builds a feature, and to write what it learns back to the wiki. A thread that already exists hears about a new link with its next message, never during a turn. Unlinking stops new threads hearing about the wiki; a thread that already heard keeps what it knows. **What agents are told** on a wiki's page shows the exact words.

## Read and edit notes

Documents are listed newest first. Above them, **Open changes** counts the wiki's open change requests and takes you to them in **Changes**. Clicking one shows it in the focused pane's tab in front, unless that tab is a conversation or something with unsaved edits, which keep their tab. The tab remembers what it showed: the arrows at the start of its header, `mod+[` and `mod+]` go back and forward, as in a browser. A document already open in another tab comes to the front there instead. Option-click (Alt-click on Windows and Linux), middle-click, or **Open in new tab** in its right-click menu opens a new tab; **Open to the right** in that menu opens it in a new pane beside the current one. ⌘-click (Ctrl-click) and Shift-click select several, as in the thread list; a selected row's right-click menu opens them all in new tabs. Drag a row, or a selection, onto a pane's tabs to open it there, or onto a pane's content to open it in a new pane. Documents open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), so a document can stand beside a chat or a file. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents whose name holds what you type. **New document** starts one: type its name and choose **Write**.

When you change a note, **Save to change request** keeps your edit in a change request instead of writing it into the wiki directly. Closing a tab with unsaved edits asks first.

## Bases

A base is a saved question over every file in a wiki's repository: which files, filtered, sorted and grouped by their properties, links and formulas, with summaries such as a column's sum or earliest date. It uses Obsidian's Bases format, and gives the same results as Obsidian 1.14: a base written in Obsidian works here and the other way round. Its results are worked out each time you look, never stored, so a base keeps up as the wiki grows. A useful shape for an index note is a hand-ordered list of the notes to read first, then a base listing everything else in the area.

To make one, write a `base` code block in a note, or embed a `.base` file with `![[Name.base]]` (or `![[Name.base#View]]` for one view) on a line of its own, and save it to a change request. A `.base` file made in Obsidian and committed to the wiki's repository lists among its documents and opens as its view. Click a row's name to open it: a note or base at the wiki's top level opens as a document, and any other file, such as an image or a note in a folder, opens as a file. Give notes properties with YAML frontmatter at the top (`status: open`), which bases can filter, sort and show. Agents read a base's rows, and can write bases into a change request like any note.

A view shows as a table, cards (with a cover image from a property), a list, a board with a column per group, or a map. A map places each file at the coordinates in the property you choose (`"48.85837, 2.294481"`, or a two-item list), as Obsidian's Maps plugin does, on OpenFreeMap's tiles unless the view names others; it needs the internet to draw. On the phone, a map lists its places instead.

A `.base` file's tab edits in place, as in Obsidian: switch, add, rename and delete views, change a view's layout, sort, filter, group and shown properties, add formulas, rename and summarize columns from their headings, edit a note's property in its cell, drag a board's card to another column, and add notes with New, which fills in what the view's filters and column ask for. Changes show at once and stay unsaved until you save them to a change request; main changes only when it merges. Only notes at the wiki's top level edit this way. On the phone, a `.base` file's cells edit the same way, a board's card moves with the column picker on it, and its view settings are read only.

When an agent renames a note, names in bases that link to it or compare a file's name with it follow the new name. Obsidian's own rename leaves bases alone, so a base whose names no longer match any note, or any link, is listed as a problem in the wiki's settings and in change requests.

As in Obsidian, a base with no filters lists every file: notes in every folder, other bases, canvases and attachments. Folders starting with a dot, such as `.git` and `.obsidian`, are left out. Add a filter such as `file.ext == "md"` or `file.inFolder("projects")` to narrow it. A file's created and modified times are those of the first and last commit that changed it.

Bases support Obsidian's whole language: filters, formulas, every function, regular expressions, summaries, `groupBy` and `groupOrder`. Two details catch people out, in Obsidian too. A property's `displayName` is keyed by its full id (`note.status`, `formula.total`), and a bare `status` is ignored. And `Average` divides by every row, a missing value counting as nothing. A base that names a function or property that doesn't exist says so instead of showing results.

## Documents beside your work

A document can open beside a conversation, and a conversation beside a document. **Document** in a pane's New tab (its **+**) finds or writes one in that tab's place. A change request's **Open thread** shows its thread's conversation after the chat in front.

## Change requests

Change requests are listed in **Changes** in the icon rail, beside your pull requests: open ones first, then a folded **Merged and closed** shelf. When the Wikis filter picks a single wiki, **Open changes** in Wikis narrows them to that wiki. Each opens as a tab, and its documents open beside it.

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a change request. The change request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a change request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a change request conflicts only when both sides changed the same sentence.

When the thread that wrote a change request has pull requests, the change request lists them with their state, and **Open** shows one beside it. Each is still reviewed and merged in its own place. Once one of them merges, the change request offers to merge the docs too; once all of them close without merging, it offers to close. Merging the docs while a pull request is still open asks first, since they would describe code that isn't on main yet.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Work on several change requests at once

The sidebar lists each wiki's worktrees as Projects lists a project's: the wiki folder under its main branch, showing its documents, then one per change request you put in a worktree, under that change request's title, showing the documents it changes. The button on a worktree's header swaps its documents for its whole file tree, and back. **Work on a change request in a worktree**, beside the filter, puts an open change request in a worktree of its own, or opens a new one there when you type a title. Worktrees work as they do in [Projects](projects.md#worktrees-and-branches): a free one is reused and its unsaved work is set aside, a worktree gets a number the first time you open one of its change request's documents, and ones you haven't touched in a day fold under **N more worktrees**. In the filter, the arrow beside a wiki lists its worktrees, and unticking one hides it.

A note opened from a change request's worktree reads from that change request. When an amendment lands on a change request, its worktree's files follow; if you have unsaved edits in the same files there, the amendment stops and names them. Edits made directly in a change request's worktree, by you or an agent working there, land as one amendment with **Save edits to the change request** in the worktree's menu.

## Agents in wikis

Agents in any thread can read, search and amend your wikis. Their amendments go into that thread's own change request on the wiki, one per thread, which you review and merge like any other.

To point an agent at a note, type `[[` in a thread's message and pick the note; the agent reads it. Notes from the project's linked wikis come first. While the project has no linked wiki, the list also offers to link one.

When an agent amends a note you have open in that change request, its changes appear in the editor as it makes them, marked as its own, and deletions stay visible so you can restore them. Anything you type while the agent's turn is running is saved to the change request when the turn ends.

## Keep a copy elsewhere

Under **Mirror** on a wiki's page in **Settings → Wikis**, set a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
