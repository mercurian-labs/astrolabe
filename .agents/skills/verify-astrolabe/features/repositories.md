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
  in front (`workspace.show`): one already open comes forward; an empty tab is filled; a
  chat, a linked tab or unsaved edits make way for a new tab; otherwise it replaces the tab
  (Back returns). Option/Alt-click, Cmd/Ctrl-click or middle-click opens a new tab (rows here
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
  path as a breadcrumb, `navigation "File path breadcrumb"`: its folder muted, keeping its last
  segment whole and cutting the rest from its start, and wrapping away (with its `/`) before
  the file's name truncates, then the file's name, both inside `navigation "Breadcrumbs"`, whose
  trailing buttons are the symbols around the cursor (a click jumps there); then
  `group "Compare changes with"` (**HEAD** / **This turn**, only once a turn changed the file);
  "An agent is working in this checkout" while a thread there is mid-turn; the language
  server's `role=status` (below); Saved / Saving… / Not saved / Deleted / Deleted, not saved /
  Read only / Too big to edit here; then **Open local graph**). Markdown opens with the live
  preview (a centred measure); code in `.cm-editor.cm-code` with line numbers and its
  language's colours (`@mercurian/editor/code`). Vim follows the device setting. The file is a
  live document the environment owns (`documents.*` RPCs, `apps/server/src/documents/`): edits
  save 500 ms after typing stops, other tabs and outside writes show as they land, a deleted
  file stays open with **Save** / **Discard**, and edits made offline that meet a changed file
  offer **Keep mine** / **Use the file's**. Cmd+F finds (with replace), Cmd+Shift+O is **Go to
  symbol**, Cmd+S saves (formatting first with **Format on save**).
- **Change markers** (`packages/editor/src/git/gitChanges.ts`): `.atlas-git-gutter` beside the
  line numbers holds `.atlas-git-marker.atlas-git-{added,modified,deleted}` against HEAD, or
  against the turn with **This turn**. A click (or Cmd+') shows the old lines with
  `role=toolbar[name=Change]`: **Restore this change**, **Previous change**, **Next change**;
  Cmd+Shift+' shows every change; Cmd+F8 / Cmd+Shift+F8 step.
- **Language server** (`apps/server/src/languageServers/`, client `packages/editor/src/lsp/`):
  the header's `span[role=status]` reads `TypeScript <version>`, `… starting…`, `… needs a
  download` (**Download**), or failed / stopped / paused to save memory (**Restart**). The
  toolchain is the checkout's own TypeScript (7 runs `tsc --lsp`, ≤6 typescript-language-server),
  else a cached download. Problems underline with the message below the line
  (`.atlas-diagnostic-messages`; F8 / Shift+F8 step); completion as you type; hover
  (`.cm-lsp-hover-tooltip`) and signature help; F12 / Cmd-click definition (another file opens
  beside), Cmd+F12 type definition, Shift+F12 implementation, Alt+Shift+F12 references; F2
  rename (`input[aria-label="Rename <name>"]`, then a "Renamed X to Y" toast with **Undo**);
  Cmd+. code actions (`.atlas-lightbulb`, `[aria-label="Code actions"]`); Cmd+Shift+I format.
- **Right-click menu** (`packages/editor/src/lsp/contextMenu.ts`): moves the cursor to the
  click unless it lands in the selection, then Go to Definition / Type Definition /
  Implementation / Find All References | Rename Symbol… / Code Actions… / Format Document |
  Cut / Copy / Paste | Copy Relative Path / Open Local Graph. Language rows show only with a
  server and are faint while it starts or lacks the feature; Cut/Copy are faint with no
  selection. On the web its items are `role=button` by name; on desktop the menu is native.
- **Project search** (Cmd+Shift+F; `components/search/ProjectContentSearchDialog.tsx`): dialog
  `Search project contents`, field placeholder `Search in <project>` (a combobox; type into it
  by `[placeholder=…]`). It searches the checkout of the focused Projects tab, else the thread in
  front; with neither it reads "Open a project to search its files." Match case / whole word /
  regex, **Filters** (`Files to include`, `Files to exclude`, `Include gitignored files`),
  pages of 500 (**Load more results**, **Keep searching**); unsaved edits in open files are
  searched too. Enter opens a match at its line; Cmd+Enter **Open results in editor**.
- **Results tabs** (`repositories/multibuffer/`): one editor of excerpts (`[data-excerpt]`, one
  per match, under a header per file with `Open <name>`), editing the real files. `repo-search:`
  "Search: <query>" (toolbar "N results for “q” in M files", `Replace with`, **Replace all**,
  asking first above 10 files, then **Undo replace-all**); `repo-problems:` "Problems" (`e` `v`,
  palette **Projects: Show Problems**; "N errors, M warnings in K files", live); `repo-locations:`
  for references ("References of <name> · N places"). F7 / Shift+F7 step files, Shift+Enter
  shows more lines, Alt+Enter opens the file at the cursor. They keep their place: a row click
  or Back/Forward from one opens the file in a new tab after it (`keepsPlace`, panes.md).
- **Agent tools** (`mcp/toolkits/code/`): `astrolabe_code_diagnostics`,
  `astrolabe_code_definition`, `astrolabe_code_references` ask the same language server
  ("Checked code diagnostics", "Found a definition", "Found references" in chat); they need an
  agent turn to walk.
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
  opened from the file header's **Open local graph**, the file's right-click menu, a sidebar
  file row's menu, or `r` `g`.
  It splits to the right, carries the file's chain mark, and follows the file in front while
  **Following** is pressed (`aria-pressed`). Header actions, in order: Back, Forward,
  **Reset the graph** (only once something is expanded), **Following**, **Fit the graph**,
  **Graph settings**. With no file it reads "Local graph", **Fit the graph** is disabled, and
  the notice reads "Open a file to see its local graph…". A single click opens the node's file and re-roots there after ~280 ms (the
  double-click window); a double-click toggles its neighbours; right-click offers Expand /
  Collapse neighbours, Show / Hide contents, Centre here and Open. Levels and the graph
  itself are in [code-graph.md](code-graph.md).
- **Keyboard and palette**: `menu g r` and the palette's **Open projects**; the editor's
  commands are the keyboard menu's `e` group (which-key.md) and Settings → Keybindings →
  **Editors**.

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
9. Language server: in the `.ts` file wait for the header status `TypeScript <version>` (a
   fresh machine asks to **Download** first). Type `const x: number = "a";`: Saving… → Saved
   and a wavy underline with `.atlas-diagnostic-messages`.
10. Right-click a call: the cursor moves there and the menu lists the language rows; choose
    **Find All References**: a `repo-locations:` tab opens beside with `[data-excerpt]`
    editors. Click a sidebar file: it opens after the results tab, which stays.
11. Cmd+K `e` `v`: a `repo-problems:` tab ("N errors, …"). With that tab focused, Cmd+Shift+F,
    type a name: "N results in M files"; Cmd+Enter opens a `repo-search:` tab.
12. Delete the file on disk: status **Deleted**; **Save** recreates it.

## Source

`apps/web/src/components/repositories/` (incl. `RepositoryGraphView.tsx`,
`localGraph.ts`, `multibuffer/`), `components/search/ProjectContentSearchDialog.tsx`,
`components/outline/`, `packages/editor/src/{lsp,git,multibuffer,outline}/`,
`apps/server/src/documents/`, `apps/server/src/languageServers/`, the language tools in
`mcp/toolkits/code/`, `components/codeGraph/`, `routes/_chat.repositories.tsx`,
`packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/workspaceTabs.tsx` (Open in Projects), the filter on
`components/projects/projectFilter.ts` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
