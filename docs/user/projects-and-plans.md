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

Opening a plan from the tree lands on its planning space: the conversation that evolves the plan,
with a composer to add to it, and a pane on the right for the plan's two standing views. The plan
you are looking at stays highlighted in the tree while you are anywhere inside it.

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

## Empty states

A workspace with no projects yet says so, with the button to create the first one. An expanded
project with no plans yet says so too. Neither one hides itself.

## Collapsing and resizing the sidebar

Drag the sidebar's right edge to resize it, or collapse it entirely with the toggle in its header
(**Toggle main sidebar**, bound to a shortcut you can change under **Settings** → **Keybindings**).
Both the width and whether the sidebar is collapsed are remembered the next time you open the app.
