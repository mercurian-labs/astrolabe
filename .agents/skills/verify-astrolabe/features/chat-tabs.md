# Chat tabs

The open chats show as tabs across the top of the chat column. The route's
thread is the tab in front. Opening a thread anywhere (the sidebar, the command
palette, a fork) adds its tab at the end and brings it up front. Beneath the
strip, the chat in front keeps T3 Code's own header, conversation and bottom
terminal drawer. Its right panel runs the full height beside it (see panes.md).

## Sub-features

- **Open**: clicking a sidebar thread adds its tab, or brings up its existing tab.
  A draft has a "New thread" tab that keeps its place when the draft is sent.
- **Switch**: clicking a tab navigates to its thread, or to its draft.
- **Close**: the ✕ on hover or keyboard focus, or a middle-click. Closing the tab
  in front shows the tab after it, else the one before it, else `/` (also when the
  neighbour's route is not known yet). Clicking a tab whose thread is gone closes
  it.
- **Reorder**: dragging a tab along the strip.
- **Persistence**: the list survives a reload, per device
  (`localStorage['t3code:chat-tabs:v1']`).
- **Pruning**: a tab whose thread was deleted or whose draft was discarded
  closes once its environment's threads have loaded.
- **The chat's controls end the strip**: Toggle thread details panel, then
  Toggle terminal drawer, plus Toggle right panel while the panel is closed.
  With the panel open (inline, viewport over 980px), only Maximize panel and
  Toggle right panel stay over the panel's top strip. Under 980px the panel
  opens as a sheet and every toggle stays in the strip.
- **Title bar**: the strip is the chat column's part of the window's title bar.
  With the right panel closed it spans to the window's right edge and the panel
  controls sit at its end, inside the strip (in Electron it also leaves the
  native window-controls inset). With the panel open, the panel's top strips sit
  beside it; maximized, the chat column collapses and only the panel shows.
- **Keyboard**: the keyboard menu's `t` group drives the same strip: `]` next and
  `[` previous (they wrap; faint with fewer than two tabs), `c` close (commands
  `chatTab.next/previous/close`, default keys, rebindable; see which-key.md). `t r`
  reopens closed panel and browser tabs, not chat tabs. `:q` in the Command Palette
  closes the tab in front unless focus was in a pane, and `:b` lists the open chat
  tabs first.

## How to get to it (user POV)

Open any thread. The tabs are the top row of the chat column. The thread's
breadcrumb header is the row below.

## Driving it with the Browser panel

```
preview_click  [data-testid=sidebar-row-card] >> nth=1          # a sidebar row
# by name: role=button[name='<title>, <project>'], or '<title>, <status>, <project>'
# when the thread shows a status (Working, Done, …)
preview_wait_for  locator=role=tab[name='<title>'][selected]
preview_click  role=tab[name='<other title>']
preview_click  role=button[name='Close <title>']
```

Read the strip (`*` marks the tab in front):

```js
[...document.querySelectorAll('[role=tablist][aria-label="Open chats"] [role=tab]')].map(
  (t) => t.getAttribute("aria-label") + (t.getAttribute("aria-selected") === "true" ? "*" : ""),
);
```

**Proof:** the strip read and `location.pathname` agree on the tab in front.
After `location.reload()` and `preview_wait_for role=tab[name='<title>']`, the
same read returns the same tabs. For layout, measure rather than eyeball:
`[data-tab-strip=chats]` spans only the chat column while the panel is open,
and the panel (`[data-preview-panel-mode]`) starts at the top of the window.

## Gotchas

- Tab lists are per origin. Dev servers reusing a port share one list, so a
  walk can inherit tabs from another server's threads. Those never prune,
  because that environment never loads. Clear the key first when it matters.
- Reorder uses HTML5 drag, and the whole strip takes the drop. `preview_drag`
  drops at the target's centre, which lands after that tab. To test a drop at
  the start, dispatch `dragstart`, `dragover` and `drop` yourself with one
  `DataTransfer`, at a point between the strip's left edge and the first tab.
  Check with `elementFromPoint` that the point is in `[data-tab-strip=chats]`,
  because the sidebar's resize rail overlaps the strip's first 8px.
- With nothing open (`/`), there is no strip: ChatView draws it.
- The stored value is zustand's wrapper: read
  `JSON.parse(localStorage['t3code:chat-tabs:v1']).state.keys`.
- Opening a chat focuses its composer. Keys sent "to the page" afterwards type into
  the draft (and with Vim on, in insert mode). Move focus first; see which-key.md.
