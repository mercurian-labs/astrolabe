# Keyboard menu (which-key) and the leader key

Cmd+K (Ctrl+K off Apple) opens a which-key menu of the app's commands, hanging
from the main area's top-right corner. The device's leader key (Space by default)
opens it too, when you are not typing and in Vim's normal mode. The palette is one
key further: **Search** is the menu's `/` or Cmd+K again, the **Command Palette**
its `:` (or Cmd+P anywhere). The menu, the Command Palette and shortcuts run the
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
  the root. Rows take a click (hover highlights), and ArrowUp/ArrowDown (Ctrl+P/
  Ctrl+N on a Mac) move a highlighted row (`li[data-highlighted]`) that Enter
  chooses. An unbound key shows **Not bound** and keeps the menu open; a command
  with nothing to act on here shows faint, **Not available here** (e.g. `g p` where
  Pull Requests is unsupported). Cmd+K shows it at once; the leader after ~300 ms,
  so a fast `Space g w` runs without it flashing.
- **Top level** (defaults): `:` Command palette, `/` Search (always enabled),
  `n` New thread or document, `f` Find file (upstream's file picker), `g` Go to,
  `t` Tabs, `p` Panes, `s` Sidebar, `w` Wikis, `,` Settings. `n`'s label follows the section (on Wikis: "New document").
  A prefix the user added with no built-in name shows as `+N` (its entry count).
- **Groups** (defaults): `g` t Threads, w Wikis, p Pull Requests, u Usage, s
  Settings. `t` `]` next tab, `[` previous, `c` close, `r` reopen closed (panel and
  browser tabs, not chat tabs; see chat-tabs.md). `p` `v` split right, `s` split
  down, `c` close pane, `m` maximize/restore. `s` `s` toggle sidebar. `w` `w` open
  Wikis, `f` find or create a document.
- **Search** (the palette's plain mode, dialog name `Search`): empty, it lists
  Recent Threads only; upstream's Actions are the Command Palette's. A query finds
  Projects, Settings, Threads and every wiki's Documents (a document opens as a
  Wikis tab from anywhere). Typing `>` or `:` first switches to the Command Palette
  (the character is consumed).
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
  (`tabindex>=0`) or a dialog, not with Shift or a held key, and in a Vim editor's
  normal/visual mode. Cmd+K always works; in the terminal Cmd+K stays the
  terminal's (`when: !terminalFocus`). Its description reads "Another way to open
  the keyboard menu, besides ⌘K. …".
- **Triggers in `keybindings.json`**: one rule shape `{key, command, when?}`. `key`
  is a shortcut (`mod+k`), menu keys (`menu g w`, single keys spaced) or an alias
  (`:q[uit]`, bracketed tail optional); `when` is for shortcuts only. A `-command`
  rule removes that command's matching default (`{"key": "menu t ]", "command":
"-chatTab.next"}`). A user rule replaces only its own kind's defaults for that
  command. Menu and alias defaults live in code, not the file. Bad rules are
  skipped with a server warning and a keybindings toast, as upstream reports bad
  shortcuts (`Invalid menu keys "…"`, `Invalid alias "…"`). `leader …` is not a
  kind: it fails as a shortcut.
- **Keybindings table** (Settings › Keybindings): one row per command
  (`#keybinding-<command>`), with Shortcut, Menu keys (header hint "after ⌘K") and
  Alias columns; several bindings of one kind share a cell joined by `|`, an empty
  cell shows `—`. A filter select (`aria-label="Kinds of keybinding shown"`: All,
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
preview_press     key=k modifiers=["Meta"]                 # opens the menu
preview_press     g                                        # into Go to
preview_press     w                                        # runs: /wikis
preview_click     role=heading[name='Wikis']               # move focus off text fields
preview_press     Space                                    # leader (wait 300 ms+)
```

Read the menu: `document.querySelector('[data-which-key]')?.innerText`. Read the
palette: `document.querySelector('[data-command-palette] input')?.value` and its
rows `[...document.querySelectorAll('[data-command-palette] [data-slot=command-item]')].map(r => r.innerText)`.
The field shows no `:` in the Command Palette (a chevron leads it instead); the
query is `':' + value`. The
dialog's name stays `Search` in both modes: type with
`preview_type role=dialog[name='Search'] >> role=combobox`.

Rules: back up `$home/userdata/keybindings.json` (the walk's `.t3`, never
`~/.t3/userdata`) before editing it, append rules with a short `node -e` script,
and copy the backup back when done. The server picks changes up live.

## Flows

1. **Menu basics.** On a chat: Cmd+K → menu at the top right with the ten top-level
   rows (Search's row shows only `/`), `Esc close` footer → Ctrl+N twice, Ctrl+P → `:` row highlighted → `g`
   (or click Go to) → heading `Menu › Go to` → click **Backspace back** → heading `Menu` → `g` → `z` → "Not bound", still open →
   click Threads, or `w` → the URL changes, menu closed.
2. **Leader across sections.** On Wikis, click the heading → Space → menu after the
   delay, heading `Menu`, rows say "Search"/"New document" → `w` `f` →
   the finder (`[data-testid=wiki-finder]`) open with focus in its field.
3. **Settings door.** Cmd+K `,` → `/settings/general`, a General settings tab
   (settings-tabs.md).
4. **Chat tabs.** With several chat tabs, focus off the composer, Cmd+K `t` `[` → the
   previous chat tab is in front (strip read in chat-tabs.md).
5. **Panes.** Open the right panel with two surfaces in one pane; focus a non-terminal
   tab → Cmd+K `p` `v` → two panes, focus in the new right pane → Cmd+K `:` `q`
   Enter → one pane, chat strip unchanged (panes.md read).
6. **Palette.** Cmd+K Cmd+K → Search, empty query, Recent Threads only; type a
   document's name from Threads → a Documents row → Enter → `/wikis` with it as a
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
9. **Keybindings table.** Settings › Keybindings, search `t ]` → the Chat Tab: Next
   row, `⌘⇧]`-style shortcut and `t ]` in Menu keys. Search `Section: Wikis` → one
   row, Menu keys `g w | w w`, Alias `—` → `⋯` Remove g w → `g w` struck through and
   `{"key":"menu g w","command":"-section.wikis"}` in the file → `⋯` Restore default
   g w → the rule is gone → click `g w`, press `g` `x`, Save → the file holds both
   `menu w w` and `menu g x` → hover the Alias cell, `+`, type `wk`, Save → the file
   holds `:wk` → filter Aliases → only commands with aliases, one column → restore
   the file. Narrow the window under 44rem → each row stacks Shortcut / Menu keys /
   Alias lines.

**Proof:** the menu and palette reads at each step, the URL or strip reads after a
command runs, the `keybindings.json` reads for flows 8 and 9, and saved screenshots
of the root menu, a group and the Command Palette.

## Gotchas

- Put focus on the page before Space: click a sidebar heading
  (`role=heading[name='Threads']`), or `preview_evaluate document.activeElement.blur()`
  where there is none. After opening a chat, focus is in its composer, where Space
  types; on a focused switch or button, Space presses it (correctly, not a leader).
- Inside the terminal, Cmd+K clears the terminal instead (by design).
- Cmd+K opens the menu from a wiki note too; the editor's link key is Cmd+Shift+K.
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
