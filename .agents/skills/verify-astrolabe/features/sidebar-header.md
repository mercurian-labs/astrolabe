# Sidebar header

The sidebar's titlebar row carries the small Astrolabe wordmark (plus the Dev or
Nightly version pill on those builds) and nothing else. It has a bottom border in
line with the tab strip's, and spans the icon rail's title-bar cell, so rail and
sidebar share it. There is no sidebar artwork: the identification setting offers
the version pill or none, and a stored "artwork" shows the pill.

Below it, the sidebar opens on its **section title**, as ChatGPT's does: a large
"Threads" (or "Wikis", see [wikis.md](wikis.md)) heading with the section's
actions at its right end.

## Sub-features

- `link "Go to threads"` holds `img "Astrolabe"`, which is the small wordmark.
  When narrow, it falls back to the small mark, measured to fit beside the pill.
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
- **Icon rail** (`nav[aria-label='Sections']`, desktop only): the sections on top
  (Threads, Wikis, Pull Requests when the server supports it), the current one marked
  with a bar and `aria-current="page"`; Usage and Settings sit at the foot, each
  current on its own page. The rail's sections are the keyboard menu's Go to
  (`useAppSections`). Threads returns to the last chat. Pull Requests is a section like
  Wikis: its own sidebar (title "Pull requests", refresh, search, Sort, Filters,
  provider, then the reviews as cards) and the reviews in tabs and splits beside it. The rail stays when the sidebar collapses, starting below the title
  bar, which still runs to the window's left edge. The sidebar footer keeps only
  update notices on desktop. On narrow windows (sheet sidebar) the rail is
  absent, the brand link is hidden (below 768px), and the footer keeps Settings,
  Wikis (Threads while on Wikis), Pull Requests and Usage; on Settings, Usage and
  Pull Requests it shows only Back.
- **Toggle main sidebar** stays at the far left of the titlebar. With the sidebar
  collapsed it sits in the rail's title-bar cell, which keeps the sidebar's colour
  and bottom border; the rail's edge starts below the title bar, never above it. The open
  sidebar's right edge also starts below the title bar; hovering the resize rail
  (`[data-slot=sidebar-rail]`, its `::after`) draws it full height. Collapsed, Search and the
  filter follow the toggle into the main title bar, and Search reopens the sidebar
  with its field focused. On pages that list no threads (Usage, Pull Requests, Wikis)
  the collapsed bar shows Search but not the project filter; on Settings (whose
  sidebar is the settings nav) it shows neither. Settings has no tabs: its header
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
preview_click  role=link[name='Go to threads']
```

**Proof:** each action's result (the field focused and
`[role=listbox][aria-label="Thread search results"] [role=option]` rows as you
type, the project filter list, the picker or a new `/draft/` URL), plus a saved screenshot of
the rows. The borders are visual-only:
read `getComputedStyle` widths on the header row (a bottom border) and `[data-app-rail-cap]` (none: the border stops above the rail). Check the wordmark is not clipped at the default sidebar width,
and again after dragging `Resize Sidebar` narrower.

## Gotchas

- The order of the title row's actions is a design decision still open (search,
  filter, new today). Assert presence, not order, unless the change is about order.
- Scope locators: `navigation "Threads"` (the sidebar), the rail's `button "Threads"`
  and `heading "Threads"` share the name.
- Upstream reworks `Sidebar.tsx` often. After a sync, check that all three
  actions still exist with these names.
