# Shared tabs, splits and linked tabs

Agents, Wikis, Projects and Changes share one set of panes (`panes/workspace.ts`,
`panes/WorkspaceView.tsx`, rendered by `routes/_chat.tsx` for thread and draft routes, `/` unless
the panes hold only their starting empty tab, `/wikis`, `/repositories` and `/pull-requests`): chats,
pull requests, change requests, change groups, files, diffs, local graphs, wiki notes and a thread's right-panel surfaces
(Browser, Terminal, Files, Diff, Pull request, Linked pull requests, Device, Graph, Lineage) are
all tabs that split right or down. The sidebar section only decides what the sidebar lists. A
thread's surfaces are tabs linked to its chat (`panes/linkedTabs.ts`): they show only while that
chat is the one in front, and park, remembering where they stood, while another chat is. Nothing
else links to a chat: chats, documents, wiki change requests, change groups, project files and
diffs stand on their own (a change group's **Open as a tab group** still links to the group, and
a following local graph to its file). There
is no right-panel frame: `ChatRightPanel` renders `panes/LinkedPanel.tsx`, which lends the panes
ChatView's panel props and renders the live surface into the pane showing its tab.

## Sub-features

- **Switching sections** (rail, which-key `g`, Command Palette's Open wikis/projects/pull
  requests, the narrow window's footer): changes only the sidebar, never the arrangement, focus,
  the front chat or which ChatViews are mounted. The rail's Agents (`useNavigateToAgents`,
  `panes/agentsRoute.ts`) goes to the focused tab's thread when focus is on a chat or one of its
  linked tabs, else to `/`. In Agents the route follows focus the same way: focusing a chat or its
  linked tab navigates to its thread (the sidebar row lights), focusing a document, file, pull
  request, change group or empty tab navigates to `/` (no row lit). Only a thread link, a sidebar
  click, Back/Forward to a thread route or a deep link bring a chat forward (`arriveChat`).
  `/` with only the starting empty tab still starts a draft, as T3 Code's start page does. Proof:
  `localStorage['astrolabe:workspace:v1']` and every `[data-pane-id]`'s tabs unchanged across the
  switch, the ChatView count unchanged, the URL, and the sidebar's lit row.

- **Linked New tab** (the chat header toggle's **New tab** only): an empty tab owned by the chat, showing T3 Code's launcher (`[aria-label="Open a surface"]`: Browser `B`,
  Terminal `T`, Files `F`, Diff `D`, Pull request `P`, Linked pull requests `L`, Device `M`,
  Graph `G`, Lineage `I`). Rows without a source are disabled `div`s whose hover says why.
  The surface picked takes the New tab's place (same pane and index), linked
  (`workspace.targetPane(pane, blank)`, placed by `arriveAtTarget` as the record gains it).
- **New tab** (`+` at the end of every strip, `button[name='New tab']`; `mod+t`,
  `rightPanel.new`, in the focused pane): opens an unowned empty tab at the end of that
  pane's tabs, in front, at once (no menu). It shows `panes/TabLauncher.tsx`
  (`[aria-label="Open a tab"]`): **New chat** `N` (the sidebar's New thread: the front
  chat's project, or the palette's project list with several), **Document** `O` (wiki
  finder), **Project file** `R` (project list, then its files; one project skips
  the list), **Project diff** `C` (each project's Uncommitted changes and Branch
  changes), **Change group** `K`. Rows with nothing to offer are faint with a reason on
  hover. Letters act only while that pane is focused, and differ from the surface
  launcher's. The pick takes the New tab's place (`putInPlace`); a new chat arriving while a
  New tab is focused lands in it. A lone empty pane shows the same launcher, in every
  section. A New tab opened beside linked tabs stays when the chat changes.
- **Lineage** (`I`, `components/lineage/`): the thread's fork family drawn left to
  right in `section[aria-label="Thread lineage"]`. The viewed thread runs along the
  centre lane, with one column per checkpoint across the family. Forks curve off the
  checkpoint they left from; merge-backs are dotted. Every line ends on a dot, a fork
  that has asked nothing yet ("not started") included. Its checkpoints are buttons named
  `Show the turn "<asked>" in the chat`, which scroll the chat to that turn; hovering one
  shows a card (ask, reply's first line, files and lines, model, when). Another
  thread's title, line or checkpoint is `Open <title> in a new tab`, which opens it as
  a chat tab after the chat in front; a fork's label reads `<agent> · <running|waiting on you|idle · 3h ago|merged
  back|not started> · <n> behind`. Quiet stretches fold into buttons named
  `Show <n> folded turns` (text `<n> turns`) that unfold on click; a bar under the drawing
  holds **Show every turn** / **Fold quiet turns** and, when the drawing overflows the panel,
  a minimap (`LineageMinimap`, an `aria-hidden` `.h-9` strip: the drawing's paths squeezed,
  a box for the scrolled view that follows `scroll` directly; press or drag to centre there —
  `preview_act click` at strip coordinates drives it). The turn the chat's minimap marks current
  gets a halo (`circle.fill-foreground/12`), or its fold's button a solid border; drive it
  by setting `.messages-timeline-scroll`'s `scrollTop`. Thread details' Lineage section has **Show lineage** (only when the
  thread has a fork, parent or merge-back), which opens or focuses the tab.
- **Chats as tabs**: a chat is `chat:<env>:<thread>` in any pane, labelled with its harness's
  icon and title (`chatTabs/chatTabLabel.tsx`). The route's chat is drawn by T3 Code's
  `ThreadRouteView` into one node (`[data-route-chat]`) that moves into that chat's tab, so one
  ChatView stays mounted across thread switches; another chat in front of its pane mounts its
  own ChatView. A sidebar click shows the thread in place of the chat in front (history
  kept); Option/middle-click or **Open in new tab** opens it after the chat in front; threads
  dragged from the sidebar onto a pane open there. In Agents, focusing another chat's pane
  navigates to it, and focusing a tab that is no chat's navigates to `/`. A chat deleted or a draft discarded closes its tab.
- **Linked tabs** (`panes/linkedTabs.ts`, `localStorage['astrolabe:workspace:v1']`'s `owners`,
  `parked`, `front`): `front` is the chat focused most recently while in front of some pane. A
  thread's surface is `chat-surface:<env>:<thread>:<surface id>`, owned by `chat:<env>:<thread>`.
  Switching chats parks the old chat's owned tabs and brings the new chat's back where they
  stood, else into the pane the old ones vacated, else a new pane right of the chat (0.45 of
  its room). Closing a chat drops its owned tabs (its thread's record keeps the surfaces, which
  come back next time). Hiding (the chat's panel closing) parks its linked tabs, except an empty
  one, which closes; closing a tab (its ✕, `:q`, the tab menu, Close pane, `t` `c`,
  `rightPanel.close`) deletes it, a surface through T3 Code's own close, so a terminal ends. An
  open panel with no linked tabs shows an owned empty tab with T3 Code's launcher; closing the
  front chat's last linked tab closes its panel, and closing its last surface keeps the panel
  open while other linked tabs remain. Linked tabs are added only from the toggle; there is no
  linking a standalone tab to a chat. **Open as its own tab** (tab menu) puts a thread's
  surface's standalone counterpart in its place, unlinked, and closes the surface in the
  thread's record: a file (from chat or Files) becomes `repo-file:` on the thread's checkout,
  Diff becomes `repo-diff:…:working-tree`, the thread's pull request a full-key pull request
  tab (only when its host is known). Terminal, browser, device, Files, Graph, Lineage and
  Linked pull requests have no counterpart and do not offer it. **Unlink tab** remains for a
  tab still linked (a change group's, or one linked before). `t` `k` (`tab.toggleLink`) does
  the focused tab's link item: a local graph's follow/pin (repositories.md) or Unlink tab, and
  is faint otherwise.
- **Linked tabs toggle** (`panes/LinkedTabsToggle.tsx`, `[data-right-panel-toggle]`): in a
  pane's chat header, after the thread details and terminal drawer toggles, in place of
  T3 Code's right-panel toggle. With the panel open, a square-minus icon, **Hide tabs** (pressed).
  With linked tabs parked for that chat (its own and its change group's, plus record surfaces
  no pane held yet), a rounded square holding their count (label `Open tabs (N hidden)`)
  opening an **Open tabs** menu: each tab with its icon, then **New tab**; picking one brings
  them all back with it in front. With none, a plus-in-a-square, **New tab**, which opens the
  linked New tab. `rightPanel.toggle` (Cmd+Alt+B), `p` `r` and the Command Palette hide the
  tabs, and with tabs parked bring them all straight back where they stood (no menu), so two
  presses hide and restore; with none they open the linked New tab. Only the button's click
  opens the menu. The header has no maximize of its own; the pane strip's does that.
- **Link marker** (`LinkMarker` in `panes/workspaceTabs.tsx`, `panes/linkMarks.ts`): a chain
  (`[data-link-mark=<ink>]`) in the ✕'s place on every linked tab on screen and on its owner (hovering the tab swaps it for the ✕; on a device without hover both show), with
  the owner's name (or `N linked tabs follow this tab`) on hover. Each owner on screen takes
  the next ink in reading order (`--link-ink-1..4`, the first is `--primary`). No motion.
- **Change groups**: **Open as a tab group** in a group's tab opens its threads after the chat
  in front and links the rest (the group's tab, its change requests, its pull requests named
  in full) to the group (`owners[key] = change-group:<env>:<id>`), shown while the front chat
  is one of the group's threads and parked otherwise. Beside a chat outside the group they
  stand on their own, together in one new pane beside it. The groups' threads reach the panes through `GroupsSync`.
- **Tab groups** (`panes/tabGroups.tsx`, runs from `panes/tabGroupRuns.ts`): in any
  strip, a change
  group's run of tabs (its chats, wiki change requests and own tab, and pull requests
  matched by repository#number) is headed by a marker,
  `button[data-tab-group]` inside the tablist: a narrow tab with a stack icon and the
  group's number as a badge, title and state in its tooltip, named
  `<title>, tab group <n>, <state>` (`, collapsed` appended). It is no `[role=tab]` or
  `[data-pane-tab]`. A chat whose thread is in several groups joins the run before it
  when it shares that run's group. Click shows the group's own tab
  (`change-group:<env>:<id>`): in front where that arrangement has it open (its pane takes
  focus), else opened at the head of the run. Right-click gives Expand/Collapse the group,
  Merge with the code (Stop merging with the code when armed), Close the group's tabs
  (each through its own close, so a pull request leaves the thread's record too);
  collapsed, for the page only and in every strip at once, the run shows the marker and
  only the strip's tab in front. The number is one numbering for the window
  (`panes/tabGroupNumbers.ts`, `localStorage['astrolabe:tab-group-numbers:v1']`): a
  group takes the lowest free number when a strip first shows it, and keeps it while any
  tab it was shown with is open on the device, in any pane arrangement or parked (checked 250 ms after a strip loses a tab, and on load), across reloads.
  Every group wears the theme's primary colour (`--tab-group` is `var(--primary)`): the
  marker's icon and badge, the `[data-tab-group-run]` grid's `::after` 2px line along the
  strip's foot, and the 2px border of the tab in front inside the run. Dragging tabs
  never changes membership; a member dragged away forms its own run with its own marker.
  Dragging the marker moves the run whole: mid-drag the run shows the marker alone
  (dimmed, no line), the preview is a clone of the marker, drops land only between runs,
  and a move along its own strip keeps the tab in front. Drive it with synthetic
  `DragEvent`s sharing one `new DataTransfer()` (`bubbles`, `cancelable`): `dragstart` on
  the marker, a tick for the run to collapse, `dragover` then `drop` on the target strip
  at a `clientX`/`clientY`, then `dragend` on the marker. Change groups themselves are in
  pull-requests.md.
- **Pane actions** (`⋯`): Split right, Split down (both disabled for a pane's only
  tab), Close pane (disabled for a lone pane holding only an empty tab). The same
  actions are commands (`pane.splitRight`, `pane.splitDown`, `pane.close`,
  `pane.toggleMaximized`, `pane.toggleFullScreen`): the keyboard menu's `p` group
  (`v`, `s`, `c`, `m` for maximize, `f` for full screen, `r` for upstream's
  `rightPanel.toggle`, which hides or brings back the front chat's linked tabs), `:vs` and `:sp` in the Command Palette, or any shortcut bound to them
  (which-key.md). A split moves focus into the new pane, on the moved tab's pill.
  `:q` closes the focused pane's active tab.
- **Tab context menu** (right-click): **Open in Projects** for a thread's Files, Diff and
  opened file, **Open as its own tab** for a
  thread's file, Diff and pull request, then T3 Code's own items for the tab (**Rename** for a
  device, **Copy path** for a workspace file, **Mute tab** / **Unmute tab** for a browser
  tab), a local graph's link item or **Unlink tab** for a tab still linked, Close, Close
  others, Close tabs to the right, Split right, Split down. A lone tab cannot split.
  Right-clicking a tab inside a Cmd/Shift selection of several shows **Close (N)**,
  **Split right (N)**, **Split down (N)** instead (no Open in); each ends the selection.
  Escape clears a selection. A middle-click (`preview_act click button="middle"`) closes a
  tab. Every tab has a ✕ (a linked one's shows on hover, over its chain mark) except a lone pane's lone empty
  tab.
- **Dividers**: between panes, a 1px line with a 3px `role=separator` handle
  (`aria-orientation` vertical for a side-by-side split, horizontal for a stacked one)
  that turns the primary colour on hover or drag (`data-active`). Dragging it rewrites
  the branch's `weights`, which persist in the stored tree (the `.root` read below). It
  is a pointer-capture drag: `preview_act drag` from the separator to an element in the
  neighbouring pane resizes it; read the new `weights` from `.root`.
- **Maximize pane** / **Restore pane**: fills the panes, shown only beside other
  panes. T3 Code's `rightPanel.toggleMaximized` (no header control in a pane)
  maximizes the pane showing the front chat's live surface; restoring that pane ends it.
- **Full screen** (`p f`, `pane.toggleFullScreen`, label "Full screen pane" /
  "Exit full screen"): maximizes the focused pane, faint for a lone pane.
- **Chrome tabs**: tabs are drawn as Chrome's (`index.css`, `TabParts.tsx`): 240px
  wide, shrinking together to 96px; the title fades out before an always-shown ✕.
  As in T3 Code's panel, a browser tab playing audio has a speaker button
  (`Mute <title>` / `Unmute <title>`), a file still saving has a dot on its icon, and
  a device tab names its host and OS version on hover and renames on double-click
  (`textbox "Rename <title>"`; Enter keeps, Escape cancels). The
  tab in front is outlined as Obsidian's: the content background (`--tab-join`), rounded
  top corners, no bottom edge over a break in the strip's bottom border, and outward
  curves with a border ring at its feet (`[data-pane-tab][aria-selected=true]::before/::after`). Other tabs are bare until hovered, with a 1px rule
  between two at rest (`::before`). The place keys act from (`[data-focused-place]`, the
  pane or chat column last focused or pressed in; keyboard-nav.md) marks its tab in front
  with a 2px bar in `--focus-bar` (rust in Mercurian) along the tab's top edge. It is not
  the arrangement's focused pane (`[data-focused]`): with focus in the sidebar or rail no
  tab has the bar. Check
  `[data-pane-id][data-focused-place] [data-pane-tab][aria-selected=true]`. The view
  header below has no bottom border and the strip's height, so tab and header read as one
  surface: a chat's, and every Astrolabe tab's (`[data-tab-header]`, `panes/TabHeader.tsx`: a
  file, a checkout's changes, a local graph, the thread's Graph tab, a wiki note), each a
  breadcrumb in the chat's type (muted place, then the page) with quiet status and ghost icon
  actions.
- **Back and Forward in the header**: every header above starts with ← → (`[data-tab-history]`,
  `TabHeader.History`; the chat's through `PaneChatHeader`), as Obsidian's tab headers do. They
  step that tab's own history (`workspace.step(direction, tabKey)`), focused or not, and are
  disabled with nothing that way; a linked surface (the thread's Graph tab) never has any. Tabs
  with no header row have none: a wiki change request, a change group, a pull request, the New
  tab launcher and the thread's other surfaces (terminal, preview, diff, files, pull requests,
  device, lineage).
  `mod+[`/`mod+]`, Space `t h`/`t l` and the palette's Back/Forward still act on the focused
  pane's tab in front. Proof: two panes, click Back in the unfocused one's header; only its tab
  changes. What scrolls beneath a header fades out under it (`topbar-scroll-fade`, static).
- **Drag a tab** to another strip or a pane edge. Cmd/Ctrl-click and
  Shift-click select several tabs, which drag together. The page draws the drag's
  preview, a pill under the pointer (`body > [aria-hidden=true].fixed`, with a count
  for several), in place of the browser's snapshot; the insertion line is 20px tall,
  centred on the strip, midway between the two tabs either side.
- **One live surface**: only the record's active surface renders. Another
  pane's shown tab reads "Click to show" until its pane takes focus.
- **Persistence**: the one arrangement, its links and parked tabs survive a reload, per
  device (`astrolabe:workspace:v1`, history `astrolabe:workspace-tab-history:v1`). The first
  load brings in the old chat tabs and the Projects and Wikis layouts side by side and
  drops `t3code:right-panel-panes:v1:*`. Maximize pane is in memory only.
- **Narrow windows**: the panes stay panes (no sheet); they scroll sideways below their
  minimum widths.

## How to get to it (user POV)

Press **+** at the end of any pane's tabs (or Cmd+T): a New tab opens there with **Open a tab**;
pick one and it takes the New tab's place. Open a chat and press **New tab** at the end of its
header (or Cmd+Alt+B): a linked pane opens to the chat's right with the surface launcher. **Hide tabs** sets them aside; the button then
counts them, and its menu brings them back.

## Driving it with the Browser panel

Scope locators to the panel with `[data-pane-id] >>`, since the chat has its own
buttons. With two panes, add `>> nth=N` to `New tab`, `Maximize pane` and
`Pane actions`.

```
preview_act click  [data-chat-header] >> [data-right-panel-toggle]            # New tab / Hide tabs / Open tabs (N hidden)
preview_act click  [data-pane-id] >> role=button[name=/^Diff/]          # launcher; an unavailable surface is a disabled row, not a button
preview_act click  [data-pane-id] >> role=button[name='New tab']          # + : a New tab, no menu
preview_act click  [aria-label='Open a tab'] >> role=button[name=/^Project file/]
preview_act click  [data-pane-id] >> role=button[name='Pane actions']
preview_act click  role=menuitem[name='Split right']
preview_act click  role=tab[name='<other chat>']                         # its linked tabs take the pane
```

Read the panes:

```js
[...document.querySelectorAll("[data-pane-id]")].map((p) =>
  [...p.querySelectorAll("[role=tab]")].map(
    (t) => t.getAttribute("aria-label") + (t.getAttribute("aria-selected") === "true" ? "*" : ""),
  ),
);
```

The read lists only `[role=tab]`: it skips `[data-tab-group]` markers and leaves out a
collapsed group's hidden tabs, which are not rendered. Read the labels' `aria-label`
too, or expand the groups, before comparing arrangements.

Tabs in the DOM are not proof that they paint. Hit-test each pane's tab in front and
its body:

```js
[...document.querySelectorAll("[data-pane-id]")].map((p) => {
  const r = p.getBoundingClientRect();
  const t = p.querySelector("[role=tab][aria-selected=true]").getBoundingClientRect();
  const hit = (x, y) => document.elementFromPoint(x, y)?.closest("[data-pane-id]") === p;
  return {
    w: r.width,
    h: r.height,
    tab: hit(t.x + t.width / 2, t.y + t.height / 2),
    body: hit(r.x + r.width / 2, r.y + r.height * 0.6),
    waiting: p.innerText.includes("Click to show"),
  };
});
```

Every pane should have `w` and `h` above 0 and `tab` and `body` true; with two panes
showing surfaces, exactly one (the unfocused one) is `waiting`.

The stored workspace: `JSON.parse(localStorage['astrolabe:workspace:v1'])` (`root`, `focused`,
`owners`, `parked`, `front`). Writes are debounced (150 ms) and flushed on `pagehide`; the
starting arrangement (one empty tab, nothing parked) has no key.

**Proof:** the panes read shows the split and the hit-test shows every pane painted; bringing
another chat to the front shows its linked tabs in that pane (its old ones listed in `parked`),
and returning shows the first chat's again. After a reload both reads return the same result.

## Gotchas

- `preview_act click` sends no modifier keys: drive a Cmd-click with `preview_evaluate`
  dispatching `new MouseEvent('click', {bubbles: true, metaKey: true})` on the tab
  (`[data-pane-tab]`). `preview_act drag` drops at the target's centre; for a pane-edge drop,
  dispatch dragstart/dragover/drop with one DataTransfer near the edge.
- Closing a terminal asks first: press `role=button[name='Confirm']`.
- The launcher's Diff row is a disabled `div`, not a button, outside a git-backed
  server thread; Files needs a project. Pick a seeded thread in a repository.
- Tab names differ from menu labels: Linked pull requests shows as "Pull requests",
  a pull request as `#<n>`, a browser by page title or host, terminals as
  "Terminal 1".
- Focus in a terminal keeps Cmd+K for the terminal. Click a non-terminal tab before
  using the keyboard menu (or the leader key; Cmd+K is the default `whichKey.open`).
- The panes engine (`panesHost.ts`, `PaneView.tsx`, `PaneTree.tsx`, `maximize.ts`,
  `paneCommands.ts`, `tabGroups.tsx`) is shared with the Changes area; a change there walks
  pull-requests.md too, and any change to the shared panes walks wikis.md and repositories.md.
  The menu acts on whichever panes registered last (one `panesSlot`).
- While a pane is maximized the others are `inert`, so role locators skip them and
  `nth` indexes shift.
- The context menu renders as plain `button`s on web. The other menus use
  `menuitem`.
- Lineage reads the whole fork family from `GET /api/orchestration/threads/<id>/lineage`,
  not the chat's loaded turns. It draws in for about a second after that first fetch
  lands, so wait before a screenshot. It opens scrolled to its right end, where forks
  taken early are out of view. To see
  them, dispatch a `wheel` event on the scroller first (it stops keeping the right end
  in view once touched), then set its `scrollLeft = 0`. Find fork families in the
  seeded `statev2.sqlite`:
  `json_extract(payload_json,'$.lineage.relationshipToParent')='fork'` on
  `orchestration_v2_projection_threads`. On 2026-10-20 neither the seeded data nor the
  live data had a merge-back (`orchestration_v2_projection_context_transfers` type
  `merge_back`), so only the layout tests cover dotted curves.
- The bottom terminal drawer is T3 Code's own (Toggle terminal drawer, Cmd+J),
  under the chat column, not a pane. Cmd+J (and `terminal.toggle` from which-key or the
  palette, faint there otherwise) reaches only the chat that is the focused pane's tab in
  front (`takesTerminalToggle`, checked in `useChatShortcuts`): with a file, document, linked
  surface or other tab focused it does nothing, and no other visible or hidden chat answers.
