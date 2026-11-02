# Search Palette

One keyboard shortcut opens a unified palette from anywhere in the app: type, pick, and you're there. It searches everything navigation offers — projects, [[Threads|threads]], your [[Teams|teams]], the app's sections ([[Repositories]], [[Settings]]) — plus the actions that start something new. Its entry point is the search button in the [[Left Sidebar]]'s top row, with no field in the sidebar _(2026-09-30)_; the palette itself is an overlay, so it works even with the sidebar collapsed. Adopted from the pattern documented as built in [[T3code Sidebar]] (its Search and Keyboard sections), per the "transfers cleanly" resolution on [[Left Sidebar]].

## Results and ranking

An empty query shows the actions, then the threads that need you — ordered by [[Status Vocabulary|attention]] urgency (awaiting your input, then unseen updates) — padded with the most recently active threads to about a dozen rows. The empty palette answers both "where am I needed" and "where was I"; a thread needing you outranks the one you just left, and recents keep the resume path when nothing is paused on you.

Typing ranks everything by match quality. Thread rows carry their status signal ([[Status Vocabulary]]) and their project for orientation. A `>` prefix restricts results to actions.

The actions: **new thread** (born in a [[Teams|project]] — the palette asks which, unless you're already inside one of a project's threads), **new project**, and **open settings**.

## Picking a result

- **A thread** opens its space ([[Threads]]).
- **A project** opens its most recently active thread; an empty project drops into creating its first thread. The direct analog of t3code's "picking a project opens its most recent thread, or starts its first" — the palette always takes you to work, never to a container.
- **A team** opens its board, as the command palette's Open team board does on Astrolabe's `collaboration` branch (2026-10-09).
- **A section** goes there.
- **An action** performs it.

## The leader key

_(Designed 2026-09-27, Venkat; supersedes the modifier chords below on the web.)_ Keyboard navigation works as it does in LazyVim: a **leader** opens a **which-key** menu of single keys, groups nest, and each sequence reads as words — `Space p v` is "panes, split right". Two doors open the same menu:

- **Space, while not typing.** Focus anywhere but a text field, or the [[Composer]] in Vim's normal or visual mode, where Space is mapped through Vim so the composer and the app share one rule: Esc, then Space. In insert mode, and with Vim off, Space types.
- **⌘K on macOS, Ctrl+K elsewhere, from anywhere**, including while typing. It is the one modifier chord browsers reliably let a page claim, and users already read it as the app's key.

The menu appears **instantly**, in the **top-right corner** of the main area, and **waits as long as you like**: the timeout Vim keeps for ambiguous mappings has no purpose in a menu, and a menu that vanishes while you read it is a defect. It closes only when Escape is pressed, when it loses focus (a click elsewhere, or the window), or when a key resolves to a command; an unbound key says so and leaves it open; Backspace steps up a group. _(Placement and the no-self-closing rule: 2026-09-27, Venkat.)_ Everything after the leader is an unmodified key, so the sequences never collide with the browser's own bindings, which keeps the rule on [[Tabs]] that the app binds no tab keys on the web.

At the root, before any group, `h` `j` `k` `l` and the arrows **move focus** one step, and the [[Left Sidebar]]'s thread list is the leftmost column of that space: left from the leftmost pane lands on the list, right from the list lands on the leftmost pane, up and down in the list step its rows. The shifted keys move what you look at rather than where you are: `H` `L` (Shift with ← →) step the focused pane's tabs, `J` `K` (Shift with ↓ ↑) step the window's thread through the sidebar's rows, and `[` `]` step the active tab's sub-tabs ([[Thread Tabs]]; chosen 2026-09-30 over Option/Alt with H and L, which type characters on macOS and reach the browser's menus elsewhere). Which-key shows these as compact rows above the groups, keycaps first. _(2026-09-27, Venkat asked whether a top-level move would be useful; ruled yes, with the sidebar in the spatial model and the shifted pair for tabs and threads.)_ A move opens a **repeat window**: for a second after any root move, the same keys run their moves again with no leader, and each press restarts the second, so `Space l l l` walks three panes and `Space J J` two threads, until a second passes with no move key. Any other key ends the window and then does what it always does; a modifier alone or a held key does neither. Where letters would type text (a field, or the composer with Vim off or in insert or replace mode) only the arrows repeat, so `Space l` followed at once by "hello" types hello; in Vim's normal and visual modes the letters repeat too. A small chip in the menu's corner shows the last move's keycaps and "again" while the window is open; it is the only thing in the keyboard layer that goes away on its own, and it goes because the window it reports has ended. _(2026-09-27, Venkat: "allow a sec for a user to repeat a movement, if they do, they can keep moving indefinitely until they take too long to send the next stroke".)_ The groups take LazyVim's letters: `p` panes (`s` split down, `v` split right, `c` close, `o` close others), `t` tabs (`n` new, `c` close, `[` `]` step, `1`–`9` jump, `o` close others), `g` go to a thread view (`c` conversation, `k` checkpoints, `f` files, `d` diffs, `t` terminal, `p` preview, `r` pull request, `g` graph, `m` memory), `s` sidebar (`s` toggle, `f` focus the list, `j` `k` next and previous thread, `n` new thread), `w` workspaces (`1`–`9`, `w` next; retired 2026-10-10 with the workspace switcher, and the key is free), `c` composer (`f` focus, `s` send, `x` clear the draft, `n` normal mode, `v` Vim on or off — turning it on still passes through the `:q` gate in [[Settings]] — with `m` model picker and `a` approval mode waiting on their surfaces), `/` this palette, `,` settings. Beyond the leader, one direct chord: **Ctrl+h/j/k/l moves pane focus** from anywhere, including the composer, because moving between [[Panes|panes]] is too frequent for two keys; Ctrl with the arrows is not its twin, since macOS keeps those for Mission Control and Windows for word jumps. Inside the which-key menu and the view chooser a highlighted row moves with **Ctrl+n / Ctrl+p** and Tab (and the arrows in the chooser, where they are free) and Enter runs it, though letters stay the way to pick in which-key. Ctrl+n and Ctrl+p also move a line in the [[Composer]] in every mode, as Vim and the Mac's text fields do, and step the rows of the sidebar's thread list along with the arrows and `j` `k`. Ctrl+N is a promise only on Apple devices: browsers on Windows and Linux open a new window on it before the page can object, so Ctrl+P and Tab are what works everywhere. _(2026-09-27, Venkat.)_ The which-key menu is also the help; the palette lists every command with its sequence.

## Jump shortcuts

_(Adopted 2026-08 from the source pattern; on the web these become leader sequences — `Space s j`/`k` and `Space t 1`–`9` — since a modifier with a digit is the browser's.)_ The rest of keyboard navigation lives with the palette, as it does in the pattern's source: toggle sidebar, open palette, and new thread each have a chord. With the modifier held — which momentarily overlays keycap hints on the rows — digits 1–9 jump to the nth visible thread row in the [[Left Sidebar]]'s list, in the order drawn (archived threads are not targets). A bracket pair steps to the previous or next card.

## What exists today

Built in T3 Code's client: the palette and the jump shortcuts, over the sidebar's thread list (see [[Left Sidebar]]). The `apps/mercurian/web` playground is taking the leader key and which-key menu (2026-09-27); it has no palette yet.

## Open Decisions

### What does an empty query show — recents, or threads needing you?

**Resolved: needing-you first, then recents.** The pure t3code transfer was a dozen most recent threads — resume muscle memory only. The other pole, only threads with a status signal, goes empty when nothing needs you. Decided for the blend: [[Status Vocabulary]] already defines "the most urgent thing true of it right now," and the palette is the fastest surface to act on it; recents pad the list so the resume path survives. Given up: strict recency order — a thread needing you outranks the one you just left.

### What does picking a project open?

**Resolved: its most recent thread, or start its first.** The direct transfer of t3code's project-pick behavior. "Most urgent thread" was considered for consistency with the empty-query resolution, but rejected as surprising — "go to project" reads as _resume_, not _triage_; the urgent thread is already surfaced by the empty query. "Reveal in the tree" was rejected as a palette that stops short of taking you anywhere. Given up: a project pick that never guesses — an empty project mitigates by dropping into thread creation rather than guessing.

### Where does the palette sit — sidebar content, or app-level chrome?

**Resolved: contained by [[Left Sidebar]].** The palette opens from anywhere and outlives a collapsed sidebar, which argued for app-level; but its entry point sits atop the sidebar, and the sidebar is the navigation surface the palette accelerates — same containment as its t3code source. Also keeps the [[Mercurian]] root to a single child. Given up: the spine saying "search works everywhere" — the note says it instead.

### Can the single-key leader be turned off?

_(Raised 2026-09-27.)_ A plain Space that opens a menu is a single-character shortcut, which accessibility guidance (WCAG 2.1.4) asks to be switchable off or remappable, and some assistive setups send stray keys. **A setting:** a device preference turns the Space door off, leaving ⌘K/Ctrl+K and Ctrl+hjkl. **Always on:** one fewer setting; Space never fires while typing anyway. **Recommendation:** a setting, on by default, beside the Vim toggle in [[Settings]]. It is cheap and it is what the guidance asks for. Given up: nothing of substance.

### Does the desktop app bind more than the web?

_(Raised 2026-09-27.)_ Electron can claim keys the browser reserves: ⌘1–9 for tabs, ⌘W to close, ⌘T. **Identical to the web:** one vocabulary everywhere; the leader covers all of it. **Desktop extras:** the native chords people expect from a desktop app, on top of the leader. **Recommendation:** identical for now, and revisit when the desktop app exists; a second vocabulary should be earned by a real complaint. Given up: ⌘-digit tab switching on the desktop, for the time being.

### Do the jump shortcuts belong here, or on the sidebar?

**Resolved: here.** Digits and brackets act on the sidebar's rows, not the palette, which argued for recording them on [[Left Sidebar]]; but all three chords are one product idea — navigate to work without the pointer — and live together in the source pattern's Keyboard section. One note answers "how do I get anywhere by keyboard." Given up: strict atomicity — the sidebar's keyboard behavior is documented one hop from the sidebar. (Decided when the sidebar was a tree; the flat list changed the targets — visible thread rows — not the decision.)
