# Projects and threads

The left sidebar is the project tree: your projects, with each project's threads nested underneath.
Use **Filter threads by project** above the tree to narrow it. Below it, a **Workspace** group links
to Repositories and Settings.

## Projects

A project is a container for threads and the context those threads ground in. Create one with the
**New project** button beside the project filter, or from the search palette. The dialog takes the
whole act: name the project, tick the registered repositories it should work in, and create — the
sidebar switches to your new project, ready for its first thread. Cancelling creates nothing.

Connecting repositories at creation is optional — the set is a default, not a boundary, and never
a label on anything. The dialog lists the repositories this workspace already knows; **Manage
Repos** takes you to the [Repositories](./repositories.md) page to add or remove them, and a
workspace with no repositories yet offers just that button. For an existing project, the same
choices live behind the project filter's **repositories** icon. Both dialogs let you independently choose a repository and directory for [memory](./project-memory.md), plans, and specs. These locations are optional. Changing a location never moves existing files.

A project row expands and collapses with a click, and the tree remembers which projects you left
expanded. A project with many threads shows its most recent ones and a **Show more** row for the
rest; expanding that list is deliberately forgotten when you come back.

## Threads

A thread is the unit of work. Start one from the **New thread** button that appears when you hover a
project row: that opens a composer, and nothing else.

A thread starts existing when you send its first message. Until then there is no row in the tree —
if you navigate away without sending, nothing is left behind but the text you typed, which is
still there if you come back to the same project. Once the first message lands, the thread appears
under its project, titled from that message's first line.

A thread can also start from an issue you already track. Open the search palette and choose
**Import from a tracker**. Unless you are already inside one of a project's threads, the palette
first asks which project to **Import into**, then opens the tracker picker. The thread starts from
the issue you choose rather than from a message you typed. See
[Trackers](trackers.md#importing-an-issue).

Opening a thread from the tree lands in its thread space. Each line of work has its own conversation,
and the thread you are looking at stays highlighted in the tree while you are anywhere inside it.

### Where a fork came from

A forked line shows the messages leading up to the fork followed by its own messages in one
continuous conversation. Messages from other branches after the fork are excluded. Use
**Load earlier turns** to read more of a long history.

Selecting a checkpoint shows the conversation up to that point. **Back to latest** restores the
line's full conversation; this control only appears when viewing an earlier checkpoint. To continue
from an earlier point, choose **Fork from here**. **Fork here** on a user message also opens another
line. Viewing history keeps your current draft and does not rewind the working tree.

## Status in the tree

A glance at the tree is a glance at where you are needed. A thread row carries a small
coloured dot when there is something to say about it, and never more than one — when several
things are true at once, the most urgent one wins. Hover the dot to read what it means.

- **Awaiting your input** — something in the thread is waiting on you to answer.
- **Assistant working** — a reply is coming in right now. This is the one that pulses.
- **Unseen updates** — the thread moved while you were not looking at it.

Opening a thread clears its unseen dot, and anything that lands while you are reading is marked
seen as it arrives — your own messages never light up your own row. To put a thread back in front
of you, open the row's menu and choose **Mark unread**; it comes back everywhere, not just in the
window you clicked in.

A collapsed project shows one dot for everything inside it: the most urgent status among its
threads. Expand it and the dot moves down to the threads themselves, which are now on screen to speak
for themselves.

None of this needs a refresh. A status appears, changes, and clears as it happens, in every window
you have open.

## The composer

The composer is where you act in the current line. It is the same composer used by any other T3
Code thread, with the line's model, access mode, attachments, commands, skills, and context meter.

A message you have not sent stays with its draft or line. Leave the thread space, come back, and it
is still in the composer, images and all; the same is true after a reload. Sending clears it, and a
draft in one line says nothing about any other. Drafts saved by older versions are brought into the
current composer once.

Messages carry images. Paste a screenshot, drop a file onto the composer, or use the image button —
each one becomes a thumbnail above what you are typing, removable with the × in its corner, and it
appears in the message once you send. A very large image is still accepted; it may just not be
there if you reload before sending.

Type **@** to mention a file from the thread's repositories: a menu lists files from every repository
in the project's set, saying which one each came from when there is more than one, and picking one
turns it into a chip that travels with the message. A project with no repositories has nothing to
offer, so the menu stays closed — see [Repositories](./repositories.md) for setting the project's
set.

Your thread can also mention [memory notes](./project-memory.md#mention-notes-in-a-thread). Type **[[**
for a notes-only menu, or keep using **@** to search notes alongside files.

### Commands and skills

Type **/** at the start of a line to browse commands supplied by the line's provider, or
type **$** to browse its enabled skills. Choosing one places the invocation in your message, where
you can add arguments before sending it. These offers come from the provider instance connected to
this machine; when that instance cannot run the selected model, the menu says why, and
when it supplies no commands or skills, the menu says that too.

**Enter** sends and **Shift+Enter** starts a new line. There is no queueing — while a message is
going out the send button is held, and the next one waits.

## The assistant

Send a message and the assistant answers in the current line, streaming below it as it works. The
first turn claims a working slot for the line; if every slot is busy, a banner says that the line is
waiting. Once the workspace exists, the assistant can work in it under the model and access mode
shown in the composer. Settled replies quietly name the provider and model that produced them.

What it consulted is shown with each reply, folded away until you want it: a quiet **Consulted…**
line expands into the files it read and the searches it ran. When a provider can only ground in one
of the project's repositories, the reply says which ones were out of reach rather than pretending it
looked. A project with no repositories is fine too — the assistant works from the conversation
alone.

While a reply is coming in, the send button becomes **Stop**. Stopping does not erase anything:
the partial reply stays in the conversation, marked **Interrupted**, because it happened and was
cut short. Branching past it later works like branching past anything else.

Instead of guessing, the assistant can ask you a structured question — a card with options right
in the conversation. The thread shows **Awaiting your input** in the tree until you answer, and the
question and your answer stay in the record with the reply.

The assistant can also edit plan and spec files mid-reply. Those edits are captured with the turn,
live in every window, and land before the reply that explains them. A claim in reply text is not an
artifact change. The assistant never forks a line for you.

Each line takes one turn at a time. While its assistant is answering, stop that turn or wait for it
to finish before sending the next message on the same line.

If this machine cannot run the line's model — none is chosen yet, or no connected
instance offers it, or every instance that offers it is signed out — the composer says so right
above where you type, instead of failing silently. Your message drafts still work; sending resumes
as soon as the model resolves. See [Model and access](#model-and-access) for how it is chosen.

## The thread space

The thread space uses T3 Code's standard thread layout: the project and thread breadcrumb in the
header, the conversation and composer in the main area, a terminal drawer below, and a tabbed panel
on the right. The composer context meter shows how much of the provider's context window the line
is using. Provider compaction remains part of the thread timeline rather than becoming a
checkpoint.

The panel starts with **Checkpoints** pinned first and **Plan** selected. Checkpoints cannot be
closed. The Plan surface lists both plan and spec documents and opens them in Files. The **+** menu
also offers available workspace surfaces such as Terminal, Files, Diff, and Browser. When neither
plans nor specs have a location and there are no documents to show, Plan is disabled with a setup
explanation. Configuring either type enables it; the other type can be configured later.

Drag the divider to give the conversation or panel more room; the width is remembered.
Maximize the panel when it needs the whole workspace. On a narrow window it opens as a sheet. The
terminal drawer is independent of the panel, so you can keep a shell open below the conversation
while reading another surface on the right. Selected terminal output can be added to the next
message as context.

## Plans and specs

Plans describe the implementation approach. Specs describe expected behavior and acceptance
criteria. Both are Markdown files in project repositories, available to future threads. A thread
can work on several documents and does not need a plan/spec pair.

Choose their locations independently in project settings or when creating a project. Changing or
removing a location does not move or delete files from the previous location. No blank documents
are created by setting a location.

The Plan surface shows documents available on the line, with the most recently checkpointed
changes first. Open a row to read it in Files. Plan and spec files are read-only in the app,
including Markdown checkboxes; ask the assistant to edit them using its normal file tools. Use Diff
to inspect changes. The list does not generate change summaries.

Selecting a checkpoint reads saved Git content rather than the current working file. Historical
files open as read-only source, so relative images cannot silently load from the live worktree.
Missing repositories or snapshots are reported rather than substituted with current content.

An imported issue creates a spec in the configured specs directory. In its Files view,
**Refresh from issue** checks the issue without sending an assistant message. An unchanged issue
writes nothing. If both versions changed, review the previous import, local spec, and upstream
issue, then choose or edit the result before saving. The app rechecks the reviewed versions and
captures the saved file in Git.

## Checkpoints and lines

The Checkpoints tab shows every continuable checkpoint in the thread: complete turns, unanswered
queries, direct artifact revisions, repository-specific Plan revisions, and historical
coding-session leaves. Those leaves open read-only, and sending from them is declined. Revisions made
inside one assistant turn stay inside that turn's checkpoint rather than appearing as separate
places to continue. The history is a spatial graph with every connection visible and no text on the
map itself. At a readable zoom, a turn shows its strongest recorded effect: code, memory, Plan, then Spec.
Status dots separately show saving, failed or unknown captures, interrupted or partial turns,
and stale Spec or Plan status. Drag the map to move around it and scroll to
zoom; where you are standing is ringed and comes to the middle.

Work you have published reads solid; work still private to you reads muted.

Choose a checkpoint to navigate to its line and viewing position. Checkpoint details show model
facts, effects, warnings, and the saved changes in each repository, including file change kinds,
renames, deletions, and recorded branch facts. **Open changes** opens that repository’s saved
checkpoint diff. Missing snapshots show as unavailable. Coding-session pull request links are
labelled as current lookups. Details offer **Fork here**, **Open line**, or
**Continue from checkpoint** when those actions apply. For a
historical coding-session leaf, **Open line** selects that leaf's line in the owning thread.

After moving, the current line's conversation stays visible, Plan and Spec show what they said at
that checkpoint, and Checkpoints highlights where you are standing. Nothing is destroyed by
looking: no history is rewritten, and nothing is thrown away. **Back to now** returns the surfaces
to the line's current position.

To branch from something you said, choose **Fork here** on that user message. Astrolabe forks at the
message's parent, creates a new line, puts the original message back into its composer, and leaves
the original line untouched. The new line gains its history root and working slot only when you
send its first turn.

**Continue from checkpoint** creates a new line whose first turn restores the checkpoint’s saved
files and reconstructs conversation through that checkpoint. Later work is excluded. Every
repository must have a complete capture; an interrupted turn can qualify even without a saved reply.
The server checks snapshot availability before creating the line and again before restoring files.

## The row menu

Hover a thread row in the tree and its timestamp gives way to a **⋯** button. That menu holds
everything you can tell a row to do: **Mark unread**, and the two ways a thread leaves the tree. On
desktop, right-clicking the row opens the same list as a native menu.

## Archiving and deleting a thread

**Archive** is always there. It takes the thread out of the tree and out of every listing, and
destroys nothing — the conversation, the Plan, and the whole history are exactly where they were.
An archived thread's own address keeps working, so a link to it still opens.

**Delete** is only there while a thread is fully private, which means no commit in it has been
published. Before that crossing the work was never seen by anyone else, so deleting leaves no
trace: the thread, its conversation, and its history are gone; repository documents are retained, and importing the same
issue again starts a fresh thread. Once anything in a thread is published, delete stops being offered
anywhere in the app — archive is the only disappearance a published thread has. Threads that came in through issue
import are published from birth, so they are archive-only from the start.

Deleting or archiving the thread you are looking at returns you to the tree.

### Getting an archived thread back

**Settings** → **Archived** lists everything you have archived, grouped by project and most
recently archived first, with when it was archived and when it was created. **Restore** puts a thread
back under its project, in the place in the list it had before — archiving is not activity, so a
restored thread does not jump to the top.

**Delete** sits beside Restore only for a thread that is still fully private. For a published thread
there is nothing to offer there.

The page is live. Archive a thread in one window and the row appears here in another; restore it and
it returns to the tree in both. Nothing needs refreshing.

## Model and access

The model picker and access-mode control are the same controls used in any T3 Code thread. A new
thread starts with the project's default or the most recently used choices. If no model is available,
the picker asks you to choose one before the assistant can answer.

A picker change is part of the unsent draft: it adds nothing to history until you send a message,
survives leaving and returning, and does not affect another branch.

The choice belongs to the line. A fork starts from the inherited thread defaults, and
changing one line does not change another.

The choice names a provider and a model — Claude and Opus, say — and never one of your connected
accounts, because accounts live on the machine they were signed in on and the workspace is shared.

Each machine works out for itself which of its own instances of that provider runs the model, and
the picker shows that instance using the standard thread control. If a machine has no
instance of that provider, the model is not on offer there, or every instance offering it is signed
out, it says so plainly and keeps showing the recorded pair — nothing is cleared or rewritten. The
pair resolves again as soon as an instance exists or you sign in. When a model is missing because
the installed agent is too old to run it, the disabled reason names the update that unlocks it.

The picker offers each instance's models the way you have curated them: models you have hidden stay
hidden and your ordering holds.

## Empty states

A workspace with no projects yet says so, with the button to create the first one. An expanded
project with no threads yet says **No threads yet**. Neither one hides itself.

## The search palette

One shortcut opens the search palette from anywhere in the app, including with the sidebar
collapsed. There is also a **Search…** row above the tree, which shows you the shortcut.

With nothing typed, the palette shows what you can start — **New thread**, **Import from a tracker**,
**New project**, **Open settings** — and then, under **Threads**, the threads that need you: the ones
waiting on an answer first, then the ones that moved while you were away, padded out with your most
recent threads to about a dozen rows. Each thread row carries its status dot and the project it
belongs to.

Start typing and everything is searched together: threads by title or project, projects by name, the
workspace sections, and the actions. Better matches come first. Type `>` to see only the actions.

Picking a result always takes you to work, never to a container:

- a **thread** opens its thread space;
- a **project** opens its most recently active thread — or, if it has none yet, drops you straight
  into composing its first;
- a **workspace section** goes to that page;
- an **action** performs it.

**New thread** asks which project first, unless you are already inside one of a project's threads — in
which case it just starts one there.

**Import from a tracker** follows the same project rule. Outside a project's thread it first asks
where to **Import into**; inside one, it opens the tracker picker for that project immediately.

## Jumping around with the keyboard

Hold the shortcut modifier and numbered keycaps appear on the tree's thread rows: press a digit to
jump to that row. A bracket pair steps to the previous or next thread and stops at the ends rather
than wrapping. The digits count only rows that open something — project rows expand instead, so
they are never numbered, and a collapsed project's threads are not counted either.

Inside the palette the same digits pick the numbered result rows.

The palette, the sidebar toggle, and **New thread** all have shortcuts you can change under
**Settings** → **Keybindings**.

## Collapsing and resizing the sidebar

Drag the sidebar's right edge to resize it, or collapse it entirely with the toggle in its header
(**Toggle main sidebar**, bound to a shortcut you can change under **Settings** → **Keybindings**).
Both the width and whether the sidebar is collapsed are remembered the next time you open the app.

## Working in a line

Planning and building happen in the same thread. Each line claims its isolated working slot on the
first turn. Until that workspace exists, git actions, repository scripts, and
**Open in** stay hidden. A missing branch, a wait for a slot, or a provider that can reach only some
of the project's repositories appears as a banner above the conversation.

The header begins with the upstream project crumb. When a line spans several repositories, git
actions, scripts, **Open in**, and file browsing address the line's home repository — the first
repository the project links. Changed-files cards and the diff still show every repository's
changes.

The timeline reads turn by turn. Work-log detail stays folded until you expand it, completed turns
carry their changed-files cards, and the timeline follows new work while you are at the bottom. Use
the terminal drawer for a persistent shell below the conversation, or add a Terminal tab to the
right panel when you want the shell beside it.

In Supervised work, commands and file changes can pause for approval. Structured questions pause in
their own answer card. Either kind of pause marks the thread **Awaiting your input** in the tree; a
running turn marks it **Assistant working**. See [Permission modes](permission-modes.md).

Links from older versions still land in this layout: a legacy `/plans/` address opens its thread
space, and a legacy `/sessions/` address opens the owning thread with that line selected.
