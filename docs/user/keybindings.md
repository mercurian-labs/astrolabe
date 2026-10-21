# Keybindings

Customize keybindings in **Settings → Keybindings** on web and desktop. That page
lists every bound command once, with a column for each kind of keybinding:

- **Shortcut**: a key chord such as `mod+w`.
- **Menu keys**: keys pressed in the [keyboard menu](#keyboard-menu), after
  `mod+k` or the leader key, such as `t` `c`.
- **Alias**: a short name typed in the [Command Palette](#command-palette), such
  as `q[uit]`.

Click a binding to change it, or hover a cell and click `+` to add one of that
kind. A removed default stays in its cell, struck through; the row's `⋯` menu
removes, resets, and restores bindings. Filter the table to one kind, or search
for a command's name or keys (`t ]` finds Chat Tab: Next).

## Composer controls

In **Settings → General → Send shortcut**, choose whether Enter sends, requires
`mod+Enter` for multiline prompts, or always requires `mod+Enter`. `Shift+Enter`
inserts a new line. This applies to the web and desktop composer at desktop widths.

**Follow-up behavior** chooses Queue or Steer while the agent runs. Use
`mod+Enter` to do the opposite for one message, even when the send shortcut
requires a modifier. `mod+Alt+Enter` sends, keeps that thread running in the
background, and opens a fresh new-thread composer. In a new thread, `mod+Enter`
does the same. Change these shortcuts in **Settings → Keybindings** under
**Composer: Opposite Queue or Steer Action**, **Composer: Start in Background**,
or **Composer: Send and Start New Thread**. These bindings take priority over the
send shortcut. Click the send button to use the configured follow-up behavior.

When an active turn has queued messages, `mod+Shift+Enter` sends the first as a
steer. Change it under **Queue: Send First Queued Message as Steer** in Keybindings.

Use `mod+shift+m` to choose a model and `mod+shift+h` to choose a host.
To step a new thread to the next machine instead of opening the menu, bind
**Composer: Cycle Host** in Keybindings. It has no default shortcut.
Use `mod+shift+e` for effort, `mod+shift+a` for access mode, `mod+shift+x` for the
workspace, and `mod+shift+g` for the Git branch. The workspace menu includes the
current checkout, a new worktree, and the previous worktree when available.
Use `mod+shift+l` to reuse the previous worktree directly.

To change effort one step without opening the picker, bind
**Composer: Increase Effort** and **Composer: Decrease Effort** in Keybindings.
Both are unbound by default. Increase wraps from the highest level to the
lowest, and decrease wraps from the lowest level to the highest.

In the model picker, press Left in an empty search field or Shift+Tab to reach
the provider list. Use Up/Down to move and Enter to choose. Right returns to
model search. `mod+shift+up` and `mod+shift+down` switch providers directly and clear the
search. These provider shortcuts can also be changed in Settings.

These shortcuts run inside the focused web or desktop client. `mod` uses Command
on macOS and Ctrl on Windows and Linux, including GNOME, KDE Plasma, Niri, and
Hyprland. If a custom desktop shortcut takes the same keys, choose another binding
in Settings.

## Vim mode

Turn on **Settings → Keybindings → This device → Vim keybindings** to edit the
composer and wiki notes with Vim's modes and motions on web and desktop. Before it turns on, you
type `:q` and press Enter in the small Vim editor that opens, to show you know
the way out. Turning it off is one click.

The composer starts in insert mode, where Enter sends and its other keys work as
usual, and it returns to insert mode after each send. Escape enters normal mode
without leaving the composer; the draft shows in the code font until you insert
again. Outside insert mode Enter and the arrow keys are Vim's, and `mod+Enter`
still sends. Notes start in normal mode, and like the draft read in the code font
outside insert mode. The code font is **Settings → Appearance → Typography →
Monospace font**. In normal mode, `:` opens the Command Palette (below) instead
of Vim's command line, and the leader key opens the keyboard menu.

### Vim configuration

Vim reads a `vimrc` file kept on the server, next to `keybindings.json`, so it
follows you to every device connected to that server. **Settings → Keybindings →
Vim** edits it:

- **Key mappings**: a row per mapping, with its mode (Normal, Visual, Insert, or
  All), its keys, and the keys it sends. Press the keys or type them in Vim
  notation (`<C-d>`, `<Space>`). A mapping does not remap what it sends unless you
  turn on **Recursive**.
- **Search patterns**: JavaScript regular expressions (`set pcre`, the default) or
  Vim's (`set nopcre`).
- **Escape key timeout**: how long insert mode waits for the rest of a mapping such
  as `jk` (`set insertModeEscKeysTimeout`, 200 ms by default).

**Open vimrc** opens the file in your editor; a save applies at once. It takes
`map`, `noremap`, and `unmap` with their mode prefixes (`nmap`, `inoremap`, `xmap`,
`omap`…), `set`, and `"` comments, one per line. An `unmap` removes a mapping the
same file made; built-in keys are not mappings. Settings keeps the lines it does
not show, and a line Vim cannot apply is reported when the file changes.

```vim
" jk leaves insert mode
inoremap jk <Esc>
nnoremap Y y$
set textwidth=100
```

## Keyboard menu

On web and desktop, `mod+k` opens the keyboard menu in the main area's top-right
corner. Press a key to run its command or open its group, or pick a row with
the mouse, or with the arrow keys and Enter (on a Mac, `Ctrl+N` and `Ctrl+P`
move too). The keys you have pressed show at the top, Backspace goes back a
level, and Escape or a click elsewhere closes it. A key with nothing bound says
so. The menu waits as long as you need.

| Key     | Does                                                    |
| ------- | ------------------------------------------------------- |
| `:`     | Command Palette                                         |
| `/`     | Search threads, wiki documents, projects, and settings  |
| `n`     | New thread, or new document on Wikis                    |
| `f`     | Find a file in the current project                      |
| `g`     | Go to Threads, Wikis, Pull Requests, Usage, or Settings |
| `t`     | Chat tabs: next, previous, close, reopen closed         |
| `p`     | Panes: split right or down, close, maximize             |
| `s` `s` | Show or hide the sidebar                                |
| `w`     | Open Wikis, or find or create a document                |
| `,`     | Settings                                                |

These are the defaults. A row lists every key in its group that runs the same
command, joined by `|`. Press `mod+k` again to open Search, as `/` does. Change
either shortcut in **Settings → Keybindings** under **Keyboard Menu: Open** and
**Search**. The file picker has no shortcut by default (`mod+p` opens the Command
Palette); bind **File Picker: Toggle** to give it one.

The leader key opens the same menu while you are not typing or on a button, and
in the composer and notes in Vim's normal and visual modes. It is Space unless
you choose another key, or None, in **Settings → Keybindings → This device →
Leader key**; `mod+k` works either way. The menu appears after a moment, so a
quick sequence like Space `g` `w` runs without it showing.

In the composer and wiki notes, `mod+shift+k` inserts a link. Elsewhere it copies
an open pull request's number (below).

### Command Palette

`mod+p` opens the Command Palette, as does `:` in the keyboard menu. In Search,
type `>` or `:` first to switch to it; Backspace in its empty field switches back.
It is marked by a chevron in place of the search icon. Empty, it lists every
command with its alias or menu keys and its shortcut, followed by the app's
actions, such as changing the theme. Type to filter them by name.

An alias runs its command directly: `q` closes the tab, `w` sends the draft or
saves the note, `sp` and `vs` split the pane, `e name` opens or creates a wiki
document, `b name` switches to a thread, and `noh` clears a Vim search
highlight. An alias works by any abbreviation down to its shortest form, so `q`,
`qu`, and `quit` all close the tab. From the composer or a note, other Vim
commands such as `s/old/new/` run in that editor.

## Copy pull request references

With a PR open in the right panel or on the Pull Requests page, use `mod+shift+c`
to copy its URL and `mod+shift+k` (outside the composer and notes) to copy its
number with a `#` prefix.
Both shortcuts can be changed in Settings. Search for “Copy Link or Thread ID”
or “Copy Number”. They copy the selected PR and leave terminal input alone.

## Find in a diff

Click into a diff in the Diff panel or a pull request's Code tab, then press
`mod+f` to search every file in it, including folded files and unchanged lines
hidden between changes. Enter and `Shift+Enter` move between matches, and a
match in a folded file opens it. Escape closes the search. This shortcut is not
configurable. A very large uncommitted diff loads its files as you scroll, and
find only searches the files loaded so far.

## iPad

With a hardware keyboard, use `Cmd+1` through `Cmd+9` to open the first nine
displayed threads. The shortcuts follow the current list filters and order.
`Cmd+K` opens the command palette to search commands, projects, and threads.
Use the arrow keys and Return to choose a result, or `Cmd+1` through `Cmd+9` to
choose directly. Escape or `Cmd+K` closes the palette. Start a search with `>`
to show only actions.

In a new thread, `Cmd+Shift+H` moves the draft to the next machine.

In the composer, Return sends and `Shift+Return` inserts a new line. `Cmd+Return`
also sends. To make Return insert a new line instead, change the Return key
behavior in Settings → Keyboard.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.astrolabe/userdata/keybindings.json` by default. You can edit this file directly.
It is a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

T3 Code creates the file with its defaults and adds new defaults on later startups.
New defaults do not replace commands you customized. A file that still has the
old `mod+p` file picker default gets the Command Palette in its place, once. If a new default overlaps one
of your shortcuts, [rule order](#precedence) decides which runs.
Invalid rules are ignored; if the file cannot be parsed, T3 Code uses defaults.

## Rule shape

Each rule requires a `key` and a `command` ID. The key is one of three kinds:

- a shortcut: `{ "key": "mod+k", "command": "whichKey.open" }`
- menu keys, after the word `menu`, single keys spaced:
  `{ "key": "menu g w", "command": "section.wikis" }`. A new group shows as `+`
  and its number of entries.
- an alias, after a colon, in Vim's notation with the bracketed tail optional:
  `{ "key": ":q[uit]", "command": "tab.close" }`

An optional `when` expression restricts when a shortcut runs. A rule replaces
the defaults of its own command and trigger kind only: a new shortcut for
`chat.new` keeps its menu keys. Only the shortcut defaults are written to the
file; menu keys and aliases stay built in.

To remove a default, put `-` before the command and repeat its key:
`{ "key": "menu t ]", "command": "-chatTab.next" }`. Write an alias in full
(`:q[uit]` or `:quit`). The Keybindings page does this when you remove a default
menu key or alias, and can restore it.

The composer's and notes' formatting keys are commands too: `markdown.bold`,
`markdown.italic`, `markdown.code`, `markdown.strikethrough`,
`markdown.highlight`, and `markdown.link`, with the `editorFocus` condition.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`, `composerDraft`,
`turnRunning`, `editableFocus`, `editorFocus`, `isWeb`, and `isDesktop`.
`editableFocus` is true while a text field, the composer, or another editor has
the keyboard. `editorFocus` is true while the composer or a wiki note has it. `isWeb` is true in a browser tab. `isDesktop` is true in the
desktop app. Unknown keys evaluate to `false`.

`mod+1` through `mod+9` jump to the first nine threads, and to models while the
model picker is open. The thread jumps do not run while the model picker is open.
Those defaults use `isDesktop` so they do not steal the
browser's tab-switch shortcuts. Remove that condition in Settings if you want
the same jumps in a browser.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

```json
{ "key": "mod+j", "command": "terminal.toggle", "when": "terminalOpen && !terminalFocus" }
```

## Find in the current thread

`chat.find` searches conversation messages and proposed plans in the active thread. Entering a
query searches the entire thread, including older messages. Thread search requires server support;
update an older server to enable it. Select **Retry** if a search fails. It defaults to
`mod+f` outside terminals and previews. Press **Enter** or **Shift+Enter** to move between matches,
and **Escape** to close find.

## Precedence

The last rule whose key and condition both match wins, even if it belongs to a
different command. Put a more specific rule after a general one when they share
a shortcut.

## Commands with special behavior

`thread.stop` interrupts the running turn in the focused thread. It has no default
shortcut; assign one in **Settings → Keybindings**.

`thread.undo` (`mod+z` by default) reverses the actions shown in the notice at the
bottom of the sidebar, such as unpin, settle, snooze, archive, or discarding a
draft. Consecutive
actions of the same kind undo together. The notice remains available for five
seconds after the latest action. The default shortcut skips text fields and
terminals so native undo keeps working there.

`navigation.back` (`mod+[` by default) and `navigation.forward` (`mod+]`) move
through the pages you have visited, like a browser's back and forward buttons.

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread). `chat.newWithoutProject`
(`mod+alt+n`) starts a thread [without a project](./thread-sidebar.md#start-without-a-project).

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

`mod+shift+t` reopens the last closed tab across the app, including files,
diffs, pull requests, browsers, and devices, in the order you closed them.
A browser opens in a fresh session without its old page history. Incognito tabs
can reopen until you reload or quit the app. This shortcut does not undo deleted work.
Browsers also use it to reopen browser tabs; choose another binding in Settings
if the browser takes it first.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.
