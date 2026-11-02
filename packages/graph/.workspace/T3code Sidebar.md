# T3code Sidebar

The left sidebar of t3code, the shell this design adapts — documented as built, in product terms, so the open navigation decision on [[Left Sidebar]] can be reconciled against the real pattern rather than a sketch. Nothing here is settled Mercurian design; the collision map lives on [[Left Sidebar]]. The threads the tree holds are documented in [[T3code Thread]], and their screen in [[T3code Thread View]].

## Shape

One panel, and the panel _is_ the work tree: projects with their threads nested directly under them, a search entry above, a footer below. There are no navigational sections — settings is a footer button, and there is no dashboard or browse surface; you navigate by going to work.

The sidebar is resizable from its right rail (down to a readable minimum, never squeezing the main content below reading width) and collapses fully off-screen — keyboard shortcut, a floating toggle, or clicking the rail. Width and open state are remembered.

## Search

One shortcut opens a unified palette over actions, projects, and threads. An empty query shows actions (new thread, add project, open settings) plus the dozen most recent threads; typing ranks projects and threads by match quality; a `>` prefix restricts to actions. Picking a thread goes there; picking a project opens its most recent thread, or starts its first.

## The tree

- **Projects sort** by last activity, creation time, or manually — manual sort unlocks drag-to-reorder.
- **Projects group** by repository (default), by repository path, or not at all, with per-project overrides — several checkouts of one repo can share a row, marked "N projects."
- A **project row** carries the project's own favicon, its name, a remote-or-local badge when it doesn't live on the primary machine, and a hover-revealed **new thread** button. Its context menu: rename, regroup, copy path, remove — removal is refused while the project still has threads, with an explicit force path.
- An **expanded project** shows its newest threads up to a visible-count setting (default six, adjustable), with **Show more / Show less** past that. A **collapsed project** rolls its threads' statuses up into a single dot — the most urgent wins — and keeps the thread you're currently in pinned visible.

## Thread rows

A row reads, left to right: a pull-request icon when the thread's branch has one (colored by open/merged/closed, click-through to the PR); a status pill; the title (double-click renames inline); then, as they apply, a link to any localhost port the work exposed, a worktree marker, a pulsing indicator for a running terminal, and finally a relative timestamp that yields on hover to an **archive** button (optionally confirm-gated, and unavailable while the thread is running).

The status pill has a strict priority: pending approval > awaiting input > working (pulsing) > plan ready > completed-unseen. Completed-unseen means the assistant finished after your last visit; opening the thread clears it, and **mark unread** re-arms it. The attention family of Mercurian's [[Status Vocabulary]] is the adaptation of exactly this system.

The context menu on a row: rename, mark unread, copy path, copy ID, delete (confirm-gated by a setting). Command-click and shift-click build a multi-selection with bulk mark-unread and bulk delete; clicking anywhere else dissolves it.

## Keyboard

Toggle sidebar, open palette, and new thread each have a chord; digits 1–9 (with the modifier held, which momentarily overlays keycap hints on the rows) jump to the nth visible thread; a bracket pair steps to the previous or next thread.

## Lifecycle and memory

Archiving removes a thread from the sidebar, but not irrecoverably: an Archived page in settings lists archived threads and restores them. Delete is permanent, confirm-gated by settings. The sidebar remembers per-project expansion, manual order, sort/grouping/visible-count preferences, and per-thread visit timestamps (which drive unseen status); it deliberately forgets show-more expansion and multi-selections between visits.

## Empty states

No projects yet and no threads yet each get a quiet placeholder rather than a hidden section; while you're in settings, the tree yields the panel to settings navigation and returns when you leave.
