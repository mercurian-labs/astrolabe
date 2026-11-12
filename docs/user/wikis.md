# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`, with bases and canvases beside them. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads, by folder. **Flat list, newest first** in its filter trades the folders for a list, and **Hidden files** shows files and folders starting with a dot, which stay out of the list, search and `[[` until you do. Your choice stays on this device. Search always gives one flat list. Its filter narrows the list to one or several wikis, or to the documents an open pull request touches (**Has changes**, also a one-tap pill under the title while any document has changes), and holds **Add a wiki**, which works like adding a project: start a new wiki, choose a git repository you already have, or clone one. **Add wiki** in the command palette and **Add a wiki** in **Settings → Wikis** do the same. **Settings → Wikis** lists every wiki; the gear on a wiki's row in the filter opens its page there, with its folder, linked projects, mirror, map backgrounds, and removing it.

Notes are the repository's `.md` files, in any folder, and `[[Name]]` finds a note the way Obsidian does, wherever it is. Files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them, `.base` files are [bases](#bases), which can list every file in the repository, and `.canvas` files are [canvases](#canvases). A wiki is not a project: no thread works in its folder. Agents reach it from threads in your projects, and every change they make goes to a pull request.

## Link a wiki to a project

Link a wiki to the projects it plans, so their agents know where research and plans live. After you add a wiki or a project, the command palette offers to link it to one on the same computer; **Not now** skips it. Change links any time under **Projects** on a wiki's page in **Settings → Wikis**, or **Wikis** in a project's settings (**Settings → Projects**). A wiki can plan several projects, and a project can have several wikis.

A linked project's chats show each of its wikis in the header; click one to open it.

When a conversation starts in a linked project, its agent is told which wikis hold that project's research and plans: to look there first when it researches, plans, or builds a feature, and to write what it learns back to the wiki. A thread that already exists hears about a new link with its next message, never during a turn. Unlinking stops new threads hearing about the wiki; a thread that already heard keeps what it knows. **What agents are told** on a wiki's page shows the exact words.

## Read and edit notes

Documents are listed newest first. Above them, **Open changes** counts the wiki's open pull requests and takes you to them in **Changes**. Clicking one shows it in the focused pane's tab in front, unless that tab is a conversation or something with unsaved edits, which keep their tab. The tab remembers what it showed: the arrows at the start of its header, `mod+[` and `mod+]` go back and forward, as in a browser. A document already open in another tab comes to the front there instead. Option-click (Alt-click on Windows and Linux), middle-click, or **Open in new tab** in its right-click menu opens a new tab; **Open to the right** in that menu opens it in a new pane beside the current one. ⌘-click (Ctrl-click) and Shift-click select several, as in the thread list; a selected row's right-click menu opens them all in new tabs. Drag a row, or a selection, onto a pane's tabs to open it there, or onto a pane's content to open it in a new pane. Documents open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), so a document can stand beside a chat or a file. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents whose name holds what you type. **New document** starts one: type its name and choose **Write**. A path, such as `plans/Launch`, puts it in that folder. A folder exists while something is in it, so **New folder** in the filter asks for the folder and its first document together, and it appears once that document saves.

### Where new files land

An image embedded with `![[image.png]]`, or `![[image.png|200]]` for its width, draws in the note as you read and edit it, on web, desktop and the phone. The name is found the way a link is, from the note, and needs its extension.

**New files** in **Settings → Wikis** sets this per computer running the wikis. **Attachments** land at the wiki's top by default, or in a folder you name, beside the document, or in a subfolder beside it, with missing folders made. A pasted image is named `Pasted image` and the time; a dropped file keeps its name; a name that's taken gets ` 1`, ` 2`.

**New notes** from a link land beside the linking file by default, or at the top, or in a folder you name, which falls back to the top if it's missing. A folder in the link always wins: `[[plans/Launch]]` makes `plans/Launch.md` from the top of the wiki. A `./` or `../` link to nothing makes no note, and says so.

### Moving documents

Drag a document or folder onto another folder, press F2 on a row to rename it, or use its right-click menu's **Move to…**, which also opens from the keyboard with Shift-F10. **Wiki: Move or rename this document** in the command palette does the same for the document in front. On the phone, touch and hold a row.

A move lands in your draft as one amendment, or the pull request you're in, and shows there as a move. Open tabs follow it. Every link to the document follows too, written the shortest way that still finds it, and a link that would have started finding it instead gets its full path, so it stays where it was. A folder's move is a move of each file in it, attachments included. A note's attachments stay put when the note moves alone. Links in frontmatter and canvases follow; plain text doesn't, and neither do bases, unless you rename a note in place.

New links are written the same way: a bare name when only one file has it, otherwise the whole path, with the title after a `|`.

Edits save by themselves a moment after you stop typing, into [your draft](#drafts), never into the wiki directly. A document you open from a pull request saves into that pull request. If a save fails, the document says so and keeps trying, and leaving it asks first.

## Bases

A base is a saved question over every file in a wiki's repository: which files, filtered, sorted and grouped by their properties, links and formulas, with summaries such as a column's sum or earliest date. It uses Obsidian's Bases format, and gives the same results as Obsidian 1.14: a base written in Obsidian works here and the other way round. Its results are worked out each time you look, never stored, so a base keeps up as the wiki grows. A useful shape for an index note is a hand-ordered list of the notes to read first, then a base listing everything else in the area.

To make one, write a `base` code block in a note, or embed a `.base` file with `![[Name.base]]` (or `![[Name.base#View]]` for one view) on a line of its own. A `.base` file made in Obsidian and committed to the wiki's repository lists among its documents and opens as its view. Click a row's name to open it: a note, base or canvas opens as a document, and any other file, such as an image, opens as a file. Give notes properties with YAML frontmatter at the top (`status: open`), which bases can filter, sort and show. Agents read a base's rows, and can write bases into a pull request like any note.

A view shows as a table, cards (with a cover image from a property), a list, a board with a column per group, or a map. A map places each file at the coordinates in the property you choose (`"48.85837, 2.294481"`, or a two-item list), as Obsidian's Maps plugin does, on OpenFreeMap's tiles unless the wiki or the view names others; it needs the internet to draw. **Map backgrounds** on a wiki's page in **Settings → Wikis** holds the tiles its maps use: the first is the default, and a map can switch between several. Backgrounds stay on the server, so an address with an access key never reaches the wiki's files or its mirror. A view that names its own tiles keeps them, and those are saved in the `.base` file. On the phone, a map lists its places instead.

A `.base` file's tab edits in place, as in Obsidian: switch, add, rename and delete views, change a view's layout, sort, filter, group and shown properties, add formulas, rename and summarize columns from their headings, edit a note's property in its cell, drag a board's card to another column, and add notes with New, which fills in what the view's filters and column ask for. Changes show at once and save by themselves, like a note's; main changes only when a pull request merges. On the phone, a `.base` file's cells edit the same way, a board's card moves with the column picker on it, and its view settings are read only.

When a note is renamed where it is, names in bases that link to it or compare a file's name with it follow the new name. A move to another folder leaves bases alone, as Obsidian's rename does, so a base whose names no longer match any note, or any link, is listed as a problem in the wiki's settings and in pull requests.

As in Obsidian, a base with no filters lists every file: notes in every folder, other bases, canvases and attachments. Folders starting with a dot, such as `.git` and `.obsidian`, are left out. Add a filter such as `file.ext == "md"` or `file.inFolder("projects")` to narrow it. A file's created and modified times are those of the first and last commit that changed it.

Bases support Obsidian's whole language: filters, formulas, every function, regular expressions, summaries, `groupBy` and `groupOrder`. Two details catch people out, in Obsidian too. A property's `displayName` is keyed by its full id (`note.status`, `formula.total`), and a bare `status` is ignored. And `Average` divides by every row, a missing value counting as nothing. A base that names a function or property that doesn't exist says so instead of showing results. One that runs but holds something nothing reads, such as a key Bases doesn't have, columns listed anywhere but `order`, or a sort written among them, shows its results with a warning above them naming each part.

## Canvases

A canvas is a board of cards and arrows, stored as a JSON Canvas `.canvas` file, so the same file opens in Obsidian. You can edit one by hand on web, desktop and the phone, and agents change them through pull requests.

To start one, choose **New document**, type a name and pick **New canvas**, or use **New canvas** in the command palette, then choose **Create canvas**. It starts in your draft, at the top of the wiki unless you type a folder before its name. You can also [keep a canvas from a thread](html-renders.md#canvases).

An agent says what goes on a board, and Astrolabe finds the room: nothing already there moves, except that a group can grow to fit a new card. Its changes land on a pull request, never on main. A canvas open in that pull request refreshes as they land, with the camera where you left it. Each changed card highlights once, then keeps its mark until the pull request is merged or closed. On the thread, **Open canvas** beside the agent's step takes you to the board.

Open a canvas like any document. Scroll to pan, hold ⌘ and scroll to zoom, hold Space and drag to pan, ⇧1 fits the board, and ⇧2 zooms to the selection. Far zoomed out, cards show only their names. **Jump to group** lists a canvas's labelled groups, from the top of its tab or the command palette.

Click a card to select it, and its content becomes live: links open, a note scrolls, a web page loads, and media plays. Double-click a file card's name to open the file. A web page that refuses to be framed stays blank on its card, so open it from the link instead.

### Edit a canvas

Edits save by themselves a moment after you stop, into [your draft](#drafts), or into the pull request the canvas is open in. There is no Save. A canvas in a closed pull request, or one you can't write to, only reads, and the gear on a board turns **Read-only** on for that board alone.

- **Add:** double-click the board for a text card, right-click it, drag from the bar at the bottom, or paste text, an address or an image. Drop files from your computer, a folder's files with them, or drag documents from the sidebar. A folder dragged from the sidebar adds a card for every file in it, its subfolders' too, up to 200. Dropped and pasted files land where **New files** in **Settings → Wikis** says.
- **Select and move:** click a card, Shift-click to add, or drag across the board to select everything you touch. Cards snap to a grid of 20 and to the cards near them; hold ⌃ during a drag to turn snapping off, Shift to hold to one direction, and Alt to leave a copy behind. Arrow keys nudge the selection, further with Shift.
- **Connect:** drag from the dot on a card's side. Drop on another card, or in empty space to make a new one. Drag an arrow to move its nearer end, and double-click it to label it.
- **Resize:** drag just outside a selected card's edge. Double-click the bottom or right edge to fit its text.
- **Group:** select cards and choose **Create group**. A group carries whatever sits fully inside it, and you pick it up by its label. An unlabelled group is reached by dragging across it.
- **Edit text:** double-click a card, or click a selected one. Escape or clicking away leaves it. A note card edits the note itself.

A selected card shows what you can do with it above it, and right-clicking (or ⇧F10) gives the rest: **Align**, **Convert to file…**, **Swap file…**, **Narrow to heading…**, and a group's background. **?** on the board lists the keys. Undo steps back one gesture at a time, through what has already saved, but not through other people's changes. If someone else changes a card while you type in it, the board keeps both versions and says so.

**Export as image**, in the gear's menu or the command palette, saves a PNG on web and desktop. Text cards draw as plain text, and what only a live card can show draws as its name: Mermaid, math, a note's body, a web page, a base, a PDF.

**Settings → Wikis** holds what the wheel does, when card names show, both kinds of snapping, and the zoom at which card content hides. They apply to every board on that computer.

On the phone, drag to pan and pinch to zoom. Tap a card to select it and show its toolbar, tap again to follow a link in it or open a code card, and double-tap to edit. A selected card can be dragged, and shows handles and dots for your finger. Touch and hold a card or the board for its menu, and **Select** in the bottom bar turns tapping and dragging into selecting several, for **Align** and **Create group**. Tap a selected file card's name to open the file; Back returns to the board. **Jump to group** is in the header. A PDF on a card opens in the app's viewer from its **Open** button, as does audio or video the phone can't play in place, and a link card opens in your browser. The phone doesn't export images or take pasted images.

A file card can narrow a note to a heading or block, or pin a base to one view, as in Obsidian. A card linking to code marks when its file has changed or gone at the project's head, and never changes itself.

A canvas in a pull request opens as a board with marks on what changed: added, removed, text, moved and restyled. The list beside it names each change, and clicking a row focuses that card. Moves are folded at the end of the list, removed cards stay on the board so you can see what went, and **JSON** shows the file's raw diff. Click the board once to pan it with the wheel; until then the wheel scrolls the page. On the phone, tap a canvas in the pull request to see the same board with the list below it.

Merging a pull request merges a canvas card by card, so two people's edits to different cards never clash. Text changed in the same card merges by sentence. Where both sides moved, resized or recoloured a card, the change being merged wins. An arrow whose card goes in the merge goes with it, and deleting a card beats moving it. The pull request says beforehand what merging will decide, and a revert says what it decided. A card edited on one side and deleted on the other, the same sentence changed on both sides, or JSON that doesn't read is a conflict. To settle one, edit the clashing cards on the board in the pull request so they agree with main, or put it in a worktree, edit the file in Obsidian or any editor, and use **Save edits to the pull request**. To keep a card main deleted, give it a new `id` there. The phone shows a conflict but can't settle it.

A file card or a link in a text card counts as a backlink, and a link in a text card to something unwritten is a red link. Arrows never count as links. Renaming a note updates the canvases that show it. Link to a canvas with its extension, as `[[Board.canvas]]`: `[[Board]]` doesn't find it. `![[Board.canvas]]` on a line of its own shows a picture of the board, and clicking it opens the canvas.

Agents read a canvas as an outline of its cards, groups and arrows, and their search finds the cards that say something.

## Link types

A link can say what it means. Add an `@` word to its display text, as in `[[Auth|the login flow @depends_on]]`. Types can be anything, a link can have several, and they read one way, from this note to the linked one. Every mention of a note in a note adds to the same link, so `[[Auth|@depends_on]]` and `[[Auth#Login|@blocks]]` give that link both types. Typing `@` inside a link suggests the types your wiki already uses.

When reading, the word stays where you wrote it, marked and without its `@`. A link with nothing but types, like `[[Auth|@blocks]]`, shows the note's name beside them. Only links in a note's body have types, not those in frontmatter, embeds or code. Every `@` word at the start of the display text or after a space is a type; write `\@sam` to keep it as text.

Hover over a link to preview its note and types. On a phone, press and hold a link while reading.

In a base, `file.linksOfType("depends_on")` lists the links a file makes with that type, and `file.backlinksOfType("depends_on")` the files linking to it with that type. A base embedded in Auth can show what depends on it with the filter `file.linksOfType("depends_on").contains(this.file)`.

Obsidian keeps these links working and shows the `@` word as you wrote it, including the backslash in `\@sam`. Its Bases can't read types, so a filter using these functions shows nothing there.

## Documents beside your work

A document can open beside a conversation, and a conversation beside a document. **Document** in a pane's New tab (its **+**) finds or writes one in that tab's place. A pull request's **Open thread** shows its thread's conversation after the chat in front.

## Drafts

Your first edit on a wiki's main line starts your draft, a pull request that has no name yet. Everything else you edit there collects in it, notes, bases and canvases alike, and main doesn't change. You have one draft per wiki, the same one on every device connected to that computer, and only you see it.

While you have a draft, the pill where a document says **Main** reads **Draft** and how many documents it holds. A document in the draft shows your edits; any other shows main, until you edit it. Your draft is also listed apart at the top of a wiki in the sidebar and in **Changes**. Reopening the app finds it where you left it.

Open the pill to:

- **Make it a pull request**: give it a title, and it becomes an ordinary pull request you can merge. A draft has to be one before it merges.
- **Move to another one**: add all of it, or the documents you pick, to an open pull request as one amendment. If the two clash, nothing moves and you're told which files.
- **Discard**: closes it, and your documents go back to main. To get it back, find it under **Merged and closed** in **Changes** and reopen it. You can't reopen one while another draft is open.

Saves of one document in a sitting count as one amendment. Moving to another document, stopping for a while, or an agent's amendment landing starts a new one.

If main moves while you work, your draft keeps your edits, and any clash shows in the draft and in the pill's menu, as it would for a pull request. While an agent is mid-turn in a pull request you're editing, your edits wait, the document says so, and they save when the turn ends. Agents never write to a draft.

## Pull requests

A wiki's pull requests are listed in **Changes** in the icon rail, beside your repositories': drafts first, then open ones, then a folded **Merged and closed** shelf. When the Wikis filter picks a single wiki, **Open changes** in Wikis narrows them to that wiki. Each opens as a tab, and its documents open beside it.

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a pull request. The pull request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a pull request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a pull request conflicts only when both sides changed the same sentence.

When the thread that wrote a wiki's pull request also has code pull requests, the wiki's one lists them with their state, and **Open** shows one beside it. Each is still reviewed and merged in its own place. Once one of them merges, the wiki's one offers to merge the docs too; once all of them close without merging, it offers to close. Merging the docs while a pull request is still open asks first, since they would describe code that isn't on main yet.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Work on several pull requests at once

The sidebar lists each wiki's worktrees as Projects lists a project's: the wiki folder under its main branch, showing its documents, then one per pull request you put in a worktree, under that pull request's title, showing the documents it changes. The button on a worktree's header swaps its documents for its whole file tree, attachments included, and back; **Hidden files** applies there too. **Work on a pull request in a worktree**, beside the filter, puts an open pull request in a worktree of its own, or opens a new one there when you type a title. Worktrees work as they do in [Projects](projects.md#worktrees-and-branches): a free one is reused and its unsaved work is set aside, a worktree gets a number the first time you open one of its pull request's documents, and ones you haven't touched in a day fold under **N more worktrees**. In the filter, the arrow beside a wiki lists its worktrees, and unticking one hides it.

A note opened from a pull request's worktree reads from that pull request. When an amendment lands on a pull request, its worktree's files follow; if you have unsaved edits in the same files there, the amendment stops and names them. Edits made directly in a pull request's worktree, by you or an agent working there, land as one amendment with **Save edits to the pull request** in the worktree's menu.

## Agents in wikis

Each thread in a linked project gets its own copy of every wiki linked to the project, and its agent reads, searches and edits the notes there with its own tools. When the turn ends, its edits land as one amendment in that thread's own pull request on the wiki, one per thread, which you review and merge like any other; agents never merge. Moving a note or a whole folder goes through Astrolabe, so links follow. Cursor with its sandbox on can't use its edit tool outside the project's folder, so it writes notes in the thread's copy with a shell command. Antigravity can't reach files outside the project's folder, so it reads and edits a few notes through Astrolabe's wiki tools and hands a larger job, such as moving, splitting or merging notes or editing more than three, to a helper agent that works in the thread's copy. When a turn leaves a base it changed broken, Astrolabe sends the agent one message in the thread naming each problem, and the agent fixes it in a new turn; if it's still broken after that, the warnings stay in the base and its pull request.

To point an agent at a note, type `[[` in a thread's message and pick the note; the agent reads it. Notes from the project's linked wikis come first. While the project has no linked wiki, the list also offers to link one.

When an agent's edits land on a note you have open in that pull request, they appear in the editor marked as its own, and deletions stay visible so you can restore them. Anything you type or change while the agent's turn is running saves to the pull request when the turn ends.

## Keep a wiki on a git host

A wiki can live in a repository on GitHub, GitLab, Bitbucket, Forgejo, GitCafe or Azure DevOps, so everyone with access to the repository works in it. On a wiki's page in **Settings → Wikis**, choose **Connect** under **Git host**. Astrolabe uses the folder's `origin` remote and pushes the wiki's history if the repository doesn't have it yet.

On a connected wiki, these are the repository's own pull requests, or merge requests on GitLab, and the app calls them what the host does. An agent's work goes up when its turn ends, as a draft where the host has drafts, and your own edits go up as you save them. Once one is on the host, it opens on the same screen as a repository's pull request, with its checks, reviews, comments and merge choices, and a **Wiki** tab showing its amendments, the notes it changes and what stands after the merge. Work not on the host yet is left out of a merge; **Publish now** on the Wiki tab sends it. When it conflicts with main, **Resolve conflicts** merges main in note by note and pushes the result, so the host can merge it. Where both sides changed the same sentences, it hands those to an agent, as it does for a repository's pull request. What each host offers depends on the host.

Astrolabe picks up what happens on the host about once a minute, or when you choose **Sync now**. If you have unsaved edits overlapping a change on the main line, your wiki's page says so and the wiki catches up once they're dealt with.

Merging starts on a method that keeps each amendment on the main line. Squashing, where you pick it or the repository allows nothing else, joins them into one commit, so they can't be reverted one at a time afterwards. A pull request merged on the host's own site uses the host's plain line merge, so conflicts Astrolabe could have settled stop it there.

**Disconnect** makes it a local wiki again. The repository and its pull requests stay on the host.

## Keep a copy elsewhere

Under **Mirror** on a wiki's page in **Settings → Wikis**, set a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
