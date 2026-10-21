# Wikis

Astrolabe's second section, beside the threads: folders of linked markdown notes
kept in git, edited through change requests. Its rail item swaps the sidebar for
the Wikis sidebar, built from the thread list's parts, and fills the main area
with Obsidian-style tabs and splits over documents (the same panes as the right
panel, see [panes.md](panes.md)). User guide: `docs/user/wikis.md`.

## Sub-features

- **Sidebar**: heading **Wikis** with **Search documents**, **Filter documents by wiki**
  (combobox, named `Filter documents by wiki: <wiki>` once one is picked, kept in
  `astrolabe:wiki-scope:v1`: All wikis, each wiki with a settings gear, **Add a
  folder**, **New wiki**) and **New document**. With no wikis, the sidebar's empty
  state has its own **Add a folder** and **New wiki**. Rows are thread-style cards
  (`[data-testid=wiki-sidebar-row]`): "Open changes · N", documents newest first
  (wiki, edited time, name, links or the open change it is in), then a folded
  "Merged and closed · N" shelf. The row of the focused tab's document is
  `aria-current="page"`. Search shows `listbox "Document search results"`, whose
  rows are `option`s (not buttons), or "No documents found".
- **Main area**: one arrangement on the device (localStorage
  `astrolabe:wiki-panes:v1`). Clicking a row opens or brings forward its tab;
  Mod-click (Cmd on macOS, Ctrl elsewhere) opens it in a new pane to the right; a
  document already open moves there instead (nothing happens when it is the focused
  pane's only tab). A pane's `+` opens an empty tab
  with one button, **Find or create a document** (only once a wiki exists; the
  finder lists documents and open changes, and offers Write "…" for a new name).
  Mod-click on a wikilink follows it in the same tab, unless the target is open in
  another tab (that one comes forward) or the note has unsaved edits (it opens in a
  new tab). Clicking inside a pane focuses it.
- **Vim**: with Vim keybindings on, notes edit with Vim and `:w` opens Save to change
  request (vim-mode.md). The keyboard menu's `w` group opens Wikis and the finder,
  and `:e <name>` in the Command Palette opens a document.
- **Search**: the Search palette (Cmd+K twice) finds every wiki's documents from
  anywhere in a Documents group; a pick opens it as a tab in the focused pane (or
  brings an open copy forward) and goes to `/wikis`.
- **Change requests** open as tabs (Merge, Close/Reopen, amendments with Revert,
  files that open inside the change request).
- **Deep links**: `/wikis/<wikiId>?environmentId=…&note=…` (the Graph tab's) open
  that document as a tab; `changeRequest=…` alone opens the change request, and
  with `note=` reads the note inside it.
- Narrow windows: the sheet sidebar holds the Wikis list, and its footer offers
  Threads as the way back. Splits stay at every width.

## How to get to it (user POV)

The book icon in the icon rail, the keyboard menu's `w w` or `g w`, or a document
from Search. ("Open wikis" is an action: in the Command Palette, or `>open wikis`
in Search.) A wiki
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

- A fixture wiki needs a git repository at its top level, with a branch checked
  out and at least one commit; only top-level `*.md` files count (never README,
  AGENTS, CLAUDE). Clone one (for example the almagest vault) anywhere the server
  can read, such as `<home>/wiki-fixtures/`, and register it: **Add a folder** →
  dialog `Add a folder`, `textbox "Folder"` (absolute path) → **Add wiki**. It also
  adds a project of the same name. **New wiki** makes a repo with only README, so
  it lists no documents.
- The settings gear in the filter is `aria-hidden`; reach it by
  `[title="Settings for <wiki>"]`.
- `data-wikilink` holds the raw target (with any `#Heading`).
- Hot-reloading across a deleted route component can wedge the preview tab
  (evaluate times out). Open a fresh tab.
- Screenshots of a tab the user is not viewing can come back soft; set a freeform
  viewport with `preview_resize` before capturing.

## Owns

`apps/web/src/components/wiki/`, `routes/_chat.wikis*.tsx`, `components/sidebar/SidebarCard.tsx`,
`panes/panesHost.ts`, `panes/rightPanelPaneTabs.tsx`, the Wikis branches in
`AppSidebarLayout.tsx` and `sidebar/mainAppLocation.ts`.
