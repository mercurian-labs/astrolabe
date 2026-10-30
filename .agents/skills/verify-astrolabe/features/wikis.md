# Wikis

Astrolabe's second section, beside the threads: folders of linked markdown notes
kept in git, edited through change requests. Its rail item swaps the sidebar for
the Wikis sidebar, built from the thread list's parts, and fills the main area
with Obsidian-style tabs and splits over documents (the same panes as the right
panel, see [panes.md](panes.md)). User guide: `docs/user/wikis.md`.

## Sub-features

- **Sidebar**: heading **Wikis** with **Search documents**, **Filter documents** and **New
  document**. The filter (`wiki/wikiFilter.ts`, the menu and pills in `WikiSidebar.tsx`) is a
  multi-select `role=combobox` named `Filter documents`, or `Filter documents (filtered)` with
  a dot. Its popup (`Search filters`) has a **Status** group, **Has changes** with its count
  (documents an open change request touches), and a **Wikis** group: All wikis, each wiki
  with a settings gear; then **Add a folder**, **New wiki**. Rows are checkboxes and picking
  keeps it open; with no wiki picked every wiki shows ticked, unticking one keeps the rest,
  and ticking every one or unticking the last is All wikis. Kept in
  `astrolabe:wiki-filter:v1` as `{wikis, changed}` (the old `astrolabe:wiki-scope:v1` is
  not read). Pills (`[aria-label='Document filters']`): **Has changes** one tap
  (`aria-pressed`) while on or any document has changes, one for the picked wikis (× is
  `Remove filter: <names>`), and **Clear** with both. An empty list reads "No documents
  match these filters". A wiki just added shows alone, unless it is the first. Opening a
  document the filter hides (a link, Search, another section) clears the filter; a filter
  changed under the open document, or a reload, keeps it. With no wikis, the sidebar's empty
  state has its own **Add a folder** and **New wiki**. Change requests moved to Changes
  (pull-requests.md): with any open, a first row **Open changes · N →** sets the
  kind and that section's wiki to the Wikis filter's wiki when it picks exactly one (else
  every wiki) and goes there. Documents (newest first) use the settled threads'
  slim row (`[data-testid=wiki-sidebar-row-slim]`: dimmed wiki icon, name, a pen icon
  when an open change holds the document, time). Hovering a row opens the threads' hover
  card: wiki, machine, links and the open changes holding it. A wiki change request
  opened here (the finder, a deep link) is a foreign tab offering **Open in Change
  Requests**.
  The row of the focused tab's document is `aria-current="page"`. Search shows
  `listbox "Document search results"`, whose rows are `option`s (not buttons), or
  "No documents found".
- **Main area**: one arrangement on the device (localStorage
  `astrolabe:wiki-panes:v1`). A plain click on a row (or Enter on a focused row)
  replaces what the focused pane's tab in front shows; a document already open in
  another tab comes forward there instead (no duplicates); an empty tab, or a note
  with unsaved edits, makes way for a new tab. Option/Alt-click, middle-click, the
  row's right-click **Open in new tab**, or Alt+Enter open a new tab after the one in
  front. Mod-click (Cmd on macOS, Ctrl elsewhere) and Shift-click select rows
  (`sidebarRowSelection.ts`, `data-selected` with the selected fill; Escape clears; with a row focused the first
  Escape moves focus to the right (keyboard-nav.md) and a second clears);
  a selected row's right-click is **Open N in new tabs**. Rows are `draggable`: dropped on
  a pane's strip they open at the insertion line, on its content in a new pane
  (`placeWikiTabs` → `placeTabs`), the selection with them. Right-click **Open to the
  right** opens it in a new pane to the right; a document already open moves there
  instead (nothing happens when it is the focused pane's only tab).
- **History**: each tab remembers what it showed (localStorage
  `astrolabe:wiki-tab-history:v1`, keyed by the tab key it shows now, last 50 each
  way). Clicks, Search, `:e`, deep links and followed wikilinks push onto it and clear
  its forward history; saving a note into a change request keeps it. The sidebar
  title-bar row's **Back**/**Forward**, `mod+[`/`mod+]` and Space `t h`/`t l` walk
  the focused pane's tab in front (faint at either end); a step to a document open in
  another tab brings that tab forward, and with unsaved edits it opens in a new tab.
- **Pane header**: a note's header (title · Main or the change request, its
  buttons) is one line as tall as the tab strip, with no bottom border; the strip's
  joined tab in front (panes.md) reads continuous with it. A pane's `+` opens an empty tab
  with one button, **Find or create a document** (only once a wiki exists; the
  finder lists documents and open changes, and offers Write "…" for a new name).
  Mod-click on a wikilink follows it in the same tab, unless the target is open in
  another tab (that one comes forward) or the note has unsaved edits (it opens in a
  new tab). Clicking inside a pane focuses it.
- **Vim**: with Vim keybindings on, notes edit with Vim and `:w` opens Save to change
  request (vim-mode.md). The keyboard menu's `w` group opens Wikis and the finder,
  and `:e <name>` in the Command Palette opens a document.
- **Search**: the Search palette (Cmd+K twice) finds every wiki's documents from
  anywhere in a Documents group; a pick shows it in the focused pane's tab in front,
  as a click does (or brings an open copy forward), and goes to `/wikis`.
- **Chats and pull requests beside documents**: a change request's **Open thread** opens
  its thread's chat in a new pane to the right (`chat:<env>:<thread>` tab, a full
  ChatView without the chat tabs; it mounts only while in front). Its tab menu offers
  **Open in Agents**. See panes.md, "Tabs from other sections".
- **Change requests** open as tabs (Merge, Close/Reopen, amendments with Revert,
  files that open inside the change request).
- **Deep links**: `/wikis/<wikiId>?environmentId=…&note=…` (the Graph tab's) show
  that document in the tab in front, as a click does; `changeRequest=…` alone opens the change request, and
  with `note=` reads the note inside it.
- **Linked repositories** (`wiki/wikiLinkStep.tsx`, `wiki/WikiLinkMenus.tsx`): a wiki is not
  a project. Adding a wiki or a repository in the palette ends on a link step
  ("Link <wiki> to the repository it plans" / "Link <repo> to a wiki…", plus **Not now**);
  links change from the wiki's settings (**Repositories**) and Settings → Projects (**Wikis**).
  A new conversation in a linked repository gets an `<astrolabe_wikis>` note on its first
  prompt (`WikiService.agentNote`); prove it with a real turn that never names the wiki.
- **`[[` in the composer** (`chat/composerWikiNoteItems.ts`): opens notes of this server's
  wikis, linked ones first; `[[ ` (space) and no wikis stay text; an unlinked repository
  gets "Link <wiki> to <repo>" rows while the query is empty. A pick inserts a chip; a
  sent chip opens the note in the right panel.
- Narrow windows: the sheet sidebar holds the Wikis list, and its footer offers
  Agents as the way back. Splits stay at every width.
- **Mobile** (iPhone; iPad drops the tab, `workspace-tabs-state.ts`): a Wikis tab
  (`apps/mobile/src/features/wikis/WikisScreen.tsx`) with its search `Search wikis` and a
  `Filter by wiki` menu (All wikis, each wiki). With any open, the first row reads "Open
  changes · N" but is named `button "N open changes"` ("1 open change"); it narrows Change
  requests to wikis and this filter's wiki, then switches there. Documents follow as
  `button "<doc>, <wiki>"`. A document (route `WikiDocument`) is the wiki editor in a web
  view; its header has `Edit the document`/`Stop editing` (not on read-only skill maps), and
  once edited `Save to a change request` and `Document actions` › Discard edits. Save opens
  the "Save to change request" sheet: New change request or an open one, `Change request
  title`, `What changed`, then Save (`Save when the turn ends` while the agent works). A
  change request (route `WikiChangeRequest`, from the Changes tab) has `Change
  request actions` (Merge into main, Close/Reopen, Open thread), "Amendments (N)" with
  `Revert <subject>` while open, and "Documents changed (N)". Adding a wiki or a document
  stays on the computer. Walk it on an iPhone with test-t3-mobile.

## How to get to it (user POV)

The book icon in the icon rail, the keyboard menu's `w w` or `g w`, or a document
from Search. ("Open wikis" is an action: in the Command Palette, or `>open wikis`
in Search.) A wiki
must be registered first (the filter's **Add a folder**).

## Driving it with the Browser panel

```
preview_act click     role=navigation[name='Sections'] >> role=button[name='Wikis']
preview_act click     role=button[name='<document>, <wiki>']        # replaces the tab in front
preview_evaluate  dispatch a click with altKey on a row          # new tab
preview_evaluate  dispatch a click with metaKey on a row         # selects it (data-selected), opens nothing
preview_act click     [data-tab-history] >> role=button[name='Back']   # the focused tab's history
preview_evaluate  dispatch mousedown with metaKey on [data-wikilink='<Note>']
preview_act click     role=combobox[name=/^Filter documents/]   # rows: role=option; click a
                                                                # wiki row by its measured x,y,
                                                                # its name carries the icon text
preview_act click     role=button[name='Find or create a document']  # in an empty tab
```

**Proof:** read the arrangement from the DOM
(`[data-pane-id]` → its `[data-pane-tab]` labels, `aria-selected`) or from
`JSON.parse(localStorage['astrolabe:wiki-panes:v1'])` (written within 150 ms; absent while
the arrangement is the starting one), and the lit row
(`[data-testid^=wiki-sidebar-row][aria-current=page]`). A change group's tabs here (its wiki
change requests, its threads' chats, its pull requests, and the `change-group:` tab a click on
the marker opens) sit behind a `[data-tab-group]` marker; while the group is collapsed (its
`aria-label` ends `, collapsed`) only its front tab has a `[data-pane-tab]`, so expand it from
the marker's right-click menu before counting. Prove it paints: `document.elementFromPoint` at the
centre of the front note's title (the `h2` in `[data-pane-id][data-focused]` with a non-zero
rect; tabs behind it are `display: none`) returns that `h2`, and at the lit row's centre
returns a node whose `closest('[data-testid=wiki-sidebar-row-slim]')` is the row.
`location.reload()` keeps the arrangement and the histories
(`JSON.parse(localStorage['astrolabe:wiki-tab-history:v1'])`) and expands every group. Save
a screenshot of the section.

## Gotchas

- A fixture wiki needs a git repository at its top level, with a branch checked
  out and at least one commit; only top-level `*.md` files count (never README,
  AGENTS, CLAUDE). Clone one (for example the almagest vault) anywhere the server
  can read, such as `<home>/wiki-fixtures/`, and register it: **Add a folder** →
  dialog `Add a folder`, `textbox "Folder"` (absolute path) → **Add wiki**. No
  project is made; link it to a repository from its settings or the palette's link
  step. **New wiki** makes a repo with only README, so it lists no documents.
- The settings gear in the filter is `aria-hidden`; reach it by
  `[title="Settings for <wiki>"]`.
- `data-wikilink` holds the raw target (with any `#Heading`).
- Hot-reloading across a deleted route component can wedge the preview tab
  (evaluate times out). Open a fresh tab.
- Screenshots of a tab the user is not viewing can come back soft; set a freeform
  viewport with `preview_resize` before capturing.

## Owns

`apps/web/src/components/wiki/`, `routes/_chat.wikis*.tsx`, `components/sidebar/SidebarCard.tsx`,
`components/sidebar/SidebarTabHistory.tsx` (Back/Forward), `panes/panesHost.ts`,
`panes/rightPanelPaneTabs.tsx`, `apps/web/src/tabNavigation.logic.ts` (`rowClickIntent`,
`NEW_TAB_CLICK`, the tab-history ops; shared with Agents, chat tabs, Repositories and
Changes), `wiki/wikiFilter.ts` and `components/projects/storedChoice.ts` (behind
`astrolabe:wiki-filter:v1`; storedChoice is shared with Repositories and the Agents filter),
`projects/ThreadsFilterParts.tsx` (the pills, shared with Agents), the Wikis branches in `AppSidebarLayout.tsx` and
`sidebar/mainAppLocation.ts`, and `apps/mobile/src/features/wikis/` (the iPhone Wikis tab;
`WikiChangesSection.tsx` is pull-requests.md's).
