# Sidebar header

The sidebar's titlebar row carries the small Astrolabe wordmark, then the
sidebar's actions, on glass over the stage artwork. Settings, Pull Requests and
Usage sit as icons at the sidebar's foot.

## Sub-features

- `link "Go to threads"` holds `img "Astrolabe"`, which is the small wordmark.
  When narrow, it falls back to the small mark, measured to fit beside the pill.
- Action pill: **Search**, **Filter threads by project** (combobox), **New thread**.
- Footer: **Settings**, **Pull Requests**, **Usage**.
- **Toggle main sidebar** stays at the far left of the titlebar.

## How to get to it (user POV)

It is the top row of the sidebar on every chat route.

## Driving it with the Browser panel

```
preview_click  role=button[name='Search']               # opens the command palette
preview_click  role=combobox[name='Filter threads by project']
preview_click  role=button[name='New thread']           # navigates to /draft/<id>
preview_click  role=link[name='Go to threads']
```

**Proof:** each action's result (palette open, project filter list, a new
`/draft/` URL), plus a saved screenshot of the row. The glass and the artwork
are visual-only. Check the wordmark is not clipped at the default sidebar width,
and again after dragging `Resize Sidebar` narrower.

## Gotchas

- The order inside the pill is a design decision still open (search, projects,
  new thread today). Assert presence, not order, unless the change is about order.
- Upstream reworks `Sidebar.tsx` often. After a sync, check that all three
  actions still exist with these names.
