# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads. Its filter narrows the list to one or several wikis, or to the documents an open pull request touches (**Has changes**, also a one-tap pill under the title while any document has changes), and holds **Add a wiki**, which works like adding a project: start a new wiki, choose a git repository you already have, or clone one. **Add wiki** in the command palette and **Add a wiki** in **Settings → Wikis** do the same. **Settings → Wikis** lists every wiki; the gear on a wiki's row in the filter opens its page there, with its folder, linked projects, mirror, map backgrounds, and removing it.

Notes are the repository's top-level `.md` files. `README.md`, `AGENTS.md` and `CLAUDE.md` are left out, files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them, and `.base` files are [bases](#bases), which can list every file in the repository. A wiki is not a project: no thread works in its folder. Agents reach it from threads in your projects, and every change they make goes to a pull request.

## Link a wiki to a project

Link a wiki to the projects it plans, so their agents know where research and plans live. After you add a wiki or a project, the command palette offers to link it to one on the same computer; **Not now** skips it. Change links any time under **Projects** on a wiki's page in **Settings → Wikis**, or **Wikis** in a project's settings (**Settings → Projects**). A wiki can plan several projects, and a project can have several wikis.

A linked project's chats show each of its wikis in the header; click one to open it.

When a conversation starts in a linked project, its agent is told which wikis hold that project's research and plans: to look there first when it researches, plans, or builds a feature, and to write what it learns back to the wiki. A thread that already exists hears about a new link with its next message, never during a turn. Unlinking stops new threads hearing about the wiki; a thread that already heard keeps what it knows. **What agents are told** on a wiki's page shows the exact words.

## Read and edit notes

Documents are listed newest first. Above them, **Open changes** counts the wiki's open pull requests and takes you to them in **Changes**. Clicking one shows it in the focused pane's tab in front, unless that tab is a conversation or something with unsaved edits, which keep their tab. The tab remembers what it showed: the arrows at the start of its header, `mod+[` and `mod+]` go back and forward, as in a browser. A document already open in another tab comes to the front there instead. Option-click (Alt-click on Windows and Linux), middle-click, or **Open in new tab** in its right-click menu opens a new tab; **Open to the right** in that menu opens it in a new pane beside the current one. ⌘-click (Ctrl-click) and Shift-click select several, as in the thread list; a selected row's right-click menu opens them all in new tabs. Drag a row, or a selection, onto a pane's tabs to open it there, or onto a pane's content to open it in a new pane. Documents open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), so a document can stand beside a chat or a file. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents whose name holds what you type. **New document** starts one: type its name and choose **Write**.

When you change a note, **Save to pull request** keeps your edit in a pull request instead of writing it into the wiki directly. Closing a tab with unsaved edits asks first.

## Bases

A base is a saved question over every file in a wiki's repository: which files, filtered, sorted and grouped by their properties, links and formulas, with summaries such as a column's sum or earliest date. It uses Obsidian's Bases format, and gives the same results as Obsidian 1.14: a base written in Obsidian works here and the other way round. Its results are worked out each time you look, never stored, so a base keeps up as the wiki grows. A useful shape for an index note is a hand-ordered list of the notes to read first, then a base listing everything else in the area.

To make one, write a `base` code block in a note, or embed a `.base` file with `![[Name.base]]` (or `![[Name.base#View]]` for one view) on a line of its own, and save it to a pull request. A `.base` file made in Obsidian and committed to the wiki's repository lists among its documents and opens as its view. Click a row's name to open it: a note or base at the wiki's top level opens as a document, and any other file, such as an image or a note in a folder, opens as a file. Give notes properties with YAML frontmatter at the top (`status: open`), which bases can filter, sort and show. Agents read a base's rows, and can write bases into a pull request like any note.

A view shows as a table, cards (with a cover image from a property), a list, a board with a column per group, or a map. A map places each file at the coordinates in the property you choose (`"48.85837, 2.294481"`, or a two-item list), as Obsidian's Maps plugin does, on OpenFreeMap's tiles unless the wiki or the view names others; it needs the internet to draw. **Map backgrounds** on a wiki's page in **Settings → Wikis** holds the tiles its maps use: the first is the default, and a map can switch between several. Backgrounds stay on the server, so an address with an access key never reaches the wiki's files or its mirror. A view that names its own tiles keeps them, and those are saved in the `.base` file. On the phone, a map lists its places instead.

A `.base` file's tab edits in place, as in Obsidian: switch, add, rename and delete views, change a view's layout, sort, filter, group and shown properties, add formulas, rename and summarize columns from their headings, edit a note's property in its cell, drag a board's card to another column, and add notes with New, which fills in what the view's filters and column ask for. Changes show at once and stay unsaved until you save them to a pull request; main changes only when it merges. Only notes at the wiki's top level edit this way. On the phone, a `.base` file's cells edit the same way, a board's card moves with the column picker on it, and its view settings are read only.

When an agent renames a note, names in bases that link to it or compare a file's name with it follow the new name. Obsidian's own rename leaves bases alone, so a base whose names no longer match any note, or any link, is listed as a problem in the wiki's settings and in pull requests.

As in Obsidian, a base with no filters lists every file: notes in every folder, other bases, canvases and attachments. Folders starting with a dot, such as `.git` and `.obsidian`, are left out. Add a filter such as `file.ext == "md"` or `file.inFolder("projects")` to narrow it. A file's created and modified times are those of the first and last commit that changed it.

Bases support Obsidian's whole language: filters, formulas, every function, regular expressions, summaries, `groupBy` and `groupOrder`. Two details catch people out, in Obsidian too. A property's `displayName` is keyed by its full id (`note.status`, `formula.total`), and a bare `status` is ignored. And `Average` divides by every row, a missing value counting as nothing. A base that names a function or property that doesn't exist says so instead of showing results.

## Link types

A link can say what it means. Add an `@` word to its display text, as in `[[Auth|the login flow @depends_on]]`. Types can be anything, a link can have several, and they read one way, from this note to the linked one. Every mention of a note in a note adds to the same link, so `[[Auth|@depends_on]]` and `[[Auth#Login|@blocks]]` give that link both types. Typing `@` inside a link suggests the types your wiki already uses.

When reading, the word stays where you wrote it, marked and without its `@`. A link with nothing but types, like `[[Auth|@blocks]]`, shows the note's name beside them. Only links in a note's body have types, not those in frontmatter, embeds or code. Every `@` word at the start of the display text or after a space is a type; write `\@sam` to keep it as text.

Hover over a link to preview its note and types. On a phone, press and hold a link while reading.

In a base, `file.linksOfType("depends_on")` lists the links a file makes with that type, and `file.backlinksOfType("depends_on")` the files linking to it with that type. A base embedded in Auth can show what depends on it with the filter `file.linksOfType("depends_on").contains(this.file)`.

Obsidian keeps these links working and shows the `@` word as you wrote it, including the backslash in `\@sam`. Its Bases can't read types, so a filter using these functions shows nothing there.

## Documents beside your work

A document can open beside a conversation, and a conversation beside a document. **Document** in a pane's New tab (its **+**) finds or writes one in that tab's place. A pull request's **Open thread** shows its thread's conversation after the chat in front.

## Pull requests

A wiki's pull requests are listed in **Changes** in the icon rail, beside your repositories': open ones first, then a folded **Merged and closed** shelf. When the Wikis filter picks a single wiki, **Open changes** in Wikis narrows them to that wiki. Each opens as a tab, and its documents open beside it.

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a pull request. The pull request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a pull request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a pull request conflicts only when both sides changed the same sentence.

When the thread that wrote a wiki's pull request also has code pull requests, the wiki's one lists them with their state, and **Open** shows one beside it. Each is still reviewed and merged in its own place. Once one of them merges, the wiki's one offers to merge the docs too; once all of them close without merging, it offers to close. Merging the docs while a pull request is still open asks first, since they would describe code that isn't on main yet.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Work on several pull requests at once

The sidebar lists each wiki's worktrees as Projects lists a project's: the wiki folder under its main branch, showing its documents, then one per pull request you put in a worktree, under that pull request's title, showing the documents it changes. The button on a worktree's header swaps its documents for its whole file tree, and back. **Work on a pull request in a worktree**, beside the filter, puts an open pull request in a worktree of its own, or opens a new one there when you type a title. Worktrees work as they do in [Projects](projects.md#worktrees-and-branches): a free one is reused and its unsaved work is set aside, a worktree gets a number the first time you open one of its pull request's documents, and ones you haven't touched in a day fold under **N more worktrees**. In the filter, the arrow beside a wiki lists its worktrees, and unticking one hides it.

A note opened from a pull request's worktree reads from that pull request. When an amendment lands on a pull request, its worktree's files follow; if you have unsaved edits in the same files there, the amendment stops and names them. Edits made directly in a pull request's worktree, by you or an agent working there, land as one amendment with **Save edits to the pull request** in the worktree's menu.

## Agents in wikis

Agents in any thread can read, search and amend your wikis. Their amendments go into that thread's own pull request on the wiki, one per thread, which you review and merge like any other.

To point an agent at a note, type `[[` in a thread's message and pick the note; the agent reads it. Notes from the project's linked wikis come first. While the project has no linked wiki, the list also offers to link one.

When an agent amends a note you have open in that pull request, its changes appear in the editor as it makes them, marked as its own, and deletions stay visible so you can restore them. Anything you type while the agent's turn is running is saved to the pull request when the turn ends.

## Keep a wiki on a git host

A wiki can live in a repository on GitHub, GitLab, Bitbucket, Forgejo, GitCafe or Azure DevOps, so everyone with access to the repository works in it. On a wiki's page in **Settings → Wikis**, choose **Connect** under **Git host**. Astrolabe uses the folder's `origin` remote and pushes the wiki's history if the repository doesn't have it yet.

On a connected wiki, these are the repository's own pull requests, or merge requests on GitLab, and the app calls them what the host does. An agent's work goes up when its turn ends, as a draft where the host has drafts, and your own edits go up as you save them. Once one is on the host, it opens on the same screen as a repository's pull request, with its checks, reviews, comments and merge choices, and a **Wiki** tab showing its amendments, the notes it changes and what stands after the merge. Work not on the host yet is left out of a merge; **Publish now** on the Wiki tab sends it. When it conflicts with main, **Resolve conflicts** merges main in note by note and pushes the result, so the host can merge it. What each host offers depends on the host.

Astrolabe picks up what happens on the host about once a minute, or when you choose **Sync now**. If you have unsaved edits overlapping a change on the main line, your wiki's page says so and the wiki catches up once they're dealt with.

Merging starts on a method that keeps each amendment on the main line. Squashing, where you pick it or the repository allows nothing else, joins them into one commit, so they can't be reverted one at a time afterwards. A pull request merged on the host's own site uses the host's plain line merge, so conflicts Astrolabe could have settled stop it there.

**Disconnect** makes it a local wiki again. The repository and its pull requests stay on the host.

## Keep a copy elsewhere

Under **Mirror** on a wiki's page in **Settings → Wikis**, set a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
