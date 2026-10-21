# Keyboard navigation: moving focus between places, through their lists, and scrolling

Focus moves between the app's places the way Vim and tmux move between windows,
the sidebar's and the rail's lists move with Vim's keys, and `d`/`u` scroll the
focused place. A place is a whole region: the icon rail (`nav[data-app-rail]`,
leftmost), the sidebar on screen (Threads, Wikis or Pull Requests), the chat
column, and each pane (the right panel's, the Wikis area's, the Pull Requests
area's). Never anything inside one (no stop for a tab strip, the timeline or the
composer).

## Sub-features

- **Commands** `focus.left`, `focus.down`, `focus.up`, `focus.right` (menu labels
  "Focus left/down/up/right", table rows "Focus Left" …, palette rows with arrow icons).
  The neighbour is geometric: the nearest place that way overlapping the focused one
  across the direction (between equals, the one focused last), else the nearest
  centre. No wrap: at an edge the command shows faint in the menu. Skipped: a collapsed
  or off-screen sidebar, the chat column while the right panel is maximized (width 0),
  panes `inert` behind a maximized pane. With focus on the page (nothing focused), it
  acts from the place last clicked, else the chat column.
- **Landing**: back on what last had focus in that place, if still there; else the
  composer (`[data-testid=composer-editor]`), a pane's tab in front
  (`[data-pane-tab][aria-selected=true]`), the sidebar's or the rail's last focused,
  current (`aria-current`) or first row/button; else the place's first focusable.
- **Triggers**: the menu's root arrows and `h`/`j`/`k`/`l` (Space or Cmd+K first;
  rows read `← | h`, `↓ | j` …; the root's cursor then moves only with Ctrl+N/Ctrl+P
  on a Mac and the mouse, while in a group the arrows still move it unless the group
  binds them); Ctrl+H/J/K/L (Ctrl on a Mac
  too) with `when: !editableFocus && !terminalFocus`, so never in a field, an editor
  (Vim or not) or a terminal, and repeating while held; where `mod` is Ctrl, Ctrl+J
  and Ctrl+K stay `terminal.toggle` and `whichKey.open` (earlier in the defaults). In
  a Vim editor's normal mode `<C-w>h/j/k/l`, `<C-w><Left>` …, `<C-w><C-h>` …; plain
  Ctrl+H there stays Vim's. The window keys are Vim keymap entries
  (`<C-w><character>`), so a vimrc `nnoremap <C-h> <C-w>h` works.
- **Repeat window**: a focus move or a scroll run from the menu by its key arms the
  menu for `menuRepeatWindowMs` (client setting, default 500, 0 off; Settings ›
  Keybindings › This device › Repeat window, search "repeat window"). While armed,
  the root's repeatable keys (arrows, `h`/`j`/`k`/`l`, `d`/`u`; held too) run again
  with the menu hidden, each restarting the window; at an edge the key is spent but
  moves nothing, except up/down from a sidebar row or rail button, which ends the
  window and steps the list (`focusEntry` in `commands.ts` makes that move not
  repeatable). Focus landing in a text field (the composer in insert mode, a note)
  does not end it, so a run of moves passes through the chat; the first key that does
  not repeat ends it and reaches the field. Any other key ends it and reaches the page (Space opens the
  menu again, a letter types); Escape only ends it; a click, the window losing focus,
  or the timeout end it. A click on the menu row, the Ctrl shortcuts, and `<C-w>h`
  never arm. The mechanism is generic: `AppCommand`'s `repeatable` flag, read by
  `pressRepeat` in `whichKey/menu.ts`.
- **Focus mark**: the place keys act from (last focused or pressed in) wears
  `[data-focused-place]`; on a pane or the chat column its tab in front
  (`[data-pane-tab]` / `[data-chat-tab]` with `aria-selected=true`) gets a 2px bar in
  `--focus-bar` (the theme's `focusBar` role; rust in Mercurian, the focus color in themes
  without one) along the tab's top edge (a background-image). It follows mouse focus too. The sidebar
  and the rail have no mark of their own beyond the attribute: their focused row or
  button's light ring shows where focus is.
- **Sidebar list** (focus on a row: `sidebar-row-card`, `sidebar-row-slim`,
  `sidebar-draft-row`, `wiki-sidebar-row[-slim]` outside search results, a PR row's
  button under `[data-pull-request-key]`, the legacy sidebar's `thread-row-*`):
  `j`/`k`/ArrowDown/ArrowUp step, `gg`/`G`/ Home/End jump, folded and hidden rows
  skipped; Enter clicks the row and keeps focus on it (Threads: the opened thread's
  composer does not take focus, `keepsListFocus`; a click still hands it focus),
  Enter shows it in the tab in front, Alt+Enter clicks with Alt (opens it in a new
  tab; any other Alt chord stays the page's), Mod+Enter Mod-clicks it (Threads:
  toggles selection, in Wikis and PRs too); `/` opens the sidebar's search; Escape focuses the place to the right;
  Space opens the keyboard menu. Keys act only with the row itself focused, not a
  control in it. The right panel's launcher letters leave a focused row its list keys
  (`gg`, `G`). The reached row shows the rows' light keyboard ring (`:focus-visible`:
  a 1px `--ring` inset edge and a 3px `--ring`/24% band, as inputs have), apart from
  the current row's fill. Rows are a roving tab stop: after a row has focus, only it
  keeps `tabindex=0`.
- **Rail list** (focus on a rail button, `[data-app-rail] [data-slot=sidebar-menu-button]`:
  the sections, then **Toggle main sidebar** last at the foot):
  the same keys as the sidebar list, minus `/`; Enter opens the section (or toggles
  the sidebar) and keeps
  focus on the button; Escape goes to the sidebar (or the main area, collapsed). The
  buttons are their own roving tab stop and show the same light ring
  (`focusRing="light"` on `SidebarMenuButton`).
- **Scrolling** `scroll.down` / `scroll.up` (menu "Scroll down/up", table "Scroll
  Down/Up", palette rows with double-chevron icons): half the scroll area's height,
  instant, on the main scroll area of the place keys act from: the largest element in
  the place (itself included) with `overflow-y` auto/scroll/overlay and content to
  scroll, by visible area (`scroll.ts`; no markers). Triggers: the menu's root `d`/`u`
  (repeatable: Space `d` `d` `d`) and Ctrl+D/Ctrl+U with `when: !editableFocus &&
!terminalFocus` (so Vim's Ctrl-D/Ctrl-U in editors stay Vim's); where `mod` is
  Ctrl, Ctrl+D/U stay `diff.toggle`/`usage.open`. Faint in the menu when the area is
  at that end (or the place has none, like the rail).

## How to get to it (user POV)

Click a sidebar row or the chat, then Ctrl+H/J/K/L, or Space `l` (or →), then `l`
again within half a second. In the composer with Vim on, Escape, then Ctrl+W `l`.
Space `d` scrolls the place half a page.

## Driving it with the Browser panel

```
preview_click     [data-testid=sidebar-row-card] >> nth=0     # focus a row
preview_press     key=l modifiers=["Control"]                 # to the main area
preview_press     key=h modifiers=["Control"]                 # back to the sidebar
preview_press     j                                           # next row
preview_press     Space                                       # leader
preview_press     l                                           # focus right, arms
preview_press     l                                           # again, within 500 ms
preview_press     key=d modifiers=["Control"]                 # scroll down half a page
```

Read where focus is, by place and element:

```js
(() => {
  const a = document.activeElement;
  const place = a?.closest(
    "[data-app-rail], [data-app-sidebar], [data-chat-column-maximized-away], [data-pane-id], [data-slot=sidebar-inset]",
  );
  const name = (el) =>
    el?.matches("[data-app-rail]")
      ? "rail"
      : el?.matches("[data-app-sidebar]")
        ? "sidebar"
        : el?.matches("[data-pane-id]")
          ? `pane ${el.getAttribute("data-pane-id")}`
          : el?.matches("[data-chat-column-maximized-away]")
            ? "chat"
            : (el?.getAttribute("data-slot") ?? null);
  const marked = document.querySelector("[data-focused-place]");
  const bar = marked?.querySelector(":is([data-pane-tab], [data-chat-tab])[aria-selected=true]");
  return {
    place: name(place),
    element: a?.getAttribute("aria-label") ?? a?.getAttribute("data-testid") ?? a?.tagName,
    marked: name(marked),
    bar: bar ? getComputedStyle(bar, "::after").backgroundColor : null,
    ringed: a?.matches(":focus-visible") ?? false,
  };
})();
```

Read the scroll position of the place keys act from, as `scroll.ts` picks its area:

```js
(() => {
  const place = document.querySelector("[data-focused-place]");
  if (!place) return null;
  const bounds = place.getBoundingClientRect();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, bounds.right) - Math.max(r.left, bounds.left);
    const h = Math.min(r.bottom, bounds.bottom) - Math.max(r.top, bounds.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const [area] = [place, ...place.querySelectorAll("*")]
    .filter(
      (el) =>
        el.scrollHeight - el.clientHeight > 1 &&
        ["auto", "scroll", "overlay"].includes(getComputedStyle(el).overflowY) &&
        !el.closest("[inert]"),
    )
    .sort((a, b) => visible(b) - visible(a));
  return area
    ? {
        scrollTop: Math.round(area.scrollTop),
        clientHeight: area.clientHeight,
        scrollHeight: area.scrollHeight,
        cls: area.className.slice(0, 60),
      }
    : null;
})();
```

**Proof:** after each key the read names the expected place and element, `marked`
equals `place`, `bar` is the focus colour on a pane or the chat (null on the
sidebar and the rail), and a row or rail button reached by the list keys reads
`ringed: true`. After Space `d`, `scrollTop` grows by half of `clientHeight` (less at
the end). Screenshot the tab bars once in light and once in dark: only one pill
carries the bar.

## Flows

1. **Sidebar to chat to panes.** On a chat with the right panel open and split right:
   click a sidebar row → Ctrl+L → place `chat`, element `composer-editor`, the chat
   tab's bar → click the chat's title (focus on the page) → Ctrl+L → the left pane, its
   active pill, the bar moved to that pill → Ctrl+L → the right pane → Ctrl+L →
   unchanged (no wrap) → Ctrl+H twice → `chat` → Ctrl+H → sidebar, the row clicked
   first, no bar anywhere.
2. **Repeat window.** From the sidebar: Space `l` → `chat` (the composer: the window
   ends here, so an `l` now types) → click the chat's title, Space `l` → the left pane
   → `l` within half a second → the right pane → wait 1 s → `l` → nothing moves (the
   window passed; with focus on a pill, `l` is no key of its). Space → (the arrow) from
   a pane → the pane to its right, `→` again repeats. From a pane: Space `h` `h` →
   sidebar → `j` at once → the next row (the list's, not a spent focus move). From the
   chat: Space `h` → sidebar → Escape → `h` → unchanged (a row has no `h`). Set Repeat
   window to 0 → Space `l` `l` → one move. Reset restores 500.
3. **Remembered focus.** In the left pane click a control inside the content (not the
   pill) → Ctrl+H → chat → Ctrl+L → that same control, not the pill.
4. **Maximized and collapsed.** Maximize the left pane (Cmd+K `p` `m`) → Ctrl+L from it →
   unchanged (the other pane is inert) → restore. Collapse the sidebar (Cmd+K `s` `s`) →
   Ctrl+H from the chat → the rail (the sidebar is skipped) → Ctrl+H → unchanged; Cmd+K
   `h` row faint.
5. **Not while typing.** In the composer (Vim off) Ctrl+H → caret behaviour only, place
   stays `chat`. In a terminal tab Ctrl+L → the terminal's (place unchanged). With Vim
   on: Escape, Ctrl+W `l` → the right panel's pane, then plain `h` → no move (Vim's
   keys never arm); Ctrl+H in normal mode → stays in the composer.
6. **Mouse marks too.** Click inside the right pane's content → the bar on its active
   pill; click the composer → the bar on the chat tab; click a sidebar row → no bar.
7. **Sidebar list.** Focus a thread row → `j` `j` → two rows down, the light ring on it,
   the active thread keeps its fill → `G` → last row, `gg` → first (also with an empty
   right-panel tab showing the launcher: Graph does not open) → Enter → that thread
   opens and focus stays on the row → ArrowDown → the next row → Escape → the composer
   → Ctrl+H, `/` → the search field focused → Escape, click a row, Escape → focus in
   the main area. On Wikis: `j` to a document → Mod+Enter → it joins the selection. Fold "Open changes" → `j` passes over its rows. On Pull Requests: ArrowDown,
   `j`, Enter → that PR in a pane, focus still on the row → `k` → the row above.
8. **Rebind in the vimrc.** Settings › Keybindings › Vim, add Normal `<C-h>` → `<C-w>h`
   (not recursive) → in the composer's normal mode Ctrl+H → the sidebar → remove the
   mapping → Ctrl+H stays in the composer, Ctrl+W `h` still moves.
9. **Rail.** From a sidebar row: Ctrl+H → the rail, on the current section's button,
   its light ring (`marked: rail`) → `j` → the next button → `G` → Settings → `gg` →
   Threads → Enter → Threads opens, focus on the button → `G` → Toggle main sidebar →
   Enter → the sidebar collapses, focus stays on the button → Enter → it opens again
   → Escape → the sidebar.
   Collapse the sidebar → Ctrl+H from the chat → the rail → Ctrl+L → the chat. Tab
   into the rail → only one button is a tab stop.
10. **Scrolling.** On a long thread: click the chat's title → Space `d` → `scrollTop`
    of the timeline up by half its height → `d` `d` within half a second → two more →
    Space `u` → back up. Ctrl+D/Ctrl+U the same; in the composer Ctrl+D stays the
    editor's. Space `l` to a pane with a long note (Wikis) or a diff → Ctrl+D scrolls
    that pane. At the top, Cmd+K shows `u` faint; on the rail both are faint. Ctrl+D on
    a sidebar row scrolls the list.

## Gotchas

- `preview_press` sends `modifiers:["Control"]` for Ctrl+H; on a Mac host Meta is
  Cmd, which is not these keys.
- Focus on the page first for the leader: a focused row takes Space as the leader
  too, but a focused button elsewhere presses it.
- In the repeat window `h`/`l` are still focus moves: after Space `h` into the
  sidebar, `h` goes on to the rail. `j`/`k` there step the list at once.
- Each `preview_press` is a round trip; two of them can straddle the 500 ms window on
  a slow walk. Raise Repeat window for the walk if presses land late, and reset it
  after.
- The server resolves the default menu keys and shortcuts: a server started before
  these defaults changed lacks the arrows, `d`/`u` and Ctrl+D/U until restarted.
- The scroll area is found by size, not by a marker: with a terminal drawer or a tall
  composer larger than the timeline, Space `d` scrolls that instead.
- The focus mark follows the last place focused or pressed, so it stays while a
  dialog or popover has focus and is absent on a fresh load until the first focus or
  click.
- `:focus-visible` is the browser's call: after a click a row shows no ring until a key
  moves focus.
- After a key the focus move waits a frame (and for the palette to close when run
  from there): read after `preview_wait_for` or a short pause.
- Rows rendered after the last row focus (a new thread) are tab stops until a row
  takes focus again.
- At 980px or less the right panel has no panes; keep the viewport wider.

## Owns

`apps/web/src/keyboardNav/` (places in `regions.ts`, lists in `placeLists.ts`,
scrolling in `scroll.ts`), the `focus.*` and `scroll.*` entries in
`whichKey/commands.ts` and their `repeatable` flag, `takesTyping` in `whichKey/leader.ts`,
the rail's `focusRing="light"` (`components/ui/sidebar.tsx`, `AppIconRail.tsx`),
`keepsListFocus` in `ChatView.tsx`'s composer focus, the launcher guard in
`RightPanelTabs.tsx`, the repeat window in `whichKey/menu.ts` (`pressRepeat`,
`createWhichKeyMenu`'s arming) and `WhichKey.tsx`, `menuRepeatWindowMs` in
`packages/contracts/src/settings.ts` and its row in `KeybindingsDeviceSettings.tsx`, the
window keys in `whichKey/doors.ts` (`appVimKeys`) and `packages/editor/src/vim.ts`
(`defineWindowKeys`, `vimHostKeys`' `window`), `openLeaderFrom` in `whichKey/doors.ts`,
`openSearch` in `SidebarThreadHeader.tsx`'s section handle, the Ctrl+H/J/K/L and Ctrl+D/U rules in
`packages/shared/src/keybindings.ts`, the `menu h`…, arrow and `d`/`u` rules and named menu keys in
`packages/shared/src/keybindingTriggers.ts`, the rows' focus ring in
`SIDEBAR_ROW_SURFACE_CLASS` (`components/sidebar/SidebarCard.tsx`), and the
`[data-focused-place]` tab bar at the end of `index.css`.
