# Repositories

**Repositories** in the icon rail is where you read and edit your repositories' code without
leaving the app. A repository is one of the two kinds of project, beside a [wiki](wikis.md).

## Find a file

The sidebar leads with what is moving: a repository's uncommitted changes, its branch against
its base, and the files its commits changed most recently. Pick one repository in the filter to
see all of that for it; with every repository, each shows its latest files.

- **Search** finds a file by name in the repository you picked.
- **Show the file tree**, in the filter, swaps the list for the whole tree.
- **Checkout** appears when a thread works in its own copy of the repository. Pick the thread's
  copy to read and edit what its agent is changing.

## Edit

Files open in the tabs Agents and Wikis share (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), beside chats and documents. Markdown files open with the live preview;
code opens with line numbers and its language's colours, with Vim if you turned it on in
Settings. Your edits save on their own a moment after you stop typing. A file shows when an agent
is working in the same copy, and an edit never overwrites newer changes saved there.

## Local graph

A file's local graph shows the file in the accent colour with the files it imports and the files
that import it, drawn the way Obsidian draws its graph. Open it with the graph button in a file's
header, **Open local graph** in a file's menu in the sidebar, or `r` `g` in the
[keyboard menu](keybindings.md#keyboard-menu). It opens beside the file and follows the file you
are reading, carrying the same chain mark as that file's tab; turn off **Following** in its
header, or choose **Unlink tab** in its tab menu, to keep it on one file.

Click a file to open it in place of the file the graph shows (⌘-click or Ctrl-click for a new
tab), and the graph moves to it; a graph kept on one file moves to the file you click. Click a
folded folder (a lighter dot
named by the end of its path, such as `web/src · 975`) to unfold it; **Fold folders** in the
header folds them again. Drag a file to move it, drag the background to pan, and scroll to zoom.
Where names would overlap, the bigger file's shows and the other waits until you zoom in.
Hovering a file names it and its neighbours, lights them, shows the import that links it, and
highlights that line in the open file. Outside packages are the lightest dots. To see which files
changed on your branch or are not yet committed, turn on **Changed files** in the panel's
Display.

**Graph settings** in the header opens a panel to search the files shown, set the depth and whether
uses, files that use it, tests and outside packages show, and tune the display and the forces that
lay the graph out. A group colours the files whose path holds every word of its query. **Animate**
lays the graph out again.

The graph reads the repository's code index, set in **Settings → Projects**. While the index is
first built, the files that import this one appear once it finishes.

## Review changes

**Review uncommitted changes** opens the changes not yet committed; **Changes against** a base
opens your branch's. Comment on lines to send them to the thread working in that copy, or to the
repository's new thread.

In a thread, the **Files** and **Diff** tabs offer **Open in Repositories** from their tab menu.

## Manage repositories

**Manage repositories**, in the filter, opens **Settings → Projects**. **Add a repository** adds a
folder or clones one, as adding a project does.

## On your phone

The **Repositories** tab lists the same files: pick a repository in its filter for its uncommitted
changes and recent files, or **Browse all files** for its tree. Files open read only; edit them on
your computer.
