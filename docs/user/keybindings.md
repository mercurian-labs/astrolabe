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

In **Settings → Chat → Send shortcut**, choose whether Enter sends, requires
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

When a thread has queued messages, `mod+Shift+Enter` sends the first one as a steer
while a turn is running, or as a new turn when the thread is stopped. Change it under
**Queue: Send First Queued Message** in Keybindings.

Use `mod+shift+m` to choose a model and `mod+shift+h` to choose a host.
To step a new thread to the next machine instead of opening the menu, bind
**Composer: Cycle Host** in Keybindings. It has no default shortcut.
Use `mod+shift+e` for effort, `mod+shift+a` for permissions, `mod+shift+x` for the
workspace, and `mod+shift+g` for the Git branch. The workspace menu includes the
current checkout, a new worktree, and the previous worktree when available.
Use `mod+shift+l` to reuse the previous worktree directly.

To change effort one step without opening the picker, bind
**Composer: Increase Effort** and **Composer: Decrease Effort** in Keybindings.
Both are unbound by default. Increase wraps from the highest level to the
lowest, and decrease wraps from the lowest level to the highest.

In the model picker, press Left in an empty search field or Shift+Tab to reach
the provider list. Use Up/Down to move and Enter to choose. Right returns to
model search. Right at the end of the search moves to the highlighted model's effort
levels, and Left comes back. Choosing a model keeps the picker open on its effort. `mod+shift+up` and `mod+shift+down` switch providers directly and clear the
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

A long line that wraps is one line to Vim, so `j` and `k` skip past all of it. Turn on
**Move by screen line**, under **Vim keybindings**, to have them move one line as it shows on
screen instead, as `gj` and `gk` do. With a count, such as `3j`, or after an operator, such as
`dj`, they still move by lines of text.

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
the mouse, or with `Ctrl+N` and `Ctrl+P` and Enter on a Mac. Inside a group the
arrow keys move between rows too; at the top level they move focus. The keys you
have pressed show at the top, Backspace goes back a level, and Escape or a click
elsewhere closes it. A key with nothing bound says so. The menu waits as long as
you need.

| Key                     | Does                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `:`                     | Command Palette                                                                                                                                                                                                                                                    |
| `/`                     | Search threads, wiki documents, projects, and settings                                                                                                                                                                                                             |
| `n`                     | New thread, or new document on Wikis                                                                                                                                                                                                                               |
| `f`                     | Find a file in the current project                                                                                                                                                                                                                                 |
| Arrows, `h` `j` `k` `l` | [Move focus](#moving-focus) left, down, up, or right                                                                                                                                                                                                               |
| `d` `u`                 | [Scroll](#scrolling) down or up half a page                                                                                                                                                                                                                        |
| `g`                     | Go to Agents, Wikis, Projects, Changes, Usage, or Settings                                                                                                                                                                                                         |
| `t`                     | Tabs: next, previous, close, reopen, back, forward, link                                                                                                                                                                                                           |
| `p`                     | Panes: split, close, maximize, full screen, right panel                                                                                                                                                                                                            |
| `s` `s`                 | Show or hide the sidebar                                                                                                                                                                                                                                           |
| `w`                     | Open Wikis, or find or create a document                                                                                                                                                                                                                           |
| `e`                     | [Find](#find-in-a-file-or-note), [go to a symbol](#go-to-a-symbol), [edit code](#edit-code), step through [changes](#changes-in-a-code-file) and pick their base, [problems](#problems-in-a-code-file), and [language features](#language-features-in-a-code-file) |
| `r` `g`                 | Open the local graph of the project file in front                                                                                                                                                                                                                  |
| `,`                     | Settings                                                                                                                                                                                                                                                           |

These are the defaults. A row lists every key in its group that runs the same
command, joined by `|`. Press `mod+k` again to open Search, as `/` does; `mod+/`
opens Search from anywhere but the terminal and a code file. Change either shortcut in
**Settings → Keybindings** under **Keyboard Menu: Open** and **Search**. The file picker has no shortcut by default (`mod+p` opens the Command
Palette); bind **File Picker: Toggle** to give it one.

The leader key opens the same menu while you are not typing or on a button, and
in the composer and notes in Vim's normal and visual modes. It is Space unless
you choose another key, or None, in **Settings → Keybindings → This device →
Leader key**; `mod+k` works either way. The menu appears after a moment, so a
quick sequence like Space `g` `w` runs without it showing.

In the composer and wiki notes, `mod+shift+k` inserts a link, and in a code file it
deletes the line. Elsewhere it copies an open pull request's number (below).

### Moving focus

Focus moves between the icon rail, the sidebar, the chat, and each pane the way
Vim moves between windows: to the nearest one in that direction. Use any of:

- `Ctrl+H`, `Ctrl+J`, `Ctrl+K`, `Ctrl+L` (Ctrl on a Mac too), while you are not
  typing in a field, an editor, or a terminal. Hold one to keep moving;
- Space then an arrow or `h` `j` `k` `l`, in the keyboard menu;
- `Ctrl+W` then `h` `j` `k` `l` or an arrow, in the composer or a note in Vim's
  normal mode. Your vimrc can map onto these like any Vim key, for example
  `nnoremap <C-h> <C-w>h`.

After a move from the keyboard menu, its keys keep moving focus for half a
second without Space, and each move starts the half second again, so Space `l`
`l` goes two places right. Any other key ends this and does what it normally
does; Escape only ends it. A run of moves passes through the composer or a note
too: within that half second the keys above still move, and any other key types
there. In the sidebar or the rail,
`j` `k` and the up and down arrows walk the list straight away, since there is
no place above or below. Change how long it lasts, or turn it off with 0, in
**Settings → Keybindings → This device → Repeat window**.

Focus returns to where you left it in that place; the first time, it lands on
the composer, the pane's tab in front, the sidebar's current row, or the rail's
current section. The pane or chat that has focus marks its tab in front with a
line in the focus color, as it does after a click. On Windows and Linux `Ctrl+J`
and `Ctrl+K` stay the terminal toggle and the keyboard menu, so use Space `j`
and `k` there, or bind **Focus Down** and **Focus Up** to other keys. In a
terminal every key stays the terminal's; to move from there, bind a shortcut of
your own in Settings.

### Scrolling

Space `d` and `u`, or `Ctrl+D` and `Ctrl+U`, scroll the place with focus half a
page down or up: the chat's messages, a pane's note, diff, or files, or the
sidebar's list. After Space `d`, more `d` and `u` keep scrolling for the repeat
window, so Space `d` `d` `d` goes a page and a half. The keyboard menu shows them
faint when there is nowhere further to go. `Ctrl+D` and `Ctrl+U` work while you
are not typing; in the composer and notes they stay Vim's. On Windows and Linux
they stay the diff toggle and Usage, so use Space `d` and `u` there, or bind
**Scroll Down** and **Scroll Up** to other keys.

### The sidebar's list

With a row of the Agents, Wikis, or Changes sidebar focused (move there
with `Ctrl+H`, or click a row), or a button of the icon rail:

| Key                    | Does                                  |
| ---------------------- | ------------------------------------- |
| `j` `k`, Down Up       | Next or previous row                  |
| `g` `g`, `G`, Home End | First or last row                     |
| Enter                  | Open the row, as a click does         |
| `Alt+Enter`            | Open the row in a new tab             |
| `mod+Enter`            | Select the row, as a `mod`-click does |
| `/`                    | Search the sidebar                    |
| Escape                 | To the place on the right             |

Space still opens the keyboard menu. The row with the focus ring is where Enter
goes; the row you are on keeps its own look. Folded groups are skipped until you
unfold them. Enter keeps you in the list, so you can open one thread after
another; press Escape or `Ctrl+L` to reach its composer. A click on a thread
still puts you in its composer.

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

With a PR open beside a chat, or focused on Changes, use `mod+shift+c`
to copy its URL and `mod+shift+k` (outside the composer and notes) to copy its
number with a `#` prefix.
Both shortcuts can be changed in Settings. Search for “Copy Link or Thread”
or “Copy Number”. They copy the selected PR and leave terminal input alone.
Without a PR, `mod+shift+c` copies the thread itself, which pastes into a
composer as a thread chip.

## Find in a file or note

In a repository file or a wiki note, `mod+f` opens a find bar above the text, starting from the
words you selected. Enter and `Shift+Enter` move between matches, as do `mod+g` and
`mod+shift+g` from the text. `Alt+Enter` selects every match in a note, so typing changes them
all. `mod+alt+c`, `mod+alt+w`, and `mod+alt+x` switch match case, whole words, and regular
expressions. Where you can edit, the bar's second row replaces: Enter replaces the current match
and `mod+Enter` every match. Escape closes the bar. Read-only files and notes can be searched too.

With Vim on, `/`, `?`, `n`, and `N` stay Vim's own search in normal mode. On Windows and Linux,
`Ctrl+F` in normal mode is Vim's page down, so use `/` or Space `e` `f` there. Change the
shortcut in **Settings → Keybindings** under **Find in Editor**. In the composer, `mod+f` finds
in the thread instead.

## Go to a symbol

In a repository file or a wiki note, `mod+shift+o` lists the file's outline: a note's headings,
and the classes, functions, methods, and other declarations of TypeScript, JavaScript, Python,
Rust, and CSS files. Type to filter by name; words before the last one match the items around it,
so `store add` finds `add` inside `Store`. Enter puts the cursor on the symbol, in the middle of
the view, and Escape goes back with the cursor where it was. Space `e` `o` and the Command Palette
open it too. Elsewhere `mod+shift+o` still starts a new thread. Change the shortcut in
**Settings → Keybindings** under **Go to Symbol in File**.

A repository file's header shows the symbols around the cursor after its path. Click one to go
to it.

## Edit code

A repository file edits like a code editor. Add cursors and selections and type into all of
them at once, drag with `Alt` held to select a column, and fold blocks from the markers that
show when you point at the gutter. Brackets and quotes close as you type, and the bracket
matching the one at the cursor is outlined.

While a code file has focus, these keys are the editor's, and the app's command on the same
key works everywhere else:

| Key                             | In a code file                                            | Elsewhere                    |
| ------------------------------- | --------------------------------------------------------- | ---------------------------- |
| `mod+d`                         | Select the next occurrence (the word at the cursor first) | Show or hide the diff        |
| `mod+shift+d`                   | Skip this occurrence: the last one moves to the next      |                              |
| `mod+shift+l`                   | Select every occurrence                                   | Previous worktree (composer) |
| `mod+i`                         | Expand the selection to the enclosing code                | Italic in notes              |
| `mod+shift+k`                   | Delete the line                                           | Link in notes                |
| `mod+[` `mod+]`                 | Indent less or more                                       | Back or forward              |
| `mod+/`                         | Comment or uncomment                                      | Search                       |
| `mod+alt+Up` `mod+alt+Down`     | Add a cursor above or below                               |                              |
| `alt+Up` `alt+Down`             | Move the line up or down                                  |                              |
| `alt+shift+Up` `alt+shift+Down` | Copy the line up or down                                  |                              |
| `mod+alt+[` `mod+alt+]`         | Fold or unfold the block at the cursor                    |                              |

`mod+u` stays Usage, and `mod+k` (the keyboard menu) and `mod+p` (the Command Palette) still
open from a code file. Space `e` then a key runs the commands with no shortcut of their own,
which the Command Palette also lists: `c` comment, `d` duplicate the selection, `j` join lines,
`s` sort lines, `u` and `l` upper and lower case, `w` wrap long lines, and `[` and `]` fold or
unfold everything.

Code files wrap long lines when **Settings → Appearance → Typography → Word wrap** is on; Space
`e` `w` switches one file. Markdown files in a repository edit the same way, but always wrap,
and `mod+i` and `mod+shift+k` stay italic and link there.

With Vim on, normal mode keeps its keys. Selecting occurrences enters visual mode, where `c`
changes them all and Escape keeps a cursor at each. On Windows and Linux `mod` is Ctrl, so in
normal mode `Ctrl+D`, `Ctrl+I` and `Ctrl+[` stay Vim's.

Change any of these in **Settings → Keybindings** under **Editors**; their names start with
**Code:**, and their condition is `codeEditorFocus`.

## Changes in a code file

In a repository's code file, a strip beside the line numbers marks every line that differs from
the file's last commit: green where lines were added, yellow where they changed, and a red notch
where lines were deleted. The strips follow your typing, and refresh when you commit or switch
branches.

Click a strip, or press `mod+'` with the cursor on a change, to show the lines it replaced above
it; press again, or Escape, to hide them. `mod+shift+'` shows every change in the file. A shown
change has a small bar with **Restore**, which puts the committed lines back (undo takes it back),
and arrows to the changes before and after it. `mod+alt+z` restores the changes under the cursor
without showing them, and `mod+f8` and `mod+shift+f8` move to the next and previous change,
wrapping at the ends of the file. With Vim on, `]c` and `[c` move between changes in normal mode,
and Escape leaves insert mode before it hides changes.

Change these shortcuts in **Settings → Keybindings** under **Editors**. Files that are new and
not yet committed show no strips.

When an agent's turn has changed the file, the header offers **HEAD** and **This turn**. This
turn marks what changed since the latest turn, from any thread in this checkout, that changed
the file started, so you see just what the agent did; while that turn runs, its edits show as
they land. A file opens on This turn while it has changes from that turn, and on HEAD
otherwise. Restore puts back the lines from the base you are comparing with, so in This turn it
reverts that change of the agent's. `e` `b` in the keyboard menu, or **Compare With HEAD or
This Turn** in the Command Palette, switches too.

## Problems in a code file

Code files show the problems their language servers find: a wavy underline, a mark beside the
line number, and the message on hover, naming the server that found it. Astrolabe has language
servers for TypeScript and JavaScript (TypeScript), Python (basedpyright), Rust (rust-analyzer),
Go (gopls), C and C++ (clangd), Java (jdtls), JSON, CSS, SCSS and Less, HTML, YAML, Bash,
Dockerfiles, TOML (Taplo), Lua (LuaLS) and Markdown (Marksman). Repository files get Marksman;
notes in a wiki don't, since a wiki has its own links. Zig (zls), Swift (SourceKit-LSP), Ruby
(Ruby LSP), PHP (Phpactor), C# (csharp-ls or OmniSharp), Kotlin, Elixir (ElixirLS) and Dart work
once installed, and you can [add your own](#add-your-own-language-server). Bash files find
problems through ShellCheck, so install it for those. Others join them where they apply: Ruff on
every Python file, ESLint when the project has an ESLint config or `eslint` in its `package.json`,
and Tailwind CSS when it has a Tailwind config or `tailwindcss` there. After adding one to a
project with files open, restart a language server to pick it up. The messages of the line the
cursor is on also show below it. `f8` and `shift+f8` move to the next and previous problem; `e`
`.` and `e` `,` in the keyboard menu do too. Change these under **Editors** as well.

The header names the language server and says when it is starting. A trusted project runs its
own server when it has one (its TypeScript, or basedpyright in its `.venv`), then one installed on
the machine, such as rustup's rust-analyzer or Xcode's clangd, and downloads one when neither is
there, the first time you open a file of that language. gopls is built with the machine's Go, so
Go files need Go installed. jdtls runs on the machine's Java, so Java files need Java 21 or newer.
When a server isn't installed the header says so: click it for what to install, then **Try again**. If a server
keeps stopping, or was paused because several ran at once, click **Restart** in the header.

Clicking the server's name in the header lists every server on the file, a `+1` beside the name
counting the others, with each one's state and memory, and **Restart**, **Stop** and
**View logs**. A stopped server stays stopped until you restart it. These are commands too, for
the file you're in; find them in the Command Palette or under `e` `L` in the keyboard menu, and
rebind them under **Editors**:

| Command                   | Keyboard menu |
| ------------------------- | ------------- |
| Restart language server   | `e` `L` `r`   |
| Stop language server      | `e` `L` `s`   |
| Trust project             | `e` `L` `t`   |
| Check language servers    | `e` `L` `c`   |
| View language server logs | `e` `L` `l`   |
| Select Python interpreter | `e` `L` `p`   |

**View logs** opens a tab with what the server wrote (**Server log**), the process behind it
(**Server info**) and every message between it and Astrolabe (**RPC trace**). Turn on **Record** to
collect a trace. Messages can hold file contents, so a trace stays in memory on the machine and
stops a few minutes after you close its tab.

Language servers can run a project's code, so each project starts out untrusted, once per machine.
An untrusted project runs only the servers that never run project code and are already on the
machine or downloaded, marked restricted in the header; the others wait, and agents' code tools
say so unless it is only ESLint or Tailwind waiting. Click **Trust project** in the header to run them, downloads included. A worktree shares
its repository's trust. To take it back, go to **Settings → Projects → Language servers** and
click **Revoke**: the project's servers restart restricted. A restricted server fetches nothing a
file names, so JSON, YAML and TOML schemas at a URL load once the project is trusted.

**Settings → Projects → Language servers** shows what each server would run for a project and
what is missing, without starting any, and whether Ruff, ESLint and Tailwind apply and why. clangd reads each file's compiler flags from a
`compile_commands.json`; without one it guesses, so have your build tool write one (CMake:
`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`).

### Change how a language server runs

**Settings → Projects → Language servers** also changes what runs. **Changes here apply to** says
whether a change is for this project, in all its worktrees, or for all projects on this machine; a
project's own setting wins. Only the servers a change reaches restart.

- The switch beside a server turns it off. A server that's off says **Off in settings** in the
  header's menu, which has **Turn on** to bring it back for this project.
- The arrows order a language's servers. The first one that's on leads: it answers for the file, and
  the others join it.
- **Configure** sets a server's binary, arguments, environment variables, initialization options and
  settings. The last two are JSON, merged over what it normally gets. Each row lists what's changed
  and where the change came from.

A server with its own binary, arguments or environment runs only in a trusted project, even one
that would otherwise run restricted. Its settings and initialization options still reach servers
running restricted in projects that aren't trusted.

Environment values, arguments and settings can hold tokens, so only someone who can manage the
environment sees them. Others see which variables are set, by name.

A project can keep servers' settings in its repository, in `.astrolabe/language-servers.json`:

```json
{
  "servers": {
    "basedpyright": {
      "settings": { "basedpyright": { "analysis": { "typeCheckingMode": "strict" } } }
    }
  }
}
```

Each server takes `settings` and `initializationOptions`, and nothing else: a repository can never
say what to run. It's read only in a trusted project, over settings for all projects and under this
project's own. A file with a mistake in it is ignored, and Settings and the header's menu say why.

### Add your own language server

Any language server that speaks LSP over stdio works, for any file extension, with no extension or
code to write. In **Settings → Projects → Language servers**, click **Add** beside **Add language
server** and give it a name, a command, and the file extensions it reads, each with the language id
it expects, like `foo foolang`. It can either join the usual server on those files or replace it.
Root files are optional: with some listed, it runs only in checkouts with one of them at the top.

Your servers are on that machine, for all its projects, and run only in trusted projects. They show
in the header's menu and logs like any other, and agents' code tools use them on their files. A file
no other server reads still gets language features, but no syntax colours. **Configure** on its row
has **Edit** and **Remove**; removing a server stops it.

### Choose a Python interpreter

basedpyright resolves imports against a Python interpreter. By default that's the checkout's `.venv`
or `venv`. To use another, click the server's name in a Python file's header and choose **Select
Python interpreter**, or run that command. It lists virtual environments in the checkout, and conda,
pyenv, uv, Homebrew and system Pythons on the machine, without running any of them. The menu shows
which one is active. **Automatic** goes back to the default. The choice is per checkout, and applies
once the project is trusted. If the chosen interpreter is deleted, the menu says so and offers to
clear it, and the default is used until you do.

## Language features in a code file

Code files also take these from their language servers. Each is in the
Command Palette, and you can rebind it under **Editors**.

| Key                          | Does                       | Keyboard menu | Vim     |
| ---------------------------- | -------------------------- | ------------- | ------- |
| `ctrl+space`                 | Show completions           | `e` `m`       |         |
| `mod+shift+space`            | Show signature help        | `e` `i`       |         |
|                              | Show hover                 | `e` `h`       | `K`     |
| `f12`, or `mod`-click a name | Go to definition           | `e` `g` `d`   | `g` `d` |
|                              | Go to declaration          | `e` `g` `c`   | `g` `D` |
| `mod+f12`                    | Go to type definition      | `e` `g` `t`   | `g` `y` |
| `shift+f12`                  | Go to implementation       | `e` `g` `i`   | `g` `I` |
| `alt+shift+f12`              | Find references            | `e` `g` `r`   | `g` `r` |
|                              | Show incoming calls        | `e` `g` `h`   | `g` `h` |
|                              | Show outgoing calls        | `e` `g` `H`   | `g` `H` |
| `mod+alt+o`                  | Go to symbol in project    | `e` `g` `s`   | `g` `W` |
| `ctrl+-` `ctrl+shift+-`      | Back and forward           | `t`           |         |
| `f2`                         | Rename symbol              | `e` `e`       |         |
|                              | Undo rename or code action | `e` `z`       |         |
| `mod+shift+i`                | Format document            | `e` `=`       |         |
| `mod+.`                      | Show code actions          | `e` `q`       |         |
| `mod+s`                      | Save the file, formatted   |               | `:w`    |

Completions open as you type a name or a `.`. Tab or Enter accepts the selected one, `ctrl+n`
and `ctrl+p` move through them, and Escape closes the list (in Vim's insert mode you stay in
insert mode). Accepting a name another module exports also adds its import.

Pointing at a name shows what the server knows about it; so does Show Hover at the cursor, until
you move or type. Edits an agent makes elsewhere in the file leave it open. Signature help opens
as you type a call's `(` or `,`, with the parameter you are on in bold; when a function has
several signatures, `mod+shift+Up` and `mod+shift+Down` step through them.

Go to definition puts the cursor on the definition, opening its file in a tab beside this one
when it is elsewhere in the checkout. When there are several, places close together are all
selected, and otherwise you pick one from a list; type to narrow it. On a definition itself, it
finds the references instead. Find References opens every use, the declaration included, as
[one editor of excerpts](projects.md#results-in-one-editor) in a tab beside the file; so does
Go to Implementation when there are several. Uses outside the checkout are left out of it. With
`mod` held, a click on a name goes to its definition; a click off a name still adds a cursor.
Back returns from any of these to where you were, and Forward goes there again.

Show Incoming Calls and Show Outgoing Calls, also in the right-click menu, list what calls the
function at the cursor and what it calls, one level at a time, in the same kind of editor. To go a
level further, open a result in its file and run the command again.

Go to Symbol in Project searches names across the project in front, by part of a name. It asks
the language servers already running there, and the code index when none is or they have no
answer.

Rename Symbol opens a box below the name: type the new name and press Enter, or Escape to
cancel. The rename reaches every file that uses the name, open or not, and they are saved. Then
every changed place opens in one editor of excerpts, with **Undo rename** at the top. It is not in
the file's own undo: use that button, or run Undo Rename, to put every file back. Edits made since
are kept. Closing the tab keeps the rename.

Format Document reformats the file with its language server, Ruff for Python, as one step you can
undo. Repository files save themselves as you type; `mod+s` (`:w` in Vim) also saves now, and
formats the file first. A formatter that takes more than two seconds is skipped and the file saves as it is. Turn
this off with **Format on save** in Settings → Appearance.

When a server has fixes or refactors for where the cursor rests, a light bulb shows beside the
line. Click it, or press `mod+.`, for every server's in one list; Enter applies one. Like a rename, the environment
applies it to every file it touches, and Undo Rename takes it back, as does **Undo** on its notice,
or at the top of the changed places when it touched several files.

While your cursor rests on a name, its other uses in the file are marked, writes more strongly than
reads. Typing in an HTML or JSX tag writes its closing tag too, where the language server offers it.

**Settings → Appearance** chooses what else language servers draw in a code file, on this device:

| Setting            | Does                                                                                      | Toggle in keyboard menu |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------- |
| Inlay hints        | Shows types and parameter names beside the text; click a hint to write it into the file   | `e` `L` `h`             |
| Inline diagnostics | Shows each line's worst problem at its end. Off at first                                  | `e` `L` `d`             |
| Semantic colours   | Colours code by what the server knows it is. Off at first; large files keep their colours |                         |
| Code lens          | Shows counts and actions above definitions. Off at first; click one to run it             |                         |

## Search results and problems in one editor

In a tab of [search results or problems](projects.md#results-in-one-editor), `f7` and
`shift+f7` jump to the next and previous file, `shift+enter` shows more lines around an excerpt,
and `alt+enter` opens the excerpt's file at the cursor. In the keyboard menu they are `e` `}`,
`e` `{`, `e` `x` and `e` `k`, and `e` `v` opens the problems of the checkout in front. In the
project search, `mod+enter` opens its results this way. Change them under **Editors**; their
condition is `multibufferFocus` (`projectSearchFocus` for the search's).

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
`markdown.highlight`, and `markdown.link`, with the `editorFocus` condition. A code
file's editing commands are `code.*`, such as `code.selectNextOccurrence` and
`code.sortLines`, with the `codeEditorFocus` condition.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`, `draftThreadRoute`,
`turnRunning`, `editableFocus`, `editorFocus`, `codeEditorFocus`, `outlineFocus`, `isWeb`, and
`isDesktop`. `draftThreadRoute` is true on a draft thread, including a restored draft, until it is
first sent.
`editableFocus` is true while a text field, the composer, or another editor has
the keyboard. `editorFocus` is true while the composer, a wiki note, or a repository file has
it, `codeEditorFocus` only while a repository file's text has it, and `outlineFocus` while a
repository file or wiki note has it. `isWeb` is true in a browser tab. `isDesktop` is true in the
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
seconds after the latest action. Right after an action, the shortcut works even
in a text field such as the composer. Once you type or press another key, the
field gets its own undo back. Terminals always keep their native shortcut.

`navigation.back` (`mod+[` by default) and `navigation.forward` (`mod+]`) move
through the pages you have visited, like a browser's back and forward buttons. In
every section they go back and forward in the focused tab instead, as the arrows at the start of
each tab's header do for their own tab. After a jump to a definition or into results they go back
to where you were first. In a code file those keys indent, so use `ctrl+-` and `ctrl+shift+-`.

Space `p` `f` takes the focused pane full screen: it fills the panes. Press it
again to restore it. Space `p` `r` hides the
[linked tabs](./thread-sidebar.md#linked-tabs) of the chat in front, or brings them back; Space `t` `n` opens a new linked tab for the focused chat, and Space
`t` `k` links the focused tab to the chat in front, or unlinks it.

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread). `chat.newWithoutProject`
(`mod+alt+n`) starts a thread [without a project](./thread-sidebar.md#start-without-a-project).

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal, or else the focused tab,
whether a chat, a file, a document, or one of a chat's linked tabs. When nothing
remains to close, it does nothing; it never closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

`mod+shift+t` reopens the last closed tab across the app, including chats, files,
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
