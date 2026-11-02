# Left Sidebar

The left sidebar is the app's navigation. It is always present. It shows your own [[Threads|threads]] as one flat list, across every project on the computers you are connected to, and below them, once you are signed in, the threads your [[Teams|teams]] have published. One row heads it, as tall as the panes' strips: the collapse toggle at its start, a compact **project** switcher the size of the buttons beside it, then **New thread** and the [[Search Palette|search]] button at its end; with the sidebar closed, the toggle, New thread and search stay in reach in the leftmost pane's strip, and in the desktop app the row leaves room for the window's controls _(2026-09-30, Venkat)_ _(2026-09-30, Venkat: the wordmark "removes usable space" and is gone from the sidebar; search is a modal, so no field shows in the sidebar)_. [[Memory]], [[Repositories]], and [[Settings]] sit in the footer. It is the only sidebar: a thread's own views open as [[Panes|panes]] of the thread's [[Tabs|tab]] ([[Thread Tabs]]).

Its contained concepts are [[Search Palette]], [[Teams]], [[Memory]], [[Repositories]], [[Settings]].

_(Rewritten 2026-09-24. The previous design scoped the list to one Mercurian project and took T3 Code's sidebar whole as its base. Mercurian now sits beside T3 Code without editing it, and a T3 Code project holds one repository, so the scope moved up to the workspace and the note was written again from that point. Git holds the previous note and its decisions.)_

## Your threads and your teams'

The list is your own work: every thread in your projects on the computers you are connected to. It has no container and nothing to choose, because working on your own needs no team and no account ([[Teams]], "Your own work"). The thread rows, the drafts, and the archived shelf are all yours.

Your teams' published threads stand below your own, in a **From your team** section that appears once you are signed in. It shows the most recently active published threads, newest first, each naming its author. **See all** opens the team's board, which shows its threads by family or by person ([[Collaborative DAG]]). A teammate's thread opens read-only, and it can open beside your thread in your [[Spaces|space]]. Organizations and teams, their people, and new teams are managed under [[Settings]], not from the sidebar.

_(Amended 2026-10-10, Venkat: "Keeping as is makes sense", confirming that your own work needs no container. The workspace switcher this section described is gone. It named one workspace, personal or shared, and scoped the whole list to it; with the personal workspace retired, the list is always yours and teams join it as a section. It had moved from the top row to the footer on 2026-09-28. Given up: a list scoped to one team's repositories and memory; a team's threads are on its board instead.)_

## The thread list

Each row is one thread, and a [[Spaces|space]] of several shows as one boxed block holding its members' rows, pinned, parked and collapsed as a whole ([[Spaces]]). The list is otherwise flat. There are no project or repository rows to expand, and each row names its repository as context. You can narrow the list to one repository from the project switcher, which the interface calls a **project** as T3 Code does: a searchable list of All projects and each of your repositories _(2026-09-30, Venkat: "it should be project too")_. The narrowing is a view of your list, remembered per device. The open thread's row is never hidden by the scope, a closed shelf, or paging.

_(2026-09-28, Venkat: the Obsidian-style list, with its gutters beside the rows, was set aside for T3 Code's sidebar UX, "excellent from a ux perspective, but not a ui perspective": copy the UX, draw it better. The rows below are that adaptation, with the T3 Code sidebar's current shape, itself a flat cross-project inbox, as the reference.)_ An active or pinned thread is a **card** of three lines: its repository and, on the right, its **status slot**; its title; then its branch and provider. The slot names what the thread needs, in the [[Status Vocabulary]]'s colours, with a glyph: **Working** with a ticking duration, **Approval** or **Input** (both awaiting your input), **Done** (unseen updates), or **Woke** (a snooze whose time came, which stays until dismissed, opened, sent to, settled or archived), else the thread's relative time. A thread working in the background that is neither open nor unread recedes, its title muted. Hovering a card swaps the slot for **Settle** and **Snooze** without moving anything; snoozing offers presets (in an hour, in three, this evening, tomorrow, next week), each with its time. Settled and snoozed threads are **slim rows** of one line, the title and the settled time or the wake countdown, which hover swaps for Un-settle or Wake now. Settling or snoozing the open thread moves the space to the next card, wrapping, or to the empty space when none is left; sending to a settled thread un-settles it. Every parking action is undoable for five seconds from a footer notice ("Settled 2 threads · ⌘Z to undo"; consecutive actions of one kind group, older groups stay undoable until they expire, and undo puts back only what the action changed). Rows sit flush in the list, 4px from its edge, on a plain surface with no gutters, and never fade: they end in an ellipsis.

A fork is a thread with its own row and its own lifecycle. A family is seen whole in a thread's local DAG, which opens from the thread as its own tab ([[Checkpoint Graph]]). A fork joins its parent's [[Spaces|space]], so in the list a family gathers in its space's block ([[Spaces]]).

**Pinned threads** come first, in the order you drag them into. **Active threads** follow. Below them, the **Settled** and **Snoozed** shelves each collapse and remember whether they were open. Settling puts a thread aside until it moves again. Snoozing puts it aside until a chosen time. A reply, an approval request, or a structured question brings a settled or snoozed thread back to the active list. A snoozed thread also returns at its wake time. A thread keeps its pin and its place in the pinned order while it is set aside.

Each row shows at most one attention state from the [[Status Vocabulary]]. **Awaiting your input** outranks **Assistant working**, which outranks **Unseen updates**. Opening the thread clears Unseen updates, and **Mark unread** sets it again.

Clicking a row shows the thread in its space with the panes and tabs it was last left in on this device; a modifier-click or a middle-click opens it in a new browser tab, and the row's menu offers the same ([[Tabs]]).

The thread header's menu and a row's context menu offer the same actions in the same order: pin and unpin, settle and un-settle, snooze and wake (or dismiss Woke), rename (inline, as a double-click on the title does), regenerate title, mark unread, filter by the row's repository, open in a new browser tab, archive, and delete where it is allowed. The menu opens from the keyboard too (Shift+F10, the ContextMenu key). The row changes as soon as the action lands.

### Drafts

A thread you have started writing but not yet sent appears in a drafts block above the pinned threads. Only drafts with text in them appear, so opening an empty draft adds nothing to the list. A draft row is one line, with its first words standing in for a title and its repository as context. Clicking the row resumes the draft, and a hover action discards it.

### The archived shelf

Archived threads collapse into one shelf at the bottom of the list. It is collapsed by default and shows a count. Opened, it lists archived threads with the most recently archived first, in slimmer rows, one page at a time. Hovering an archived row offers **Restore**, and the row menu offers delete while the thread is private. Restoring returns a thread to where it was, with its pin order and lifecycle. The shelf and the Archived page in [[Settings]] show the same threads.

Delete exists only while a thread is fully private. Once anything in it is published, archive is the only way to remove it from view ([[Threads]]).

### New thread

The new-thread action starts a draft in the project the list is narrowed to, or else in the project of the thread you have open; the draft can move to another project before its first message. **It joins the [[Spaces|space]] you have open**: the new thread becomes a member, its conversation opens in the focused pane, and a space of one becomes a space of several. With no space open it starts one. A modifier-click (⌘ on macOS, Ctrl elsewhere) always starts it in a new space _(2026-09-30, Venkat)_. A new thread with nothing typed that you leave is discarded, and its space shrinks back. With no projects yet, the sidebar offers to add one.

## Search and keyboard

The search entry opens the [[Search Palette]]. Search happens only in the palette, never inside the sidebar. The jump shortcuts move through the visible rows in the order drawn, including rows in open Settled and Snoozed shelves. Rows in a collapsed shelf and archived threads are skipped.

## The footer

Three rows: [[Memory]], standing knowledge; [[Repositories]], where repositories are added and managed; and [[Settings]], which holds [[Environments|environments]], [[Providers|providers]], your teams, and the Archived page. Where a team's memory is reached, now that the list has no team scope, is open below. Update notices also appear here. While you are in Settings, settings navigation replaces the sidebar's contents.

The sidebar collapses and resizes, and remembers both across reloads.

## Where the rows come from

The rows come from two sources, and the list reads them as one ([[Sync]]). Your own threads come from the T3 Code servers on the machines you are connected to. Teams, their repository sets, and the threads teammates have published come from the Mercurian cloud ([[Strategy]]). A row looks the same whichever source it came from.

## What exists today

In the `apps/mercurian/web` playground (2026-09-28): the workspace row (since retired), the header (search by title, repository scope, new thread), drafts, Pinned and Active cards, the Snoozed and Settled shelves, hover actions, park-and-advance, the undo notice, inline rename, the row menu and the keyboard paths, over fixture threads with an in-memory lifecycle. Not yet: drag to pin, reorder or settle; multi-selection and bulk actions; the hover card; the archived shelf; a real search palette. In Astrolabe's main the sidebar that runs is T3 Code's own. On Astrolabe's `collaboration` branch (2026-10-09, not merged), T3 Code's sidebar gains the From your team section, its See all link to the board, and a way to open a teammate's thread beside yours.

## Open Decisions

### How much of T3 Code's sidebar is the starting point?

_(Raised 2026-09-24.)_ The previous design took T3 Code's sidebar whole because every upstream sync would otherwise conflict with our changes. Mercurian no longer edits T3 Code's files, so a Mercurian sidebar is its own code and never conflicts with upstream. That reason no longer holds, and the choice is now about what serves the design. **Keep the lifecycle:** start from T3 Code's rows, its pinned, settled, and snoozed shelves, its row menu, and its drafts, and remove what belongs to projects: the project tree, the grouping and sorting options, and project rows. **Start bare:** draw only the thread list, and add lifecycle features when use asks for them. **Recommendation:** keep the lifecycle. People use pinning, settling, and snoozing to manage many threads at once, which is the audience this product is for, and the thread header offers those same actions. Given up: the smaller first build.

### How does the list show that a thread is a fork?

_(Raised 2026-09-24.)_ Research forks often, so the list fills with sibling threads that answer the same question differently. **Flat, unmarked:** what T3 Code does. Every fork is an ordinary row, and the relationship shows only in the [[DAG]]. **Nested:** forks indent under their parent and collapse with it, which brings back the tree the flat list rejected. **Flat, marked:** each fork's row names the thread it forked from, and hovering a row highlights the rest of its family in the list. **Recommendation:** flat, marked. The list stays flat and the family is one glance away. Given up: collapsing a family out of the way, which settling each fork already does.

**Resolved in part (2026-09-24): the list stays flat.** Nesting is declined. A family's structure belongs to the local DAG, not the list.

**Resolved (2026-09-29, Venkat): a family gathers in a window** _(a window is now a [[Spaces|space]])_. A fork joins its parent's space, whose block in the list holds its members as ordinary rows, unindented and without parent-to-child structure, so the list stays flat within the block and the tree stays in the DAG. Marking a fork's parent on its row and highlighting its family on hover are left for use to ask for. Given up: a list where every thread stands alone.

### Do threads an agent spawned appear in the list?

_(Raised 2026-09-24.)_ A spawned thread is a real thread in the [[DAG]], but it works under one turn of its parent and reports back to it. **Recommendation:** keep them out of the list, as T3 Code does, and reach them from the parent thread. A person did not choose to start them, and listing them would crowd the rows people did choose. Given up: jumping straight to a spawned thread from the sidebar; the [[Search Palette]] still finds it.

### Where do teammates' published threads appear?

_(Raised 2026-09-24.)_ In a team, teammates publish threads ([[Collaborative DAG]]). **Mixed in:** their threads join your rows, each marked with its author, and the list stops being your own work queue. **A team shelf:** a collapsible shelf below the active list holds the team's published threads from other people, newest activity first, each row marked with its author. **Search and DAG only:** teammates' threads never appear in the list. **Recommendation:** a team shelf, collapsed by default, remembering whether it was open like the other shelves. Pinning a teammate's thread moves it into your pinned threads. Given up: a single ordering of everything in the team. Attention states on a teammate's row are also open: a thread awaiting its author's input is not awaiting yours.

_(2026-10-09.)_ Built on Astrolabe's `collaboration` branch as recommended, short of a ruling: the From your team section above, always shown while signed in rather than collapsible, with no pinning of teammates' threads yet and no attention states on their rows.

### Where does PR Review live?

_(Raised 2026-09-24.)_ [[PR Review]] is one of the three parts of the [[Strategy]] and has no design yet. **A footer row:** beside Memory and Repositories, as a page of its own. **A shelf in the list:** pull requests waiting for your review, as rows among the threads. **Recommendation:** a footer row until PR Review is designed. A pull request is not a thread, and putting it among threads would give the list two kinds of row. Given up: review requests showing up where you already look.

### Is attention in other workspaces shown?

_(Raised 2026-09-24.)_ The switcher shows one workspace, so a thread awaiting your input in another workspace stays hidden until you switch. The previous design accepted this for projects until use asked for more. Teams now belong to several shared workspaces, and a teammate's question can wait unseen. **Recommendation:** a count on the switcher of threads awaiting your input in other workspaces, and nothing else. The other attention states stay inside their workspace. Given up: a quiet switcher.

**Dissolved (2026-10-10): there are no other workspaces.** The list always holds all of your own threads, so a thread awaiting your input is always in it. A teammate's thread awaiting its author's input is not awaiting yours, as the shelf decision above notes.

### Where is a team's memory reached?

_(Raised 2026-10-10.)_ A team holds a [[Memory|memory]] when one is designated ([[Teams]]). The footer's Memory row read the scoped workspace's memory; with no team scope on the list, it has no team to read. **On the team's page:** beside the board, where the team's threads already are. **In the footer, with a team picker:** one Memory row that asks which team. **Recommendation:** on the team's page. A team's memory belongs with its people and threads, and the footer stays about your own work. Given up: reaching every memory from one row.
