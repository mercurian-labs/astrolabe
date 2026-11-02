# Tabs

A tab is one of a thread's views standing in a [[Panes|pane]]: a pane groups several of the thread's views as tabs and shows one at a time. The whole main area shows one [[Spaces|space]], a single [[Threads|thread]] or several gathered together: on the web that is the browser tab, on the desktop the app window, and the app keeps no tab list of its own. The [[Left Sidebar]] lists threads and is the working set; the panes and their tabs are how one thread's views are arranged. _(Designed 2026-09-24 as Obsidian's tabs-in-splits; turned over 2026-09-27 into tabs-contain-panes with a vertical strip beside the sidebar; turned back the same day, thread-scoped, see "Why panes own the tabs, scoped to a thread".)_

## One space at a time

The browser tab, or the desktop window, holds one [[Spaces|space]] and its arrangement of panes; a space of one is a single thread, as below. Clicking a thread's row in the [[Left Sidebar]] shows that thread with its own panes and tabs, the conversation, Checkpoints, Diffs, the memory graph, and the rest ([[Thread Tabs]]), as you last left them; nothing of the previous thread's arrangement carries over. A modifier-click (⌘ on macOS, Ctrl elsewhere) or a middle-click opens the thread in a new browser tab, and the row's menu offers the same. A note or a page opened from within the thread's work may be a tab too. A second thread is a tab only when the two share a space of several, which is how two threads are compared in one screen ([[Spaces]], 2026-09-29, reversing the earlier rule that a second thread never is).

## Tabs in a pane

- A pane's tabs are the thread's views, and each view is one tab in the whole space. Opening a view that is already a tab in the pane shows it; opening one that is a tab in **another** pane **moves it here**, into the pane you asked from, and a pane left with no tabs closes as it does when its last tab is closed. The dialog says "Move here" on such a view before you choose it. Adding a tab asks which view in a small dialog and opens it; cancelling opens nothing. _(2026-09-28, Venkat: the earlier rule, focusing the view where it already was, teleported you away from the pane you had just asked in; moving honours where you asked. Given up: a split that survives having its only view asked for elsewhere.)_ _(2026-09-27, Venkat: "new tab shouldn't open a tab that allows you to select between different options"; the chooser-as-a-tab of the same morning is withdrawn.)_
- A pane's strip runs across its top, as pills. The **thread's name is not a tab**: the conversation's tab reads simply **Conversation** in a space of one (in a space of several each conversation tab carries its thread's name, since there the strip does hold several threads, [[Spaces]]), and the thread is named in the header of the pane showing it ([[Panes]]) and on its row in the [[Left Sidebar]]. _(2026-09-28, Venkat: a thread name on a tab button read as if another thread could open as a second tab beside it, which a window never does. A heading in the top-left pane's strip was tried the same day and withdrawn: "putting it with the composer might be the move".)_ _(A per-pane vertical rail, hover-widening and pinnable as Chrome's vertical tabs, was added and withdrawn on 2026-09-27; see the open decision below.)_
- Dragging a tab to another pane's strip moves it there; dragging it to a pane's edge divides that pane. Closing a pane's last tab closes the pane, and the last pane stays empty, with one action that asks which view to open.
- On the web the app binds no tab keys; the browser's keep their meaning.

## Opening and remembering

- A space with no thread shows the empty state, and the composer starts a new thread there.
- A space's arrangement is its own, remembered **per device, per space**, and for a space of one that is **per thread**: the panes, tabs, active tabs, sizes and focus you leave a thread in are what return whenever that thread is shown again, in the same browser tab, another one, or after a restart. A thread never opened on this device opens as one pane with one tab, the conversation; adding a tab is where you choose a view ([[Thread Tabs]], first-open ruling, resolved 2026-09-27). Switching threads puts one arrangement away and brings back the other's.
- A space with no thread (the memory, graph and repositories pages) keeps its own arrangement with the browser tab.
- The URL names the thread and the focused pane's active tab, so a link opens the same thread, and a link to a view opens that view in the thread's arrangement.

## Only what you can see stays live

A visible tab receives its updates as they happen; a hidden tab, or a background window, keeps what it last showed and catches up when shown. A thread that needs you says so in the browser tab's title and on its row in the [[Left Sidebar]] ([[Status Vocabulary]]).

## On the phone

The [[Mobile App]] shows one view at a time and has no tabs or panes.

## Why panes own the tabs, scoped to a thread

The first design put tabs inside panes and let a tab be any view of any thread, which made the app own a tab list the browser could not honour. The second turned it over — a tab was a thread holding panes — and listed those tabs in a strip beside the sidebar. That strip was a second list of the sidebar's own rows: a thread is what the sidebar lists, with pinning and lifecycle for the working set, so a tab that was a thread carried nothing a row did not (_"vertical tabs makes me feel like the idea of tabs are kinda useless here"_, 2026-09-27). What was left worth keeping from each: the browser or window as the thread, from the second; tabs grouping views inside a pane, from the first. Scoping the tabs to the window's thread removes the conflict that broke the first design, since the browser's tabs stay the browser's. Given up: several threads in one window; an app-level tab list; the vertical strip beside the sidebar, and the 2026-09-25 scrolling layout (reversed on [[Panes]]); later the same day, an arrangement shared across a thread swap, and the vertical strip inside a pane (below).

## What exists today

The playground at `apps/mercurian/web` has been through each of the three models in turn (2026-09-24 to 27) and now builds the thread-scoped one: horizontal strips per pane, arrangements per device per thread. T3 Code's client shows one thread at a time.

## Open Decisions

### Does a link to a note open it in a tab?

_(Raised 2026-09-24.)_ A wikilink in a reply or a note opens a transient reader over the thread's space ([[Memory]]). That reader existed because the right sidebar had a fixed set of views and no room for a note. **A tab:** clicking a link opens the note in a new tab beside the one you are in, as Obsidian does, and a modifier-click opens it in the focused tab. **The overlay:** the reader stays as it is. **Recommendation:** a tab. The overlay's reason retired with the right sidebar, and a note open in a tab can be read beside the conversation while the agent works on it ([[Atlas]]). Given up: a reader that disappears on its own when you look away.

**Resolved (2026-09-27): a tab, beside the one you are in, in the same pane.** The note joins the thread's window as one of its tabs. Given up: the overlay, as before.

### Does each workspace keep its own tabs?

_(Raised 2026-09-24.)_ **Per workspace:** switching workspaces puts away one set of tabs and brings back the other's, as switching vaults does in Obsidian. The tabs always match the sidebar's scope. **One set for the app:** tabs from several workspaces stay open together, which suits comparing across workspaces but lets the tabs disagree with the sidebar. **Recommendation:** per workspace. The workspace already scopes the list, the memory, and the repositories, and a tab from another workspace would be the only thing on screen that ignored it. Given up: comparing threads from two workspaces side by side.

**Dissolved (2026-09-27): a window is one thread of one workspace.** Its tabs are that thread's views; workspaces meet only across windows. _(2026-10-10: a window is now a [[Spaces|space]], and the workspace is retired ([[Teams]]); with no team scope on the list, the question has nothing left to decide.)_

### Do the number shortcuts jump to sidebar rows or to tabs?

_(Raised 2026-09-24.)_ The jump shortcuts move through the sidebar's rows ([[Search Palette]]). Obsidian and most tabbed apps use the same keys to move between tabs. **Recommendation:** the number keys move between tabs, as people expect in a tabbed app, and the bracket pair keeps stepping through sidebar rows. Given up: jumping straight to the fifth thread in the list; the [[Search Palette]] reaches any thread by name.

**Resolved (2026-09-27): to browser tabs, by the browser.** The app binds no tab keys on the web. The bracket pair keeps stepping through sidebar rows. _(Later that day: the leader key on [[Search Palette]] reaches a pane's tabs as `Space t 1`–`9`, unmodified keys after a leader, so the rule holds.)_

### Where do a window's panes go when its thread is replaced?

_(Raised 2026-09-27.)_ Clicking a row swaps the thread. **The arrangement stays** and every tab shows the new thread's counterpart view, which is what the 2026-09-26 "linked" ruling on [[Thread Tabs]] asked for, now true by construction. **The new thread's own arrangement returns**, remembered per thread, as the 2026-09-24 note had it. **Recommendation:** the arrangement stays. The window is the thing you arranged, and a swap that rearranged it under you would make clicking a row unpredictable. Given up: a layout remembered per thread.

**Resolved (2026-09-27, Venkat): the new thread's own arrangement returns, remembered per device, per thread.** The recommendation was built and overturned in use: _"when I switch threads, the state of the panes and everything is the same. All that changes is the conversation tab in place. This not we want. Each thread should get its own tabs and split completely independently."_ The thing you arranged is the thread, not the window. Per device rather than per browser tab, so a second browser tab and a restart show the thread as you left it. Given up: an arrangement that stays put across a swap; two browser tabs on one thread arranging it differently.

### Does the vertical tab strip return?

_(Raised 2026-09-27 by Venkat.)_ Each pane could switch its strip to a vertical rail at its left, widening on hover and pinnable, in the manner of Chrome's vertical tabs. It was built and withdrawn the same day: _"It just doesn't lead to a great experience I feel. It would take a lot of effort to get perfect, so let's just put a pin on it."_ **Never:** panes have one strip, across the top. **Later, polished:** the rail returns once the hover, pin, width and narrow-pane cases are right. **Recommendation:** none until a use asks for it; the pin is the record. Given up for now: a pane whose tabs read as a list.
