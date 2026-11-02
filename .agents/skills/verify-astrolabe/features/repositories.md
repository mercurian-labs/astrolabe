# Projects

Astrolabe's section for a project's files and changes, built as Wikis is: a rail
item (`button "Projects"`, between Wikis and Changes) swaps the sidebar
for the Projects sidebar; files and diffs open as tabs in the one shared workspace
([panes.md](panes.md)). Text files open in the editor wikis use;
diffs and everything that is not text keep T3 Code's viewers. It is the home of a
thread's Files and Diffs. User guide: `docs/user/projects.md`.

## Sub-features

- **Sidebar** (`role=navigation[name='Projects']`): heading **Projects** with **Search files**,
  **Filter projects** and **Add a project** (the add-project palette; once it adds the project
  the app leaves `/repositories` for a new draft thread there, so click `button "Projects"` to
  come back). The server's scratch workspace (threads with no project) is never listed. With no
  projects the list reads "No projects yet" with its own **Add a project**.
- **Filter** (`RepositoryFilterMenu.tsx`, `repositoryFilter.ts`, localStorage
  `astrolabe:repository-filter:v1` `{repositories, hidden, changed}`), as Agents' and Wikis':
  `button "Filter projects"` (` (filtered)` appended and a dot while on) opens a multi-select
  list with a `Search filters` field: **Status** (**Has changes** with its count of worktrees with
  uncommitted files), **Projects** (**All projects**, then each, every one ticked while
  none is picked), then **Worktrees** (`Worktrees · <repository>` with several) for each kept
  repository, ticked unless hidden. Picking keeps the list open; its foot holds **Manage
  projects** and **Add a project**. Pills under the title (`[aria-label="Project
  filters"]`): **Has changes** one tap (shown while on or above 0), the picked projects,
  `Hiding <worktrees>`; × clears a pill, **Clear** shows with two. The focused tab's repository
  and worktree show whatever the filter says, its header marked **hidden** (tooltip), and drop out
  when another tab comes to the front; nothing clears the filter for it. A repository left with
  no worktree drops out once read.
- **List** (default): with several repositories shown, one collapsible header each (favicon,
  name), open by default only for the focused tab's repository; every shown repository's worktree
  list is read (`worktrees.list`) for the counts, but a folded one mounts no rows. With one
  repository, its worktrees bare: one collapsible section per git
  worktree (`ProjectWorktreeService`, `worktrees.list`), headed by its branch (or short
  commit when detached), the main checkout first and marked **main checkout**, with "N
  changed" and a pin when held (tooltip: the holds). Under each: **Uncommitted · N** with
  **Review uncommitted changes →** and each changed file (`+a −d`), **Changes against
  `<base>` →** (the branch's own base; "Changes against…" opening the picker when it has none)
  with `combobox "Compare with another branch"` beside it (tooltip; any local or remote
  branch; the tab key's source becomes `branch-range~<base>`), the same in every worktree,
  then **Recently changed** (20 files; `review.getRecentFiles`, `git log --name-only`). A
  section's rows sit indented under its header along a guide line. File rows are `button "<path>"` by role (a
  `div[role=button][draggable]`, so use role locators, not a CSS `button`): name, folder,
  age; tooltip adds the commit's subject. A click shows the file in the focused pane's tab
  in front (`workspace.show`): one already open comes forward; an empty tab is filled; a
  chat, a linked tab or unsaved edits make way for a new tab; otherwise it replaces the tab
  (Back returns). Option/Alt-click, Cmd/Ctrl-click or middle-click opens a new tab (rows here
  have no selection); dragging places it.
- **Worktrees**: `combobox "Open a branch in a worktree"` (beside the filter, while exactly one
  repository shows; opening a branch un-hides its worktree) lists local branches, each noting `main checkout` or `worktree <n>`
  when checked out; a pick puts the branch in its worktree, else a free one (no main
  checkout, thread, terminal or Keep), else a new `t3-<8 hex>` folder. Its `switch "Open in
  a new worktree"` (`astrolabe:open-in-new-worktree:v1`, shared with Wikis' picker) skips
  free ones. Linked worktrees carry a number (server-kept, lowest free, held while the folder
  exists) on their header and are listed by it.
  A name that is no branch offers "New branch <name> from <main's branch>". A free
  worktree's uncommitted work is set aside as `refs/astrolabe/set-aside/<branch>` (row
  **Set-aside work on <branch>**, **Open** / **Discard**) and comes back when the branch
  opens again, unless the branch moved (warning toast; the row stays). Each non-main
  section has `button "<branch> worktree actions"`: **Keep for this branch** / **Stop
  keeping**, **Delete worktree…** (a confirm dialog lists what would be lost; the work is
  set aside). Tabs of a linked worktree are keyed by branch
  (`repo-file:<env>:<project>:branch:<branch>:<path>`); main-checkout and detached tabs
  by folder. A branch tab with no worktree reads "<branch> is not checked out in any
  worktree." with **Open <branch>**. A repository tab shows the number of the worktree
  holding it now (`[aria-label="Worktree N"]`) between its icon and title, none for the main
  checkout; hovering its title gives the path (or the changes' title) over
  `<branch> · worktree N` / `main checkout` / `not in a worktree`.
- **Tree**: a worktree header's `button "Show its files"` / `"Show its changes"` swaps its
  rows for T3 Code's file browser (`FileBrowserPanel`, @pierre/trees) on that worktree, per
  worktree (`astrolabe:repository-worktree-files:v1`); the focused tab's worktree opens on
  its own. Each panel is
  `[data-file-browser-panel="<env>:<worktree path>"]`, keyed by that pair. In the sidebar
  its toolbar (refresh, search, expand all) is `hidden`; the header's **Search files** is
  the search. Each worktree header subscribes to `worktrees.subscribeChanges`; while anyone does,
  the server watches that worktree (@parcel/watcher, skipping `.git`, `node_modules` and
  git-ignored folders, plus the git dir's `HEAD`/`index`) and every ~250 ms of changes it pushes
  the changed folders, refreshes git status (`subscribeVcsStatus`) and the search index. The tree
  rereads its open folders, the worktree list refetches. A worktree that can't be watched shows
  an eye-off icon in its header and falls back to head/changed-count and window focus. Rows live in `file-tree-container`'s open shadow
  root as `[role=treeitem]` with `data-item-type` (`folder` / `file`) and `data-item-path`.
  The tree is as tall as its visible rows (24px each, up to 20, then it scrolls), so the
  guide line ends at its last row. Rows in the
  accessibility tree are no proof they paint (a 0px-tall list had them all), and the
  panel's attribute changes with its props even if its rows do not (a tree once kept the
  first repository's files), so Walk 4 and 5 hit-test a row and compare row paths.
- **Search**: the header's search finds files by name, while one repository shows, in its
  focused-tab worktree, else its main checkout (`projects.searchEntries`); with several it asks
  to pick one in the filter.
- **Main area**: the shared panes (panes.md; localStorage `astrolabe:workspace:v1`, history
  `astrolabe:workspace-tab-history:v1`); a reload keeps both. Each open tab renders into
  `[data-workspace-tab="<tab key>"]`. An empty tab shows the New tab launcher (**Open a tab**, panes.md).
- **File tab** (`[data-workspace-tab^="repo-file:"]`): a header row (Back/Forward, then the
  path as a breadcrumb, `navigation "File path breadcrumb"`: its folder muted, keeping its last
  segment whole and cutting the rest from its start, and wrapping away (with its `/`) before
  the file's name truncates, then the file's name, then the checkout's branch; "An
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
- **Manage projects** (the filter's foot) opens Settings → Projects.
- **Open in Projects**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it opens the same file or its uncommitted
  changes (the focused tab brings its worktree into view), or the tree, for which the filter
  adds the project to its picks (when some are picked) and un-hides the worktree. Only
  those thread surface tabs offer it (`panes/workspaceTabs.tsx`).
- **Local graph** (`repo-graph:…`, keyed by the file's checkout as file tabs are, settings in `astrolabe:repository-local-graph:v1`):
  opened from the file header's **Open local graph**, a sidebar file row's menu, or `r` `g`.
  It splits to the right, carries the file's chain mark, and follows the file in front while
  **Following** is pressed (`aria-pressed`). Header actions, in order: Back, Forward,
  **Reset the graph** (only once something is expanded), **Following**, **Fit the graph**,
  **Graph settings**. With no file it reads "Local graph", **Fit the graph** is disabled, and
  the notice reads "Open a file to see its local graph…". A single click opens the node's file and re-roots there after ~280 ms (the
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

1. Click `button "Projects"`; with no project picked the list shows one header per
   project.
2. Pick only the scratch project in **Filter projects** (untick the others). Expect **Uncommitted · 1**;
   **Review uncommitted changes** opens the diff; **Open** opens the file in a new tab
   after the diff.
3. Type in the file; within a second the file on disk changes (`git status` shows it).
4. **Show its files** on the worktree's header, wait for `[data-file-browser-panel] >> role=treeitem`, then
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
   With several worktrees there is one `file-tree-container` per open section; run the
   check on each (`document.querySelectorAll(...)[i]`).

5. Pick only the other project in the filter (**server** on a clean home; the tree stays),
   wait for `[data-file-browser-panel$=':<its path>'] >> role=treeitem` and run the check
   again: `paths` are its top-level entries, not step 4's, and `painted` is true. Back on
   the scratch repository, **Open a branch in a worktree** → another branch: a second
   section appears; expand it and check again: `panel` ends in that worktree's path and
   its rows paint. Save the sidebar with `preview_snapshot` `save: true`.
   Worktree reuse, set-aside, Keep and Delete: make the worktree dirty, open another
   branch, then reopen the first: the edits come back.
6. Search a file name; Enter opens it.
7. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Projects**: the URL is `/repositories` and the thread's worktree shows.
8. Hide a worktree in the filter while a tab of it is in front: its header stays, marked
   **hidden**, and the `Hiding …` pill shows; bring another tab to the front and it drops out.
   With a file written in one worktree, **Has changes** counts it and, on, leaves only it (and
   the focused tab's worktree, marked).
9. With the `.ts` file in front, click **Open local graph**: a `repo-graph:` tab splits to
   the right with the file's chain mark. Prove it paints: `document.elementFromPoint` at the
   graph canvas's centre returns a `CANVAS`. Open another file with **Following** pressed and
   the graph re-roots on it; unpress it and it stays.

## Source

`apps/web/src/components/repositories/` (incl. `RepositoryGraphView.tsx` and
`localGraph.ts`), `components/codeGraph/`, `routes/_chat.repositories.tsx`,
`packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/workspaceTabs.tsx` (Open in Projects), the filter on
`components/projects/ThreadsFilterParts.tsx` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
