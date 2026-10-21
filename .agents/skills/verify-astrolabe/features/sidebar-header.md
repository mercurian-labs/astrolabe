# Sidebar header

The sidebar's titlebar row (`[data-sidebar-chrome-header]`) carries no wordmark (the
rail's monogram stands for the brand), only the Dev or Nightly version pill on those builds and, in
Threads and Wikis, **Back** and **Forward** at its right end
(`[data-tab-history]`, see chat-tabs.md and wikis.md). It has a bottom border in
line with the tab strip's and keeps the icon rail's colour (`bg-sidebar`), so the
rail's title-bar cell and this row read as one band. Below it the sidebar's body
(section title and list) takes the main area's background
(`--astrolabe-canvas`, the root `--background`); the narrow-window sheet keeps the
sidebar colour. There is no sidebar artwork: the identification setting offers
the version pill or none, and a stored "artwork" shows the pill.

Below it, the sidebar opens on its **section title**, as ChatGPT's does: a large
"Threads" (or "Wikis", see [wikis.md](wikis.md)) heading with the section's
actions at its right end.

## Sub-features

- No brand link in the header row; the rail's monogram tile (`[data-app-rail-mark]`, as large
  as a rail button, 8px corners) heads the rail. Where the open sidebar meets the rail and the
  title bar, `[data-app-rail-corner]` rounds the join with the tab's 8px radius. With the
  sidebar collapsed, `[data-app-rail-corner=collapsed]` rounds the content's top-left
  corner the same way, where the rail's edge meets the title bar's bottom border (strips,
  and the Settings and Usage headers).
- Title row: heading **Threads**, then **Search threads**, **Filter threads by
  project** (combobox; once a project is picked its name is `Filter threads by
project: <project>`), **New thread**. Search is upstream's integrated search: the
  button gives way to upstream's field, `combobox "Search threads"` (and a **Clear
  thread search** button while it holds a query). Typing replaces the list with
  `listbox "Thread search results"` (or a status: "Searching thread messages…",
  then "No threads found"). Escape
  clears a query; Escape on an empty field brings the heading and button back.
  The keyboard menu's `/` opens the Search palette instead, not this field; its `n`
  presses the row's New thread / New document button (which-key.md).
- **New thread** creates a draft directly only with one project or on Shift+click;
  with several projects it opens the palette's "New thread in…" picker. It is
  disabled with no projects.
- **Rail mark**: the cap above the rail (`[data-app-rail-cap]`) holds the small monogram on a bordered rounded tile (`[data-app-rail-mark]`). In the macOS desktop app, where the window's buttons take that corner, the tile is the rail's first item instead, above Threads.
- **Icon rail** (`nav[aria-label='Sections']`, desktop only): the sections on top
  (Threads, Wikis, Pull Requests when the server supports it, Usage), the current one
  marked with a bar and `aria-current="page"`; the toggle, the desktop app's update control
  (`Check for updates`, a rail list row) and Settings sit at the foot.
  Usage has no sidebar: there it shows collapsed and the toggle is gone (`mod+b` does
  nothing), and leaving Usage restores the open state. The rail's sections are the keyboard menu's Go to
  (`useAppSections`). Threads returns to the last chat. Pull Requests is a section like
  Wikis: its own sidebar (title "Pull requests", refresh, search, Sort, Filters,
  provider, then the reviews as cards) and the reviews in tabs and splits beside it. A row
  click shows the review in the focused pane's tab in front (one open elsewhere comes to
  the front there); Option-click, middle-click, Alt+Enter and the row's right-click open a
  new tab in the focused pane; Mod-click and Shift-click select rows, as in Wikis, and a
  selected row's right-click opens them all; rows drag onto a pane's strip or content
  (`placePullRequests`). A pull request picked inside a review (its stack menu, a link in its text)
  replaces that review's tab. Each tab keeps back/forward (`pullRequestTabs.ts`, localStorage
  `astrolabe:pull-request-tab-history:v1`), walked by the header's arrows and `mod+[`/`mod+]`. The rail stays when the sidebar collapses, starting below the title
  bar, which still runs to the window's left edge. The sidebar footer keeps only
  update notices on desktop. On narrow windows (sheet sidebar) the rail is
  absent, the brand link is hidden (below 768px), and the footer keeps Settings,
  Wikis (Threads while on Wikis), Pull Requests and Usage; on Settings, Usage and
  Pull Requests it shows only Back.
- **Toggle main sidebar** is at the foot of the icon rail, above Settings (same icon, tooltip "Toggle main sidebar (⌘B)", `aria-pressed` while
  open; a rail list button, so `j`/`k` reach it). On narrow windows (no rail) the
  toggle stays in the title bar and the sheet's header. The rail's title-bar cell is
  empty and has no bottom border; the rail's right edge starts on the title bar's
  bottom-border row, so it meets the sidebar header's border square at the
  sidebar's top-left corner. The open sidebar's right edge runs the full window
  height, through the title bar (`[data-app-sidebar]::after`); collapsed there is
  none. Collapsed, the start of the main title bar (where its content starts) holds the
  section's Back and Forward (`[data-sidebar-control] [data-tab-history]`, in sections
  with tabs only), not Search or the filter. Settings has no tabs: its header
  (Settings / page) is the title bar, as Usage's is.

## How to get to it (user POV)

The titlebar row and the section title are the top of the sidebar on every chat
route.

## Driving it with the Browser panel

```
preview_click  role=button[name='Search threads']       # swaps the heading for the field
preview_type   role=combobox[name='Search threads']  text=<title words>
preview_click  role=combobox[name=/^Filter threads by project/]
preview_click  role=button[name='New thread']           # picker with >1 project; Shift+click: /draft/<id>
```

**Proof:** each action's result (the field focused and
`[role=listbox][aria-label="Thread search results"] [role=option]` rows as you
type, the project filter list, the picker or a new `/draft/` URL), plus a saved screenshot of
the rows. The borders are visual-only:
read `getComputedStyle` widths on the header row (a bottom border) and `[data-app-rail-cap]` (none: the border stops above the rail). Colours: `[data-sidebar-chrome-header]` and `[data-app-rail]` share a `backgroundColor`; `[data-slot=sidebar-inner]` matches `main[data-slot=sidebar-inset]` (light and dark, Mercurian and another theme), and a hovered and the current row still show a fill. The edge: `getComputedStyle(document.querySelector('[data-app-sidebar]'), '::after').top` is `0px`. Check the pill and the Back/Forward buttons are not clipped at the default sidebar width,
and again after dragging `Resize Sidebar` narrower.

## Gotchas

- The order of the title row's actions is a design decision still open (search,
  filter, new today). Assert presence, not order, unless the change is about order.
- Scope locators: `navigation "Threads"` (the sidebar), the rail's `button "Threads"`
  and `heading "Threads"` share the name.
- Upstream reworks `Sidebar.tsx` often. After a sync, check that all three
  actions still exist with these names.
