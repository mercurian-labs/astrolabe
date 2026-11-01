# Repos

**Repos** in the icon rail is where you read and edit your repositories' code without
leaving the app. A repository is one of the two kinds of project, beside a [wiki](wikis.md).

## Find a file

The sidebar leads with what is moving: each worktree's uncommitted changes, its branch against
its base, and the files its commits changed most recently. It keeps up as files change on disk,
whoever changes them: an agent, a terminal, or another editor. With several repositories, each
folds under its name, open when it holds the tab you're on.

- **The filter** picks which repositories show, hides worktrees you don't need, and with **Has
  changes** shows only worktrees with uncommitted files. Pills under the title show what's
  filtered. Whatever the tab in front is in shows anyway, marked "hidden", until you move to
  another tab.
- **Search** finds a file by name when one repository shows, in the worktree of the tab you're on.
- The tree button on a worktree's header swaps its changes for its whole file tree, and back.

## Worktrees and branches

A repository lists each of its worktrees under the branch checked out there, the
repository's own checkout first. Every other worktree has a number, which it keeps while it
exists, so you can tell where each branch is. Tabs follow the branch, not the folder: if a worktree later
holds another branch, its old tabs offer to open their branch again.

- **Open a branch**, beside the filter while one repository shows, puts a branch in a worktree: the one it is already in, else
  a free one, else a new one. Turn on **In a new worktree** in it to give every branch you open a
  worktree of its own instead. Type a new name to make a branch from the main checkout's branch.
- A worktree is free unless a thread uses it, a terminal is open in it, it is the repository's
  own checkout, or you chose **Keep for this branch** in its menu.
- When a free worktree takes another branch, its uncommitted work is set aside on its branch and
  comes back when you open that branch again. If the branch has new commits by then, the work is
  kept under **Set-aside work** for you to open or discard.
- **Delete worktree…**, in a worktree's menu, says first what you would lose. Its branch stays.

## Edit

Files open in tabs that split, as wiki documents do. Markdown files open with the live preview;
code opens with line numbers and its language's colours, with Vim if you turned it on in
Settings. Your edits save on their own a moment after you stop typing. A file shows when an agent
is working in the same copy, and an edit never overwrites newer changes saved there.

## Review changes

**Review uncommitted changes** opens the changes not yet committed; **Changes against** a base
opens your branch's. To compare with any other branch, pick it with the compare button beside
that row. Comment on lines to send them to the thread working in that copy, or to the
repository's new thread.

In a thread, the **Files** and **Diff** tabs offer **Open in Repos** from their tab menu.

## Manage repositories

**Manage repositories**, in the filter, opens **Settings → Projects**. **Add a repository** adds a
folder or clones one, as adding a project does.

## On your phone

The **Repos** tab lists the same files: pick a repository in its filter for its uncommitted
changes and recent files, or **Browse all files** for its tree. Files open read only; edit them on
your computer.
