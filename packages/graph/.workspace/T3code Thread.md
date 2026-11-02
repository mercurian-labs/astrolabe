# T3code Thread

A thread is t3code's durable unit of work: one ongoing conversation with a coding agent inside a project, holding the message timeline, the agent's activity, its file changes, and the live agent runtime. Documented as built — verified against the t3code repository — in product terms, so the planning-space design can be reconciled against the real pattern. Nothing here is settled Mercurian design; the reconciliation lives on [[Threads]]. The screen that drives a thread is [[T3code Thread View]]; the navigation around threads is [[T3code Sidebar]].

## Born as a draft

A new thread starts as a draft: composing the first prompt is purely local, and nothing exists beyond your composer until the first turn starts — at that moment the draft is promoted to a real thread on its environment. A draft already carries the thread's whole configuration (branch, worktree choice, modes), so a thread is fully shaped before it exists.

## One turn at a time

A thread advances in turns: you send a prompt, the agent works — reading files, running commands, editing — and the turn settles. Strictly one turn runs at a time: the send control is simply unavailable while a turn runs, and there is no queueing — the one exception is mobile, where a message sent while the agent is busy waits and is delivered when the turn settles, a reliability mechanism rather than a stackable queue. A running turn can be interrupted at any time.

Mid-turn the agent can pause for you two ways: **approval requests** (in the modes that require them) that you accept — once, or for the rest of the session — or decline, and **structured questions** that wait on your answers.

## Checkpoints: rewind, not forks

When a turn settles, the workspace is snapshotted as a checkpoint — invisible bookkeeping that never appears in your branch history or dirties your working tree — and the turn's file changes are summarized as a **turn diff**. Checkpoints buy three things: seeing exactly what each turn changed, comparing points in the thread, and reverting — every user message in the timeline carries a _revert to this message_ action that rolls the workspace and conversation back to that point.

The contrast that mattered for Mercurian (2026-07): rewind was the **only** history move — no editing a past prompt, no retrying a response, no forking a conversation; going back discarded everything after. t3code's history was a line with an eraser. _(2026-09-24: t3code's next orchestrator adds forking a thread into a new thread with its lineage recorded and taking a fork's context back, while rewind in place stays and marks what came after as rolled back. Mercurian adopts the fork and the transfer whole and keeps rewind as a fork — the [[DAG]] of threads, where "forks and transfers are human-driven only" and nothing is destroyed; [[Threads]].)_

## The session and its modes

A session is the live agent runtime attached to the thread, hosted on the thread's environment, running under a [[T3code Providers|provider instance]] and a chosen model — switchable from the composer, including by a `/model` command. Two independent toggles shape it:

- **Runtime mode** — three tiers, not two: _supervised_ (approval before consequential actions), _auto-accept edits_, and _full access_ (the default).
- **Interaction mode** — _default_ (act directly; the picker presents it as build) or _plan_ (propose a plan first — see [[T3code Thread View]]), switchable via `/plan` and `/default`.

Neither mode sticks: a new draft always starts at full access, in the default interaction mode. What a new draft inherits is the provider instance and model — last-used, never configured (see [[T3code Providers]]).

Session state is server-owned and fans out: web, desktop, and mobile can all watch the same thread stream live at once.

## Where the work lands

A thread works in the project's main checkout or in an isolated worktree on its own branch, so parallel threads never step on each other. The choice is made when starting the thread — and can still be changed after — from a branch toolbar on the thread view; a setting chooses whether new worktrees start from the local branch or from origin. Finished work leaves the ordinary git ways (the git actions on [[T3code Thread View]]). The worktree's full arc — created at the first turn, a system-owned branch named by the work, teardown only on delete — is [[T3code Worktree Lifecycle]].

Threads live on an environment — a machine — and rows on a non-primary environment are badged (see [[T3code Sidebar]]; for the Mercurian stance on environments, [[Environments]]).

## Bookkeeping

Threads title themselves from the first prompt, and the generated title never overwrites a rename. The thread tracks its context-window usage — a meter in the composer — and the agent compacts its context automatically as it fills, surfacing the compaction in the timeline. Archiving removes the thread from the sidebar but is reversible from an Archived page in settings; delete is permanent, confirm-gated by a setting.
