# Glossary

> For maintainers. Using T3 Code? See [docs/user](../user/).

This is a living glossary for T3 Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Checkpointing](#checkpointing)
- [Planning history](#planning-history)
- [Projects and plans](#projects-and-plans)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

Not to be confused with a **Mercurian project**, which contains plans and has no path on disk. Everything on Mercurian's side of that seam is `Mercurian`-prefixed on the wire — see [Projects and plans](#projects-and-plans).

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Receipt

A typed signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. Receipts are a test-only mechanism: the production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on them. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the receipt schema][13], so in practice it is something tests wait on rather than a production signal.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The backend agent runtime that actually performs work. Five drivers ship built in: Codex, Claude, Cursor, Grok, and OpenCode. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

### Planning history

Mercurian's planning state, stored separately from t3code's threads in [CommitStore.ts][25].

#### Commit

One entry in a planning space's history. A commit has a `kind` (message, plan revision, issue revision, coding session), an author (human or assistant), a payload the store treats as opaque, and an ordered list of parents that is unbounded: none for a root, one for a continuation, two or more for a merge. Forks and merges are refused for assistant-authored commits, and nothing may be committed onto a coding session — those are leaves.

#### History

The DAG of commits for one planning space, and the anchor its commits reference. Created with its root commit in one transaction by `createHistory`; every later commit hangs off an existing one.

#### Published

Whether a commit has crossed from the author's workspace into shared history. The flag is one-way, and publishing a commit also publishes its unpublished ancestors along every parent path, so shared history is always complete from any published commit back to the root. An imported plan's root is born published; everything else starts private. Reads take an explicit `visibility` of `published` or `all`.

### Projects and plans

Mercurian's planning layer, stored beside the commit graph in [PlanningStore.ts][26] and crossing the wire through [mercurian.ts][27].

#### Mercurian project

A container of plans, and the context its plans ground in. It has a name and nothing else today: the set of repositories a project scopes is a default rather than a boundary, and the table that holds it arrives with the feature that manages it. Distinct from a t3code [Project](#project), which is a workspace root on disk.

#### Plan

The unit of work, born in a project and owning exactly one planning space. A plan exists only from its first message: creation takes that message and writes it as the history's root commit, which is why there are no empty rows in the project tree and nothing to clean up after an abandoned draft. Its title is derived from the first line of that message.

#### Planning space

The conversation that evolves a plan, with a right pane holding the plan's two standing views — the artifact and the [DAG explorer](#dag-explorer) — chosen from icons in the surface's top-right corner and closable by re-pressing the active one. Everything on it renders over the plan's one [history](#history). The surface writes human `message` and `plan-revision` commits, each naming its own parent, and reads live over one `mercurian.subscribePlan` subscription — a snapshot, then commit events keyed by the commit store's own `sequence` ([ADR 002](../architecture/event-streaming-model.md)). Whether the pane is open and which view it holds are per-browser preferences, unkeyed by plan so they follow the person across plans. Assistant turns land on this seam later.

**Position** is where a window stands, modelled in `PlanPosition.logic.ts` as `latest` or `at(commit, live)`. `latest` is the landing default and follows the plan's newest commit. A `live` position is a branch tip you chose or a commit you just wrote: the [composer](#plan-composer) acts from it, the artifact is editable, and the surface _follows that branch_ as it grows — chained along the first-born child until it rests on a leaf, and never across to another branch. A position that is not `live` is a commit that already led somewhere: you are looking back, and nothing that lands afterwards moves you. Position is per-window transient view state, never persisted and never server-owned, so two windows on one plan may stand on two different branches and still agree on every fact the server owns.

#### Plan composer

The one place a person acts in a [planning space](#planning-space). It acts from wherever the window stands, naming that commit as `parentCommitId` on the write — which is what makes a [fork](#fork) an ordinary send rather than its own operation. It holds a per-plan draft (client-local, keyed by plan, surviving a reload), image attachments through the same attachment store and assets door t3code threads use, and mention chips carried as inline tokens in the message text rather than as a field on the wire. Send and stop are one control whose face derives from a single composer state; today that state is only ever `idle | sending`, which is what makes queueing impossible, and the streaming face lights when the planning assistant lands.

#### Fork

A second child of one commit — two lines of work from a shared point. The only way to author one is to pick an earlier commit in the [DAG explorer](#dag-explorer) and send: the message is the branch's first commit, so every fork begins with something a person said. Assistant-authored forks are refused by the commit store outright, and the artifact's **Edit** is offered only while standing live, so a [plan revision](#plan-revision) can never be the commit that opens a branch. Nothing is destroyed by forking; both lines are real and the explorer draws the branch point.

#### DAG explorer

The plan's history as the right pane draws it, in two views. **Navigator** is the git-graph and the one you move through: commit rows in append order with an SVG rail drawing lanes and edges (`navigatorLayout` — the first child inherits its parent's lane, further children open lanes, merges close them). **Graph** is the spatial map, for seeing structure rather than walking it: every commit a node, every parent edge drawn, laid out by `spatialLayout` — a deterministic synchronous force solve (springs along edges, pairwise repulsion, and a directional field ordering commits by generation) seeded from commit ids, so the same history draws the same picture in every window on every open. Beyond `SPATIAL_MAX_SIMULATED_NODES` the solve is skipped for the plain time axis; when the timeline grows the solve re-runs warm from the prior positions, so the map drifts locally instead of rearranging under a reader. Neither view renders a commit twice — a merge is drawn once in both, where its lanes reunite in the navigator and as one node with an edge per parent on the map. It opens no channel of its own — `parents` and `published` ride on every timeline item, so the explorer is a second _rendering_ of the plan subscription, modelled purely in `PlanGraph.logic.ts`. Published and private commits are distinguished. Picking a commit navigates: the surface shows the [ancestor closure](#history) of that commit as the conversation you are in, and `mercurian.getPlanTextAt` reads the artifact as of there — the one fact the client cannot derive, since revisions travel without their text. The conversation is always one path — the path through wherever you stand. Picking a leaf stands you live on that branch and the surface follows it; picking an interior commit is looking back, which freezes the artifact and turns the composer's next send into a [fork](#fork), said out loud in a banner with the "Back to now" way out beside it. See [position](#planning-space). Nothing is written by moving.

#### Plan revision

A direct edit of the plan, recorded as a `plan-revision` commit in the plan's one history, interleaved with messages at the same standing. Its payload is the plan's _whole_ text after the edit, not a diff, so the plan at any commit is the nearest revision at or above it — no patch replay, and a fork's text is just its own path's latest snapshot. Nothing stores the plan anywhere else: the current text is derived from the history, which is why a plan born blank derives an empty artifact and an imported plan whose root is a revision renders from that root.

#### Issue status

The one thing a tree row is saying right now, from a vocabulary of three: **awaiting your input** (something is waiting on a person — a structured question, or a coding session's approval request), **assistant working** (a reply is streaming), **unseen updates** (the plan moved while you were not looking at it). When several are true the most urgent wins, in that order, and a row shows exactly one. The vocabulary is deliberately narrower than the thread sidebar's five pills: signals from both stores map into these three words _before_ they are ranked, so a session's pending approval and a plan's structured question are one status and there is nothing left to rank inside a tier.

Every input is a server-side fact on the tree subscription's rows — `hasPendingInput`, `isWorking`, and [visited-at](#visited-at) — and the client only ranks them ([ADR 002](../architecture/event-streaming-model.md) §4). The two booleans are composed at one point, `toWirePlanTreeRow` in [wire.ts][28], and are constant `false` until planning turns and coding-session runtimes exist to raise them. Unseen is not a wire field at all: it is `updatedAt` against `visitedAt`, which is ranking rather than originating, and the search palette needs both raw timestamps anyway.

**Rollup** is the same resolver applied to a row's children, most urgent wins: a collapsed project speaks for its plans, and a plan will speak for its coding sessions when those rows nest under it. It is level-agnostic by construction, so adding a level does not change it. An _expanded_ project stays quiet — its plans are on screen saying it themselves.

#### Visited-at

When a plan was last opened, stored per plan in Mercurian's `plan_visits` table. Server-owned rather than client-local ([ADR 002](../architecture/event-streaming-model.md) §5), because unseen is a status the tree ranks and the palette orders — a fact one window's `localStorage` could hold only for that window. It rides back out on the tree subscription like any other row change, so every window agrees. Absent means never visited, which reads as unseen.

Its own table rather than a column on `plans`, so that reading a plan can never bump the plan's `updated_at` and reorder the tree: the tree's order is activity, not attention. `mercurian.visitPlan` writes only when the visit changes seen-ness, which is what lets the open plan fire it on every activity advance for free.

**Mark unread** (`mercurian.markPlanUnread`) puts a plan back in front of you by standing its visit one millisecond before the plan's latest activity, so unseen falls out of the same comparison every row is read by rather than needing a second flag that could disagree with it. Per-user visited state is deferred until identity exists.

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ../../apps/server/src/mercurian/commitTree/CommitStore.ts
[26]: ../../apps/server/src/mercurian/planning/PlanningStore.ts
[27]: ../../packages/contracts/src/mercurian.ts
[28]: ../../apps/server/src/mercurian/planning/wire.ts
