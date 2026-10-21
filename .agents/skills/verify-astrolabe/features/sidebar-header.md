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
  project** (combobox), **New thread**. Search is upstream's integrated search: the
  button swaps the heading for upstream's own field, which filters the thread list
  in place (results are upstream's slim rows). Escape clears a query; Escape on an
  empty field brings the heading back.
- **Icon rail** (`nav[aria-label='Sections']`, desktop only): Threads on top,
  marked current with a bar and `aria-current="page"`. Pull Requests, Usage and
  Settings sit at the foot, each current on its own page. Threads returns to the
  last chat. The rail stays when the sidebar collapses, starting below the title
  bar, which still runs to the window's left edge. The sidebar footer keeps only
  update notices on desktop. On narrow windows (sheet sidebar) the rail is
  absent, and the footer keeps Settings, Pull Requests and Usage.
- **Toggle main sidebar** stays at the far left of the titlebar. With the sidebar
  collapsed it sits in the rail's title-bar cell, which keeps the sidebar's colour
  and bottom border; the rail's edge starts below the title bar, never above it. The open
  sidebar's right edge also starts below the title bar; hovering the resize rail
  (`[data-slot=sidebar-rail]`, its `::after`) draws it full height. On pages that list no threads (Settings, Usage, Pull Requests), the
  collapsed title bar shows Search but not the project filter.

## How to get to it (user POV)

The titlebar row and the section title are the top of the sidebar on every chat
route.

## Driving it with the Browser panel

```
preview_click  role=button[name='Search threads']       # swaps the heading for the search field
preview_click  role=combobox[name='Filter threads by project']
preview_click  role=button[name='New thread']           # navigates to /draft/<id>
preview_click  role=link[name='Go to threads']
```

**Proof:** each action's result (the field focused and the list filtered as you
type, the project filter list, a new `/draft/` URL), plus a saved screenshot of
the rows. The borders are visual-only:
read `getComputedStyle` widths on the header row and `[data-app-rail-cap]`. Check the wordmark is not clipped at the default sidebar width,
and again after dragging `Resize Sidebar` narrower.

## Gotchas

- The order of the title row's actions is a design decision still open (search,
  filter, new today). Assert presence, not order, unless the change is about order.
- Upstream reworks `Sidebar.tsx` often. After a sync, check that all three
  actions still exist with these names.
