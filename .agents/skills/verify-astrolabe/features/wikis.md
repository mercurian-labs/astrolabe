# Wikis

Astrolabe's second section, beside the threads: folders of linked markdown notes
kept in git, edited through change requests. Its rail item swaps the sidebar for
the Wikis sidebar, built from the thread list's parts, and fills the main area
with Obsidian-style tabs and splits over documents (the one shared workspace, see
[panes.md](panes.md)). User guide: `docs/user/wikis.md`.

## Sub-features

- **Sidebar**: heading **Wikis** with **Search documents**, **Filter documents** and **New
  document**. The filter (`wiki/wikiFilter.ts`, the menu and pills in `WikiSidebar.tsx`) is a
  multi-select `role=combobox` named `Filter documents`, or `Filter documents (filtered)` with
  a dot. Its popup (`Search filters`) has a **Status** group, **Has changes** with its count
  (documents an open change request touches), and a **Wikis** group: All wikis, each wiki
  with a settings gear; then **Add a wiki**, which opens the palette's add-wiki flow. Rows are checkboxes and picking
  keeps it open; with no wiki picked every wiki shows ticked, unticking one keeps the rest,
  and ticking every one or unticking the last is All wikis. Kept in
  `astrolabe:wiki-filter:v1` as `{wikis, changed}` (the old `astrolabe:wiki-scope:v1` is
  not read). Pills (`[aria-label='Document filters']`): **Has changes** one tap
  (`aria-pressed`) while on or any document has changes, one for the picked wikis (× is
  `Remove filter: <names>`), and **Clear** with both. An empty list reads "No documents
  match these filters". A wiki just added shows alone, unless it is the first. The document in
  front stays listed while the filter hides it (opened from a link, Search or another section,
  or the filter changed under it), its row marked **hidden**; the filter never clears for it.
  With no wikis, the sidebar's empty state reads "No wikis yet" with its own **Add a wiki**.
  Change requests moved to Changes
  (pull-requests.md): with any open, a first row **Open changes · N →** sets the
  kind and that section's wiki to the Wikis filter's wiki when it picks exactly one (else
  every wiki) and goes there. Documents (newest first) use the settled threads'
  slim row (`[data-testid=wiki-sidebar-row-slim]`: dimmed wiki icon, name, a pen icon
  when an open change holds the document, time). Hovering a row opens the threads' hover
  card: wiki, machine, links and the open changes holding it. A wiki change request
  opened here (the finder, a deep link) is a foreign tab offering **Open in Changes**.
  The row of the focused tab's document is `aria-current="page"`. Search shows
  `listbox "Document search results"`, whose rows are `option`s (not buttons), or
  "No documents found".
- **Worktrees** (with a wiki picked, or the only wiki): `combobox "Work on a change request in a worktree"`
  beside the filter lists open change requests; a pick puts its branch `cr/<id>` in a
  worktree (as Projects does: its own, a free one, or a new `t3-<8 hex>`), and
  a typed title offers "New change request “<title>” in a worktree". There is no list or
  tree mode: outside search the sidebar is each shown wiki's worktrees (`WikiWorktreeSections`;
  with several wikis each under `button "<wiki>"` with its icon, open by default), as Projects
  lists a repository's: main under the wiki's main branch, a change request's under its title.
  Each header has Projects' toggle, `button "Show its files"` / `"Show its documents"`
  (`astrolabe:wiki-worktree-files:v1`, documents by default). Main's documents are the old list
  (**Open changes · N**, then the notes the filter keeps); a change request's are the `.md` and
  `.base` files its amendments touch, rows named `<note>, in <change request>` opening inside
  it. Files show a `FileBrowserPanel`. The main line and the focused tab's worktree open on
  their own. They fold as Projects'
  do (`worktreeFolding.ts`, `FoldedWorktrees`): idle ones under `button "N more worktrees"` with
  `textbox "Find among <wiki>'s other worktrees"`. The filter nests each wiki's worktrees under
  it (`button "Show <wiki>'s worktrees"`, folded by default); unticking one hides it from the
  sidebar (`astrolabe:wiki-filter:v1` `hidden`, pill `Hiding <titles>`), the focused tab's
  worktree staying, marked. A note or change request tab in a change request with a worktree
  shows its number before its ✕; opening such a note numbers the worktree
  (`useNumberWhenOpened`). A top-level `.md`
  clicked in a tree, on the main line or a `cr/` branch, opens as
  `wiki-note:<env>:<wiki>:<change request id or empty>:<name>`; README, AGENTS, CLAUDE,
  `*.skillmap.md`, nested `.md`, any `.md` on another branch, and every other file open as
  `wiki-file:` file tabs; tree rows open on a plain click only (no middle-click
  or modifiers). A change request worktree's menu adds **Save edits to the change
  request** while it has uncommitted files (`wiki.saveWorktree`, one amendment, worktree left
  clean; refused with "No document in this worktree has unsaved changes." when only non-note
  files changed). The main worktree has no menu. An amendment landing on a change request moves its worktree's files, and is
  refused, naming the files, when they overlap unsaved edits there. The worktree calls name the wiki (`worktrees.*` with `wikiId`, read in the wiki's own
  folder), so a wiki needs no project; a non-note file opens as `wiki-file:<env>:<wiki>:…`
  (no local graph button, never in a change group).
- **Main area**: the shared panes (panes.md; localStorage `astrolabe:workspace:v1`). A plain click on a row (or Enter on a focused row)
  replaces what the focused pane's tab in front shows, whatever it is (a file or a pull
  request too); a document already open in another tab comes forward there instead (no
  duplicates); an empty tab is filled, and a chat, a chat's linked tab or a tab with unsaved
  edits makes way for a new tab. Option/Alt-click, middle-click, the
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
  `astrolabe:workspace-tab-history:v1`, shared with every section, keyed by the tab key it shows now, last 50 each
  way). Clicks, Search, `:e`, deep links and followed wikilinks push onto it and clear
  its forward history; saving a note into a change request keeps it. The note header's
  **Back**/**Forward** walk that tab, and `mod+[`/`mod+]` and Space `t h`/`t l` walk
  the focused pane's tab in front (the arrows faint at either end); a step to a document open in
  another tab brings that tab forward, and with unsaved edits it opens in a new tab.
- **Pane header**: a note's header (Main or the change request, muted / the note's
  name, as a chat's breadcrumb; then quiet status and its buttons) is one line as tall as the tab strip, with no bottom border; the strip's
  joined tab in front (panes.md) reads continuous with it. A pane's `+` opens a New tab
  (panes.md) whose **Document** (`O`, faint until a wiki exists) opens the finder; it
  lists documents and open changes, offers Write "…" for a new name, and the pick takes
  the New tab's place.
  Mod-click on a wikilink follows it in the same tab, unless the target is open in
  another tab (that one comes forward) or the note has unsaved edits (it opens in a
  new tab). Clicking inside a pane focuses it.
- **Drafts**: nothing in a document saves by hand. The first edit on main starts one draft per
  wiki (`wiki.autosave` with no `changeRequestId`), and main's folder doesn't change. The tab key
  stays on main: a document reads from the draft once the draft holds it
  (`wikiDocumentScope`), with no remount, so the caret stays put. The header's `Main` becomes a
  pill, `Draft · N documents`, on every document of that wiki; its menu has Open draft, Make it a
  change request… (title prefilled `Edit <document>`), Move to another one… (target and document
  checkboxes; a target whose agent is mid-turn is disabled), and Discard… (a confirm). The Wikis
  sidebar gets a `Draft · N documents` row above Open changes, which doesn't count it; Changes gets
  **Your drafts** above Wiki changes, and a discarded one sits on Merged and closed as "discarded
  draft" with **Reopen draft**. The draft's tab offers the three ways out in place of Close and
  Merge. **Wiki: Open your draft** in the palette opens it. Status text after the title: `Saving…`,
  `Saved`, `Not saved`, `Saves when the turn ends`, `Saves once this runs` (a base whose edit can't
  run). A failed save shows an alert with **Try again** and keeps trying; only then does leaving
  ask. A document in a merged or closed change request is read only.
- **Vim**: with Vim keybindings on, notes edit with Vim and `:w` saves now
  (vim-mode.md). The keyboard menu's `w` group opens Wikis and the finder,
  and `:e <name>` in the Command Palette opens a document.
- **Find and symbols**: in a note Cmd+F opens CodeMirror's find bar (`.cm-search`, focus in
  `input[name=search]`, a replace row; Cmd+Enter replaces all), read-only notes too, and
  Cmd+Shift+O opens `[aria-label="Go to symbol"]` listing the note's headings. Outside an
  editor Cmd+F finds in the thread and Cmd+Shift+O is a new thread.
- **Search**: the Search palette (Cmd+K twice) finds every wiki's documents from
  anywhere in a Documents group; a pick shows it in the focused pane's tab in front,
  as a click does (or brings an open copy forward), and goes to `/wikis`.
- **Chats and pull requests beside documents**: a change request's **Open thread** opens
  its thread's chat in a new tab after the chat in front and brings it forward
  (`chat:<env>:<thread>` tab), as a sidebar click does. See panes.md, "Chats as tabs".
- **Change requests** open as tabs with the shared tab header
  (`nav[aria-label='Change request breadcrumb']`: the wiki, muted / the title; the state as
  quiet status; **Open thread**, **Close change request** / **Reopen change request** and
  **Merge**), then who opened it, amendments with Revert, and files that open inside the
  change request.
- **Deep links**: `/wikis/<wikiId>?environmentId=…&note=…` show
  that document in the tab in front, as a click does; `changeRequest=…` alone opens the change request, and
  with `note=` reads the note inside it.
- **Linked projects** (`wiki/wikiLinkStep.tsx`, `wiki/WikiLinks.tsx`): a wiki is not
  a project. Adding a wiki or a project in the palette ends on a link step, a group headed
  "Link <wiki> to the project it plans" or "Link <project> to a wiki, where its research and
  plans live", with the candidates and **Not now** ("Link it later in its settings"). The
  step shows only with source-control write access and something on the same server to link
  to; otherwise the palette closes. Links change on a wiki's page in Settings → Wikis
  (`/settings/wikis?wiki=<environmentId>:<wikiId>`, the filter's gear opens it) and in
  Settings → a project's **Wikis** section (**Add a wiki** when its servers have no wikis).
  Both are lists with **Unlink** and a searchable **Link a project** or **Link a wiki** picker,
  and a chat in a linked project shows a chip per wiki in its header, hidden below `sm`.
- **Agent note**: the first prompt of every new native conversation in a linked project,
  including after a provider restart or handoff, gets an `<astrolabe_wikis>` note naming the
  wikis and the `astrolabe_wiki_*` tools (`WikiService.agentNote`,
  `ProviderTurnStartService.ts`); a conversation with turns gets it on its next prompt for wikis
  linked since its last one (links with no `projectLinkedAt` time never do); a prompt that
  starts with `/` never does and doesn't count as its last. Only the provider
  sees it, not the user's bubble. Prove it with a real turn that never names the wiki. The
  host T3 instance you drive from still has its own `t3_wiki_*` tools; don't mix them up.
- **`[[` in the composer** (web only; `composer-logic.ts` `detectWikiNoteTrigger`,
  `chat/composerWikiNoteItems.ts`): opens `listbox "Wiki notes"` with this server's notes,
  linked wikis first, at most 20; `[[ ` (space), no wikis, no match or a pending question
  keep it shut. Enter or a click inserts a chip, `button "Wiki note, <note> in <wiki>"`
  (`WikiNoteContextChip.tsx`), without sending. In a project with no linked wiki, an empty
  query also lists "Link <wiki> to <project>" rows ("So agents here know where its plans
  live"), which link instead of inserting. A sent chip opens the note as its own tab beside
  the focused pane, or brings an open one forward (outside the panes, `/wikis/<id>?note=`); on the phone it is an inline link named after
  the note that opens `WikiDocument` (`ThreadFeed.tsx`).
- Narrow windows: the sheet sidebar holds the Wikis list, and its footer offers
  Agents as the way back. Splits stay at every width.
- **Canvases** (`wiki/WikiCanvasView.tsx`, the board in `packages/wiki-editor/src/CanvasBoard.tsx`,
  the format in `packages/wiki/src/canvas.ts`): a `.canvas` is a document named by its file, with a
  `Waypoints` icon in the sidebar and Finder. Its tab reads as **Canvas**, **Read only**. Walk: fit
  on open; `Zoom in`, `Reset zoom`, `Fit the board in view`, `Zoom out`; ⇧1 and ⇧2; below 0.3 text
  cards become a lines glyph; a first click selects (`data-selected`) and only then is content
  live (`data-live`). `[data-card-id]` counts what's mounted, and it must follow the view. Every
  card kind: text with Mermaid and math, note with `subpath`, image, PDF, audio, video, base with a
  pinned view, nested canvas as a minimap, missing file, link (selecting mounts an iframe), code
  with a staleness mark. **Jump to group** in the tab and the palette. New canvas: type a name in
  the Finder, pick **New canvas**, **Create canvas** lands it in the draft with no dialog. `![[Board.canvas]]`
  in a note draws a thumbnail that opens it; Mermaid draws in ordinary notes. Invalid JSON shows the
  error and its raw text. A change landing on the canvas refreshes it with the camera where it was.
- **Agents on a canvas** (`packages/wiki/src/canvasEdits.ts`, `canvasPlace.ts`, the transform in
  `WikiService.transform`): ask an agent to add to a canvas with the board open in its change
  request. It calls `astrolabe_wiki_transform` with kind `canvas`, no coordinates; `astrolabe_wiki_amend`
  refuses and names the transform. No existing card moves, unless a group had to grow, and its
  cards stay. The camera stays; each changed card highlights once (`.cv-flash`, gone after about a
  second, nothing repainting at rest), then keeps its mark until the change request is merged or
  closed. On main there are no marks. The tool row's **Open canvas** opens the board in that change
  request. Search by card text returns `cards`, not line numbers.
- **Bases** (`wiki/WikiBaseView.tsx`; engine `packages/wiki/src/bases.ts`, server
  `WikiService.query` / `wiki.query`, agents `astrolabe_wiki_query`): a `.base` file lists as a
  document named `<name>.base` (no links line in its hover card) and opens as a tab labelled
  `<name>` (no `.base`) with its view (table or cards; a `View` select when it has several). Its
  header's breadcrumb, `nav[aria-label='Base breadcrumb']`, reads `Main / <name>` (`<change request
  title> / <name>` when read from one), with "Base · read only" as its status. A
  ` ```base ` block in a note shows the same view in place (`.cm-md-host-block`, via the
  editor's `codeBlocks` option) and its YAML once the caret is in it. Row names and `[[links]]`
  in cells open notes: in a base's own tab the note replaces it (Back returns); a view with no name column gets a "Name" column. A base outside the
  supported subset shows "This base can't be shown" naming the unsupported part. On the phone,
  the page asks the app for each block (`queryBase`/`baseResult` in `wiki-editor/protocol.ts`)
  and draws its first view. A `.base` file lists on the phone too, `button "<name>.base, <wiki>"`
  with a table icon and "Base · read only" under it, and opens in `WikiDocument` (the same
  route; `WikiBaseScreen.tsx`) titled `<name>`, subtitle `<wiki> · Main · Base · read only`. The
  page draws only the base (`showBase` in `protocol.ts`, the same `BaseBlock`); a `View` header
  menu (iOS only, as every header button) appears with two or more views and ticks the one shown.
  A row's name opens its note on top; Back returns to the base.
- **Canvas review** (`wiki/WikiCanvasReview.tsx`, the logic in `packages/wiki/src/canvas.ts` and
  `canvasMerge.ts`, the pass in `WikiService.mergeTrees`): seed a change request and main with
  worktree edits to one `.canvas`. A changed canvas shows a board with marks and a change list, not
  a JSON diff; **JSON** swaps to the diff and back. Check each mark (Added, Removed, Text, Moved,
  Style), including on an arrow, in dark mode and the Mercurian theme. A row focuses and selects
  its card; a removed card under a new one comes up on top. Moves are folded. The wheel scrolls the
  page until the board is clicked. Merge: adjacent cards merge clean; an arrow onto a card main
  deleted shows under **Merging decides these** and is gone from main afterwards; a card edited
  here and deleted there is a conflict naming the card, whose advice says worktree, not amend;
  saving the worktree to agree with main clears it. Revert an amendment that later work drew an
  arrow on: a toast says the arrow was dropped. Invalid JSON on a side is a conflict and the file is
  left as it was.
- **Canvas review on the phone** (`WikiCanvasReviewRouteScreen.tsx`, `WikiCanvasChanges.tsx`): the
  change request's row shows a count such as `2 added, 1 moved`, and a deleted canvas's row opens
  too. It opens the board with marks and the list below; a row selects its card. A conflict says it
  can't be settled from the phone, and the notes show under the merge card.
- **Canvases on the phone** (`WikiCanvasScreen.tsx`, the page's `mobileCanvas.tsx`): an agent's
  change shows in the feed as a row, `Changed the canvas <name>`, that opens it in the change
  request, with the same marks and one highlight per commit. A `.canvas`
  lists as `button "<name>, canvas, <wiki>"` with "Canvas · read only", and opens in `WikiDocument`
  from the list, a change request's documents, links in notes and a base's rows, subtitle
  `<wiki> · Main · Canvas · read only`, with a `Jump to group` header menu when it has labelled
  groups. Walk: touch pan, pinch, left-edge back swipe, first tap selects and a second acts (a link,
  a code card, a file card's name; Back returns to the board with its camera). File cards read in
  batches at the commit shown (`readFiles`/`filesRead`, split at 256 KB a message). Images, audio and
  video load from a commit-scoped asset URL (`readAsset`/`assetRead`); a PDF, and media WebKit
  can't play, shows its name and **Open**, the app's viewer. Check repository images on a plain-http
  server (the page's origin must stay `http://localhost/`: on https WebKit upgrades them and they
  fail). Base cards, nested canvases as minimaps, `![[Board.canvas]]` in a note, Mermaid on cards and
  in notes (each diagram type injected the first time it draws, `peleOnDemand.ts`). Android is
  the same code and needs its own walk.
- **Mobile** (iPhone; iPad drops the tab, `workspace-tabs-state.ts`): a Wikis tab
  (`apps/mobile/src/features/wikis/WikisScreen.tsx`) with its search `Search wikis` and a
  `Filter by wiki` menu (All wikis, each wiki). With any open, the first row reads "Open
  changes · N" but is named `button "N open changes"` ("1 open change"); it narrows Change
  requests to wikis and this filter's wiki, then switches there. Documents follow as
  `button "<doc>, <wiki>"`. A document (route `WikiDocument`) is the wiki editor in a web
  view; its header has `Edit the document`/`Stop editing` (iOS exposes them as `button "Edit"`/`"Done"`;
  not on read-only skill maps), and
  there is no Save: the subtitle reads `Saving…` then `Saved`, or `saves when the turn ends`
  while an agent works. With a draft a bar in place of Main (`Draft · N documents`) opens the "Your
  draft" sheet: `Change request title` and Make it a change request, Move with its documents, and
  Discard. A
  change request (route `WikiChangeRequest`, from the Changes tab) has `Change
  request actions` (on iOS the ⋯ button is named after the change request; Merge into main,
  Close/Reopen, and Open thread when it has one; a draft's offers the sheet instead of Merge and Close), "Amendments (N)" with
  `Revert <subject>` while open, and "Documents changed (N)". Adding a wiki or a document
  stays on the computer. Walk it on an iPhone with test-t3-mobile.

## How to get to it (user POV)

The book icon in the icon rail, the keyboard menu's `w w` or `g w`, or a document
from Search. ("Open wikis" is an action: in the Command Palette, or `>open wikis`
in Search.) A wiki
must be registered first (the filter's **Add a wiki**, or the palette's **Add wiki**). A
clean or seeded home may have none: before walking, add one with the palette's **Add wiki** →
**Local folder** and the path to a git repository with top-level `*.md` files (Gotchas).

## Driving it with the Browser panel

```
preview_act click     role=navigation[name='Sections'] >> role=button[name='Wikis']
preview_act click     role=button[name='<document>, <wiki>']        # replaces the tab in front
preview_evaluate  dispatch a click with altKey on a row          # new tab
preview_evaluate  dispatch a click with metaKey on a row         # selects it (data-selected), opens nothing
preview_act click     [data-focused="true"] >> role=button[name='Back']   # the focused tab's history
preview_evaluate  dispatch mousedown with metaKey on [data-wikilink='<Note>']
preview_act click     role=combobox[name=/^Filter documents/]   # rows: role=option; click a
                                                                # wiki row by its measured x,y,
                                                                # its name carries the icon text
preview_act click     [aria-label='Open a tab'] >> role=button[name=/^Document/]  # in a New tab
```

**Proof:** read the arrangement from the DOM
(`[data-pane-id]` → its `[data-pane-tab]` labels, `aria-selected`) or from
`JSON.parse(localStorage['astrolabe:workspace:v1'])` (written within 150 ms; absent while
the arrangement is the starting one), and the lit row
(`[data-testid^=wiki-sidebar-row][aria-current=page]`). A change group's tabs here (its wiki
change requests, its threads' chats, its pull requests, and the `change-group:` tab a click on
the marker opens) sit behind a `[data-tab-group]` marker; while the group is collapsed (its
`aria-label` ends `, collapsed`) only its front tab has a `[data-pane-tab]`, so expand it from
the marker's right-click menu before counting. Prove it paints: `document.elementFromPoint` at the
centre of the front note's title returns it: headers have no `h2`, so take
`nav[aria-label="Document breadcrumb"] [aria-current="page"]` (a change request's is
`Change request breadcrumb`, a base's `Base breadcrumb`) in `[data-pane-id][data-focused]` with a non-zero rect (tabs
behind it are `display: none`), and at the lit row's centre
returns a node whose `closest('[data-testid=wiki-sidebar-row-slim]')` is the row.
`location.reload()` keeps the arrangement and the histories
(`JSON.parse(localStorage['astrolabe:workspace-tab-history:v1'])`) and expands every group. Save
a screenshot of the section.

### Walk drafts

1. Open a note on main and type. Within about two seconds the header reads Saved, `Main` is the
   pill `Draft · 1 document`, the caret hasn't moved, and `git -C <wiki> log main` is unchanged.
2. Keep typing over a few pauses, then open the draft: one amendment. Edit a second note, and
   the pill reads 2 documents, with two amendments; a third note on main still shows main's text.
3. Reload. The pill and your text are still there.
4. In a base, edit a cell, then rename a view. No Save anywhere; a board's card moves and stays.
   New canvas's **Create canvas** adds to the draft.
5. Stop the dev server mid-typing (by its tracked PID), keep typing: `Not saved`, the alert, and it
   lands by itself after restart. Leaving while it shows asks first.
6. Make it a change request: the tab stays on the note, now inside it; the next edit on main starts
   a new draft. Move one of two documents into an open change request. Discard, then reopen from
   Merged and closed. Reopen with a newer draft open: refused, saying why.
7. Merge something else to main that clashes: the draft's tab and the pill's menu say so, and it
   still saves.
8. In an agent's change request mid-turn: `Saves when the turn ends`, and it lands when it ends.
9. Two clients on one note: each one's text lands in the other, attributed "You, elsewhere", and
   neither is overwritten.
10. Phone: the same, from Edit; no Save, the bar opens the sheet, and backgrounding the app saves.

## Gotchas

- A fixture wiki needs a git repository at its top level, with a branch checked
  out and at least one commit; only top-level `*.md` files count (never README,
  AGENTS, CLAUDE). Clone one (for example the almagest vault) anywhere the server
  can read, such as `<home>/wiki-fixtures/`, and register it: the palette's **Add wiki** (or
  the filter's **Add a wiki**) → **Local folder** → type the absolute path, Enter. No project
  is made; the palette then offers the link step (pick a project or **Not now**). **New wiki**
  makes a repo with only README, so it lists no documents.
- Wikis registered before wikis stopped being projects load with `projectIds: []`; the
  `wiki-<id>` projects older builds made stay behind as ordinary projects.
- The settings gear in the filter is `aria-hidden`; reach it by
  `[title="Settings for <wiki>"]`.
- `data-wikilink` holds the raw target (with any `#Heading`).
- A click on a numbered change request worktree's header by role (`role=button[name='1 …']`)
  may time out; click it by its measured centre instead.
- Hot-reloading across a deleted route component can wedge the preview tab
  (evaluate times out). Open a fresh tab.
- Screenshots of a tab the user is not viewing can come back soft; set a freeform
  viewport with `preview_resize` before capturing.

## Owns

`apps/web/src/components/wiki/`, `routes/_chat.wikis*.tsx`, `components/sidebar/SidebarCard.tsx`,
`panes/panesHost.ts`,
`panes/workspaceTabs.tsx`, `apps/web/src/tabNavigation.logic.ts` (`rowClickIntent`,
`NEW_TAB_CLICK`, the tab-history ops; shared with Agents, chat tabs, Projects and
Changes), `wiki/wikiFilter.ts` and `components/projects/storedChoice.ts` (behind
`astrolabe:wiki-filter:v1`; storedChoice is shared with Projects and the Agents filter),
`projects/ThreadsFilterParts.tsx` (the pills, shared with Agents), the Wikis branches in `AppSidebarLayout.tsx` and
`sidebar/mainAppLocation.ts`, and `apps/mobile/src/features/wikis/` (the iPhone Wikis tab;
`WikiChangesSection.tsx` is pull-requests.md's). Linking and the agent note: `wikiLinkStep.tsx`
and the palette's link step in `CommandPalette.tsx`, the Wikis section in
`settings/ProjectSettingsPanel.tsx`, server `wiki/WikiService.ts` and
`orchestration-v2/ProviderTurnStartService.ts`. Settings → Wikis:
`settings/WikisSettings.tsx`, `routes/_chat.settings.wikis.tsx`. The chat header's chips:
`wiki/LinkedWikiChips.tsx`. `[[`: `composer-logic.ts`
(`detectWikiNoteTrigger`), `chat/composerWikiNoteItems.ts`, `WikiNoteContextChip.tsx`, and
mobile `features/threads/ThreadFeed.tsx` (the sent chip). Bases: `wiki/WikiBaseView.tsx`,
`packages/wiki/src/bases.ts`, `baseExpression.ts` and `properties.ts`,
`packages/wiki-editor/src/BaseBlock.tsx` and `baseCells.ts`, server `wiki/wikiViews.ts` and
`mcp/toolkits/wiki/` (`astrolabe_wiki_query`).
