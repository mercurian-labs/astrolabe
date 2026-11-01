# Keyboard menu (which-key) and the leader key

Cmd+K (Ctrl+K off Apple) opens a which-key menu of the app's commands, hanging
from the main area's top-right corner. The device's leader key (Space by default)
opens it too, when you are not typing and in Vim's normal mode. The palette is one
key further: **Search** is the menu's `/`, Cmd+K again, or Cmd+/ (Ctrl+/ off Apple)
anywhere but the terminal; the **Command Palette** is its `:` (or Cmd+P anywhere but the terminal).
The menu, the Command Palette and shortcuts run the
same commands, and all three kinds of trigger (Shortcut, Menu keys, Alias) live in
`keybindings.json`.

## Sub-features

- **Menu** (`[data-which-key]`): a muted heading naming the groups entered (`Menu`,
  `Menu › Go to`; past four levels the middle folds to `…`, with the whole trail on
  hover), the group's rows, a footer (`Esc close`; in a group `Backspace back · Esc
  close`) whose hints are buttons that do what they say. A row shows every key that runs it at this level,
  joined by `|` (`g w | w w` style); Search's row shows only `/`, though Cmd+K
  pressed again at the root still opens Search. A group key opens its group, a command key runs and
  closes the menu. Backspace goes up (at the root it closes); Escape, a click
  outside, or the window losing focus closes it; Cmd+K inside a group goes back to
  the root. Rows take a click (hover highlights), and Ctrl+P/Ctrl+N on a Mac move a
  highlighted row (`li[data-highlighted]`) that Enter chooses, in every group;
  ArrowUp/ArrowDown move it too, except in a group that binds that arrow: the root
  (the focus moves, by default) or a user's `menu p arrowdown`, where it runs its row.
  So at the root off a Mac only the mouse moves the cursor. An unbound key shows **Not bound** and keeps the menu open; a command
  with nothing to act on here shows faint, **Not available here** (e.g. `g p` where
  Pull Requests is unsupported). Cmd+K shows it at once; the leader after ~300 ms,
  so a fast `Space g w` runs without it flashing.
- **Top level** (defaults, sixteen rows in this order): `:` Command palette, `/`
  Search (always enabled), `n` New thread or document, `f` Find file (upstream's
  file picker), `←`/`h`, `↓`/`j`, `↑`/`k`, `→`/`l` Focus left/down/up/right (rows
  read `← | h`; repeatable: a repeat window follows, see keyboard-nav.md), `d` Scroll
  down and `u` Scroll up (repeatable), `g` Go to, `t` Tabs, `p` Panes, `s` Sidebar,
  `w` Wikis, `,` Settings. `n`'s
  label follows the section (on Wikis "New document", on Projects "Add a project", which opens
  the palette's add flow; where no section header is mounted, such as Changes, it is
  upstream's "New thread"). The popup is `aria-label="Keyboard commands"` (`[data-which-key]`),
  and Not bound / Not available here is a `role=status` note. After a command runs the
  popover fades out, so wait for `[data-which-key]` to detach before reading "closed".
  A prefix the user added with no built-in name shows as `+N` (its entry count).
- **Groups** (defaults): `g` t Agents, w Wikis, r Projects, p Changes,
  u Usage, s Settings. `t` `]` next tab, `[` previous, `c` close, `k` link or unlink the focused tab (panes.md, Linked tabs), `r` reopen closed (panel and
  browser tabs, not chats), `h` Back and `l` Forward (upstream's
  `navigation.back`/`forward` through their shortcuts: in Agents, Wikis, Projects
  and Changes they walk the tab in front's history and are faint at either
  end; elsewhere the route history). `p` `v` split right, `s` split down, `c` close pane, `m`
  maximize/restore, `f` Full screen pane / Exit full screen (panes.md), `r` Toggle
  right panel (parks or restores the front chat's linked tabs); the focus moves are root keys now, not in Panes.
  `s` `s` toggle sidebar. `w` `w` open
  Wikis, `f` find or create a document.
- **Search** (Cmd+/, the menu's `/`, Cmd+K again; the palette's plain mode, dialog
  name `Search`): empty, it lists
  Recent Threads only; upstream's Actions are the Command Palette's. A query finds
  Projects, Settings, Threads and every wiki's Documents (a document opens as a
  Wikis tab from anywhere). Typing `>` or `:` first switches to the Command Palette
  (the character is consumed). On a Mac, Ctrl+N/Ctrl+P in the field move the
  highlighted row as ArrowDown/ArrowUp do, in every dialog on the palette's field
  (Search, the Command Palette, the file picker, content search, the wiki finder).
- **Command Palette** (Cmd+P, the menu's `:`, Vim's `:`): a chevron
  (`ChevronRightIcon`) replaces the search icon and the field holds only what
  follows the query's internal colon; Backspace in the empty field goes back to
  Search, and Cmd+P in it closes the palette (from Search, the file picker or
  content search, Cmd+P switches to it). Empty, it lists every command once (label,
  its alias such as `q[uit]` or else its menu keys as `Space t ]`, its shortcut)
  under Commands, then upstream's Actions. An alias runs its command: `q` closes the
  focused pane's tab when focus is in the panes (the Wikis area is all panes), else
  the chat tab in front; `w` send or save, `sp`/`vs` split, `e <name>` a document,
  `b <name>` a thread (open chat tabs first), `noh`. Picking `b`/`e` fills the line
  and waits for the name. Any other line shows
  **Run in the editor** when opened from a Vim editor (see vim-mode.md), else **Not
  an editor command**. A request to open the palette made before it mounts (a key
  just after a page load) waits for it.
- **Leader key**: Settings › Keybindings › This device › **Leader key**: Space
  (default), Another key… (records one key; not Escape, Enter, Tab, Backspace,
  Delete or a modifier), or None; stored as `leaderKey` in
  `localStorage['t3code:client-settings:v1']` (unset reads the old
  `spaceLeaderEnabled`). It fires when focus is not in a text field, a control
  (`tabindex>=0`) or a dialog, not on a held key (nor with Shift when the leader is Space), and in a Vim editor's
  normal/visual mode. It also fires on a focused sidebar row, icon-rail button, or
  pane or chat tab (`[data-pane-tab]`, `[data-chat-tab]`), where Space would
  otherwise press it. Cmd+K always works; in the terminal Cmd+K stays the
  terminal's (`when: !terminalFocus`). Its description reads "Another way to open
  the keyboard menu, besides ⌘K. …".
- **Triggers in `keybindings.json`**: one rule shape `{key, command, when?}`. `key`
  is a shortcut (`mod+k`), menu keys (`menu g w`, single keys spaced; `space` and `arrowleft`…`arrowright` by name) or an alias
  (`:q[uit]`, bracketed tail optional); `when` is for shortcuts only. A `-command`
  rule removes that command's matching default (`{"key": "menu t ]", "command":
  "-chatTab.next"}`). A user rule replaces only its own kind's defaults for that
  command. Menu and alias defaults live in code, not the file. Bad rules are
  skipped with a server warning and a keybindings toast, as upstream reports bad
  shortcuts (`Invalid menu keys "…"`, `Invalid alias "…"`). `leader …` is not a
  kind: it fails as a shortcut.
- **Keybindings table** (Settings › Keybindings): one row per command, with
  Shortcut, Menu keys (header hint "after ⌘K") and Alias columns. A row's id is
  `keybinding-<command>`, and command ids contain a dot, so select it with
  `[id='keybinding-chatTab.next']` or `document.getElementById(...)`
  (`#keybinding-chatTab.next` matches nothing). Several bindings of one kind share
  a cell joined by `|`, an empty cell shows `–` (an en dash, hidden while the row is hovered or focused, when `+` takes its place). `g r`'s command reads "Section: Projects". A filter select (`aria-label="Kinds of keybinding shown"`: All,
  Shortcuts, Menu keys, Aliases) narrows the columns and drops rows with nothing
  of that kind; the search box matches labels and keys (`t ]`, `menu t ]`, `⌘W`,
  `mod+w`). A shortcut's keycaps (`aria-label="Edit shortcut for …"`) open a
  popover holding upstream's row, recording at once (When, conflicts, ⋯, Save).
  Menu keys and aliases (`aria-label="Edit menu keys for …"` / `"Edit alias for
  …"`) open a recorder popover with Save. A cell's `+` (`aria-label="Add
  shortcut|menu keys|alias for …"`, visible on hover) opens upstream's new-binding
  form fixed to that command and kind; adding beside defaults writes them too. A
  removed default shows struck through in its cell; the row's `⋯` (`aria-label=
  "Actions for …"`) lists **Remove `x`**, **Reset `x` to default**, and **Restore
  default `x`** per binding. Narrow (under 44rem), the columns stack as labelled
  lines. **Add keybinding** asks for the command, the kind, then records.
- **Migrations** (once each, recorded in `$home/userdata/keybindings-migrations`):
  an untouched `mod+k → commandPalette.toggle` becomes `whichKey.open`, an
  untouched `mod+shift+k → pullRequest.copyNumber` gains `!editorFocus`, and an
  untouched `mod+p → filePicker.toggle` (`!terminalFocus`) becomes
  `commandLine.open`.

## How to get to it (user POV)

Press Cmd+K anywhere, or the leader key (Space) while not typing; Cmd+P for the
Command Palette. Rebind everything in Settings › Keybindings.

## Driving it with the Browser panel

```
preview_act press     key=k modifiers=["Meta"]                 # opens the menu
preview_act press     g                                        # into Go to
preview_act press     w                                        # runs: /wikis
preview_act click     role=heading[name='Wikis']               # Wikis only (no composer); on a chat use Cmd+K h
preview_act press     Space                                    # leader (wait 300 ms+)
```

Read the menu: `document.querySelector('[data-which-key]')?.innerText`. Prove it
paints where it should (rows in the DOM are not proof):
`const m=document.querySelector('[data-which-key]').getBoundingClientRect(), i=document.querySelector("[data-slot='sidebar-inset']").getBoundingClientRect(); [m.height>0, document.elementFromPoint(m.left+m.width/2, m.top+m.height/2)?.closest('[data-which-key]')!=null, Math.abs(i.right-12-m.right)<4]`
should be all true (it hangs 12px in from the main area's right edge). Read the
palette: `document.querySelector('[data-command-palette] input')?.value` and its
rows `[...document.querySelectorAll('[data-command-palette] [data-slot=command-item]')].map(r => r.innerText)`.
The field shows no `:` in the Command Palette (a chevron leads it instead); the
query is `':' + value`. The
dialog's name stays `Search` in both modes: type with
`preview_act type role=dialog[name='Search'] >> role=combobox`.

Rules: back up `$home/userdata/keybindings.json` (the walk's `.t3`, never
`~/.t3/userdata`) before editing it, append rules with a short `node -e` script,
and copy the backup back when done. The server picks changes up live.

## Flows

1. **Menu basics.** On a chat: Cmd+K → menu at the top right (the paint read above)
   with the sixteen top-level rows (Search's row shows only `/`), `Esc close` footer
   → Ctrl+N twice, Ctrl+P → `:` row highlighted → `g` (or click Go to) → heading
   `Menu › Go to`, rows Agents, Wikis, Projects, Changes (a faint "Section: Changes"
   where pull requests are unsupported), Usage, Settings → click **Backspace back**
   → heading `Menu` → `g` → `z` → "Not bound", still open → click Agents, or `w`,
   or `r` (`/repositories`) → the URL changes, menu closed.
2. **Leader across sections.** On Wikis, click the heading → Space → menu after the
   delay, heading `Menu`, rows say "Search"/"New document" → `w` `f` →
   the finder (`[data-testid=wiki-finder]`) open with focus in its field.
3. **Settings door.** Cmd+K `,` → `/settings/general`, with Settings / General in the
   title bar (Settings has no tabs).
4. **Tabs.** With several tabs in the focused pane, focus off the composer, Cmd+K `t` `[` → the
   previous tab of that pane is in front (panes read in panes.md).
5. **Panes.** Open the right panel with two surfaces in one pane; focus a non-terminal
   tab → Cmd+K `p` `v` → two panes, focus in the new right pane → Cmd+K `:` `q`
   Enter → one pane, the chat's pane unchanged (panes.md read).
6. **Palette.** Cmd+K Cmd+K → Search, empty query, Recent Threads only; Escape,
   then Cmd+/ → Search again. On a Mac, Ctrl+N, Ctrl+N, Ctrl+P move the highlighted
   row (`[data-command-palette] [data-slot=command-item][data-active]`) down, down,
   up, as the arrows do. Type a
   document's name from Agents → a Documents row → move the highlight onto it (Threads
   rows arriving late can take it; check `[data-active]`) → Enter → `/wikis` with it as a
   tab. Cmd+K `:` → chevron, empty field, command rows; type `q` → one row,
   Close tab; Backspace twice → Search; type `>` → Command Palette again, field
   empty; Escape, then Cmd+P → Command Palette; Cmd+P again → closed. Cmd+K `f` →
   the file picker (`aria-label="File picker"`); Cmd+P there → Command Palette.
7. **Leader key.** Leader key → Another key… → press `\` → Space on the page and in
   a composer's normal mode opens nothing, `\` opens the menu →
   Leader key → None → only Cmd+K opens it → reset to Space.
8. **Rules in the file.** Add `{"key":"menu t ]","command":"-chatTab.next"}`,
   `{"key":"menu x n","command":"chat.new"}` and `{"key":"menu gx","command":"chat.new"}`
   → Cmd+K shows an `x` `+1` row, `t` has no `]` row, and the dev log has
   "ignoring invalid keybinding entry" for `menu gx` (`Invalid menu keys`) →
   restore the file.
9. **Keybindings table.** Settings › Keybindings, search `t ]` (field
   `aria-label="Search keybindings"`) → the Chat Tab: Next row
   (`[id='keybinding-chatTab.next']`), `t ]` in Menu keys and `–` (an en dash) in Shortcut (it
   has no default shortcut; ⌘⇧] is Thread: Next's). Search `Section: Wikis` → one
   row, Menu keys `g w | w w`, Alias `–` → `⋯` Remove g w → `g w` struck through and
   `{"key":"menu g w","command":"-section.wikis"}` in the file → `⋯` Restore default
   g w → the rule is gone → click `button "Edit menu keys for Section: Wikis: g w"` (the
   field starts with `g w` and appends each key, so press Backspace twice), press `g` `x`,
   Save → the file holds both
   `menu w w` and `menu g x` → hover the Alias cell, `+`, type `wk`, Save → the file
   holds `:wk` → filter Aliases → only commands with aliases, one column → restore
   the file. Narrow the window under 44rem → each row stacks Shortcut / Menu keys /
   Alias lines.

**Proof:** the menu and palette reads at each step, the menu's paint read in flow 1,
the URL or strip reads after a
command runs, the `keybindings.json` reads for flows 8 and 9, and saved screenshots
of the root menu, a group and the Command Palette.

## Gotchas

- Put focus on a row before Space (Cmd+K `h`), or open the menu with Cmd+K: clicking a
  sidebar heading or `document.activeElement.blur()` leaves focus on the page, where
  type-to-focus sends Space into the composer. After opening a chat, focus is in its composer, where Space
  types. A focused sidebar row, rail button or pane/chat tab opens the menu; on any
  other focused switch or button, Space presses it (correctly, not a leader).
- Inside the terminal, Cmd+K clears the terminal instead (by design).
- Cmd+K opens the menu from a wiki note too; the editor's link key is Cmd+Shift+K.
  Cmd+/ in a note opens Search, not a comment toggle.
- Cmd+K while the palette is open closes it.
- The table shows menu keys alone (`g w`), whatever the leader key; the file says
  `menu g w`. The Command Palette's list prefixes them with the leader's label.
- A changed leader key or leftover rules outlive the flow: reset the leader and
  restore `keybindings.json` before the next feature.

## Owns

`apps/web/src/whichKey/`, `apps/web/src/commandPaletteBus.ts`, `panes/paneCommands.ts`,
the `useAppSections` handlers in `components/sidebar/AppIconRail.tsx`,
`components/settings/KeybindingsDeviceSettings.tsx`, `KeybindingsTable.tsx`,
`KeybindingsTable.logic.ts`, `KeybindingTriggerRows.tsx`,
`KeybindingTriggerSettings.logic.ts`, the table's hooks in `KeybindingsSettings.tsx`, the palette hooks in `CommandPalette.tsx`,
`CommandPalette.logic.ts` and `CommandPaletteContent.tsx`, `useDocumentSearchRows` in
`components/wiki/WikiFinder.tsx`, `packages/shared/src/keybindingTriggers.ts`, the
Astrolabe commands in `packages/contracts/src/keybindings.ts` and
`packages/shared/src/keybindings.ts`, `leaderKey` in `packages/contracts/src/settings.ts`,
`keybindingTriggers` in `packages/contracts/src/server.ts`, and the trigger
validation, removals and moved-default migrations in `apps/server/src/keybindings.ts`.
