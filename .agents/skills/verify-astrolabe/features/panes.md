# Tabs and splits in the right panel

T3 Code's right panel holds the chat's surfaces (Browser, Terminal, Files, Diff,
Pull request, Linked pull requests, Device, Graph, Lineage) as tabs that split right or down.
The panel belongs to the chat tab in front: switching chats swaps it, and each
thread keeps its own arrangement. It runs the window's full height, its top
strips sharing the title bar with the chat tabs. T3 Code's own toggle, width,
resize and maximize still drive the panel itself.

## Sub-features

- **Empty panel**: one "New tab" showing T3 Code's launcher ("Open a surface").
  Picking a surface replaces it.
- **New tab menu** (`+` in every strip): the same surfaces. Items without a
  source are disabled. Astrolabe adds **Document** (`O`), which opens the wiki
  finder and puts the pick in that pane as a document tab.
- **Lineage** (`I`, `components/lineage/`): the thread's fork family drawn left to
  right in `section[aria-label="Thread lineage"]`. The viewed thread runs along the
  centre lane, with one column per checkpoint across the family. Forks curve off the
  checkpoint they left from; merge-backs are dotted. Every line ends on a dot, a fork
  that has asked nothing yet ("not started") included. Its checkpoints are buttons named
  `Show the turn "<asked>" in the chat`, which scroll the chat to that turn; hovering one
  shows a card (ask, reply's first line, files and lines, model, when). Another
  thread's title, line or checkpoint is `Open <title> in a new tab`, which opens it as
  a chat tab; a fork's label reads `<agent> · <running|waiting on you|idle · 3h ago|merged
back|not started> · <n> behind`. Quiet stretches fold into buttons named
  `Show <n> folded turns` (text `<n> turns`) that unfold on click; a bar under the drawing
  holds **Show every turn** / **Fold quiet turns** and, when the drawing overflows the panel,
  a minimap (`LineageMinimap`, an `aria-hidden` `.h-9` strip: the drawing's paths squeezed,
  a box for the scrolled view that follows `scroll` directly; press or drag to centre there —
  `preview_click` at strip coordinates drives it). The turn the chat's minimap marks current
  gets a halo (`circle.fill-foreground/12`), or its fold's button a solid border; drive it
  by setting `.messages-timeline-scroll`'s `scrollTop`. Thread details' Lineage section has **Show lineage** (only when the
  thread has a fork, parent or merge-back), which opens or focuses the tab.
- **Tabs from other sections** (`apps/web/src/sectionTabs/`): the Wikis, Repositories
  and Changes panes can hold a chat (`chat:<env>:<thread>`), a document or wiki
  change request (`wiki-note:`, `wiki-change:`), a repository file, diff or Manage tab
  (`repo-file:`, `repo-diff:`, `repo-manage`), a change group (`change-group:<env>:<id>`)
  and a pull request named in full, beside their own tabs. A change request's **Open
  thread** opens its thread beside it. A thread's right panel takes only wiki tabs
  (Document, or a Graph tab click, which opens one beside the graph). A tab outside its
  own section has **Open in Agents / Wikis / Repositories / Changes** first in
  its right-click menu: it closes here and opens there (a chat in the chat tab in front,
  a document in the Wikis tab in front, a repository tab in the Repositories panes, a
  change request or change group in Changes). The exception is a thread's
  right-panel **Files**, **Diff** and opened-file tabs: their **Open in Repositories**
  keeps the tab here and opens the thread's checkout in Repositories (the file, its
  uncommitted changes, or the file tree; repositories.md). Section tab keys survive a
  reload; a chat mounts only while its tab is in front.
- **Tab groups** (`panes/tabGroups.tsx`, runs from `panes/tabGroupRuns.ts`): in any
  strip, a thread's right panel and the chat tabs included (chat-tabs.md), a change
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
  tab it was shown with is open on the device, in any pane arrangement, the chat tabs or
  a shared run (checked 250 ms after a strip loses a tab, and on load), across reloads.
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
- **Shared run beside a group's threads** (`panes/groupPanelRuns.ts`,
  `panes/GroupPanelRunsSync.tsx`): beside every thread in a group (`group.threadIds`), the
  group's own tab, its pull requests and its wiki change requests are one run the group
  owns. Opening one beside a member thread (a pull request link, a member row in the
  group's tab, the marker) opens it beside every member; closing one there (its ✕, Close
  the group's tabs, Close pane, Open in Changes) closes it beside all of them. The other
  members catch up when their panel shows (at once if it is on screen): missing tabs open
  as one run in the pane already holding part of it, else the pane holding the thread's
  surfaces, else the focused pane, never in front and with focus where it was; a closed
  panel stays closed (pull requests join the thread's record quietly, `shareSurfaces`).
  Where the tabs stand, which tab is in front, the thread's own surfaces and its splits
  stay each thread's. A group tab the thread already held (its own pull request, opened
  before the group formed) joins the run when the thread shows in the group; a thread in
  two groups shows both runs. Only threads' right panels share: Changes, Wikis and
  Repositories panes don't. The store is
  `JSON.parse(localStorage['astrolabe:group-panel-runs:v1']).state.runs[<change-group key>]`,
  `{open: [entries], closed: [ids]}` (`closed` holds what was closed beside a member, until
  it is opened again). From the group's tab beside a thread, **Open as a tab group** opens
  the group's threads as chat tabs right after the chat in front (no navigation) and the
  rest into the run; beside a thread outside the group they open in that panel too,
  unshared. A thread row there opens it as a chat tab after the one in front, a pull
  request row as the thread's own surface. In Changes, Wikis and Repositories, **Open as a
  tab group** opens everything in that section's focused pane. **Proof:** with member
  threads A and B, open the group's tab beside A, show B: its strip holds the group's tab,
  not `aria-selected`, and B's panel, if it was closed, is still closed; close it beside B,
  show A: it is gone, and the store's `closed` lists it.
- **Pane actions** (`⋯`): Split right, Split down (both disabled for a pane's only
  tab), Close pane (disabled for a lone pane holding only an empty tab). The same
  actions are commands (`pane.splitRight`, `pane.splitDown`, `pane.close`,
  `pane.toggleMaximized`, `pane.toggleFullScreen`): the keyboard menu's `p` group
  (`v`, `s`, `c`, `m` for maximize, `f` for full screen, `r` for upstream's
  `rightPanel.toggle`, faint with no chat on screen), `:vs` and `:sp` in the Command Palette, or any shortcut bound to them
  (which-key.md). A split moves focus into the new pane, on the moved tab's pill.
  `:q` with focus in the panes closes the focused pane's active tab, not the chat tab.
- **Tab context menu** (right-click): Open in `<section>` (only for a tab outside its
  section), Close, Close others, Close tabs to the right, Split right, Split down. A
  lone tab cannot split. Right-clicking a tab inside a Cmd/Shift selection of several
  shows **Close (N)**, **Split right (N)**, **Split down (N)** instead (no Open in);
  each ends the selection. Escape clears a selection. A middle-click
  (`preview_click button="middle"`) closes a tab, except a lone empty one.
- **Dividers**: between panes, a 1px line with a 3px `role=separator` handle
  (`aria-orientation` vertical for a side-by-side split, horizontal for a stacked one)
  that turns the primary colour on hover or drag (`data-active`). Dragging it rewrites
  the branch's `weights`, which persist in the stored tree (the `.root` read below). It
  is a pointer-capture drag: `preview_drag` from the separator to an element in the
  neighbouring pane resizes it; read the new `weights` from `.root`.
- **Maximize pane** / **Restore pane**: fills the panel, shown only beside other
  panes. Separate from T3 Code's **Maximize panel**, which fills the main area.
- **Full screen** (`p f`, `pane.toggleFullScreen`, label "Full screen pane" /
  "Exit full screen"): the focused pane takes the whole content area: it maximizes
  the pane (unless alone) and, in a thread's right panel, the panel too, so the chat
  column hides (`[data-chat-column-maximized-away=true]`); pressed again it restores
  both. In Wikis, Repositories and Changes it is maximizing the pane, faint for
  a lone pane.
- **Chrome tabs**: tabs are drawn as Chrome's (`index.css`, `TabParts.tsx`): 240px
  wide, shrinking together to 96px; the title fades out before an always-shown ✕. The
  tab in front is outlined as Obsidian's: the content background (`--tab-join`), rounded
  top corners, no bottom edge over a break in the strip's bottom border, and outward
  curves with a border ring at its feet (`[data-pane-tab][aria-selected=true]::before/::after`). Other tabs are bare until hovered, with a 1px rule
  between two at rest (`::before`). The place keys act from (`[data-focused-place]`, the
  pane or chat column last focused or pressed in; keyboard-nav.md) marks its tab in front
  with a 2px bar in `--focus-bar` (rust in Mercurian) along the tab's top edge. It is not
  the arrangement's focused pane (`[data-focused]`): with focus in the sidebar or rail no
  tab has the bar. Check
  `[data-pane-id][data-focused-place] [data-pane-tab][aria-selected=true]`. The view
  header below (a wiki note's, a chat's) has no bottom border and the strip's height, so
  tab and header read as one surface.
- **Drag a tab** to another strip or a pane edge. Cmd/Ctrl-click and
  Shift-click select several tabs, which drag together. The page draws the drag's
  preview, a pill under the pointer (`body > [aria-hidden=true].fixed`, with a count
  for several), in place of the browser's snapshot; the insertion line is 20px tall,
  centred on the strip, midway between the two tabs either side.
- **One live surface**: only the record's active surface renders. Another
  pane's shown tab reads "Click to show" until its pane takes focus.
- **Persistence**: each thread's arrangement survives a reload, per device.
  Maximize pane is in memory only; a reload restores every pane.
- **Narrow windows**: at 980px or less the panel is a sheet of plain T3 tabs, with
  no panes (`[data-pane-id]` absent). Keep the viewport wider.

## How to get to it (user POV)

Open a chat and press **Toggle right panel** (top right, or Cmd+Alt+B).

## Driving it with the Browser panel

Scope locators to the panel with `[data-pane-id] >>`, since the chat has its own
buttons. With two panes, add `>> nth=N` to `New tab`, `Maximize pane` and
`Pane actions`.

```
preview_click  role=button[name='Toggle right panel']
preview_click  [data-pane-id] >> role=button[name=/^Diff/]          # launcher; an unavailable surface is a disabled row, not a button
preview_click  [data-pane-id] >> role=button[name='New tab']
preview_click  role=menuitem[name=/^Files/]
preview_click  [data-pane-id] >> role=button[name='Pane actions']
preview_click  role=menuitem[name='Split right']
preview_click  role=tab[name='<other chat>']                         # swaps the panel
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

Stored trees, one per thread whose panel is not at its start:
`Object.keys(localStorage).filter(k => k.startsWith('t3code:right-panel-panes:v1:')).map(k => [k, JSON.parse(localStorage.getItem(k)).root])`
(`…:v1:pull-requests` is the Changes area's, not a thread's).
Writes are debounced (150 ms) and flushed on `pagehide`; a panel left at its
start (one empty tab) has no key.

**Proof:** the panes read shows the split and the hit-test shows every pane painted,
another chat tab shows its own panel, and returning shows the split again. After a
reload both reads return the same result.

## Gotchas

- `preview_click` sends no modifier keys: drive a Cmd-click with `preview_evaluate`
  dispatching `new MouseEvent('click', {bubbles: true, metaKey: true})` on the tab
  (`[data-pane-tab]`). `preview_drag` drops at the target's centre; for a pane-edge drop,
  dispatch dragstart/dragover/drop with one DataTransfer near the edge, as chat-tabs.md's
  Gotchas do.
- Closing a terminal asks first: press `role=button[name='Confirm']`.
- The launcher's Diff row is a disabled `div`, not a button, outside a git-backed
  server thread; Files needs a project. Pick a seeded thread in a repository.
- Tab names differ from menu labels: Linked pull requests shows as "Pull requests",
  a pull request as `#<n>`, a browser by page title or host, terminals as
  "Terminal 1".
- Focus in a terminal keeps Cmd+K for the terminal. Click a non-terminal tab before
  using the keyboard menu (or the leader key; Cmd+K is the default `whichKey.open`).
- The panes engine (`panesHost.ts`, `PaneView.tsx`, `PaneTree.tsx`, `maximize.ts`,
  `paneCommands.ts`, `sectionPanes.ts`, `tabGroups.tsx`) is shared with the Wikis,
  Repositories and Changes areas; a change there walks wikis.md,
  repositories.md and pull-requests.md too. The menu acts on whichever panes
  registered last (one `panesSlot`).
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
  under the chat column, not a pane.
