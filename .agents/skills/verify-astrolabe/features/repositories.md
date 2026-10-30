# Repositories

Astrolabe's section for a repository's files and changes, built as Wikis is: a rail
item (`button "Repos"`, between Wikis and Changes) swaps the sidebar
for the Repositories sidebar and fills the main area with tabs and splits (the same
panes as Wikis, see [panes.md](panes.md)). Text files open in the editor wikis use;
diffs and everything that is not text keep T3 Code's viewers. It is the home of a
thread's Files and Diffs. User guide: `docs/user/repositories.md`.

## Sub-features

- **Sidebar** (`role=navigation[name='Repos']`): heading **Repos** with
  **Search files**, **Filter by repository** (combobox; its popup starts with a
  `Search repositories` field; named `Filter by repository:
  <name>` once one is picked; kept in `astrolabe:repository-scope:v1`: the
  **Repos** heading for all, then each repository; a wiki's checkout and the
  server's scratch workspace (threads with no project) are left out) and **Add a repository** (the add-project palette; once
  it adds the repository the app leaves `/repositories` for a new draft thread there, so
  click `button "Repos"` to come back). The filter's foot holds **Manage
  repositories** and **Add a repository**.
- **List** (default): with every repository, one group each (collapsible header) with its
  eight most recently committed files. With one repository: one collapsible section per git
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
  in front; Option/Alt-click, Cmd/Ctrl-click or middle-click opens a new tab (rows here
  have no selection); dragging places it.
- **Worktrees**: `combobox "Open a branch in a worktree"` (beside the filter, with a
  repository picked) lists local branches, each noting `main checkout` or `worktree <n>`
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
  worktree." with **Open <branch>**.
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
- **Search**: the header's search finds files by name in the scoped repository's
  focused-tab worktree, else its main checkout (`projects.searchEntries`); with every
  repository it asks for one.
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
- **Manage repositories** (the filter's foot) opens Settings → Projects.
- **Open in Repos**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it scopes Repositories to the thread's
  repository and checkout and opens the same file, its uncommitted changes, or the tree.
  Repository tabs open in Wikis' and Changes' panes too and offer **Open in
  Repositories** there.
- **Keyboard and palette**: `menu g r` and the palette's **Open repositories**.

- **Mobile** (iPhone; iPad keeps two roots): a fourth tab `button "Repos"`
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

1. Click `button "Repos"`; with no repository picked the list shows one group per
   repository.
2. Pick the scratch repository in **Filter by repository**. Expect **Uncommitted · 1**;
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

5. Pick the other repository in the filter (**server** on a clean home; the tree stays),
   wait for `[data-file-browser-panel$=':<its path>'] >> role=treeitem` and run the check
   again: `paths` are its top-level entries, not step 4's, and `painted` is true. Back on
   the scratch repository, **Open a branch in a worktree** → another branch: a second
   section appears; expand it and check again: `panel` ends in that worktree's path and
   its rows paint. Save the sidebar with `preview_snapshot` `save: true`.
   Worktree reuse, set-aside, Keep and Delete: make the worktree dirty, open another
   branch, then reopen the first: the edits come back.
6. Search a file name; Enter opens it.
7. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Repositories**: the URL is `/repositories`, the filter names the thread's repository.

## Source

`apps/web/src/components/repositories/`, `routes/_chat.repositories.tsx`,
`panes/sectionPanes.ts`, `packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/rightPanelPaneTabs.tsx` (Open in Repos), the filter on
`components/projects/projectFilter.ts` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
