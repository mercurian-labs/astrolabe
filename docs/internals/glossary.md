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
- [Trackers](#trackers)
- [Workspace settings](#workspace-settings)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

Not to be confused with a **Mercurian project**, which contains plans and has no path on disk, or a **[Mercurian repository](#mercurian-repository)**, which is a registered codebase. Everything on Mercurian's side of that seam is `Mercurian`-prefixed on the wire — see [Projects and plans](#projects-and-plans).

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

A container of plans, and the context its plans ground in. It has a name and a set of [Mercurian repositories](#mercurian-repository) — a default rather than a boundary, held in `project_repositories` and never a stamp: nothing is filed under a repository, and no table could file it. Distinct from a t3code [Project](#project), which is a workspace root on disk.

#### Mercurian repository

A registered codebase — the third thing this vocabulary calls a repository, beside t3code's `RepositoryIdentity` (a git-remote-derived fact about a workspace) and `SourceControlRepositoryInfo` (a provider's view of a remote). It has a name, a resolved path unique across the registry, and the scripts declared on it, in [RepositoryStore.ts][28] and crossing the wire through [mercurianRepositories.ts][29].

Three things it does _not_ store, each on purpose. Its **git-ness** is probed live (`git rev-parse --show-toplevel`, short-TTL cached): a plain directory registers fine because grounding reads files either way, and the working-tree features light up on their own once the directory becomes a repository. Its **hosting provider** is derived from the primary fetch remote. Its **environment** is a fact about which server answered, not a column — the registry lives in one `mercurian.sqlite`, and environments stay plumbing.

Removal disconnects: the row, its scripts, and its project memberships go, while the files and every grounding reference already written into a plan's history stay — those are content, not foreign keys. It is refused with `RepositoryHasLiveWorktreesError` when `git worktree list` names a linked worktree under `ServerConfig.worktreesDir`, and there is no force flag. When coding sessions land store-side worktree state, that check gains a second source behind the same refusal.

#### Hosting provider

The service that hosts a repository's git remote, such as GitHub, GitLab, Bitbucket, or Azure DevOps. Mercurian detects provider presence and authentication standing from the machine, and derives a repository's provider from its fetch remotes; it never configures, assigns, or stores either fact. Unknown remote hosts remain plain hosting facts and acquire no provider affordances.

#### Repository script

A name and a command declared on a Mercurian repository, optionally carrying a preview address or flagged as setup. App-owned and per-machine: the declarations live in `mercurian.sqlite`, so nothing is ever written into the repository and there is no file format to design. The whole list is replaced on save and ids are minted server-side from names; a script that carries an existing id keeps it, which is what makes an edit an edit. Execution is the coding-session surface's.

#### Plan

The unit of work, born in a project and owning exactly one planning space. A plan exists only from its first message: creation takes that message and writes it as the history's root commit, which is why there are no empty rows in the project tree and nothing to clean up after an abandoned draft. Its title is derived from the first line of that message.

#### Planning space

The conversation that evolves a plan, with a right pane holding the plan's two standing views — the artifact and the [DAG explorer](#dag-explorer) — chosen from icons in the surface's top-right corner and closable by re-pressing the active one. Everything on it renders over the plan's one [history](#history). The surface writes human `message` and `plan-revision` commits, each naming its own parent, and reads live over one `mercurian.subscribePlan` subscription — a snapshot, then commit events keyed by the commit store's own `sequence` ([ADR 002](../architecture/event-streaming-model.md)). Whether the pane is open and which view it holds are per-browser preferences, unkeyed by plan so they follow the person across plans. [Planning turns](#planning-turn) ride the same subscription: transient turn frames beside the durable commit events, with the in-flight turn on the snapshot for a window joining mid-reply.

**Position** is where a window stands, modelled in `PlanPosition.logic.ts` as `latest` or `at(commit, live)`. `latest` is the landing default and follows the plan's newest commit. A `live` position is a branch tip you chose or a commit you just wrote: the [composer](#plan-composer) acts from it, the artifact is editable, and the surface _follows that branch_ as it grows — chained along the first-born child until it rests on a leaf, and never across to another branch. A position that is not `live` is a commit that already led somewhere: you are looking back, and nothing that lands afterwards moves you. Position is per-window transient view state, never persisted and never server-owned, so two windows on one plan may stand on two different branches and still agree on every fact the server owns.

#### Plan composer

The one place a person acts in a [planning space](#planning-space). It acts from wherever the window stands, naming that commit as `parentCommitId` on the write — which is what makes a [fork](#fork) an ordinary send rather than its own operation. It holds a per-plan draft (client-local, keyed by plan, surviving a reload), image attachments through the same attachment store and assets door t3code threads use, and mention chips carried as inline tokens in the message text rather than as a field on the wire. Send and stop are one control whose face derives from a single derived state (`PlanComposer.logic.ts`): Send while idle, held while a send is in flight, and Stop while a [planning turn](#planning-turn) is live — which is what makes queueing impossible from any window. When the displayed planning model cannot run on this machine, sending gates with the reason stated in the card; typing stays live, because drafts are drafts.

#### Fork

A second child of one commit — two lines of work from a shared point. The only way to author one is to pick an earlier commit in the [DAG explorer](#dag-explorer) and send: the message is the branch's first commit, so every fork begins with something a person said. Assistant-authored forks are refused by the commit store outright, and the artifact's **Edit** is offered only while standing live, so a [plan revision](#plan-revision) can never be the commit that opens a branch. Nothing is destroyed by forking; both lines are real and the explorer draws the branch point.

#### DAG explorer

The plan's history as the right pane draws it, in two views. **Navigator** is the git-graph and the one you move through: commit rows in append order with an SVG rail drawing lanes and edges (`navigatorLayout` — the first child inherits its parent's lane, further children open lanes, merges close them). **Graph** is the spatial map, for seeing structure rather than walking it: every commit a node, every parent edge drawn, laid out by `spatialLayout` — a deterministic synchronous force solve (springs along edges, pairwise repulsion, and a directional field ordering commits by generation) seeded from commit ids, so the same history draws the same picture in every window on every open. Beyond `SPATIAL_MAX_SIMULATED_NODES` the solve is skipped for the plain time axis; when the timeline grows the solve re-runs warm from the prior positions, so the map drifts locally instead of rearranging under a reader. Neither view renders a commit twice — a merge is drawn once in both, where its lanes reunite in the navigator and as one node with an edge per parent on the map. It opens no channel of its own — `parents` and `published` ride on every timeline item, so the explorer is a second _rendering_ of the plan subscription, modelled purely in `PlanGraph.logic.ts`. Published and private commits are distinguished. Picking a commit navigates: the surface shows the [ancestor closure](#history) of that commit as the conversation you are in, and `mercurian.getPlanTextAt` reads the artifact as of there — the one fact the client cannot derive, since revisions travel without their text. The conversation is always one path — the path through wherever you stand. Picking a leaf stands you live on that branch and the surface follows it; picking an interior commit is looking back, which freezes the artifact and turns the composer's next send into a [fork](#fork), said out loud in a banner with the "Back to now" way out beside it. See [position](#planning-space). Nothing is written by moving.

#### Plan revision

A direct edit of the plan, recorded as a `plan-revision` commit in the plan's one history, interleaved with messages at the same standing. Its payload is the plan's _whole_ text after the edit, not a diff, so the plan at any commit is the nearest revision at or above it — no patch replay, and a fork's text is just its own path's latest snapshot. Nothing stores the plan anywhere else: the current text is derived from the history, which is why a plan born blank derives an empty artifact and an imported plan whose root is a revision renders from that root.

#### Atomic plan

Internal term, never surfaced in product copy: a plan whose implementation belongs in exactly one repository. The [implement gate](#implement-gate) identifies the repository but does not write history or start a coding session.

#### Split

Internal term, never surfaced in product copy: a plan projection for one repository, landed as a human-authored `plan-revision` branch from the commit where the implement gate ran. Its payload stamps the repository id and name beside the projected text. A split changes the artifact on its own branch, never the parent line; it remains readable even if the repository is later disconnected.

#### Readiness verdict

The implement gate's immutable, recorded answer about one commit. A ready verdict names the one repository where a coding session can run and crosses the wire as a keyed side-fact, rendered as **Ready to implement** wherever that commit appears. A needs-split verdict records the repositories still requiring projections for server-side short-circuiting but is not itself surfaced. Absence means the commit has never been evaluated.

#### Implement gate

The read-only analysis between a finished plan and implementation. It grounds across the project's repository set and produces either an [atomic plan](#atomic-plan) verdict or editable split proposals, then records that [readiness verdict](#readiness-verdict) against the analyzed commit. Analysis and cancellation write no commits. Only explicit confirmation lands splits, as sibling plan-revision branches at the analyzed commit; those projected commits are born with ready verdicts of their own.

#### Planning turn

One reply of the planning assistant: from a human message committing to exactly one assistant `message` commit landing. Driven by [PlanningAssistant.ts][35] on the fork's provider-session runtime — never by a client RPC; a turn starts server-side when a human message commits, because the assistant responds and is never invoked. In flight it is transport, not record (ADR 002 §3): transient `turn-*` frames on `mercurian.subscribePlan` — deltas carrying the offset of the text before them so a joiner folds replays away, grounding items, the structured question — with the partial turn on the snapshot for join-mid-turn, and nothing persisted until the settle. Every ending lands one commit: full text on completion; partial text marked **interrupted** on a stop, an abnormal session end, or an archive mid-reply — stopping means "this happened and was cut short", and forking past it is the tree's own move. One turn per plan at a time is a server fact held in `PlanTurnRegistry`: while it is claimed, human writes refuse (`PlanTurnActiveError`) so the settle can never be raced into an illegal assistant fork. Planning stays mode-free — sessions open at the most restrictive runtime mode with every approval auto-answered (reads approved, everything else declined), no mode is user-visible anywhere, and the assistant's one write door is the planning MCP toolkit's `save_plan_revision`, resolved to the live turn by the calling session's thread.

#### Grounding

The assistant reading the project's repositories to answer from what is actually there — read-only by runtime enforcement, never by prompt alone. A session opens on the project's repositories (cwd plus `additionalDirectories` for providers whose `groundingRoots` capability is `multi`); a `cwd-only` provider grounds the first repository alone and the turn carries which ones were out of reach — narrowed, and visibly so, because silent narrowing is exactly what "grounding is visible" forbids. What was consulted is folded from runtime events (`GroundingFold.ts`) into per-item entries that stream with the turn and persist on the settled commit, rendered folded away until expanded — the history explains itself when reopened. A project with no repositories grounds nothing, legally.

#### Issue status

The one thing a tree row is saying right now, from a vocabulary of three: **awaiting your input** (something is waiting on a person — a structured question, or a coding session's approval request), **assistant working** (a reply is streaming), **unseen updates** (the plan moved while you were not looking at it). When several are true the most urgent wins, in that order, and a row shows exactly one. The vocabulary is deliberately narrower than the thread sidebar's five pills: signals from both stores map into these three words _before_ they are ranked, so a session's pending approval and a plan's structured question are one status and there is nothing left to rank inside a tier.

Every input is a server-side fact on the tree subscription's rows — `hasPendingInput`, `isWorking`, and [visited-at](#visited-at) — and the client only ranks them ([ADR 002](../architecture/event-streaming-model.md) §4). The two booleans are composed at one point, `toWirePlanTreeRow` in [wire.ts][34]: [planning turns](#planning-turn) raise `isWorking` while a reply streams and `hasPendingInput` while a structured question waits, and coding-session runtimes will contribute both from the other store, composed at the same point. Unseen is not a wire field at all: it is `updatedAt` against `visitedAt`, which is ranking rather than originating, and the search palette needs both raw timestamps anyway.

**Rollup** is the same resolver applied to a row's children, most urgent wins: a collapsed project speaks for its plans, and a plan will speak for its coding sessions when those rows nest under it. It is level-agnostic by construction, so adding a level does not change it. An _expanded_ project stays quiet — its plans are on screen saying it themselves.

#### Visited-at

When a plan was last opened, stored per plan in Mercurian's `plan_visits` table. Server-owned rather than client-local ([ADR 002](../architecture/event-streaming-model.md) §5), because unseen is a status the tree ranks and the palette orders — a fact one window's `localStorage` could hold only for that window. It rides back out on the tree subscription like any other row change, so every window agrees. Absent means never visited, which reads as unseen.

Its own table rather than a column on `plans`, so that reading a plan can never bump the plan's `updated_at` and reorder the tree: the tree's order is activity, not attention. `mercurian.visitPlan` writes only when the visit changes seen-ness, which is what lets the open plan fire it on every activity advance for free.

**Mark unread** (`mercurian.markPlanUnread`) puts a plan back in front of you by standing its visit one millisecond before the plan's latest activity, so unseen falls out of the same comparison every row is read by rather than needing a second flag that could disagree with it. Per-user visited state is deferred until identity exists.

#### Search palette

The one overlay you reach everything from — plans, [Mercurian projects](#mercurian-project), the two workspace sections, and the three actions that start something new (new plan, new project, open settings). One chord opens it from anywhere, the sidebar's collapsed state included, because it is an overlay and only its entry row lives in the tree.

Its whole search space is the client's live tree snapshot, so ranking is pure and synchronous and there is no round trip. An empty query answers "where am I needed, where was I": the actions, then plans whose [issue status](#issue-status) is awaiting-input, then unseen, padded with the most recently active plans to about a dozen rows. A `working` plan reaches the list through recency rather than urgency — something streaming is not waiting on you. Typing ranks every kind together on the fork's ladder (exact over prefix over substring, earlier search terms over later, ties keeping source order — which for plans is that same urgency order), and a `>` prefix restricts to actions.

Picking always lands on work, never on a container: a plan opens its [planning space](#planning-space); a project opens its most recently active plan, or opens the composer for its first if it has none; a section is a page; an action runs. Archived plans are absent, since every listing renders the active partition. Results are modelled as a discriminated union by what picking them means, which is where coding-session results join without touching the existing arms.

Its jump chords live with it: modifier-held digits over the tree rows that _open a place_ (project rows expand instead, so they are never targets, and a collapsed project contributes none), a bracket pair stepping between them, and the same digits picking the palette's own numbered rows while it is open. The commands are still named `thread.jump.*` / `thread.previous` / `thread.next` — stale vocabulary kept deliberately, so saved `keybindings.json` files and the whole helper chain keep working.

### Trackers

Mercurian's seam to external issue trackers, held in [TrackerStore.ts][32] and crossing the wire through [mercurianTrackers.ts][33]. Mercurian is where issues get planned, never a mirror of the tracker.

#### Tracker

An external system the backlog lives in — Linear today, with Jira and GitHub Issues the named family. Each one is a [connector](#tracker-connector): one file implementing `TrackerConnector`, one literal on `TrackerKind`, one registry entry. Nothing in the store, on the wire, or in the UI changes shape when a tracker is added, which is what keeps each additional one cheap.

#### Tracker connection

One workspace's link to one tracker, made and unmade in **Settings → Trackers**. The row holds a `connection_id`, a `kind`, and the `label` the tracker named at connect time; it deliberately holds nothing else. The **credential** is a file in the [`ServerSecretStore`](../../apps/server/src/auth/ServerSecretStore.ts) named `mercurian-tracker-<connectionId>`, never a column — it crosses the wire once, inbound, on `mercurian.connectTracker`, and nothing echoes it back. **Standing** (`connected | unauthorized | unreachable`) is a fact about the outside world, so it is probed live behind a one-minute cache rather than stored: a key revoked in the tracker decays on its own, with no refresh button and no column to go stale. Two workspaces of the same tracker are two connections; `kind` is not unique.

#### Tracker connector

The per-tracker adapter, `TrackerConnector`: a `probe` that validates a credential and names what it reaches, and a `listIssues` that reads live. It has **no write method**, which is what makes pull-only a property of the type rather than a rule to remember — reinforced by a test asserting every GraphQL document the connector can send is a `query`, and by a wire surface with no tracker-ward call. Write-back is resolved deferred (2026-07): it waits until finalized plans exist and users ask where they went.

#### Issue import

Turning a tracked issue into a plan, from a project's new-plan flow (`mercurian.importPlan`). Import is _selection, not synchronization_: the browse is a live `mercurian.listTrackerIssues` read that nothing stores, and the only issues that leave a trace in Mercurian are the ones someone decided to plan. The imported content becomes the history's **root commit**, of kind `issue-revision` and authored `human` — the planning space literally begins with the issue, which is also why the root is not merely a message: upstream changes land later as more commits of the same kind. Three rules hold, each structurally rather than by discipline. **Idempotent by origin**: the plan keeps a link to its [origin](#origin-plan) and a `UNIQUE` on it means re-importing goes to the existing plan, or resurfaces it when archived, rather than duplicating; the wire says which of `created | existing | resurfaced` happened, so idempotency reads as navigation and never as an error. **Born published**: `createHistory` is called with `rootPublished: true` — the issue having a plan is shared truth — while `append` hardcodes `published: false`, so everything after the root is a private draft; a published root also makes an imported plan archive-only from its first second. **Arrives ungrounded**: plans carry no repository columns anywhere, so an imported plan has no associations to acquire — grounding is project-level and derived, never assigned. The issue's content is client-supplied from the browse the caller just did rather than re-fetched: no connector has a by-id read, and adding one belongs to issue refresh. The issue's `status` crosses on the way in and is stored nowhere.

#### Origin (plan)

Where an imported plan came from: `(connection_id, issue_id)` plus the issue's `url` and when it was imported, in `plan_origins` — its own table, not columns on `plans`, because most plans are born blank and would carry nothing but empty fields. Origin is **connection identity, not tracker kind**: two Linear workspaces are two connections whose issue keys may collide. `connection_id` is deliberately not a foreign key — origins are content, and disconnecting a tracker must never dangle a plan or cascade into one. The accepted cost, named in the migration: reconnecting the same tracker workspace mints a new `connection_id`, so an import through it is a new origin. The `UNIQUE (connection_id, issue_id)` is the idempotency rule made structural, holding even against two windows importing in the same instant. The row holds no status (a live tracker fact) and no content (that is the root commit; a copy here would be a second truth). `deletePlan` takes the origin row with it, which is what makes deleting a plan leave no trace for a later re-import to find.

#### Minimal common shape

`TrackerIssue`: exactly `id`, `title`, `description`, `url`, `status`, all strings. Every connected tracker, whatever its API, produces this and nothing else. Labels, assignees, sprints and priorities have no field to land in — they stay in the tracker, one click away through `url`, which is the tracker's own canonical link. `id` is the tracker's human-facing key (`M-98`), and `status` is the tracker's own status word left uninterpreted; normalizing status vocabularies across trackers would be rebuilding tracker semantics. The narrowness enforces _don't rebuild the tracker_ structurally rather than by discipline, so adding a field here is a design decision about what Mercurian is, not a refactor. Issues are read live through `mercurian.listTrackerIssues` and never stored: import is selection, not synchronization, so no issue table exists for a stale copy to live in.

### Workspace settings

Settings that belong to the Mercurian workspace rather than to the machine reading it. They live in `mercurian.sqlite`'s `workspace_settings` key-value table behind [WorkspaceSettingsStore.ts][30] and cross the wire through [mercurianWorkspace.ts][31] — deliberately not in `settings.json`, which is machine state (binary paths, the provider-instance map, the machine's own model selections).

#### Planning model

The abstract provider/model pair the planning assistant runs under. Each human message that opens a turn may carry `ranUnder: PlanningModelSelection` in its commit payload. The **standing choice** at any position is the nearest such ancestor, self-inclusive. This is history-carried state rather than a plan column: forks inherit at the fork point, branches diverge independently, and returning to a position re-derives the same pair.

An explicit composer choice is stamped as-is. With no explicit choice, the server stamps the standing pair; on a bare history it seeds from the pair the workspace last planned under. If nothing has ever run, it stamps nothing and the message may land without a reply. Whenever a stamped turn-opening message lands, its pair becomes the workspace's new last-used seed. Assistant replies separately carry `generatedBy`, captured at turn start, so history says which pair actually produced them. None of these shapes can name a [provider instance](#provider): an instance is a connected account on one machine, and a shared history naming one would resolve to nothing everywhere else.

#### Planning-model resolution

The mapping from the abstract pair to an instance, computed per machine by `resolvePlanningModel` and never stored — it is a fact about a machine at a moment. Candidates are that driver's snapshots which are available, enabled, and installed; among those offering the model the provider's default instance wins, otherwise the first in settings order. No candidate resolves `no-instance`; candidates without the model resolve `model-unavailable`, which is also how capability gating surfaces, since a model the installed agent is too old to run is already absent from the snapshot. Curation is deliberately not consulted by resolution: hiding a model is one client's picker preference. An unresolved recorded pair remains visible and unchanged — the machine never rewrites what history chose.

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
[28]: ../../apps/server/src/mercurian/repositories/RepositoryStore.ts
[29]: ../../packages/contracts/src/mercurianRepositories.ts
[30]: ../../apps/server/src/mercurian/workspace/WorkspaceSettingsStore.ts
[31]: ../../packages/contracts/src/mercurianWorkspace.ts
[32]: ../../apps/server/src/mercurian/trackers/TrackerStore.ts
[33]: ../../packages/contracts/src/mercurianTrackers.ts
[34]: ../../apps/server/src/mercurian/planning/wire.ts
[35]: ../../apps/server/src/mercurian/assistant/PlanningAssistant.ts
