# Wikis

Astrolabe's second section, beside the threads: folders of linked markdown notes
kept in git, edited through change requests. Its rail item swaps the sidebar for
the Wikis sidebar, built from the thread list's parts, and fills the main area
with Obsidian-style tabs and splits over documents (the same panes as the right
panel, see [panes.md](panes.md)). User guide: `docs/user/wikis.md`.

## Sub-features

- **Sidebar**: heading **Wikis** with **Search documents**, **Filter documents by wiki**
  (combobox: All wikis, each wiki with a settings gear, **Add a folder**, **New
  wiki**) and **New document**. Rows are thread-style cards
  (`[data-testid=wiki-sidebar-row]`): "Open changes · N", documents newest first
  (wiki, edited time, name, links or the open change it is in), then a folded
  "Merged and closed · N" shelf. The row of the focused tab's document is
  `aria-current="page"`. Search filters the rows in place.
- **Main area**: one arrangement on the device (localStorage
  `astrolabe:wiki-panes:v1`). Clicking a row opens or brings forward its tab;
  Mod-click opens it in a new pane to the right. A pane's `+` opens an empty tab
  with one button, **Find or create a document** (the finder lists matches and
  offers Write "…" for a new name). Mod-click on a wikilink follows it in the
  same tab. Clicking inside a pane focuses it.
- **Change requests** open as tabs (Merge, Close/Reopen, amendments with Revert,
  files that open inside the change request).
- **Deep links**: `/wikis/<wikiId>?environmentId=…&note=…` (the Graph tab's) open
  that document as a tab.
- Narrow windows: the sheet sidebar holds the Wikis list, and its footer offers
  Threads as the way back. Splits stay at every width.

## How to get to it (user POV)

The book icon in the icon rail, or "Open wikis" in the command palette. A wiki
must be registered first (the filter's **Add a folder**).

## Driving it with the Browser panel

```
preview_click     role=navigation[name='Sections'] >> role=button[name='Wikis']
preview_click     role=button[name='<document>, <wiki>']        # opens a tab
preview_evaluate  dispatch a click with metaKey on a row         # opens beside
preview_evaluate  dispatch mousedown with metaKey on [data-wikilink='<Note>']
preview_click     role=combobox[name='Filter documents by wiki']
preview_click     role=button[name='Find or create a document']  # in an empty tab
```

**Proof:** read the arrangement from the DOM
(`[data-pane-id]` → its `[data-pane-tab]` labels, `aria-selected`), and the lit row
(`[data-testid=wiki-sidebar-row][aria-current=page]`); `location.reload()` keeps the
arrangement. Save a screenshot of the section.

## Gotchas

- A fixture wiki needs a git repository; register one under the worktree's `.t3`
  (for example a clone of the almagest vault) with **Add a folder**.
- Hot-reloading across a deleted route component can wedge the preview tab
  (evaluate times out). Open a fresh tab.
- Screenshots of a tab the user is not viewing can come back soft; set a freeform
  viewport with `preview_resize` before capturing.

## Owns

`apps/web/src/components/wiki/`, `routes/_chat.wikis*.tsx`, `components/sidebar/SidebarCard.tsx`,
`panes/panesHost.ts`, `panes/rightPanelPaneTabs.tsx`, the Wikis branches in
`AppSidebarLayout.tsx` and `sidebar/mainAppLocation.ts`.
