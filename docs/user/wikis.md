# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads. Its filter narrows the list to one or several wikis, or to the documents an open change request touches (**Has changes**, also a one-tap pill under the title while any document has changes), and holds **Add a wiki**, which works like adding a project: start a new wiki, choose a git repository you already have, or clone one. **Add wiki** in the command palette does the same. A wiki's settings (its folder, mirror, and removing it) open from the gear on its row in the filter.

Notes are the repository's top-level `.md` files. `README.md`, `AGENTS.md` and `CLAUDE.md` are left out, and files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them. A wiki is not a project: no thread works in its folder. Agents reach it from threads in your repositories, and every change they make goes to a change request.

## Link a wiki to a repository

Link a wiki to the repositories it plans, so their agents know where research and plans live. After you add a wiki or a repository, the command palette offers to link it to one on the same computer; **Not now** skips it. Change links any time with **Repositories** in a wiki's settings, or **Wikis** in a repository's settings (**Settings → Projects**). A wiki can plan several repositories, and a repository can have several wikis.

When a conversation starts in a linked repository, its agent is told which wikis hold that repository's research and plans: to look there first when it researches, plans, or builds a feature, and to write what it learns back to the wiki.

## Read and edit notes

Documents are listed newest first. Above them, **Open changes** counts the wiki's open change requests and takes you to them in **Changes**. Clicking one shows it in the focused pane's tab in front, which remembers what it showed: the arrows at the top of the sidebar, `mod+[` and `mod+]` go back and forward, as in a browser. A document already open in another tab comes to the front there instead. Option-click (Alt-click on Windows and Linux), middle-click, or **Open in new tab** in its right-click menu opens a new tab; **Open to the right** in that menu opens it in a new pane beside the current one. ⌘-click (Ctrl-click) and Shift-click select several, as in the thread list; a selected row's right-click menu opens them all in new tabs. Drag a row, or a selection, onto a pane's tabs to open it there, or onto a pane's content to open it in a new pane. Tabs split and rearrange as the right panel's do: drag a tab to a pane's edge to split it, or onto another pane's tabs to move it there. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents whose name holds what you type. **New document** starts one: type its name and choose **Write**.

When you change a note, **Save to change request** keeps your edit in a change request instead of writing it into the wiki directly. Closing a tab with unsaved edits asks first.

## Documents beside your work

A document can open beside a conversation, and a conversation beside a document. In a thread, **Document** in the right panel's **+** menu finds or writes one in that pane, and the thread's **Graph** tab opens the notes and change requests it names beside itself. In Wikis, a change request's **Open thread** shows its thread's conversation in a pane beside it. A tab outside its own section has **Open in Wikis**, **Open in Agents** or **Open in Changes** in its right-click menu, which moves it there.

## Change requests

Change requests are listed in **Changes** in the icon rail, beside your pull requests: open ones first, then a folded **Merged and closed** shelf. When the Wikis filter picks a single wiki, **Open changes** in Wikis narrows them to that wiki. Each opens as a tab there, and its documents open beside it.

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a change request. The change request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a change request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a change request conflicts only when both sides changed the same sentence.

When the thread that wrote a change request has pull requests, the change request lists them with their state, and **Open** shows one beside it. Each is still reviewed and merged in its own place. Once one of them merges, the change request offers to merge the docs too; once all of them close without merging, it offers to close. Merging the docs while a pull request is still open asks first, since they would describe code that isn't on main yet.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Agents in wikis

Agents in any thread can read, search and amend your wikis. Their amendments go into that thread's own change request on the wiki, one per thread, which you review and merge like any other.

To point an agent at a note, type `[[` in a thread's message and pick the note; the agent reads it. Notes from the repository's linked wikis come first. While the repository has no linked wiki, the list also offers to link one.

When an agent amends a note you have open in that change request, its changes appear in the editor as it makes them, marked as its own, and deletions stay visible so you can restore them. Anything you type while the agent's turn is running is saved to the change request when the turn ends.

A thread's **Graph** tab shows the notes the thread has read and changed, and the links between them, turn by turn. When a thread hands work to other threads, the same tab lists them and the change requests they opened.

## Keep a copy elsewhere

In a wiki's menu, **Mirror** sets a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
