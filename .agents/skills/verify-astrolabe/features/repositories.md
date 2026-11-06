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
  `role=combobox[name=/^Filter projects/]` (` (filtered)` appended and a dot while on) opens a multi-select
  list with a `Search filters` field: **Status** (**Has changes**, with its count of worktrees
  with uncommitted files once it is on and has counted them all; meanwhile
  `role=status` "Counting changes… N of M" sits under the pills, and an empty list reads
  "Counting changes…"), **Projects** (**All
  projects**, then each, every one ticked while none is picked). Each project row ends in
  `button "Show <project>'s worktrees"` (`"Hide <project>'s worktrees"` once open;
  `aria-expanded`; clicking it never ticks the row; gone while the search has text),
  folded by default; unfolded, its worktrees follow it indented, ticked unless hidden. A search
  reads every project's worktrees and shows the matches under their project. Picking keeps the
  list open; its foot holds **Manage projects** and **Add a project**, and can cover the lower
  rows. The popup also shifts while it opens, so scroll a row into view before clicking it by
  position. Pills under the title
  (`[aria-label="Project filters"]`): **Has changes** one tap (only while on), the picked projects,
  `Hiding <worktrees>`; × clears a pill, **Clear** shows with two. The focused tab's repository
  and worktree show whatever the filter says, its header marked **hidden** (tooltip), and drop out
  when another tab comes to the front; nothing clears the filter for it. A repository left with
  no worktree drops out once read.
- **List** (default): with several repositories shown, one collapsible header each (favicon,
  name; its role name is the bare name, without the favicon's initials), open by default only
  for the focused tab's repository. An archived project is marked **Archived**, and its main
  checkout's actions menu adds `menuitem "Unarchive project"`. A folder that is not a git
  repository stays on "Reading worktrees…" (known, older than the v0.1.6 merge), so unarchive
  those from Settings › Projects. Every shown repository's worktree
  list is read (`worktrees.list`, no `git status`: `changedFiles` is null in a list), but a
  folded one mounts no rows. With one repository, its worktrees bare: one collapsible section
  per listed git worktree (`ProjectWorktreeService`), headed by its branch (or short
  commit when detached), the main checkout first and marked **main checkout**, with "N
  changed" (`worktrees.status`, counted per shown header, at most four `git status` at once on
  the server, recounted on the watch's changes) and a pin when held (tooltip: the holds).
  Listed: the main checkout, numbered ones, those held by a working thread, terminal or Keep,
  those with an open tab's checkout, a known change, or `lastActiveAt` within 24 hours; only the
  main checkout and the focused tab's start open
  (`worktreeFolding.ts`). The rest fold under `button "N more worktrees"`: a
  `Find among <project>'s other worktrees` field, then groups by `madeBy` (Astrolabe, Claude
  Code, T3 Code, Codex, Other; newest first), each row folded, unwatched and uncounted until
  opened. Under each: **Uncommitted · N** with
  **Review uncommitted changes →** and each changed file (`+a −d`), then the 20 files its
  commits changed most recently, with no heading (`review.getRecentFiles`,
  `git log --name-only`). Each header's `button "<label> worktree actions"` menu (the main checkout's too,
  holding only this unless archived) has `menuitem "Changes against its base"`, opening `repo-diff:…:branch-range`. A
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
  free ones. A linked worktree gets a number (server-kept in `worktree-keep.json`'s `opened`,
  lowest free across every project and wiki, held while the folder exists) the first time something opens in it: a branch
  opened or made there, or any of its tabs shown (`worktrees.markOpened`); numbered ones come
  first. Others show a branch icon.
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
  holding it now (`[aria-label="Worktree N"]`) just before its ✕ (before
  `[data-tab-end]`, so on a linked tab before its chain mark), none for the main
  checkout; hovering its title gives the path (or the changes' title) over
  `<branch> · worktree N` / `main checkout` / `not in a worktree`.
- **Tree**: a worktree header's `button "Show its files"` / `"Show its changes"` swaps its
  rows for T3 Code's file browser (`FileBrowserPanel`, @pierre/trees) on that worktree, per
  worktree (`astrolabe:repository-worktree-files:v2`, a map of picks); until picked the main
  checkout shows its files and the others their changes. The focused tab's worktree opens on
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
  the file's name truncates, then the file's name, both inside `navigation "Breadcrumbs"`, whose
  trailing buttons are the symbols around the cursor (a click jumps there); then the checkout's
  branch; then
  `group "Compare changes with"` (**HEAD** / **This turn**, only once a turn changed the file);
  "An agent is working in this checkout" while a thread there is mid-turn; the language
  server's `role=status` (below); Saved / Saving… / Not saved / Deleted / Deleted, not saved /
  Read only / Too big to edit here; then **Open local graph**, a project's file only). Markdown opens with the live
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
  the header's `span[role=status]` reads `TypeScript <version>`, `… starting…`, `… needs this
  project trusted` (**Trust project**), or failed / stopped / paused to save memory (**Restart**).
  Clicking it opens its menu: each server on the file (`+N` in the status counts the companions:
  Ruff, and ESLint or Tailwind where the project uses them) with state, memory, Restart, Stop, View
  logs (a `repo-lsp-logs:` tab with Server log, RPC trace, Server info); Settings → Projects says
  why a companion isn't active. The primary's commands are under `e L` in the keyboard menu. The
  toolchain is the checkout's own TypeScript (7 runs `tsc --lsp`, ≤6 typescript-language-server),
  else a cached download. Problems underline with the message and its server's name below the line
  (`.atlas-diagnostic-messages`; F8 / Shift+F8 step); completion as you type; hover
  (`.cm-lsp-hover-tooltip`) and signature help; F12 / Cmd-click definition (another file opens
  beside), Cmd+F12 type definition, Shift+F12 implementation, Alt+Shift+F12 references; F2
  rename (`input[aria-label="Rename <name>"]`, then a `repo-locations:` tab titled "Renamed X to
  Y" with one **Undo rename**, which says after what it put back; a wiki's file keeps a toast);
  Cmd+. code actions (`.atlas-lightbulb`, `[aria-label="Code actions"]`); Cmd+Shift+I format.
  Inlay hints (`.atlas-inlay-hint`) and symbol marks (`.atlas-symbol-read`, `-write`) are on by
  default; inline diagnostics (`.atlas-inline-diagnostic`), semantic colours and code lens
  (`.atlas-code-lens`) are off, in Settings → Appearance. Typing in a JSX tag writes its pair.
  Back and Forward (`ctrl+-`, `ctrl+shift+-` in a code file) cross go-tos and results tabs.
  `mod+alt+o` opens the palette's `project-symbol-picker`; a server must be running, else the
  code index answers.
- **Right-click menu** (`packages/editor/src/lsp/contextMenu.ts`): moves the cursor to the
  click unless it lands in the selection, then Go to Definition / Type Definition /
  Implementation / Find All References / Show Incoming Calls / Show Outgoing Calls |
  Rename Symbol… / Code Actions… / Format Document |
  Cut / Copy / Paste | Copy Relative Path / Open Local Graph. Language rows show only with a
  server and are faint while it starts or lacks the feature; Cut/Copy are faint with no
  selection. On the web its items are `role=menuitem` by name; on desktop the menu is native.
- **Project search** (Cmd+Shift+F; `components/search/ProjectContentSearchDialog.tsx`): dialog
  `Search project contents` (the palette's name, with or without a project), field
  placeholder `Search in <project>` (a combobox; type into it by `[placeholder=…]`). It searches the checkout of the focused Projects tab, else the thread in
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
  "Branch changes"): a header reading `<branch> / Uncommitted changes` or
  `/ Changes against <base>` (`RepositoryDiffView.tsx`), where `<base>` is
  `combobox "Compare with another branch than <base>"` (any local or remote branch; a pick
  takes the tab's place as `branch-range~<base>`, titled "Against <base>", so Back returns; with
  no known base the trigger reads "a branch…" and its name ends "than its base"), then T3 Code's diff renderer; each
  file's header has **Open**. Line
  comments go to the composer of the thread in that checkout, else the project's
  new-thread draft, else its newest thread; with none, a note asks to start a thread.
- **Manage projects** (the filter's foot) opens Settings → Projects.
- **Open in Projects**: a thread's right-panel **Files**, a file opened there, and
  **Diff** offer it in the tab's context menu; it opens the same file or its uncommitted
  changes (the focused tab brings its worktree into view), or the tree, for which the filter
  adds the project to its picks (when some are picked) and un-hides the worktree. Only
  those thread surface tabs offer it (`panes/workspaceTabs.tsx`).
- **Local graph** (`repo-graph:…`, keyed by the file's checkout as file tabs are, settings in
  `astrolabe:repository-local-graph:v1`): opened from the file header's **Open local graph**, the
  file's right-click menu, a sidebar file row's menu, or `r` `g`.
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

1. Click `button "Projects"`; with no project picked the list shows one header per
   project.
2. Pick only the scratch project in **Filter projects** (`role=combobox[name=/^Filter projects/]`;
   untick the others). The main
   checkout opens on its file tree (`button "Show its changes"`, `aria-pressed=true`); click
   that button. Expect **Uncommitted · 1**; **Review uncommitted changes** opens the diff;
   **Open** opens the file in a new tab after the diff. Click `button "Show its files"` to
   go back to the tree. Its `button "<main branch> worktree actions"` menu holds only
   `menuitem "Changes against its base"`: it opens `…:branch-range` in place; pick another
   branch from the title's combobox and the tab becomes "Against <branch>"; Back returns.
3. Type in the file; within a second the file on disk changes (`git status` shows it).
4. With the main checkout's tree showing, wait for `[data-file-browser-panel] >> role=treeitem`, then
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
   section appears, already open on its changes; click its `button "Show its files"` and
   check again: `panel` ends in that worktree's path and its rows paint. A file opened there
   numbers the worktree: its header and the file's tab show `[aria-label="Worktree N"]`, and
   no other worktree in any project has that N. Save the sidebar with `preview_snapshot` `save: true`.
   Folding: `git worktree add ../scratch-old -b old` in the scratch repository, then
   `touch -t 202601010000` the new folder and its `.git/worktrees/scratch-old/HEAD` and
   `logs/HEAD` (the server reads those times), and refocus the window: it folds under
   `button "1 more worktree"`; open it for `textbox "Find among <project>'s other worktrees"`
   and the group "Other · 1".
   Worktree reuse, set-aside, Keep and Delete: make the worktree dirty, open another
   branch, then reopen the first: the edits come back.
6. Search a file name; Enter opens it.
7. In a thread, add a **Diff** tab to the right panel, right-click it, **Open in
   Projects**: the URL is `/repositories` and the thread's worktree shows.
8. In the filter, unfold the project (`button "Show <project>'s worktrees"`) and untick a
   worktree while a tab of it is in front: its header stays, marked
   **hidden**, and the `Hiding …` pill shows; bring another tab to the front and it drops out.
   With a file written in one worktree, **Has changes** counts it and, on, leaves only it (and
   the focused tab's worktree, marked).
9. With the `.ts` file in front, click **Open local graph**: a `repo-graph:` tab splits to
   the right with the file's chain mark. Prove it paints: `document.elementFromPoint` at the
   graph canvas's centre returns a `CANVAS`. Open another file with **Following** pressed and
   the graph re-roots on it; unpress it and it stays.
10. Language server: in the `.ts` file wait for the header status `TypeScript <version>` (a
    an untrusted project asks to **Trust project** first). Type `const x: number = "a";`: Saving… → Saved
    and a wavy underline with `.atlas-diagnostic-messages`.
11. Right-click a call: the cursor moves there and the menu lists the language rows; choose
    **Find All References**: a `repo-locations:` tab opens beside with `[data-excerpt]`
    editors. Click a sidebar file: it opens after the results tab, which stays.
12. Cmd+K `e` `v`: a `repo-problems:` tab ("N errors, …"). With that tab focused, Cmd+Shift+F,
    type a name: "N results in M files"; Cmd+Enter opens a `repo-search:` tab.
13. Delete the file on disk: status **Deleted**; **Save** recreates it.

## Source

`apps/web/src/components/repositories/` (incl. `RepositoryGraphView.tsx`,
`localGraph.ts`, `multibuffer/`), `components/search/ProjectContentSearchDialog.tsx`,
`components/outline/`, `packages/editor/src/{lsp,git,multibuffer,outline}/`,
`apps/server/src/documents/`, `apps/server/src/languageServers/`, the language tools in
`mcp/toolkits/code/`, `components/codeGraph/`, `routes/_chat.repositories.tsx`,
`packages/editor/src/code/`, `review.getRecentFiles` in
`apps/server/src/review/ReviewService.ts`, `sectionTabs/` (the `repositories` section),
`panes/workspaceTabs.tsx` (Open in Projects), the filter on
`components/projects/ThreadsFilterParts.tsx` and `storedChoice.ts`, T3 Code's
`components/files/FileBrowserPanel.tsx` (the tree). Mobile:
`apps/mobile/src/features/repositories/`, `apps/mobile/src/state/repositories.ts`, the
`RepositoryFiles` / `RepositoryFile` routes in `apps/mobile/src/Stack.tsx`.
