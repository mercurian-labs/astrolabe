# Spaces

A space is the unit you arrange and return to: one or more [[Threads|threads]] shown together, with their views standing as [[Tabs|tabs]] in [[Panes|panes]]. Every thread belongs to exactly one space. A thread on its own is a space of one, and nothing about it differs from a single thread's space. A space of several gathers threads you work on together, after the spaces of Devin's desktop app. _(2026-10-09: this note was Windows; renamed with the vocabulary ruling on [[Teams]], since "window" also names the browser's and the operating system's.)_ The browser tab, or the desktop window, shows one space at a time. _(2026-09-29, Venkat: proposed as thread groups, named spaces "because it can be scoped to just one thread". It reverses the 2026-09-27 rule that a second thread is never a tab, for the threads you chose to put together; see "Why spaces".)_

## What a space of several shows

- Each member's conversation is a tab named by its thread. A space of one keeps its conversation tab reading Conversation ([[Tabs]]).
- A thread view ([[Thread Tabs]]) belongs to one member and says so: its tab carries the view's name and then its thread's. A view never follows focus to another member. Pages, notes and the memory graph are one per space.
- Choosing Conversation from a pane's view list in a space of several asks which member's conversation to open _(2026-09-30, Venkat)_.
- Each view of each member is one tab in the space, and opening one that stands in another pane moves it to the pane you asked from ([[Tabs]]).
- The [[Composer]] writes to the thread of the focused tab. The pane header's title is a switcher listing the members with their status; choosing one brings that member's conversation into the pane ([[Panes]]).
- The space's panes, tabs, sizes and focus are remembered per device for the space, as a lone thread's are for the thread.

## In the sidebar

Every space among the list's cards is drawn as a space, a raised box, so the column reads as a stack of spaces _(2026-09-30, Venkat: "the other active threads will definitely have their own windows, so they should get a white background like the group")_. A space of several has a header with its name and its members as ordinary rows inside; collapsed, the header shows its most urgent member's status, and the block remembers whether it is open. A space of one is the same box around its one row, with no header. The shelves' slim rows stay on the sidebar's surface.

A space is pinned, settled or snoozed as a whole from its header, and sits in that section as one block. A member can still be settled or snoozed alone; it then stays in its space as a slim row at the block's end rather than leaving it.

## Making and unmaking

- A row's menu moves its thread to another space or to a new one, named inline. A member can be removed, becoming a space of one again with a fresh arrangement. The header's menu renames, parks, or ungroups the space, returning every member to a space of one.
- A thread joining a space brings its conversation into the space's focused pane and leaves its own arrangement behind.
- **New thread joins the open space** as a member; a modifier-click starts it in a new space instead ([[Left Sidebar]], 2026-09-30).
- **A fork joins its parent's space**, so a research family gathers where it is being compared without anyone arranging it ([[Threads]]).
- Moving, removing and ungrouping are undoable for five seconds, like the list's other actions.

## Why spaces

The 2026-09-27 rule kept a space to one thread because an app-wide list of thread tabs had just proved redundant with the sidebar: a tab that equals a thread carries nothing the row does not. A space of several is different in kind. It is a set you chose, so its tabs say something the list cannot: these threads are being read together. Comparing two threads no longer needs two browser windows when you gather them; it still can. Given up: the simplicity of one thread per screen, and a thread's views being arranged only for that thread once it has joined others.

## Spaces are yours

_(2026-10-09, Venkat: spaces are personal.)_ A space is only ever one person's: collaboration happens through the threads inside it, and no teammate ever rearranges yours. Three ways layer onto that, in the order they are built. **Teammates' threads visit:** a teammate's published thread can sit in your space as a tab beside your own threads, read-only, as a guest thread does; continuing it makes a thread of your own ([[Collaborative DAG]]). The rule that every thread belongs to one space holds per person: their thread sits in their space and in yours. **Sending a copy:** sending a space gives the recipient a space of their own with the same threads and arrangement, after which the two drift apart, as a fork does; private threads in it must be published or left out. **Following:** a live, read-only view of a teammate's space, for pairing and demonstrations, waits for presence to be designed. Spaces that several people edit together are declined: one arrangement nobody owns.

## What exists today

Nothing in Astrolabe's main. The `apps/mercurian/web` playground has it (2026-09-29): spaces of several with members as tabs, thread-bound views, the composer's switcher, the sidebar block with its rollup, whole-space and per-member parking, moving, removing, ungrouping and renaming, and undo for all but renaming. A member of a parked space offers the space's own un-settle or wake. Not yet: making a space by dragging one row onto another, and a real fork action to show forks joining their parent's space.

_(2026-10-09.)_ On Astrolabe's `collaboration` branch, not yet merged: a teammate's published thread opens as a tab beside the thread you are in, read-only, from the sidebar's team rows. Sending and following a space are not built.
