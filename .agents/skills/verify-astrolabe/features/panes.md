# Tabs and splits in the main area

The main area beside the sidebar is a tree of panes, each with a tab strip.
The thread's conversation is the **Main Thread** tab. Terminal, Browser, Files,
Diff, Pull request, Linked pull requests and Device open as tabs, which replace
T3 Code's terminal drawer and right panel.

## Sub-features

- **New tab menu** in every strip: Browser, Terminal, Files, Diff, Pull request,
  Linked pull requests, Device, then **Thread** (see guest-threads.md). Items
  without a source are disabled. On a real thread Diff is enabled even with no
  changes (it opens to "Click to show"); Pull request needs a linked PR. Device
  opens "Set up devices" when none is set up (Escape cancels).
  Diff, Pull request and Linked pull requests are disabled on a fresh draft.
- **Pane actions** (`⋯` at the strip's end): Split right, Split down, Close pane.
- **Tab context menu** (right-click a tab): Close, Close others, Close tabs to
  the right, Split right, Split down. A lone tab cannot split. A guest adds
  **Open in its own workspace**.
- **Maximize pane** / **Restore pane** button. It appears only when there is
  more than one pane.
- **Drag a tab** to another strip or a pane edge. Cmd/Ctrl-click and
  Shift-click select several tabs, and they drag together.
- **Empty tab** shows T3 Code's own surface launcher.
- **Shortcuts**: the terminal toggle (Cmd+J) goes to a terminal tab and back,
  the right panel toggle (Cmd+Alt+B) does nothing, and the right panel's
  maximize maximizes the focused pane. Maximize has no default key, so bind one
  in Settings → Keybindings to test it.
- **Persistence**: each thread's arrangement survives a reload, per device.

## How to get to it (user POV)

Open any thread. The strip sits at the top of the main area. The **New tab**
`+` follows the last tab, and **Pane actions** ends the strip.

## Driving it with the Browser panel

Once there are two panes, every strip has its own `New tab`, `Maximize pane`
and `Pane actions`, so add `>> nth=0`, `>> nth=1`, and so on. A maximized
pane's hidden sibling keeps its buttons in the DOM.

```
preview_click  role=button[name='New tab']
preview_click  role=menuitem[name=/^Terminal/]
preview_click  role=button[name='Pane actions']
preview_click  role=menuitem[name='Split right']
preview_click  role=button[name='Maximize pane']
preview_drag   source=role=tab[name='Terminal 1']  target=role=tab[name='Main Thread']
preview_click  role=tab[name='Terminal 1']  button=right
preview_click  role=button >> text=/^Close$/   # 'Close' alone also matches 'Close others'
preview_click  role=button[name='Confirm']     # closing a terminal asks first
```

Read the panes and their tabs (`*` marks the active one):

```js
[...document.querySelectorAll("[role=tablist]")].map((l) =>
  [...l.querySelectorAll("[role=tab]")].map(
    (t) => t.textContent.trim() + (t.getAttribute("aria-selected") === "true" ? "*" : ""),
  ),
);
```

Guest tabs' text runs their title and branch together; their `aria-label` is
the title alone.

Read the stored trees. There is one key per thread whose arrangement differs from
the default, so list them all and pick by thread id. A thread back at the default
has no key:
`Object.keys(localStorage).filter(k => k.startsWith('t3code:panes:v1:')).map(k => [k, JSON.parse(localStorage.getItem(k)).root])`.
Writes are debounced, so wait about a second after an action before reading.
After Split right it is a `branch` with `direction: "row"` holding two `leaf`s,
`conversation` and `surface:terminal:term-1`.

**Proof:** the tablist read shows the expected panes, and after
`location.reload()` plus `preview_wait_for role=tab[name='Main Thread']` the same
read returns the same arrangement.

## Gotchas

- Browser panel limits: `preview_click` sends no modifier keys, so multi-select
  is UNVERIFIABLE, and `preview_drag` drops at the target's centre, so pane-edge
  drops are UNVERIFIABLE. Report those as such. Do not fake them through state.
- The empty-tab launcher has no path these tools can reach (a lone tab cannot
  split, and edge drops are out of reach). Report it UNVERIFIABLE.
- "Close others" and "Close tabs to the right" stay enabled when the only tab
  they would close is Main Thread, which never closes, and then they do nothing.
  This is a known bug, not a walk failure.

- A terminal tab first shows its shell's process name (for example `mise`),
  then settles to `Terminal 1`. Match by role, or wait before reading names.
- On web, the tab context menu renders as plain `button`s, not `menuitem`s. The
  Pane actions and New tab menus do use `menuitem`.
- Dragging a pane's last tab away closes that pane.
- The terminal tab brings T3's own terminal toolbar ("Split Terminal
  Horizontally (⌘D)" and so on). That is upstream's, not the panes'.
