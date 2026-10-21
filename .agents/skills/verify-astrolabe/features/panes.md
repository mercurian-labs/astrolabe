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
  source are disabled.
- **Pane actions** (`⋯`): Split right, Split down (both disabled for a pane's only
  tab), Close pane (disabled for a lone pane holding only an empty tab). The same
  actions are commands (`pane.splitRight`, `pane.splitDown`, `pane.close`,
  `pane.toggleMaximized`): the keyboard menu's `p` group (`v`, `s`, `c`, and `m` for
  maximize), `:vs` and `:sp` in the Command Palette, or any shortcut bound to them
  (which-key.md). A split moves focus into the new pane, on the moved tab's pill.
  `:q` with focus in the panes closes the focused pane's active tab, not the chat tab.
- **Tab context menu** (right-click): Close, Close others, Close tabs to the
  right, Split right, Split down. A lone tab cannot split.
- **Maximize pane** / **Restore pane**: fills the panel, shown only beside other
  panes. Separate from T3 Code's **Maximize panel**, which fills the main area.
- **Drag a tab** to another strip or a pane edge. Cmd/Ctrl-click and
  Shift-click select several tabs, which drag together.
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

Stored trees, one per thread whose panel is not at its start:
`Object.keys(localStorage).filter(k => k.startsWith('t3code:right-panel-panes:v1:')).map(k => [k, JSON.parse(localStorage.getItem(k)).root])`.
Writes are debounced (150 ms) and flushed on `pagehide`; a panel left at its
start (one empty tab) has no key.

**Proof:** the panes read shows the split, another chat tab shows its own panel,
and returning shows the split again. After a reload the same read returns the
same arrangement.

## Gotchas

- `preview_click` sends no modifier keys, so multi-select is UNVERIFIABLE.
  `preview_drag` drops at the target's centre, so pane-edge drops are
  UNVERIFIABLE. Report them as such.
- Closing a terminal asks first: press `role=button[name='Confirm']`.
- The launcher's Diff row is a disabled `div`, not a button, outside a git-backed
  server thread; Files needs a project. Pick a seeded thread in a repository.
- Tab names differ from menu labels: Linked pull requests shows as "Pull requests",
  a pull request as `#<n>`, a browser by page title or host, terminals as
  "Terminal 1".
- Focus in a terminal keeps Cmd+K for the terminal. Click a non-terminal tab before
  using the keyboard menu (or the leader key; Cmd+K is the default `whichKey.open`).
- The panes engine (`panesHost.ts`, `PaneView.tsx`, `PaneTree.tsx`, `maximize.ts`,
  `paneCommands.ts`) is shared with the Wikis area; a change there walks wikis.md
  too. The menu acts on whichever panes registered last (one `panesSlot`).
- While a pane is maximized the others are `inert`, so role locators skip them and
  `nth` indexes shift.
- The context menu renders as plain `button`s on web. The other menus use
  `menuitem`.
- The bottom terminal drawer is T3 Code's own (Toggle terminal drawer, Cmd+J),
  under the chat column, not a pane.
