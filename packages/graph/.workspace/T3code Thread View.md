# T3code Thread View

The core working screen of t3code: the timeline of one [[T3code Thread]] plus everything that drives its next turn. Documented as built — verified against the t3code repository — in product terms. Nothing here is settled Mercurian design; the reconciliation lives on [[Threads]]. _(2026-09-03: adopted whole as the [[Threads|thread]] space, with Mercurian's additions enumerated there and on [[Thread Tabs]].)_

## Timeline

The conversation reads turn by turn. Inside a turn, the agent's activity is a work log — what it read, ran, and changed, plus its thinking — each entry folded to a line and expandable: the same "grounding is visible, folded away" move the [[Assistant]] adopts. Long turns fold into collapsible groups, and a minimap runs alongside for orientation. The view keeps itself pinned to the newest content while the agent streams, with a jump-to-bottom affordance once you scroll away.

Each turn ends with a **changed-files card** — the files touched, with added and removed line counts — that opens that turn's diff in the right panel. Every user message carries the _revert to this message_ action (the checkpoints of [[T3code Thread]]).

## Header

The header names the thread — not the project — and carries three controls: **project scripts** (predefined commands run in the thread's workspace), an **open-in picker** (hand the workspace to an editor), and **git actions** — commit (a generated message on offer, per-file inclusion), push, pull, open a pull request, the combined commit-and-push(-and-PR) moves, and first-run moves like initializing or publishing a repository.

## Composer

The prompt box carries everything you hand the agent, staged as removable chips before sending: `@`-mentions of workspace files, image attachments, terminal output attached as context, and pending review comments from the diff tab. When the agent needs you mid-turn, this is where it shows up — approval requests to accept or decline, structured questions awaiting answers. Send and stop are one control: it starts a turn when idle and interrupts the running one.

Slash commands switch the session — `/model` is built in — alongside provider-supplied commands and skills. Pickers on the composer choose the [[T3code Providers|provider instance]], model, runtime mode, and — where the model offers them — the model's own traits, such as reasoning depth; a footer meter shows context-window usage. A prompt stash sets a drafted message aside — text and image attachments, deliberately no model choice — for restoring into any thread's composer later.

## Right panel

A tabbed panel docked beside the timeline, opened as needed: **terminal**, **files**, **diff**, **browser preview**, **plan**. Browser preview is desktop-only — the web app shows the tab, disabled, and says so — and offers itself when the thread's work exposes a localhost port. The diff tab requires the project to be a git repository.

The diff tab scopes to a single turn or the whole thread's changes, with whitespace and word-wrap toggles. Its distinctive move is the feedback loop: you can comment on individual lines, and the comments flow back into the composer as pending context for the next turn — review the changes, mark what's wrong, send it back.

## Plan mode

In plan mode a turn ends with a proposed plan instead of executed work. The thread signals **plan ready**; the plan opens in the right panel — a summary, a checklist of steps with progress states, and the full text — and the composer offers three moves: **implement**, **refine**, or **implement in a new thread**. Nothing executes until you choose, and implementing in a new thread links the plan to the thread that carries it out.
