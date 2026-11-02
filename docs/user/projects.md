# Projects

**Projects** in the icon rail is where you read and edit your projects' code without leaving the
app. A project can be linked to a [wiki](wikis.md) that holds its research and plans.

## Find a file

The sidebar leads with what is moving: each worktree's uncommitted changes, its branch against
its base, and the files its commits changed most recently. It keeps up as files change on disk,
whoever changes them: an agent, a terminal, or another editor. With several projects, each folds
under its name, open when it holds the tab you're on.

- **The filter** picks which projects show and, under each project (open it with its arrow),
  hides worktrees you don't need. **Has changes** shows only worktrees with uncommitted files; it
  counts every worktree when you turn it on, which takes a while in a project with many. Pills
  under the title show what's filtered. Whatever the tab in front is in shows anyway, marked
  "hidden", until you move to another tab.
- **Search** finds a file by name when one project shows, in the worktree of the tab you're on.
- The tree button on a worktree's header swaps its changes for its whole file tree, and back. The
  project's own checkout shows its file tree until you switch it.

## Worktrees and branches

A project lists its worktrees under the branch checked out there, the project's own checkout
first. A worktree gets a number the first time you open something in it, and keeps it while it
exists. No two worktrees share a number, even in different projects; its files' tabs show the
number, so you can tell where each branch is. Tabs follow the branch, not the folder: if a
worktree later holds another branch, its old tabs offer to open their branch again.

Agents' tools leave a worktree per run, so a busy project can have hundreds. The list shows the
ones that matter: those with a number, an agent working, a terminal, a Keep pin, open tabs,
uncommitted changes you have seen, or activity in the last day. The rest fold under **N more worktrees**,
grouped by the tool that made them, with a search box.

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

## Search the code

`mod+shift+f` searches every file in the current thread's checkout. A result opens its file in a
tab.

- **Filters**, beside the match options, limits the search to files that match
  **Include** and drops those that match **Exclude**. Separate patterns with commas, as in
  `src/**/*.ts, docs`; commas inside `{a,b}` don't separate. A folder's path covers everything in
  it, and an exclusion beats an inclusion.
- **Ignored files** also searches files your `.gitignore` leaves out, such as `node_modules`.
  Pair it with an **Include** such as `node_modules/some-package` to keep it quick.
- A search shows 500 results at a time. **Load more results** at the end fetches the next 500;
  **Keep searching** means the search stopped to stay fast and has more files to look through.
- Files open in an editor are searched as they are now, unsaved edits included.

### Results in one editor

**Open results in editor** (`mod+enter` in the search) opens every result as a tab of small
editors, one per match with two lines around it, under a header for each file. They are
the files themselves: what you type there lands in the file and shows in its other tabs, and
changes from elsewhere show in the results. Matches stay highlighted as you edit; the refresh
button searches again.

- Arrow keys move from one excerpt into the next. `f7` and `shift+f7` jump to the next and
  previous file, `shift+enter` shows five more lines around an excerpt (or click **more lines**
  above or below it; excerpts that meet merge), and `alt+enter` opens the excerpt's file at the
  cursor. Each excerpt has its own undo, which takes back only what you typed there.
- **Replace all** replaces every match in the results' files. With more than ten files it asks
  first. A file open in another tab takes the replacement there, where undo takes it back; the
  rest are changed and saved for you. **Undo replace-all** takes the whole replacement back, also
  after you've edited since, for 30 minutes or until your next replace-all in that tab, then
  searches again. A replacement you've changed or undone since stays as it is. With
  **.\*** on, `$1` and `$<name>` in the replacement insert groups, and `\n` a line break.
- A file you open from the sidebar opens in a tab beside the results, not over them; so do
  problems and found references.

### Problems

`e` `v` in the keyboard menu (**Projects: Show Problems** in the Command Palette) opens the
problems of the checkout in front: every problem language servers found in the files they have
open, or checked since they started, grouped by file with errors first, as editable excerpts with
each message below its line. It updates as you and agents edit.

## Edit

Files open in the tabs every section shares (see [Tabs and splits](./thread-sidebar.md#tabs-and-splits)), beside chats and documents. Markdown files open with the live preview;
code opens with line numbers and its language's colours, with Vim if you turned it on in
Settings. Your edits save on their own a moment after you stop typing. Changes from agents, the
terminal, and other windows with the same file open show up as they happen, and an edit never
overwrites newer changes saved there. A file shows when an agent is working in the same copy.
TypeScript and JavaScript files show the [problems](keybindings.md#problems-in-a-code-file) their
language server finds.

If a file you have edits in is deleted, it stays open with **Save**, which recreates it, and
**Discard**. Edits made while you were offline are sent when you reconnect; if the file changed
in the meantime, choose **Keep mine** or **Use the file’s**.

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
opens your branch's, from the **⋯** menu on a worktree's header. To compare with another
branch, pick it from the branch name in the changes tab's title. Comment on lines to send them to the thread working in that copy, or to the
project's new thread.

In a thread, the **Files** and **Diff** tabs offer **Open in Projects** from their tab menu.

## Manage projects

**Manage projects**, in the filter, opens **Settings → Projects**. **Add a project** adds a
folder or clones a repository.

## On your phone

The **Projects** tab lists the same files: pick a project in its filter for its uncommitted
changes and recent files, or **Browse all files** for its tree. Files open read only; edit them on
your computer.
