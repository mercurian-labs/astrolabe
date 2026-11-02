# Projects

**Projects** in the icon rail is where you read and edit your projects' code without leaving the
app. A project can be linked to a [wiki](wikis.md) that holds its research and plans.

## Find a file

The sidebar leads with what is moving: each worktree's uncommitted changes, its branch against
its base, and the files its commits changed most recently. It keeps up as files change on disk,
whoever changes them: an agent, a terminal, or another editor. With several projects, each folds
under its name, open when it holds the tab you're on.

- **The filter** picks which projects show, hides worktrees you don't need, and with **Has
  changes** shows only worktrees with uncommitted files. Pills under the title show what's
  filtered. Whatever the tab in front is in shows anyway, marked "hidden", until you move to
  another tab.
- **Search** finds a file by name when one project shows, in the worktree of the tab you're on.
- The tree button on a worktree's header swaps its changes for its whole file tree, and back.

## Worktrees and branches

A project lists each of its worktrees under the branch checked out there, the project's own
checkout first. Every other worktree has a number, which it keeps while it exists and which its
files' tabs show, so you can tell where each branch is. Tabs follow the branch, not the folder: if
a worktree later holds another branch, its old tabs offer to open their branch again.

- **Open a branch**, beside the filter while one project shows, puts a branch in a worktree: the
  one it is already in, else a free one, else a new one. Turn on **In a new worktree** in it to
  give every branch you open a worktree of its own instead. Type a new name to make a branch from
  the main checkout's branch.
- A worktree is free unless a thread uses it, a terminal is open in it, it is the project's own
  checkout, or you chose **Keep for this branch** in its menu.
- When a free worktree takes another branch, its uncommitted work is set aside on its branch and
  comes back when you open that branch again. If the branch has new commits by then, the work is
  kept under **Set-aside work** for you to open or discard.
- **Delete worktree…**, in a worktree's menu, says first what you would lose. Its branch stays.

## Edit

Files open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), beside chats and documents. Markdown files open with the live preview;
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
folded folder (a lighter dot named by the end of its path, such as `web/src · 975`) to open it.
Double-click a file to add its neighbours, and right-click any dot to show its contents or centre
the graph on it: see [Code graph](code-graph.md) for levels of detail and growing the graph.
Hovering a file names it and its neighbours, lights them, shows the import that links it, and
highlights that line in the open file. To see which files changed on your branch or are not yet
committed, turn on **Changed files** in the panel's Display.

**Graph settings** in the header opens a panel to search the graph, set its level and depth and
whether uses, files that use it, tests and outside packages show, and tune the display and the
forces that lay the graph out. A group colours the files whose path holds every word of its query. **Animate**
lays the graph out again.

The graph reads the project's code index, set in **Settings → Projects**. While the index is
first built, the files that import this one appear once it finishes.

## Review changes

**Review uncommitted changes** opens the changes not yet committed; **Changes against** a base
opens your branch's. To compare with any other branch, pick it with the compare button beside
that row. Comment on lines to send them to the thread working in that copy, or to the
project's new thread.

In a thread, the **Files** and **Diff** tabs offer **Open in Projects** from their tab menu.

## Manage projects

**Manage projects**, in the filter, opens **Settings → Projects**. **Add a project** adds a
folder or clones a repository.

## On your phone

The **Projects** tab lists the same files: pick a project in its filter for its uncommitted
changes and recent files, or **Browse all files** for its tree. Files open read only; edit them on
your computer.
