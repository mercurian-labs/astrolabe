# Projects and plans

The left sidebar is the project tree: your projects, with each project's plans nested underneath.
Below it, a **Workspace** group links to Repositories and Settings.

## Projects

A project is a container for plans and the context those plans ground in. Create one with the
**+** button in the Projects header, give it a name, and it appears in the tree.

A project's context is its repositories. Hover a project row and press the **repositories** icon to
choose which registered repositories its plans work in — a default, not a boundary, and never a
label on anything. See [Repositories](./repositories.md).

A project row expands and collapses with a click, and the tree remembers which projects you left
expanded. A project with many plans shows its most recent ones and a **Show more** row for the
rest; expanding that list is deliberately forgotten when you come back.

## Plans

A plan is the unit of work. Start one from the **new plan** button that appears when you hover a
project row: that opens a composer, and nothing else.

A plan starts existing when you send its first message. Until then there is no row in the tree —
if you navigate away without sending, nothing is left behind but the text you typed, which is
still there if you come back to the same project. Once the first message lands, the plan appears
under its project, titled from that message's first line.

A plan can also start from an issue you already track. The same empty composer offers **Import from
a tracker**, which browses your connected trackers and starts the plan from the issue you pick — the
plan's conversation then opens with that issue rather than with something you typed. See
[Trackers](trackers.md#importing-an-issue). Both ways in are equally supported; blank is the one you
land on.

Opening a plan from the tree lands on its planning space: the conversation that evolves the plan,
with a composer to add to it, and a pane on the right for the plan's two standing views. The plan
you are looking at stays highlighted in the tree while you are anywhere inside it.

## Status in the tree

A glance at the tree is a glance at where you are needed. A plan row carries a small
coloured dot when there is something to say about it, and never more than one — when several
things are true at once, the most urgent one wins. Hover the dot to read what it means.

- **Awaiting your input** — something in the plan is waiting on you to answer.
- **Assistant working** — a reply is coming in right now. This is the one that pulses.
- **Unseen updates** — the plan moved while you were not looking at it.

Opening a plan clears its unseen dot, and anything that lands while you are reading is marked
seen as it arrives — your own messages never light up your own row. To put a plan back in front
of you, open the row's menu and choose **Mark unread**; it comes back everywhere, not just in the
window you clicked in.

A collapsed project shows one dot for everything inside it: the most urgent status among its
plans. Expand it and the dot moves down to the plans themselves, which are now on screen to speak
for themselves.

None of this needs a refresh. A status appears, changes, and clears as it happens, in every window
you have open.

## The composer

The composer is where you act in a plan. It acts from wherever you are standing — normally that is
the end of the conversation you are in, and after picking an earlier commit in the history it is
that commit instead.

A message you have not sent stays with its plan. Leave the planning space, come back, and it is
still in the composer, images and all; the same is true after a reload. Sending clears it, and a
draft in one plan says nothing about any other.

Messages carry images. Paste a screenshot, drop a file onto the composer, or use the image button —
each one becomes a thumbnail above what you are typing, removable with the × in its corner, and it
appears in the message once you send. A very large image is still accepted; it may just not be
there if you reload before sending.

Type **@** to mention a file from the plan's repositories: a menu lists files from every repository
in the project's set, saying which one each came from when there is more than one, and picking one
turns it into a chip that travels with the message. A project with no repositories has nothing to
offer, so the menu stays closed — see [Repositories](./repositories.md) for setting the project's
set.

**Enter** sends and **Shift+Enter** starts a new line. There is no queueing — while a message is
going out the send button is held, and the next one waits.

## The assistant

Send a message and the assistant answers, streaming in below it as it thinks. It runs under the
workspace's [planning model](#the-planning-model), and it grounds what it says in the project's
repositories — reading, searching, listing, never changing a file.

What it consulted is shown with each reply, folded away until you want it: a quiet **Consulted…**
line expands into the files it read and the searches it ran. When a provider can only ground in one
of the project's repositories, the reply says which ones were out of reach rather than pretending it
looked. A project with no repositories is fine too — the assistant plans from the conversation
alone.

While a reply is coming in, the send button becomes **Stop**. Stopping does not erase anything:
the partial reply stays in the conversation, marked **Interrupted**, because it happened and was
cut short. Branching past it later works like branching past anything else.

Instead of guessing, the assistant can ask you a structured question — a card with options right
in the conversation. The plan shows **awaiting your input** in the tree until you answer, and the
question and your answer stay in the record with the reply.

The assistant can also edit the plan itself, mid-reply, at the same standing as your own edits: its
revisions appear in the history like yours do, live in every window. What it never does is branch,
merge, or touch anything outside the plan — branches are yours to open, and its replies only ever
continue from where things left off.

One reply at a time, for the whole plan: while the assistant is answering, sending — from any
window — waits until you stop the reply or it finishes.

If this machine cannot run the planning model — none is chosen yet, or no connected instance offers
it — the composer says so right above where you type, instead of failing silently. Your message
drafts still work; sending resumes as soon as the model resolves. See
[the planning model](#the-planning-model) for how it is chosen.

## The right pane

Two icons sit in the space's top-right corner: the **plan** and the **history**. Pressing one shows
it in the right pane; pressing the one already showing closes the pane and gives the conversation
the whole width.

The first plan you open comes up with its plan visible and the history one press away. After that
the pane comes back the way you left it — open or closed, and on whichever view — and that choice
follows you from plan to plan, because which view you prefer is a fact about you rather than about
one plan.

Drag the divider between the conversation and the pane to give either side more room; the width is
remembered. On a narrow window the two stack, pane above conversation.

## The plan

Every planning space has exactly one plan, and it is yours to edit. A new plan starts empty —
**Edit** in the plan's header opens it for writing, **Save** keeps what you wrote, **Cancel**
throws it away. The plan is written in Markdown and renders as a document.

Saving is not a side channel: your edit joins the plan's history alongside the messages, in the
order things happened, with who made it and when. Scroll the conversation and you will see the
edits interleaved with the messages — one history, not a document with a change log bolted on.
Clearing the plan is an edit like any other, and the plan's text is always exactly what that
history adds up to.

Nothing here needs refreshing. An edit or a message appears as it lands — including one made in
another window open on the same plan.

## The history

The history view shows every commit in the plan: your messages, the assistant's, and every edit of
the plan, with the branch points visible. It offers two readings, and remembers which one you chose.

**Navigator** is the one you move through: every commit as a row in the order it happened, with
lanes drawn down the left showing where work split and where it came back together. **Graph** is a
map of the same history laid out in space — every commit a point, every connection drawn, the whole
shape at once. Use the navigator to walk the history; use the graph to see it. Drag the map to move
around it and scroll to zoom; it draws the same way every time you open it, and where you are
standing is ringed and comes to the middle.

Work you have published reads solid; work still private to you reads muted.

Pick any commit, in either view, and the space moves there: the conversation shows the path through
that commit, the plan shows what it said at the time, and the history highlights where you are
standing. The conversation is always one path — a branch you are not on is a different conversation,
not more of this one. Nothing is destroyed by looking: no history is rewritten, and nothing is
thrown away.

Picking the end of a branch stands you in that conversation, and the space follows that branch as
it grows. Branches other than yours can grow all they like; you stay where you are.

Picking a commit that already led somewhere is looking back. The plan goes read-only, and the
composer says so: _sending starts a new branch from here_. Send, and it does — a new branch whose
first commit is your message, and the space follows it. That is the only way a branch is made:
every one begins with something you said. **Back to now** returns you to the newest line of work.

## The row menu

Hover a plan row in the tree and its timestamp gives way to a **⋯** button. That menu holds
everything you can tell a row to do: **Mark unread**, and the two ways a plan leaves the tree. On
desktop, right-clicking the row opens the same list as a native menu.

## Archiving and deleting a plan

**Archive** is always there. It takes the plan out of the tree and out of every listing, and
destroys nothing — the conversation, the plan, and the whole history are exactly where they were.
An archived plan's own address keeps working, so a link to it still opens.

**Delete** is only there while a plan is fully private, which means no commit in it has been
published. Before that crossing the work was never seen by anyone else, so deleting leaves no
trace: the plan, its conversation, and its history are gone, and importing the same issue again
starts a fresh plan. Once anything in a plan is published, delete stops being offered anywhere in
the app — archive is the only disappearance a published plan has. Plans that came in through issue
import are published from birth, so they are archive-only from the start.

Deleting or archiving the plan you are looking at returns you to the tree.

### Getting an archived plan back

**Settings** → **Archived** lists everything you have archived, grouped by project and most
recently archived first, with when it was archived and when it was created. **Restore** puts a plan
back under its project, in the place in the list it had before — archiving is not activity, so a
restored plan does not jump to the top.

**Delete** sits beside Restore only for a plan that is still fully private. For a published plan
there is nothing to offer there.

The page is live. Archive a plan in one window and the row appears here in another; restore it and
it returns to the tree in both. Nothing needs refreshing.

## The planning model

The model the planning assistant runs under is chosen once for the whole workspace, under
**Settings** → **Providers**. It names a provider and a model — Claude and Opus, say — and never
one of your connected accounts, because accounts live on the machine they were signed in on and the
workspace is shared.

Each machine works out for itself which of its own instances of that provider runs the model, and
the setting says which one underneath the picker. If a machine has no instance of that provider, or
the model is not on offer there, it says so plainly and keeps showing what the workspace chose —
nothing is cleared, and the setting resolves again as soon as an instance exists. When a model is
missing because the installed agent is too old to run it, the message names the update that unlocks
it, and that update is one click away on the instance's own card further down the page.

The picker offers each provider's models the way you have curated them: models you have hidden stay
hidden, your ordering holds, and your favorites come first.

## Empty states

A workspace with no projects yet says so, with the button to create the first one. An expanded
project with no plans yet says so too. Neither one hides itself.

## The search palette

One shortcut opens the search palette from anywhere in the app, including with the sidebar
collapsed. There is also a **Search…** row above the tree, which shows you the shortcut.

With nothing typed, the palette shows what you can start — **New plan**, **New project**, **Open
settings** — and then the plans that need you: the ones waiting on an answer first, then the ones
that moved while you were away, padded out with your most recent plans to about a dozen rows. Each
plan row carries its status dot and the project it belongs to.

Start typing and everything is searched together: plans by title or project, projects by name, the
workspace sections, and the actions. Better matches come first. Type `>` to see only the actions.

Picking a result always takes you to work, never to a container:

- a **plan** opens its planning space;
- a **project** opens its most recently active plan — or, if it has none yet, drops you straight
  into composing its first;
- a **workspace section** goes to that page;
- an **action** performs it.

**New plan** asks which project first, unless you are already inside one of a project's plans — in
which case it just starts one there.

## Jumping around with the keyboard

Hold the shortcut modifier and numbered keycaps appear on the tree's plan rows: press a digit to
jump to that row. A bracket pair steps to the previous or next plan and stops at the ends rather
than wrapping. The digits count only rows that open something — project rows expand instead, so
they are never numbered, and a collapsed project's plans are not counted either.

Inside the palette the same digits pick the numbered result rows.

The palette, the sidebar toggle, and **New plan** all have shortcuts you can change under
**Settings** → **Keybindings**.

## Collapsing and resizing the sidebar

Drag the sidebar's right edge to resize it, or collapse it entirely with the toggle in its header
(**Toggle main sidebar**, bound to a shortcut you can change under **Settings** → **Keybindings**).
Both the width and whether the sidebar is collapsed are remembered the next time you open the app.
