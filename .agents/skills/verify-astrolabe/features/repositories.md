# Projects

Astrolabe's section for a project's files and changes, built as Wikis is: a rail
item (`button "Projects"`, between Wikis and Changes) swaps the sidebar
for the Projects sidebar; files and diffs open as tabs in the one shared workspace
([panes.md](panes.md)). Text files open in the editor wikis use;
diffs and everything that is not text keep T3 Code's viewers. It is the home of a
thread's Files and Diffs. User guide: `docs/user/projects.md`.

## Sub-features

- **Sidebar** (`role=navigation[name='Projects']`): heading **Projects** with
  **Search files**, **Filter by project** (combobox; its popup starts with a
  `Search projects` field; named `Filter by project:
  <name>` once one is picked; kept in `astrolabe:repository-scope:v1`: the
  **All projects**, then each project; the server's scratch workspace (threads with no
  project) is left out) and **Add a project** (the add-project palette; once
  it adds the project the app leaves `/repositories` for a new draft thread there, so
  click `button "Projects"` to come back). The filter's foot holds **Show the file
  tree** / **Show as list** (`astrolabe:repository-view:v1`), **Manage projects** (opens
  `/settings/projects`) and **Add a project**. With no projects the list reads "No projects
  yet" with its own **Add a project**.
- **List** (default): with every project, one group each (collapsible header), a
  **Changes →** row (Changes scoped to that project; its name is `Changes`, as is the rail's
  button, so scope locators to `role=navigation[name='Projects']`) and its eight
  most recently committed files. With one project: **Changes →**, then
  **Uncommitted · N** with **Review uncommitted changes →** and each changed file
  (`+a −d`), **Changes against `<base>` →** off the default branch, then **Recently
  changed** (up to 40 files from the last 40 commits; `review.getRecentFiles`,
  `git log --name-only`, deleted files and files already under Uncommitted left out). File rows are `button "<path>"` by role (a
  `div[role=button][draggable]`, so use role locators, not a CSS `button`): name, folder,
  age; tooltip adds the commit's subject. A click shows the file in the focused pane's tab
  in front; Option/Alt-click, Cmd/Ctrl-click or middle-click opens a new tab (rows here
  have no selection); dragging places it.
- **Checkout picker** (`combobox "Checkout"`, only with a thread working tree):
  "Project checkout", then each thread's working tree as `<thread> · <branch>`
  (`astrolabe:repository-checkout:v1`). List, tree and search read the chosen one.
- **Tree** (**Show the file tree**): T3 Code's file browser (`FileBrowserPanel`,
  @pierre/trees) on the chosen checkout, only once a project is picked; with every
  project the sidebar reads "Pick a project in the filter to see its files." The
  panel is `[data-file-browser-panel="<env>:<cwd>"]` and is keyed by that pair, so a new
  project or checkout remounts it on the new root. Toolbar: **Refresh workspace
  files**, the field `Search <project title> files`, **Expand all folders** / **Collapse all
  folders** (only with folders). Rows live in `file-tree-container`'s open shadow root as
  `[role=treeitem]` with `data-item-type` (`folder` / `file`) and `data-item-path`. The
  tree fills an absolutely placed box so its virtualized list gets a height. Rows in the
  accessibility tree are no proof they paint (a 0px-tall list had them all), and the
  panel's attribute changes with its props even if its rows do not (a tree once kept the
  first project's files), so Walk 4 and 5 hit-test a row and compare row paths.
- **Search**: the header's search finds files by name in the scoped project
  (`projects.searchEntries`); with every project it asks for one.
- **Main area**: the shared panes (panes.md; localStorage `astrolabe:workspace:v1`, history
  `astrolabe:workspace-tab-history:v1`); a reload keeps both. Each open tab renders into
  `[data-workspace-tab="<tab key>"]`. An empty tab shows the New tab launcher (**Open a tab**, panes.md).
- **File tab** (`[data-workspace-tab^="repo-file:"]`): a header row (Back/Forward, then the
  path as a breadcrumb: its folder muted and cut from its start, then the file's name; "An
  agent is working in this checkout" while a thread there is mid-turn, Saved / Saving… /
  Read only / Too big to edit here; then **Open local graph**). Markdown opens with the live preview (a centred
  measure); code in `.cm-editor.cm-code` with line numbers and its language's colours
  (`@mercurian/editor/code`). Vim follows the device setting. Edits save 500 ms after
  typing stops through T3 Code's save (`projects.writeFile`), shared with the thread's
  Files view; the window regaining focus re-reads the file.
- **Diff tab** (`repo-diff:…:working-tree` "Uncommitted changes", or `:branch-range`
  "Branch changes"): a header reading `<checkout folder> / Uncommitted changes` or
  `/ Changes against <base>` (`RepositoryDiffView.tsx`), then T3 Code's diff renderer; each
  file's header has **Open**. Line
  comments go to the composer of the thread in that checkout, else the project's
  new-thread draft, else its newest thread; with none, a note asks to start a thread.
- **Open in Projects**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it scopes Projects to the thread's
  project and checkout and opens the same file, its uncommitted changes, or the tree. Only
  those thread surface tabs offer it (`panes/workspaceTabs.tsx`).
- **Local graph** (`repo-graph:…`, settings in `astrolabe:repository-local-graph:v1`):
  opened from the file header's **Open local graph**, a sidebar file row's menu, or `r` `g`.
  It splits to the right, carries the file's chain mark, and follows the file in front while
  **Following** is pressed (`aria-pressed`). Header actions: Back, Forward, **Following**,
  **Fit the graph**, **Graph settings** (plus **Reset the graph** once something is
  expanded). A single click opens the node's file and re-roots there after ~280 ms (the
  double-click window); a double-click toggles its neighbours; right-click offers Expand /
  Collapse neighbours, Show / Hide contents, Centre here and Open. Levels and the graph
  itself are in [code-graph.md](code-graph.md).
- **Keyboard and palette**: `menu g r` and the palette's **Open projects**.

- **Mobile** (iPhone; iPad keeps two roots): a fourth tab `button "Projects"`
  (`features/repositories/RepositoriesScreen.tsx`). `Filter by project` (All projects,
  each project; a name on two machines adds the machine). The pick lives in memory only, so
  an app restart returns to All projects. Every project: its eight latest files under its
  name; a project with no recent files is left out. One: **Browse all files** (route
  `RepositoryFiles`, T3 Code's tree with no thread), **Changes** (selects that tab with its
  project kind, which the Changes filter names "Projects" only while it lists wikis too),
  **Uncommitted · N**, **Recently changed**. Rows are buttons named by path; a file opens
  read only on route `RepositoryFile`. Search (the tab's `Search files`) finds files by
  name in a picked project (`projects.searchEntries`); with every project it narrows
  each one's eight latest files by path, and a project with no match drops out. Only
  projects on connected environments are listed. Both routes sit in the root stack: a
  tab's screen reaches them with `navigate`, not `push`.

## Walk

Setup: a throwaway git repository for edits (never this worktree's own files) with a
commit, a folder holding a `.ts` file and one uncommitted change, added with **Add a
project**. When a wiki exists on that server, the palette then asks to link it; pick **Not
now**. With the **server** project that makes two projects.

1. Click `button "Projects"`; with no project picked the list shows one group per
   project.
2. Pick the scratch project in **Filter by project**. Expect **Uncommitted · 1**;
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

5. Pick the other project in the filter (**server** on a clean home; the tree stays),
   wait for `[data-file-browser-panel$=':<its path>'] >> role=treeitem` and run the check
   again: `paths` are its top-level entries, not step 4's, and `painted` is true. With a
   thread on its own worktree, pick it in `combobox "Checkout"` and check again: `panel`
   ends in that worktree's path and its rows paint. Save the sidebar with `preview_snapshot`
   `save: true`.
6. Search a file name; Enter opens it.
7. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Projects**: the URL is `/repositories`, the filter names the thread's project.
8. With the `.ts` file in front, click **Open local graph**: a `repo-graph:` tab splits to
   the right with the file's chain mark. Prove it paints: `document.elementFromPoint` at the
   graph canvas's centre returns a `CANVAS`. Open another file with **Following** pressed and
   the graph re-roots on it; unpress it and it stays.

## Source

`apps/web/src/components/repositories/` (incl. `RepositoryGraphView.tsx` and
`localGraph.ts`), `components/codeGraph/`, `routes/_chat.repositories.tsx`,
`packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/workspaceTabs.tsx` (Open in Projects), the filter on
`components/projects/projectFilter.ts` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
