# Repositories

Astrolabe's section for a repository's files and changes, built as Wikis is: a rail
item (`button "Repositories"`, between Wikis and Changes) swaps the sidebar
for the Repositories sidebar and fills the main area with tabs and splits (the same
panes as Wikis, see [panes.md](panes.md)). Text files open in the editor wikis use;
diffs and everything that is not text keep T3 Code's viewers. It is the home of a
thread's Files and Diffs. User guide: `docs/user/repositories.md`.

## Sub-features

- **Sidebar** (`role=navigation[name='Repositories']`): heading **Repositories** with
  **Search files**, **Filter by repository** (combobox; its popup starts with a
  `Search repositories` field; named `Filter by repository:
<name>` once one is picked; kept in `astrolabe:repository-scope:v1`: the
  **Repositories** heading for all, then each repository; a wiki's checkout and the
  server's scratch workspace (threads with no project) are left out) and **Add a repository** (the add-project palette; once
  it adds the repository the app leaves `/repositories` for a new draft thread there, so
  click `button "Repositories"` to come back). The filter's foot holds **Show the file
  tree** / **Show as list** (`astrolabe:repository-view:v1`), **Manage repositories** and
  **Add a repository**.
- **List** (default): with every repository, one group each (collapsible header), a
  **Changes →** row (Changes scoped to that repository) and its eight
  most recently committed files. With one repository: **Changes →**, then
  **Uncommitted · N** with **Review uncommitted changes →** and each changed file
  (`+a −d`), **Changes against `<base>` →** off the default branch, then **Recently
  changed** (40 files; `review.getRecentFiles`, `git log --name-only`, deleted files and
  files already under Uncommitted left out). File rows are `button "<path>"` by role (a
  `div[role=button][draggable]`, so use role locators, not a CSS `button`): name, folder,
  age; tooltip adds the commit's subject. A click shows the file in the focused pane's tab
  in front; Option/Alt-click, Cmd/Ctrl-click or middle-click opens a new tab (rows here
  have no selection); dragging places it.
- **Checkout picker** (`combobox "Checkout"`, only with a thread working tree):
  "Repository checkout", then each thread's working tree as `<thread> · <branch>`
  (`astrolabe:repository-checkout:v1`). List, tree and search read the chosen one.
- **Tree** (**Show the file tree**): T3 Code's file browser (`FileBrowserPanel`,
  @pierre/trees) on the chosen checkout, only once a repository is picked; with every
  repository the sidebar reads "Pick a repository in the filter to see its files." The
  panel is `[data-file-browser-panel="<env>:<cwd>"]` and is keyed by that pair, so a new
  repository or checkout remounts it on the new root. Toolbar: **Refresh workspace
  files**, the field `Search <repo> files`, **Expand all folders** / **Collapse all
  folders** (only with folders). Rows live in `file-tree-container`'s open shadow root as
  `[role=treeitem]` with `data-item-type` (`folder` / `file`) and `data-item-path`. The
  tree fills an absolutely placed box so its virtualized list gets a height. Rows in the
  accessibility tree are no proof they paint (a 0px-tall list had them all), and the
  panel's attribute changes with its props even if its rows do not (a tree once kept the
  first repository's files), so Walk 4 and 5 hit-test a row and compare row paths.
- **Search**: the header's search finds files by name in the scoped repository
  (`projects.searchEntries`); with every repository it asks for one.
- **Main area**: one arrangement on the device (localStorage
  `astrolabe:repository-panes:v1`, removed while it is the starting single empty tab) and
  each tab's Back/Forward history (`astrolabe:repository-tab-history:v1`); a reload keeps
  both. Each open tab renders into `[data-repository-tab="<tab key>"]`. An empty tab
  reads **No file open**.
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
- **Manage tab** (`repo-manage`, titled `tab "Repositories"`): every repository with its
  path and machine, a gear to Settings → Projects, **Hosting providers** (Settings →
  Source control) and **Add a repository**.
- **Open in Repositories**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it scopes Repositories to the thread's
  repository and checkout and opens the same file, its uncommitted changes, or the tree.
  Repository tabs open in Wikis' and Changes' panes too and offer **Open in
  Repositories** there.
- **Keyboard and palette**: `menu g r` and the palette's **Open repositories**.

- **Mobile** (iPhone; iPad keeps two roots): a fourth tab `button "Repositories"`
  (`features/repositories/RepositoriesScreen.tsx`). `Filter by repository` (Repositories,
  each repository; a name on two machines adds the machine). Every repository: its eight
  latest files under its name. One: **Browse all files** (route `RepositoryFiles`, T3 Code's
  tree with no thread), **Changes** (selects that tab, kind Repositories),
  **Uncommitted · N**, **Recently changed**. Rows are buttons named by path; a file opens
  read only on route `RepositoryFile`. Search (the tab's `Search files`) finds files by
  name in a picked repository (`projects.searchEntries`); with every repository it narrows
  each one's eight latest files by path, and a repository with no match drops out. Only
  repositories on connected environments are listed. Both routes sit in the root stack: a
  tab's screen reaches them with `navigate`, not `push`.

## Walk

Setup: a throwaway git repository for edits (never this worktree's own files) with a
commit, a folder holding a `.ts` file and one uncommitted change, added with **Add a
repository**. With the **server** project that makes two repositories.

1. Click `button "Repositories"`; with no repository picked the list shows one group per
   repository.
2. Pick the scratch repository in **Filter by repository**. Expect **Uncommitted · 1**;
   **Review uncommitted changes** opens the diff; **Open** opens the file in a new tab
   after the diff.
3. Type in the file; within a second the file on disk changes (`git status` shows it).
4. **Show the file tree**, wait for `[data-file-browser-panel] >> role=treeitem`, then
   prove the rows paint with `preview_evaluate`:

   ```js
   const panel = document.querySelector("[data-app-sidebar] [data-file-browser-panel]");
   const host = panel.querySelector("file-tree-container");
   const rows = [...host.shadowRoot.querySelectorAll("[role=treeitem]")];
   const row = rows.find((n) => !n.hasAttribute("data-item-parked"));
   const box = row.getBoundingClientRect();
   const hit = host.shadowRoot.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
   return {
     panel: panel.dataset.fileBrowserPanel,
     hostHeight: host.getBoundingClientRect().height,
     painted: row.contains(hit),
     paths: rows.map((n) => n.dataset.itemPath),
   };
   ```

   `panel` ends in `:<scratch path>`, `hostHeight` > 0 and `painted` is true. Expand a
   folder (`aria-expanded` turns `true`) and open the `.ts` file: `.cm-code` appears.

5. Pick the other repository in the filter (**server** on a clean home; the tree stays),
   wait for `[data-file-browser-panel$=':<its path>'] >> role=treeitem` and run the check
   again: `paths` are its top-level entries, not step 4's, and `painted` is true. With a
   thread on its own worktree, pick it in `combobox "Checkout"` and check again: `panel`
   ends in that worktree's path and its rows paint. Save the sidebar with `preview_snapshot`
   `save: true`.
6. Search a file name; Enter opens it.
7. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Repositories**: the URL is `/repositories`, the filter names the thread's repository.

## Source

`apps/web/src/components/repositories/`, `routes/_chat.repositories.tsx`,
`panes/sectionPanes.ts`, `packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/rightPanelPaneTabs.tsx` (Open in Repositories), the filter on
`components/projects/projectFilter.ts` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
