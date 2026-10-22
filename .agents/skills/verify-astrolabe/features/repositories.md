# Repositories

Astrolabe's section for a repository's files and changes, built as Wikis is: a rail
item (`button "Repositories"`, between Wikis and Change Requests) swaps the sidebar
for the Repositories sidebar and fills the main area with tabs and splits (the same
panes as Wikis, see [panes.md](panes.md)). Text files open in the editor wikis use;
diffs and everything that is not text keep T3 Code's viewers. It is the home of a
thread's Files and Diffs. User guide: `docs/user/repositories.md`.

## Sub-features

- **Sidebar** (`role=navigation[name='Repositories']`): heading **Repositories** with
  **Search files**, **Filter by repository** (combobox, named `Filter by repository:
<name>` once one is picked; kept in `astrolabe:repository-scope:v1`: the
  **Repositories** heading for all, then each repository; a wiki's checkout and the
  scratch folder are left out) and **Add a repository** (the add-project palette). The
  filter's foot holds **Show the file tree** / **Show as list** (`astrolabe:repository-view:v1`),
  **Manage repositories** and **Add a repository**.
- **List** (default): with every repository, one group each (collapsible header), a
  **Change requests →** row (Change Requests scoped to that repository) and its eight
  most recently committed files. With one repository: **Change requests →**, then
  **Uncommitted · N** with **Review uncommitted changes →** and each changed file
  (`+a −d`), **Changes against <base> →** off the default branch, then **Recently
  changed** (40 files; `review.getRecentFiles`, `git log --name-only`, deleted files
  left out). File rows are `button "<path>"`: name, folder, age; tooltip adds the
  commit's subject. A click shows the file in the focused pane's tab in front;
  Option/Alt, the modifier or middle-click opens a new tab; dragging places it.
- **Checkout picker** (`combobox "Checkout"`, only with a thread working tree):
  "Repository checkout", then each thread's working tree as "<thread> · <branch>"
  (`astrolabe:repository-checkout:v1`). List, tree and search read the chosen one.
- **Tree**: T3 Code's file browser (`FileBrowserPanel`, @pierre/trees; rows live in
  `file-tree-container`'s shadow root as `[role=treeitem]`) on the chosen checkout.
- **Search**: the header's search finds files by name in the scoped repository
  (`projects.searchEntries`); with every repository it asks for one.
- **File tab** (`[data-repository-tab^="repo-file:"]`): a header row (path, "An
  agent is working in this checkout" while a thread there is mid-turn, Saved / Saving… /
  Read only / Too big to edit here). Markdown opens with the live preview (a centred
  measure); code in `.cm-editor.cm-code` with line numbers and its language's colours
  (`@mercurian/editor/code`). Vim follows the device setting. Edits save 500 ms after
  typing stops through T3 Code's save (`projects.writeFile`), shared with the thread's
  Files view; the window regaining focus re-reads the file.
- **Diff tab** (`repo-diff:…:working-tree` "Uncommitted changes", or `:branch-range`
  "Branch changes"): T3 Code's diff renderer; each file's header has **Open**. Line
  comments go to the composer of the thread in that checkout, else the repository's
  new-thread draft, else its newest thread; with none, a note asks to start a thread.
- **Manage tab** (`repo-manage`): every repository with its path and machine, a gear to
  Settings → Projects, **Hosting providers** (Settings → Source control) and **Add a
  repository**.
- **Open in Repositories**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it scopes Repositories to the thread's
  repository and checkout and opens the same file, its uncommitted changes, or the tree.
  Repository tabs open in Wikis' and Change Requests' panes too and offer **Open in
  Repositories** there.
- **Keyboard and palette**: `menu g r` and the palette's **Open repositories**.

- **Mobile** (iPhone; iPad keeps two roots): a fourth tab `button "Repositories"`
  (`features/repositories/RepositoriesScreen.tsx`). `Filter by repository` (Repositories,
  each repository; a name on two machines adds the machine). Every repository: its eight
  latest files under its name. One: **Browse all files** (route `RepositoryFiles`, T3 Code's
  tree with no thread), **Change requests** (selects that tab, kind Repositories),
  **Uncommitted · N**, **Recently changed**. Rows are buttons named by path; a file opens
  read only on route `RepositoryFile`. Search (the tab's) finds files by name in the picked
  repository. Both routes sit in the root stack: a tab's screen reaches them with
  `navigate`, not `push`.

## Walk

1. Click `button "Repositories"`; with no repository picked the list shows one group per
   repository.
2. Pick one in **Filter by repository**; make an uncommitted change in it first. Expect
   **Uncommitted · 1**; **Review uncommitted changes** opens the diff; **Open** opens the
   file.
3. Type in the file; within a second the file on disk changes (`git status` shows it).
4. **Show the file tree**; expand a folder and open a code file: `.cm-code` appears.
5. Search a file name; Enter opens it.
6. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Repositories**: the URL is `/repositories`, the filter names the thread's repository.

Use a scratch repository for edits (never this worktree's own files).

## Source

`apps/web/src/components/repositories/`, `routes/_chat.repositories.tsx`,
`panes/sectionPanes.ts`, `packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/rightPanelPaneTabs.tsx` (Open in Repositories).
