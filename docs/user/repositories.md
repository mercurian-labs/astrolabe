# Repositories

**Repositories** in the icon rail is where you read and edit your repositories' code without
leaving the app. A repository is one of the two kinds of project, beside a [wiki](wikis.md).

## Find a file

The sidebar leads with what is moving: a repository's uncommitted changes, its branch against
its base, and the files its commits changed most recently. Pick one repository in the filter to
see all of that for it; with every repository, each shows its latest files.

- **Search** finds a file by name in the repository you picked, in the worktree of the tab
  you're on.
- **Show the file tree**, in the filter, swaps the list for each worktree's file tree.

## Worktrees and branches

A repository you picked lists each of its worktrees under the branch checked out there, the
repository's own checkout first. Tabs follow the branch, not the folder: if a worktree later
holds another branch, its old tabs offer to open their branch again.

- **Open a branch**, beside the filter, puts a branch in a worktree: the one it is already in, else
  a free one, else a new one. Type a new name to make a branch from the main checkout's branch.
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
