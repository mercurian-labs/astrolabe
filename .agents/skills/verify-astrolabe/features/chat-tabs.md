# Chat tabs

The open chats show as tabs across the top of the chat column. The route's
thread is the tab in front. Showing a thread anywhere (a sidebar row's plain
click, Search, `:b`, a fork, a new thread) replaces what the tab in front shows,
as a browser tab follows a link; a thread already open in another tab brings that
tab forward instead (no duplicates). From the sidebar, a new tab opens on Option/Alt-click,
middle-click, the row menu's **Open in new tab**, Alt+Enter on a focused row, or a drag
onto the strip; a thread clicked in Lineage, one opened from a change group's tab, and
**Open as a tab group** also add tabs.
Each tab keeps its own back/forward history. Beneath the strip, the chat in front
keeps T3 Code's own header (one borderless line as tall as the strip), conversation
and bottom terminal drawer. Its right panel runs the full height beside it (see
panes.md).

## Sub-features

- **Replace**: a plain click on a sidebar thread (or draft) shows it in the tab
  in front: the strip keeps its count, the front tab's title changes. A thread open
  in another tab brings that tab forward instead. On a thread row, Cmd/Ctrl-click and
  Shift-click stay upstream's multi-select and range select, opening nothing; on a draft row
  they fall through to a plain click and replace the front tab.
- **New tab**: Option-click (Alt-click), middle-click, right-click › **Open in new
  tab** (first item of the thread and draft row menus), or Alt+Enter on a focused
  row, open it in a new tab right after the one in front. Alt+Enter works because keyboard
  navigation (`keyboardNav/placeLists.ts`) turns it into an Alt-click; the rows' own key
  handlers ignore Alt.
  A draft has a "New thread" tab that keeps its place when the draft is sent.
- **History**: each tab remembers what it showed (thread keys, last 50 each way).
  The sidebar title-bar row's **Back**/**Forward** buttons (`[data-tab-history]`),
  `mod+[`/`mod+]`, and Space `t h`/`t l` walk the tab in front; they are faint at
  either end. A replace clears the tab's forward history. Stepping to a thread
  open in another tab brings that tab forward and leaves this tab as it was; a
  deleted thread or discarded draft in the history is skipped and forgotten.
- **Chrome tabs**: drawn as a pane's tabs are (panes.md): the tab in front in the
  toolbar background (`--tab-join`), outlined over a break in the strip's bottom border,
  with curved feet, the others bare until hovered
  with rules between them, a fading title and an always-shown ✕. The focused place's
  mark is a 2px bar along the top edge of the tab in front (a background-image).
- **Harness icon**: before the title, the thread's provider icon, the same one
  its sidebar hover card shows (running instance, else the selected one), dimmed on
  inactive tabs until hovered. A "New thread" tab shows the provider its
  composer has picked, else the one the composer would fall back to. The chat
  glyph shows only while no provider resolves (e.g. before the environment's
  config loads). No instance badge: at tab size it would cover the glyph.
- **Switch**: clicking a tab navigates to its thread, or to its draft.
- **Close**: the always-shown ✕ at the tab's end (`Close <title>`), or a
  middle-click. Closing the tab in front shows the tab after it, else the one
  before it, else `/` (also when the neighbour's route is not known yet). Clicking
  a tab whose thread is gone closes it.
- **Reorder**: dragging a tab along the strip.
- **Tab groups**: neighbouring chats of one change group stand behind the marker pane
  strips use (panes.md, Tab groups): `button[data-tab-group]` heading a
  `[data-tab-group-run]` inside the `Open chats` tablist, the window's number on its badge,
  the 2px primary line under the run and the chat in front outlined in it. A chat in
  several groups joins the run before it when it shares that group. Click the marker: when
  the chat in front is in the group, its right panel opens if closed and the group's tab
  comes to the front there (the group's shared run, beside every thread in it); otherwise
  the run's first chat comes to the front first and the tab opens beside it. A thread outside
  the group never gets the group's tab from the marker. Right-click: Expand/Collapse the
  group (collapsed shows the marker and the chat in front if the run holds it; the same
  collapse as the panes' on this page), Merge with the code / Stop merging with the code,
  Close the group's tabs (the run's chat tabs only, the panels' runs stay; closing the chat
  in front goes to the nearest tab outside the run). Dragging the marker moves the run's
  chats whole along the strip: mid-drag the run shows the dimmed marker alone, the
  insertion line goes only between runs, and panes ignore the drop. A member dragged out
  keeps its group and gets its own marker. Its number holds across the chat tabs, panes
  and right panels: the chat tabs count as open for its release. Open a group's threads
  together with **Open as a tab group** in its tab beside a thread (panes.md, Shared run).
- **Drag from the sidebar**: a thread row dragged past the sidebar onto the strip shows the
  insertion line and opens there as a tab, in front (`chatTabs/threadTabDrop.ts`, fed by the
  sidebar's drag past its list, as the composer's context drop is). A Cmd/Shift selection
  that includes the row opens together, in sidebar order; one already open moves to the line;
  the pin order is untouched. Only rows the sidebar lets you drag: pin-reorderable servers, and
  the Working shelf (its drags are always context drags, so they reach the strip). The rows use
  a pointer sensor, not HTML5 drag; Gotchas has how to walk it.
- **Persistence**: the list, the tab in front and the histories survive a reload,
  per device (`localStorage['t3code:chat-tabs:v1']`, `state.keys`, `state.active`,
  `state.histories`); a stored value with only `keys` (older builds) still loads.
- **Pruning**: a tab whose thread was deleted or whose draft was discarded
  closes once its environment's threads have loaded. When the first connect leaves a thread
  out (older settled threads, idle subagents), the tab reads "New thread" and loads that
  thread's family first; it closes only if that read leaves the thread out too. If the tab is
  in front, the thread page redirects first and the tab closes after.
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
preview_act click  role=button[name=/^<title>, /]                 # sidebar row: "<title>, [<status>, ]<project>"
preview_act click  [data-testid=sidebar-row-card] >> nth=1          # or by position; settled/snoozed rows are sidebar-row-slim, drafts sidebar-draft-row
preview_wait_for  locator=role=tab[name='<title>'][selected]
preview_act click  role=tab[name='<other title>']
preview_act click  role=button[name='Close <title>']
preview_act click  [data-testid=sidebar-row-card] >> nth=2  button="middle"   # new tab
# preview_act click sends no modifiers, so Option-click is Alt+Enter on the focused row:
# preview_evaluate document.querySelectorAll('[data-testid=sidebar-row-card]')[2].focus()
# preview_act press  key=Enter  modifiers=["Alt"]
# or button="right", then preview_act click role=button[name='Open in new tab']
preview_act click  [data-tab-history] >> role=button[name='Back']      # the tab in front's history
preview_act click  [data-tab-history] >> role=button[name='Forward']
# unscoped, a Browser tab in the right panel's own Back/Forward makes it ambiguous
```

Read the strip's tab groups (each run's first chat key and the marker's name):

```js
[...document.querySelectorAll('[aria-label="Open chats"] > [data-tab-group-run]')].map((run) => [
  run.dataset.firstKey,
  run.querySelector("[data-tab-group]")?.getAttribute("aria-label"),
]);
```

Drag a run by its marker as panes.md's Tab groups describes, dispatching `dragover` and
`drop` on `[data-chat-tab-strip]` at a `clientX` between two runs.

Read the strip (`*` marks the tab in front):

```js
[...document.querySelectorAll('[role=tablist][aria-label="Open chats"] [role=tab]')].map(
  (t) => t.getAttribute("aria-label") + (t.getAttribute("aria-selected") === "true" ? "*" : ""),
);
```

**Proof:** the strip read and `location.pathname` agree on the tab in front.
After `location.reload()` and `preview_wait_for role=tab[name='<title>']`, the
same read returns the same tabs. For layout, measure rather than eyeball:
`[data-chat-tab-strip]` spans only the chat column while the panel is open,
and the panel (`[data-preview-panel-mode]`) starts at the top of the window.
Tabs in the accessibility tree do not prove the strip paints. Hit-test the tab in
front: with `t = document.querySelector('[data-chat-tab][aria-selected=true]')` and
its rect `r`, `document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-chat-tab]') === t`
must be true. Then `preview_snapshot save:true` with the strip in view.

## Gotchas

- Tab lists are per origin. Dev servers reusing a port share one list, so a
  walk can inherit tabs from another server's threads. Those never prune,
  because that environment never loads. Clear the key first when it matters.
- Reorder uses HTML5 drag, and the whole strip takes the drop. `preview_act drag`
  drops at the target's centre, which lands after that tab. To test a drop at
  the start, dispatch `dragstart`, `dragover` and `drop` yourself with one
  `DataTransfer`, at a point between the strip's left edge and the first tab.
  Check with `elementFromPoint` that the point is in `[data-chat-tab-strip]`,
  because the sidebar's resize rail overlaps the strip's first 8px.
- With nothing open (`/`), there is no strip: ChatView draws it.
- The stored value is zustand's wrapper: read
  `JSON.parse(localStorage['t3code:chat-tabs:v1']).state` (`keys`, `active`,
  `histories[<key in front>]`).
- Middle-click is `preview_act click button="middle"` (server browser tabs only), which
  fires the row's or tab's `auxclick` (button 1). Elsewhere, dispatch
  `new MouseEvent('auxclick', {button: 1, bubbles: true})` on it. Option-click cannot
  be sent (`preview_act click` takes no modifiers): use Alt+Enter on the focused row.
- Drag from the sidebar: the rows' pointer sensor accepts synthetic events, and the
  preview tools send no raw CDP input. From `preview_evaluate`, on the row card (not an
  action button) dispatch a `pointerdown` with `{pointerId: 1, isPrimary: true,
  button: 0, buttons: 1, clientX, clientY, bubbles: true}`. Then dispatch several
  `pointermove`s with the same pointerId, `buttons: 1` and coordinates, more than 6px
  in total, ending at a point inside `[data-chat-tab-strip]` and outside the sidebar's
  thread list. Finish with a `pointerup` there. A move with `buttons: 0` ends the drag.
- The tab in front's curves are visual: screenshot the strip, and
  read `getComputedStyle(tab, '::before').backgroundImage` for the gradient.
- Opening a chat focuses its composer. Keys sent "to the page" afterwards type into
  the draft (and with Vim on, in insert mode). Move focus first; see which-key.md.
