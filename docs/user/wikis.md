# Wikis

A wiki is a folder of linked notes that you and your agents keep together: plain markdown files, one idea per note, joined by `[[wikilinks]]`. It lives on your computer as a git repository, and every change to it is reviewed before it lands.

## Add a wiki

Open **Wikis** in the icon rail, or pick a document from **Search** (⌘K twice), which finds every wiki's documents from anywhere in the app. The sidebar lists documents in place of threads. Its filter picks one wiki or all of them, as the project filter does for threads, and holds **Add a folder**, which registers a git repository you already have, and **New wiki**, which creates an empty one. A wiki's settings (its folder, mirror, and removing it) open from the gear on its row in the filter.

Notes are the repository's top-level `.md` files. `README.md`, `AGENTS.md` and `CLAUDE.md` are left out, and files named `*.skillmap.md` are skill maps, which arrange notes and teach agents how to work in them. Adding a wiki also adds its folder as a project, so you can start threads in it.

## Read and edit notes

Documents are listed newest first, with open change requests above them. Clicking one opens it as a tab; ⌘-click (Ctrl-click on Windows and Linux) opens it in a new pane beside the current one. Tabs split and rearrange as the right panel's do: drag a tab to a pane's edge to split it, or onto another pane's tabs to move it there. The layout is kept on this device.

In a note, ⌘-click a wikilink to follow it in the same tab. Search in the sidebar narrows its list to the documents and change requests whose name holds what you type. **New document** starts one: type its name and choose **Write**.

When you change a note, **Save to change request** keeps your edit in a change request instead of writing it into the wiki directly. Closing a tab with unsaved edits asks first.

## Change requests

Nothing reaches a wiki without someone merging it. Every edit, yours or an agent's, lands as an amendment in a change request. The change request shows each amendment, what it changed, and whether it merges cleanly. You can revert any single amendment, close a change request, reopen it, or merge it. Only you merge; agents cannot.

Merging writes the result into the wiki's folder. If you have unsaved changes in that folder that the merge would overwrite, the merge stops and names the files, so nothing of yours is lost. Edits to different sentences of the same paragraph merge on their own; a change request conflicts only when both sides changed the same sentence.

A skill map warns you when a change breaks a link one of its edges depends on. The warning stays in the map's history, even after you repair the link.

## Agents in wikis

Agents in any thread can read, search and amend your wikis. Their amendments go into that thread's own change request on the wiki, one per thread, which you review and merge like any other.

When an agent amends a note you have open in that change request, its changes appear in the editor as it makes them, marked as its own, and deletions stay visible so you can restore them. Anything you type while the agent's turn is running is saved to the change request when the turn ends.

A thread's **Graph** tab shows the notes the thread has read and changed, and the links between them, turn by turn. When a thread hands work to other threads, the same tab lists them and the change requests they opened.

## Keep a copy elsewhere

In a wiki's menu, **Mirror** sets a git remote, such as a repository you own on GitHub. After every merge, Astrolabe pushes the wiki's main line and its full history there, so you always have a complete copy. The mirror is a copy only: changes made to it directly are replaced by the next push, and the wiki tells you when that happens.

Removing a wiki from Astrolabe leaves its folder and files untouched.
