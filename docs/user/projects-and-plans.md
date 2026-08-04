# Projects and plans

The left sidebar is the project tree: your projects, with each project's plans nested underneath.
Below it, a **Workspace** group links to Repositories and Settings.

## Projects

A project is a container for plans and the context those plans ground in. Create one with the
**+** button in the Projects header, give it a name, and it appears in the tree.

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

Opening a plan from the tree lands on its planning space: the conversation that evolves the plan,
with a composer to add to it, and a pane on the right for the plan's two standing views. The plan
you are looking at stays highlighted in the tree while you are anywhere inside it.

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
the plan, in one list with the branch points visible. It offers two readings, and remembers which
one you chose. **Navigator** is the compact one — a tree you can scan, indented where the history
branched. **Graph** draws the full picture, lanes and all, so you can see where work split and
where it came back together. Work you have published reads solid; work still private to you reads
muted.

Pick any commit and the space moves there: the conversation shows the path through that commit, the
plan shows what it said at the time, and the history highlights where you are standing. Nothing is
destroyed by looking — no history is rewritten, and nothing is thrown away. While you are back
there the composer and **Edit** step aside for **Back to now**, because adding from an earlier point
is starting a new line of work rather than appending to this one. **Back to now** — or picking the
latest commit — returns you to the live view.

## Empty states

A workspace with no projects yet says so, with the button to create the first one. An expanded
project with no plans yet says so too. Neither one hides itself.

## Collapsing and resizing the sidebar

Drag the sidebar's right edge to resize it, or collapse it entirely with the toggle in its header
(**Toggle main sidebar**, bound to a shortcut you can change under **Settings** → **Keybindings**).
Both the width and whether the sidebar is collapsed are remembered the next time you open the app.
