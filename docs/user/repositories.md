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

## Search the code

`mod+shift+f` searches every file in the current thread's checkout. A result opens its file in a
Repositories tab.

- **Filters**, beside the match options, limits the search to files that match
  **Include** and drops those that match **Exclude**. Separate patterns with commas, as in
  `src/**/*.ts, docs`; commas inside `{a,b}` don't separate. A folder's path covers everything in
  it, and an exclusion beats an inclusion.
- **Ignored files** also searches files your `.gitignore` leaves out, such as `node_modules`.
  Pair it with an **Include** such as `node_modules/some-package` to keep it quick.
- A search shows 500 results at a time. **Load more results** at the end fetches the next 500;
  **Keep searching** means the search stopped to stay fast and has more files to look through.

## Edit

Files open in tabs that split, as wiki documents do. Markdown files open with the live preview;
code opens with line numbers and its language's colours, with Vim if you turned it on in
Settings. Your edits save on their own a moment after you stop typing. Changes from agents, the
terminal, and other windows with the same file open show up as they happen, and an edit never
overwrites newer changes saved there. A file shows when an agent is working in the same copy.

If a file you have edits in is deleted, it stays open with **Save**, which recreates it, and
**Discard**. Edits made while you were offline are sent when you reconnect; if the file changed
in the meantime, choose **Keep mine** or **Use the file’s**.

## Review changes

**Review uncommitted changes** opens the changes not yet committed; **Changes against** a base
opens your branch's. Comment on lines to send them to the thread working in that copy, or to the
repository's new thread.

In a thread, the **Files** and **Diff** tabs offer **Open in Repositories** from their tab menu.

## Manage repositories

**Manage repositories**, in the filter, lists every repository with where it lives, a link to its
settings, and **Hosting providers**. **Add a repository** adds a folder or clones one, as adding a
project does.

## On your phone

The **Repositories** tab lists the same files: pick a repository in its filter for its uncommitted
changes and recent files, or **Browse all files** for its tree. Files open read only; edit them on
your computer.
