# Collaborative DAG

The [[DAG]] shared across people: a project's published threads, with the forks and transfers that relate them, visible to everyone in the team it was published to ([[Teams]]), held in the Mercurian cloud ([[Environments]]). It is the second pillar of the [[Strategy]] — publishing agentic conversation threads — and the point where the orchestrator's thread lineage meets [[Publishing]].

What is designed so far follows from Publishing and the DAG rather than deciding anything new: a thread is private until published; publishing a checkpoint publishes its thread's earlier checkpoints and the ancestry it forked from, so nobody sees a thread whose origin is invisible; a teammate's fork of a published thread is a thread of their own, on their own machine, with the lineage recorded across the two; and a transfer across people takes from a published checkpoint, never from another person's private work. Open, to be designed from use: how the shared DAG is hosted and kept in sync — the control plane on [[Strategy]] — and what a teammate sees of a published thread's working state beyond its conversation and checkpoints.

_(2026-09-24: written up from the note's one line, "a DAG that is collaborative".)_

How published threads reach each person's app, next to their own threads, is on [[Sync]].

## Continuing a teammate's thread

_(2026-10-09.)_ Pairing is forking. On a teammate's published thread you choose **Continue in a thread of mine** and pick one of your projects, with checkouts of the same repository offered first. A new thread of yours opens there carrying their conversation as context, newest messages kept when it is long; their code stays on their branch. When you publish your thread, it records the thread it continues, as long as both are in the same organization, so the family stays legible across people.

## The team board

_(2026-10-09, Venkat: the board is for awareness.)_ The team's page answers "what is everyone working on?". It shows **families**: a thread and every published thread that continues it, whoever made them, with who is in each, which repository, and when it last moved. The same threads can also be listed by person. It shows status, not shape: a single family's shape stays its [[Checkpoint Graph]], and the 2026-09-24 ruling there, declining a map of every thread at thread size, stands. A teammate's thread can also sit beside yours in your own [[Spaces|space]], read-only, as a guest thread does.

## Open Decisions

### What carries a published thread into its team?

_(Raised 2026-09-24.)_ A thread lives in a T3 Code server on the machine where it runs, and Mercurian does not change T3 Code. Something else has to read the thread there and send what is published to the cloud. **The client that publishes:** the app you publish from reads the thread from the machine and sends it. Publishing then works only while that app is open and connected, and later checkpoints on a published thread wait for the next time it is. **A Mercurian process beside the T3 Code server:** it runs on the owning machine, reads the thread from T3 Code as any client does, and keeps the published part current. It is one more thing to install and run. **Recommendation:** start with the client that publishes, since publishing is already a deliberate act, and move to a process on the machine when published threads need to stay current without you. Given up for now: published threads that update while no app is open.

**Resolved (2026-10-09): the client that publishes.** Taken with the control-plane architecture Venkat agreed on [[Strategy]]: the control plane never connects to anyone's computer, so the app carries published work to it. Since a published thread now stays published as it grows ([[Publishing]]), the app watches its published threads and, when one's turn settles, sends the messages the team has not seen. Given up, as recommended: a published thread that grows while no app of its owner's is open; it catches up when one opens.
