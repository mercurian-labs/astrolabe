# Tabs and splits in the right panel

T3 Code's right panel holds the chat's surfaces (Browser, Terminal, Files, Diff,
Pull request, Linked pull requests, Device, Graph) as tabs that split right or down.
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
- **Tabs from other sections** (`apps/web/src/sectionTabs/`): the Wikis, Repositories
  and Changes panes can hold a chat (`chat:<env>:<thread>`), a document or wiki
  change request (`wiki-note:`, `wiki-change:`), a repository file, diff or Manage tab
  (`repo-file:`, `repo-diff:`, `repo-manage`), a change group (`change-group:<env>:<id>`)
  and a pull request named in full, beside their own tabs. A change request's **Open
  thread** opens its thread beside it. A thread's right panel takes only wiki tabs
  (Document, or a Graph tab click, which opens one beside the graph). A tab outside its
  own section has **Open in Threads / Wikis / Repositories / Changes** first in
  its right-click menu: it closes here and opens there (a chat in the chat tab in front,
  a document in the Wikis tab in front, a repository tab in the Repositories panes, a
  change request or change group in Changes). The exception is a thread's
  right-panel **Files**, **Diff** and opened-file tabs: their **Open in Repositories**
  keeps the tab here and opens the thread's checkout in Repositories (the file, its
  uncommitted changes, or the file tree; repositories.md). Section tab keys survive a
  reload; a chat mounts only while its tab is in front.
- **Tab groups** (`panes/tabGroups.tsx`): in any strip, a thread's right panel
  included, a change group's run of tabs (its chats, wiki change requests and own tab,
  and pull requests matched by repository#number) is headed by `button[data-tab-group]`
  inside the tablist, named `<title>, tab group, <state>` (`, collapsed` appended), with
  `aria-expanded`. Click collapses the run into the label, leaving only the pane's tab
  in front; right-click gives Expand/Collapse the group, Merge with the code (Stop
  merging with the code when armed), Open the group, Close the group's tabs. Collapse
  lasts only for the page. Change groups themselves are in pull-requests.md.
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
preview_click  [data-pane-id] >> role=button[name=/^Diff/]          # launcher
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

The read lists only `[role=tab]`: it skips `[data-tab-group]` labels and leaves out a
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
- The bottom terminal drawer is T3 Code's own (Toggle terminal drawer, Cmd+J),
  under the chat column, not a pane.
