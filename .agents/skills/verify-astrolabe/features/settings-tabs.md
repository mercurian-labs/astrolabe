# Settings tabs

The settings pages you visit open as tabs across the top of the settings screen,
working as the chat tabs do. The page on screen is the tab in front. The strip
is the title bar there, and the `Settings / <page>` breadcrumb sits in the row
below it.

## Sub-features

- **Open**: visiting a settings page (sidebar nav, search, a link, the rail's
  Settings, the keyboard menu's `,` or `g s`) adds its tab at the end, unless it
  is already open, in which case that tab comes to the front where it is. The
  rail opens `/settings`, which redirects to General.
- **Switch**: clicking a tab shows its page, replacing the history entry as the
  sidebar nav does.
- **Close**: the ✕ on hover or keyboard focus, or a middle-click. Closing the tab
  in front shows the tab after it, else the one before. Closing the last one goes
  to the last threads URL the app recorded (Wikis, Usage, Pull Requests and
  Settings URLs are never recorded), else `/`.
- **Switch** drops the URL's hash, so a search deep link's `#target` is lost.
- **Reorder**: dragging, as on the chat strip.
- **Persistence**: `localStorage['t3code:settings-tabs:v1']`, zustand's wrapper:
  `JSON.parse(…).state.keys` is the list of page paths.

## How to get to it (user POV)

Press **Settings** on the icon rail, then open other pages from the settings
sidebar.

## Driving it with the Browser panel

```
preview_click  [data-app-rail] >> role=button[name='Settings']
preview_wait_for  locator=role=tablist[name='Open settings']
preview_click  [data-slot=sidebar-container] >> role=button[name=/^Providers/]
preview_click  [data-tab-strip=settings] >> role=tab[name='General']
preview_click  [data-tab-strip=settings] >> role=button[name='Close General']
```

Read the strip:
`[...document.querySelectorAll('[data-tab-strip=settings] [data-tab]')].map(t => t.getAttribute('aria-label') + (t.getAttribute('aria-selected') === 'true' ? '*' : ''))`.

**Proof:** the strip read and `location.pathname` agree on the tab in front.
Open a chat before Settings; after closing every tab the URL is that chat again,
`[data-tab-strip=settings]` is gone, and `state.keys` is `[]`.

## Gotchas

- The strip and its tabs are the shared `titlebarTabs/` components. A change
  there shows on both strips, so walk chat-tabs.md too.
- Only pages with a breadcrumb label get a tab, which is every settings page.
