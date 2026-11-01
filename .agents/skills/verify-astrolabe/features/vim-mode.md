# Vim mode

The composer, wiki notes and Projects file tabs can edit with Vim, behind one
device setting that is off by default. Turning it on asks you to type `:q` first, to
show you know the way out. In Vim's normal mode `:` opens the Command Palette (see
[which-key.md](which-key.md)), and the leader key (Space by default) opens the keyboard menu.

## Sub-features

- **Setting**: Settings › Keybindings › This device › **Vim keybindings** (`role=switch`), stored
  as `vimModeEnabled` in `localStorage['t3code:client-settings:v1']`. Turning it
  on opens a one-line Vim editor under the row (`role=textbox[name='Type :q and press Enter']`),
  in normal mode (block cursor), while the switch stays off. `:q`, `:quit` or `:q!` then Enter turns it on. Any
  other ex command (`:w` too), Escape in normal mode, or **Cancel** backs out and
  returns focus to the switch. Turning it off is one click.
- **Move by screen line** (the row under it, `vimScreenLinesEnabled`, off by default, disabled
  while Vim is off): `j`/`k` (and the arrows) move one wrapped row, as `gj`/`gk`; with a count
  (`2k`) or after an operator (`dj`) by lines of text (`defineScreenLineKeys` in
  `packages/editor/src/vim.ts`). Walk it in the composer with a line long enough to wrap and
  read the fat cursor's `getBoundingClientRect().top` after each key.
- **Composer**: a new or cleared draft is in insert mode, and a send returns it there
  (a draft restored after a reload can open in normal mode). Insert mode
  keeps every composer key (Enter sends, Shift+Enter, ArrowUp history, and every menu
  trigger: `/`, `@`, `$`, `#` and the `[[` wiki-note menu). Escape closes an open menu first,
  then enters normal mode with focus kept in the composer; normal mode opens no menus. In an
  empty draft the insert caret shows at the left edge (`.cm-cursorLayer:not(.cm-vimCursorLayer)
  .cm-cursor`, `margin-left: 0`, inside `.cm-scroller`), only while the composer has focus. Outside insert mode the draft switches to the code font (the
  mode's only marker) and every key is Vim's: Enter and the arrows move, they never
  send or add a line. Mod+Enter still sends. One Vim change (`cw` plus the typed
  text, a whole insert session) is one undo step.
- **Notes**: wiki notes start in normal mode, with no mode panel: like the composer,
  the text reads in the code font (`--font-mono`, the Monospace font setting)
  outside insert mode.
- **Project files**: a Projects file tab ([repositories.md](repositories.md)) starts
  in normal mode with no mode panel and follows the switch live. Space opens the keyboard
  menu and `:` the palette. Files save on their own, so `:w` is the disabled "Nothing to
  write here". A Markdown file switches to the code font outside insert mode; a code file
  (`.cm-editor.cm-code`) is monospace already, so only the block cursor shows the mode.
- **Visual mode** (every Vim editor): `v`, `V` paint the selection in a theme colour
  (CodeMirror's `.cm-selectionLayer`); prove it with a screenshot, since the layer's
  elements are not always there to count.
- **Ex commands** (through the Command Palette; the app's are aliases, keybinding
  rules such as `:w[rite]`, typed without the colon, see which-key.md): `w` sends the composer's draft, or opens a note's
  **Save to change request** ("No edits to save" on a clean note; "Nothing to write
  here" elsewhere). `q` is the app's close tab: from the composer it closes the chat
  tab in front. Lines no command claims (`:s/a/b/`, `:%s`, `:12`) show **Run in the
  editor** (first, ahead of any palette matches) when the palette came from a Vim
  editor, and run in that editor's own Vim with focus back in it.
- **Vim configuration**: Settings › Keybindings › **Vim**, the server's vimrc file
  (`$home/userdata/vimrc`, beside `keybindings.json`, created on first start) for every
  device. **Key mappings** rows (mode, keycaps, `→`, what it sends; `recursive` when
  it is a `*map`) with a `⋯` (`Actions for Insert jk`: Edit, Remove) and **Add**; the
  edit form has a Mode select, a **Keys** field (typed, or a held key recorded as
  `<C-d>`, Space as `<Space>`), **Does**, a **Recursive** switch, Save. Options:
  **Search patterns** (JavaScript = `set pcre` / Vim = `set nopcre`), **Escape key timeout**
  (`set insertModeEscKeysTimeout=N`, default 200 ms), each with a reset once set. **Open
  vimrc** in the section header opens the file. Each change rewrites only its own
  lines; comments and lines Settings does not show stay. A hand edit applies live;
  lines Vim cannot apply come back as a warning toast ("Vim configuration has lines
  it cannot apply", "Line 3: Not supported here: let", **Open vimrc**), once per set
  of issues. Every other reload, Settings' own Add, Edit, Remove and option changes
  included, shows a success toast ("Vim configuration updated", "The vimrc reloaded."),
  at most one per 2 s. Applied to every Vim editor on the page; a change undoes the old
  mappings.
- **Formatting keys** are keybinding commands that fire while an editor has focus
  (`when: editorFocus`): `markdown.bold` (Cmd+B), italic (Cmd+I), code (Cmd+E),
  strikethrough (Cmd+Shift+X), highlight (Cmd+Shift+H), link (Cmd+Shift+K). In notes they
  win over the app's same keys. In the composer Cmd+Shift+X and Cmd+Shift+H stay the app's
  (they open the workspace and host pickers), and Cmd+B formats only with a selection in the
  composer; elsewhere it toggles the sidebar. Markdown file tabs in Projects use the live
  preview without these keys.
- **Typography**: with Vim on, Settings › Appearance › Typography › Monospace font's
  description ends "the terminal, and Vim's normal mode."
- With the setting off, nothing changes: Escape leaves the composer as upstream does.

## How to get to it (user POV)

Settings (icon rail, or the keyboard menu's `,`) › Keybindings › Vim keybindings, then
type `:q` and Enter.

## Driving it with the Browser panel

The composer is CodeMirror: `preview_act type` cannot target it. Insert text with
`preview_evaluate` (`ed.focus(); document.execCommand('insertText', false, '…')`
on `[data-testid=composer-editor]`). Vim keys go through `preview_act press`, one key
per call (`Escape`, `b`, `d`, `w`, `:`, `Enter`, `Space`).

```
preview_act click     role=switch[name='Vim keybindings']        # opens the :q gate
preview_act press     :   then q   then Enter                    # turns Vim on
preview_wait_for  [data-testid=composer-editor]              # in a chat
preview_act press     Escape                                     # normal mode
preview_act press     :                                          # palette as ex line
preview_act type      role=dialog[name='Search'] >> role=combobox   text=s/hello/bye/
preview_wait_for  text=Run in the editor                     # the row settles after typing
preview_act press     Enter                                      # runs in the editor
```

Read the composer's state:

```js
(() => {
  const ed = document.querySelector("[data-testid=composer-editor]");
  return {
    mode: ed.closest("[data-vim-mode]")?.dataset.vimMode,
    text: ed.innerText,
    font: getComputedStyle(ed).fontFamily.slice(0, 20),
    focused: ed.contains(document.activeElement),
  };
})();
```

A note's mode: `document.querySelector('[data-pane-id] [data-vim-mode]').dataset.vimMode`
and its font `getComputedStyle(document.querySelector('[data-pane-id] .cm-content')).fontFamily`.
A Projects file tab reads the same way.

## Flows

Walk these end to end; each crosses into another feature.

1. **Gate.** Settings › Keybindings → click Vim keybindings → the gate opens with a
   block cursor, switch still `aria-checked=false` → `:w` Enter → gate gone, switch
   off, focus on the switch → click again → `:q` Enter → switch on, stored
   `vimModeEnabled: true`, which survives `location.reload()`.
2. **Composer in a chat tab.** Open a chat (its composer takes focus in insert mode)
   → insert "hello world" → Escape → mode `normal`, monospace, focus kept → `b` `d`
   `w` → "hello " → Enter → still one line, URL unchanged (nothing sent) → `u` →
   "hello world".
3. **Ex line round trip.** In normal mode `:` → Command Palette open (chevron,
   empty field) listing every command (Search, New thread, Close tab, Send the
   draft, Split down, Split right, Clear search highlight, …; from a note the write
   row reads Save to change request) → type `s/hello/bye/` → first row **Run in the
   editor** → Enter → palette gone, draft "bye world", mode `normal`, focus in the
   composer.
4. **Note.** Open a wiki document (wikis.md) → click into it → mode `normal`, code
   font, no `--NORMAL--` panel → `v` `e` → a selection drawn → Escape → `:w` Enter → "No edits to save" → `A`, `x`, Escape, `:w` Enter →
   **Save to change request** dialog → Escape, **Discard edits**.
5. **Vim configuration.** Settings › Keybindings › Vim → **Add** → Mode Insert, Keys
   `jk`, Does `<Esc>` → Save → a row `Insert jk → <Esc>`, a "Vim configuration
   updated" toast, and `inoremap jk <Esc>` in `$home/userdata/vimrc` → append
   `let mapleader = ','` to the file by hand → a warning toast names line N → the
   row's `⋯` Edit → Recursive on → Save → a "Vim configuration updated" toast, not a
   second warning → the line reads `imap jk <Esc>` and the `let` line is still there
   → Search patterns → Vim → `set nopcre` in the file → a chat: insert text, `j` `k`
   → mode `normal`, no "jk" typed → back in settings, remove the row and reset Search
   patterns → only the hand-written lines remain.
6. **Formatting keys.** In the composer, select a word in visual mode (`v` `b`) →
   Cmd+B → `**word**`, the sidebar still open → `u` → Cmd+Shift+K → `[word]()`
   → Settings › Appearance → the Monospace font row names Vim's normal mode.
7. **Off is upstream.** Turn the switch off → the composer has no `[data-vim-mode]`
   value, Escape leaves it.

**Proof:** each flow's reads above, plus saved screenshots of the gate, the
composer in normal mode (code font) and the ex palette. A `[data-vim-mode]` value is
not proof the editor paints: `document.elementFromPoint` at the centre of the gate's
and the composer's `.cm-editor` must land inside it, and `.cm-fat-cursor` must have a
non-zero rect. In an empty, focused Vim draft the insert caret must have a non-zero width
with `margin-left: 0px` and sit inside `.cm-scroller` (it blinks: take two screenshots if the
first misses it). The visual-mode selection needs the screenshot, since its layer draws
under the text and a hit-test lands on the text.

## Gotchas

- Opening a thread focuses its composer **in insert mode**, so a Space or letter
  sent "to the page" types into the draft. Press Escape (normal mode, where Space is
  the leader) or open the menu with Cmd+K; a click outside leaves focus on the page,
  where type-to-focus sends the key into the composer. Clear any stray text.
- Do not send from the composer on a seeded home unless a provider is configured:
  `:w` and Enter in insert mode start a real turn.
- Locators for `preview_act type` must be Playwright selectors; a bare CSS descendant
  selector (`[data-testid=x] input`) is rejected. Use role locators or `>>`.
- The palette's dialog is named `Search` in `:` mode too. Type into it with
  `preview_act type role=dialog[name='Search'] >> role=combobox`, or with
  `[data-testid=command-palette] >> role=combobox`.
- Clear test drafts (`d` `d` in normal mode) and empty the vimrc before the next
  feature: it applies on every device on that server. A row's Keys field records
  held keys, so type `jk` as letters; Enter saves the form.
- `preview_act press` is slower than Vim's 200 ms wait for the second key of a mapping, so
  `j` `k` types "jk". Set **Escape key timeout** to 3000 for flow 5 and reset it after.
- The option fields are number fields: `preview_act type clear=true` does not clear them.
  Click the field, press Meta+A, type the number, then Tab to save it.
- The vimrc is the walk home's `userdata/vimrc` (or `dev/vimrc` under a dev URL
  without `--home-dir`), never `~/.t3/userdata/vimrc`.
- `preview_act press` does send modifiers (`modifiers: ["Meta"]`); `preview_act click`
  does not.

## Owns

`packages/editor/src/vim.ts` (`vimConfiguration`), `packages/shared/src/vimrc.ts`,
`apps/server/src/vimrc.ts`, `packages/contracts/src/vimrc.ts`,
`components/settings/VimrcSettings.tsx`, the vimrc branch of
`components/KeybindingsUpdateToast.logic.ts`, the `vimPanel` prop in `editor.tsx`,
`apps/web/src/components/composerCodeMirror/` (`composerEditor.ts`, `composerUndo.ts`,
`ComposerPromptEditorCodeMirror.tsx`), `components/settings/VimModeSetting.tsx`,
`components/settings/vimQuitGate.ts`, the This device section of
`components/settings/KeybindingsDeviceSettings.tsx`, `apps/web/src/editorKeybindings.ts`,
`apps/web/src/vimScreenLines.ts` (`useVimScreenLines`, which applies Move by screen line to
every Vim editor on the page), `appVimKeys` in `whichKey/doors.ts`,
`components/wiki/WikiNoteEditor.tsx` and `WikiNoteView.tsx` (`:w`), the Vim compartment in
`components/repositories/RepositoryFileView.tsx`, the `markdown.*` defaults in
`packages/shared/src/keybindings.ts`, and `vimModeEnabled` and `vimScreenLinesEnabled` in
`packages/contracts/src/settings.ts`.
