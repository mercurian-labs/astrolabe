# Sidebar header

The sidebar's titlebar row (`[data-sidebar-chrome-header]`) carries no wordmark (the
rail's monogram stands for the brand), only the Dev or Nightly version pill on those builds and, in
each section with tabs (Agents, Wikis, Projects, and Changes where the server
supports pull requests), **Back** and **Forward** at its right end (`[data-tab-history]`, from
`SidebarTabHistory.tsx`; see chat-tabs.md, wikis.md, repositories.md and pull-requests.md). It has a bottom border in
line with the tab strip's and keeps the icon rail's colour (`bg-sidebar`), so the
rail's title-bar cell and this row read as one band. Below it the sidebar's body
(section title and list) takes the main area's background
(`--astrolabe-canvas`, the root `--background`); the narrow-window sheet keeps the
sidebar colour. There is no sidebar artwork: the identification setting offers
the version pill or none, and a stored "artwork" shows the pill.

Below it, the sidebar opens on its **section title**, as ChatGPT's does: a large
"Agents" (or "Wikis", "Projects", "Changes"; see [wikis.md](wikis.md)) heading with the section's
actions at its right end.

## Sub-features

- No brand link in the header row; the rail's monogram tile (`[data-app-rail-mark]`, as large
  as a rail button, 6px corners) heads the rail. Where the open sidebar meets the rail and the
  title bar, `[data-app-rail-corner]` rounds the join with the tab's 6px radius (`--radius-md`). With the
  sidebar collapsed, `[data-app-rail-corner=collapsed]` rounds the content's top-left
  corner the same way, where the rail's edge meets the title bar's bottom border (strips,
  and the Settings and Usage headers).
- Title row: heading **Agents**, then **Search threads**, **Filter threads**, **New thread**.
  The filter is a multi-select combobox (`projects/useThreadsFilter.ts` over the pure model in
  `projects/threadsFilter.ts` and the shared `projects/projectFilter.ts`; pills and checkboxes
  in `projects/ThreadsFilterParts.tsx`). Its trigger always shows the filter icon and is named
  `Filter threads`, or `Filter threads (filtered)` with a dot while anything is picked. Its
  popup has a `Search filters` field (placeholder `Filter...`; "No matching filters." when
  nothing matches), then a **Status** group (Needs you, Working, Errored, each with the count
  of visible threads in the picked projects) and a **Projects** group: All projects, each
  project (wikis are not projects, so none is listed), and a last **New project** row. Every
  row is a checkbox and picking keeps the popup open. Values in one group widen, the two
  groups narrow. With no project picked, All projects and every project show ticked;
  unticking one keeps the rest, and ticking every project or unticking the last is All
  projects again. The filter is kept in localStorage `astrolabe:threads-filter:v1` as
  `{projects, statuses}` (removed when empty; an older stored `kinds` is dropped). An empty list reads "No threads match these filters".
- **Pills** (`[aria-label='Thread filters']`, under the title row): **Needs you** is a
  one-tap toggle (`aria-pressed`, a dashed outline while off) shown while it is on or any
  visible thread needs you; one pill names the picked projects (up to three icons, the names,
  or `N projects` past two) and one the other statuses. A pill's body opens the popup, its ×
  (`Remove filter: <label>`) clears that dimension, and **Clear** (with two or more pills)
  clears all. Opening a thread the filter hides (search, the palette, a link, a reload onto
  it) clears the whole filter. A thread row's menu offers `Filter by <project>` (that project
  alone) or `Show all projects`. Search is upstream's integrated search: the
  button gives way to upstream's field, `combobox "Search threads"` (and a **Clear
  thread search** button while it holds a query). Typing replaces the list with
  `listbox "Thread search results"` (or a status: "Searching thread messages…",
  then "No threads found"). Escape
  clears a query; Escape on an empty field brings the heading and button back.
  The keyboard menu's `/` opens the Search palette instead, not this field; its `n`
  presses the row's New thread / New document button (which-key.md).
- **New thread** creates a draft directly only with one project or on Shift+click;
  with several projects it opens the Search palette (`dialog "Search"`) on its Projects
  list, the "New thread in…" picker. It is disabled with no projects. Each project row in
  the filter's popup has a `Project settings for <name>` gear.
- **Rail mark**: the small monogram on a bordered rounded tile (`[data-app-rail-mark]`) is the rail's first item, above Agents, on web and desktop alike. The cap above the rail (`[data-app-rail-cap]`) is an empty, aria-hidden cell. The sidebar toggle is a separate fixed element drawn over it (`[data-app-rail-toggle]`, centred, x ≈ 6), not a child of the cap: locate it by `[data-app-rail-toggle]` or `role=button[name='Toggle main sidebar']`, never scoped under the cap. In the macOS desktop app (not fullscreen), whose window buttons take that corner, the toggle sits just after them (`--rail-toggle-left`, 90px, outside the cap's 44px) and the header row's content starts after the toggle.
- **Icon rail** (`nav[aria-label='Sections']`, desktop only): the sections on top
  (Agents, Wikis, Projects, Changes when the server supports pull requests),
  the current one marked with a bar and `aria-current="page"`; the desktop app's update control
  (`Check for updates`, a rail list row), then Usage and Settings, sit at the foot. Where cloud sign-in is
  configured, Settings is the account menu instead of a link (see
  [account-menu.md](account-menu.md)). The sidebar toggle is not in the rail but above it (see
  Rail mark).
  Usage has no sidebar: there it shows collapsed and the toggle is gone (`mod+b` does
  nothing), and leaving Usage restores the open state. The rail's sections are the keyboard menu's Go to
  (`useAppSections`). Agents returns to the last chat. Projects and Changes are
  sections like Wikis, each with its own sidebar and panes ([repositories.md](repositories.md),
  [pull-requests.md](pull-requests.md)). The rail stays when the sidebar collapses, starting below the title
  bar, which still runs to the window's left edge. The sidebar footer keeps only
  update notices on desktop. On narrow windows (sheet sidebar) the rail, and with it the
  monogram, is absent; the header row carries no brand at any width, and below 768px it starts
  with the sheet's own Toggle main sidebar (`md:hidden`). The footer keeps Settings (or the
  account menu), Wikis, Projects, Changes (when the server supports pull requests) and
  Usage; while on Wikis, Projects or Changes, that section's button reads Agents
  instead. On Settings (legacy `/projects/…` links included) and Usage it shows only Back,
  beside the account menu when there is one.
- **Toggle main sidebar** is drawn over the rail's title-bar cell, above the monogram (same icon,
  tooltip "Toggle main sidebar (⌘B)", `aria-pressed` while open; outside the rail's list,
  so `j`/`k` no longer reach it). On narrow windows (no rail) the toggle stays in the
  title bar and the sheet's header. The rail's title-bar cell has no bottom border; the rail's right edge starts on the title bar's
  bottom-border row, so it meets the sidebar header's border square at the
  sidebar's top-left corner. The open sidebar's right edge runs the full window
  height, through the title bar (`[data-app-sidebar]::after`); collapsed there is
  none. Collapsed, the start of the main title bar (where its content starts) holds the
  section's Back and Forward (`[data-sidebar-control] [data-tab-history]`, in sections
  with tabs only), not Search or the filter. Settings has no tabs: its header
  (Settings / page) is the title bar, as Usage's is.
- **Thread rows** (`[data-testid=sidebar-row-card]`): one line with the project picture, the
  title, the terminal and machine glyphs, and the age or status; a smaller second line only when
  the thread has something particular, its parts joined by `·`: `Draft`
  (`sidebar-draft-indicator-<id>`); the branch without its `<repository>/` prefix, hidden on the
  default branch (main or master, or what the row's git status reports), after the worktree glyph
  (`thread-worktree-<id>`) when the thread has its own worktree; the pull request as
  `PR #130 open` (still the badge link, with its tooltip); and the agent's name when it is not
  its project's usual one (the default the project's new threads start with, its own or its
  environment's, else the most common among the environment's listed threads). In a repository
  whose default branch is not main or master, a row on it shows the branch until its git status
  arrives, then drops to one line. `components/sidebar/agentRowSummary.ts` decides the second
  line; `AgentRowDetails.tsx` and `SidebarCard.tsx`'s `SidebarAgentRowItem`/
  `SidebarAgentRowContent` draw it. Pinned rows sit under a resting **Pinned** heading
  (`[data-testid=sidebar-pinned-header]`, `role=heading`, 24px tall) with no pin glyph, and an
  **Active** one (`sidebar-pinned-divider`) closes them while active rows follow; hovering a pinned
  row offers `button "Unpin thread"` beside Snooze and Settle. Draft-session rows
  (`sidebar-draft-row`) take the same two lines (the preview, then Draft) and stay above the
  Pinned heading, outside the sortable rows the drag projection measures. Snoozed and settled
  rows stay slim (`sidebar-row-slim`, with their pin glyph), and mobile rows are upstream's.

## How to get to it (user POV)

The titlebar row and the section title are the top of the sidebar on every chat
route.

## Driving it with the Browser panel

```
preview_act click  role=button[name='Search threads']       # swaps the heading for the field
preview_act type   role=combobox[name='Search threads']  text=<title words>
preview_act click  role=combobox[name=/^Filter threads/]   # popup stays open across picks
preview_act click  role=option[name=/^<project>/]           # under All projects: unticks it, keeps the rest
preview_evaluate   localStorage['astrolabe:threads-filter:v1']
preview_act click  role=button[name=/^Remove filter: /]     # the pill's ×
preview_act click  role=button[name='New thread']           # picker with >1 project; Shift+click: /draft/<id>
```

The trigger is a `role=combobox` button, and status rows carry their count in their name
(`Working3`), so match them with a leading regex. Clicking the trigger through
`preview_evaluate` (`.click()`) does not open Base UI's popup; use `preview_act click`. Read
the boxes from the drawn checkbox: `[...document.querySelectorAll('[role=option]')].map(o =>
[o.textContent, o.querySelector('svg.lucide-check') ? 'x' : o.querySelector('svg.lucide-minus')
? '-' : ' '])`. The sidebar's own search looks only inside the filter ("No threads found"
for a hidden thread), so prove the reveal from the Search palette instead: Cmd+K `/`, type
the hidden thread's title, Enter; the stored filter is gone and its row shows.

**Proof:** each action's result (the field focused and
`[role=listbox][aria-label="Thread search results"] [role=option]` rows as you
type, the filter popup with its `Search filters` field, the Status and Projects groups and
the New project row, every box ticked under All projects, the stored filter and the pill
after a pick, the row count dropping to the picked projects and returning after the pill's ×,
the picker or a new `/draft/` URL), plus a saved screenshot of the rows and pills. Rows in the accessibility
tree are not proof they paint: for `[data-app-rail-mark]`, `[data-app-rail-toggle] button` and
the first search result, take the `getBoundingClientRect` centre (nonzero height) and check
`document.elementFromPoint(cx, cy).closest(...)` returns that element. The borders are visual-only:
read `getComputedStyle` widths on the header row (a bottom border) and `[data-app-rail-cap]` (none: the border stops above the rail). Colours: `[data-sidebar-chrome-header]` and `[data-app-rail]` share a `backgroundColor`; `[data-slot=sidebar-inner]` matches `main[data-slot=sidebar-inset]` (light and dark, Mercurian and another theme), and a hovered and the current row still show a fill. The edge: `getComputedStyle(document.querySelector('[data-app-sidebar]'), '::after').top` is `0px`. Check the pill and the Back/Forward buttons are not clipped at the default sidebar width,
and again after dragging `Resize Sidebar` narrower. Thread rows: a `sidebar-row-card`'s
`getBoundingClientRect().height` is 26 with one line and 42 with two (its `li` adds 2).

## Gotchas

- The order of the title row's actions is a design decision still open (search,
  filter, new today). Assert presence, not order, unless the change is about order.
- Scope locators: `navigation "Agents"` (the sidebar), the rail's `button "Agents"`
  and `heading "Agents"` share the name.
- Upstream reworks `Sidebar.tsx` often. After a sync, check that all three
  actions still exist with these names.
