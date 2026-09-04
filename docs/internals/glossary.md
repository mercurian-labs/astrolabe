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
- [Projects and threads](#projects-and-threads)
- [Trackers](#trackers)
- [Workspace settings](#workspace-settings)
- [Appearance](#appearance)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the upstream orchestration model. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain orchestration threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero orchestration threads. See [workspace-layout.md][2].

Not to be confused with a **Mercurian project**, which contains threads and has no path on disk, or a **[Mercurian repository](#mercurian-repository)**, which is a registered codebase. Everything on Mercurian's side of that seam is `Mercurian`-prefixed on the wire — see [Projects and threads](#projects-and-threads).

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for an orchestration thread. If an orchestration thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

### Thread timeline

#### Thread

The user-facing unit created, listed, opened, archived, and restored beneath a [Mercurian project](#mercurian-project). It is persisted by Mercurian's planning layer as a plan record, but **thread** is the product noun. A thread owns one planning [history](#history), contains one or more [lines](#line), and exposes its [Plan](#plan), Spec, and Checkpoints in the [thread space](#thread-space).

#### Orchestration thread

The durable conversation and workspace history owned by one Mercurian [line](#line). In [the orchestration contracts][1], an orchestration thread holds messages, activities, checkpoints, and provider-session state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside an orchestration thread. It starts with user input and ends when the provider session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to an orchestration thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.turn.interrupt`.

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

The backend agent runtime that actually performs work. Six drivers ship built in: Codex, Claude, Cursor, Grok, OpenCode, and Antigravity. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to an orchestration thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for an orchestration thread or provider session. Thread composers offer `approval-required`,
`auto-accept-edits`, and `full-access`. [The contracts][1] retain the upstream `auto` value for
legacy thread compatibility, but Mercurian never creates it. See [permission modes][18].

#### Interaction mode

The agent interaction style for an orchestration thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the orchestration-thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

#### Usage limits

The rolling subscription quota windows a provider reports for its signed-in account, such as Claude's five-hour and weekly windows or Codex's primary and secondary allowances. Each driver decides in its own `checkProvider` whether it has any and returns them on the snapshot as `usageLimits`; drivers with no notion of subscription usage leave the field absent. Adapters that receive rate-limit telemetry during a turn normalise it into a `ProviderUsageLimitsUpdate` at the boundary, and `ProviderUsageLimitsIngestion` folds it onto the owning instance's snapshot through `ServerProviderShape.applyUsageLimits`, so no central service needs to know a driver kind. See [providerUsageLimits.ts](../../packages/contracts/src/providerUsageLimits.ts) and [makeManagedServerProvider.ts](../../apps/server/src/provider/makeManagedServerProvider.ts).

#### Usage limit source

A read-only quota feed outside this environment's provider CLIs, configured under `settings.usageLimitSources`. The only kind today is a CLIProxyAPI hub, whose `quota-scheduler/status` reports the windows of every pooled account. `UsageLimitSources` polls each source on the provider health interval and publishes `UsageLimitSourceSnapshot`s over the config stream as `usageLimitSourcesUpdated`, gated by a client capability flag the way environment themes are. The management key round-trips through the secret store with a redaction marker on disk. See [UsageLimitSources.ts](../../apps/server/src/usage/UsageLimitSources.ts).

#### Model manifest

The per-driver list of current model slugs that decides which models land in the model picker's legacy section. Bundled at `apps/server/src/provider/model-manifest.json` and refreshed at runtime from the same file on `main`, so classification updates ship as commits instead of releases. See the [provider architecture][16] model manifest section.

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of an orchestration-thread workspace. In practice it is a hidden Git commit addressed by a ref in [CheckpointStore.ts][19], plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

For a Mercurian line, snapshots form a chain owned by [SnapshotChain.ts][40]. A snapshot records the complete working tree without moving the line's branch or running `git commit`: its first parent is the previous line snapshot when one exists, and its other parent pins the checked-out `HEAD` at capture. The first snapshot has the branch head as its sole parent. Walk established chains with `--first-parent`; a one-parent first snapshot has no earlier snapshot to follow. Snapshot kinds name why capture happened: `settled` after a completed turn, `partial` after an interrupted turn, `recovery` while preserving a dirty slot that is being switched away or reset, and `external` for changes found between turns on the line's own slot.

The line's branch contains only commits made by a person or agent. The snapshot chain retains uncommitted trees separately. A line is **built** independently in each repository once a captured snapshot tree differs from that repository's recorded base tree, or the line branch moves away from its recorded base commit. An unchanged snapshot on an unmoved branch does not build the line, so an unbuilt branch can still follow a moving inherited base.

Refs decide where a line stands. If the recorded branch name is gone and a named `HEAD` points at exactly the line's recorded commit, the branch was renamed by hand and the line-branch row, slot member, and orchestration thread adopt the new name for that repository. A new branch beside the surviving line branch, or a rename followed by another commit, is instead a departure. If a turn finishes with another branch or detached `HEAD` checked out, it is **departed**: the snapshot records that ref, the line branch stays put, and the next slot claim restores the line's latest snapshot over its own branch. If the recorded ref is gone and `HEAD` is elsewhere, the provider session stops and the thread offers to recreate the recorded branch at the chain's recorded commit. See [SlotService.ts][41].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed for ordinary turn checkpoints in [Utils.ts][22], and used by [CheckpointStore.ts][19]. Mercurian keeps turn snapshots at the existing turn refs, the latest snapshot for each line at a line-head ref, and named recovery or external snapshots below that line's ref namespace. [SnapshotChain.ts][40] constructs and advances the line refs.

#### Checkpoint baseline

The starting checkpoint for diffing an orchestration-thread timeline. Ordinary orchestration threads retain the turn-zero baseline constructed in [Utils.ts][22]. A Mercurian line also has its own chain baseline: an inherited line begins from the ancestor's latest snapshot, while a root line's first snapshot pins the line branch's starting head. [CheckpointReactor.ts][6] coordinates capture, and [CheckpointDiffQuery.ts][20] chooses the adjacent snapshot parent so external or recovery captures do not leak into the following turn diff.

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into orchestration-thread state by [projector.ts][4]. The thread timeline renders it as the changed-files card at the end of that turn.

#### Whole-session diff

The checkpoint diff from turn count zero through a line's latest completed checkpoint. It reuses the full-thread checkpoint query rather than comparing the line branch to a Git base, so it includes the complete workspace arc even when the line has made commits.

#### Review comment

A pending composer context anchored to an exact diff section, file, and selected row range. Re-commenting the same anchor replaces the pending entry; distinct ranges coexist. On send, each entry becomes a `<review_comment>` block in the user message and the pending chips clear.

#### Revert

A retired user action that restored a thread and conversation to an earlier [checkpoint](#checkpoint). M-195 removed revert-to-message: current checkpoints support diffs and internal workspace restoration, but the product does not destructively rewind the thread timeline. For Mercurian lines, [SlotService.ts][41] restores the latest line snapshot when a slot changes ownership or returns from a departed ref; that restoration does not discard messages or [turn diffs](#turn-diff).

### Planning history

Mercurian's artifact and lineage state, stored beside orchestration threads in [CommitStore.ts][25].

#### Commit

One entry in a thread space's history. A commit has a `kind` (message, Plan revision, Spec revision, or historical coding-session leaf), an author (human or assistant), a payload the store treats as opaque, and an ordered list of parents that is unbounded: none for a root, one for a continuation, two or more for a merge. Forks and merges are refused for assistant-authored commits, and nothing may be committed onto a historical coding-session leaf.

#### History

The DAG of commits for one thread space, and the anchor its commits reference. Created with its root commit in one transaction by `createHistory`; every later commit hangs off an existing one.

#### Published

Whether a commit has crossed from the author's workspace into shared history. The flag is one-way, and publishing a commit also publishes its unpublished ancestors along every parent path, so shared history is always complete from any published commit back to the root. An imported thread's root is born published; everything else starts private. Reads take an explicit `visibility` of `published` or `all`.

### Projects and threads

Mercurian's planning layer, stored beside the commit graph in [PlanningStore.ts][26] and crossing the wire through [mercurian.ts][27].

#### Mercurian project

A container of threads, and the context its threads ground in. It has a name and a set of [Mercurian repositories](#mercurian-repository) — a default rather than a boundary, held in `project_repositories` and never a stamp: nothing is filed under a repository, and no table could file it. Distinct from a t3code [Project](#project), which is a workspace root on disk.

#### Mercurian repository

A registered codebase — the third thing this vocabulary calls a repository, beside t3code's `RepositoryIdentity` (a git-remote-derived fact about a workspace) and `SourceControlRepositoryInfo` (a provider's view of a remote). It has a name, a resolved path unique across the registry, and the scripts declared on it, in [RepositoryStore.ts][28] and crossing the wire through [mercurianRepositories.ts][29].

Three things it does _not_ store, each on purpose. Its **git-ness** is probed live (`git rev-parse --show-toplevel`, short-TTL cached): a plain directory registers fine because grounding reads files either way, and the working-tree features light up on their own once the directory becomes a repository. Its **hosting provider** is derived from the primary fetch remote. Its **environment** is a fact about which server answered, not a column — the registry lives in one `mercurian.sqlite`, and environments stay plumbing.

Removal disconnects: the row, its scripts, and its project memberships go, while the files and every grounding reference already written into a thread's history stay — those are content, not foreign keys. It is refused with `RepositoryHasLiveWorktreesError` when `git worktree list` names a linked worktree under `ServerConfig.worktreesDir`, and there is no force flag. Store-side line worktrees provide a second source behind the same refusal.

#### Memory

A project's durable design knowledge, read directly from Markdown notes and YAML maps beneath its
[memory source](#memory-source). Memory is a disk-derived read model rather than a synchronized or
persisted copy: each read reflects the designated files, and the line's assistant is instructed
to consult it before repository code for design intent. Contracts live in
[mercurianMemory.ts][36].

#### Memory source

The single registered repository, optionally narrowed to a repository-relative subpath, that a
[Mercurian project](#mercurian-project) designates as its [memory](#memory). It need not belong to
the project's code-repository set. Removing a repository also removes designations that point to
it; it never deletes memory files.

#### Amendment

A human-reviewed change proposed from a line turn and applied to [memory](#memory) only after
explicit confirmation. The proposal is transient and carries the exact unified patch and map
placements; confirming applies the guarded note snapshots, records a commit in the memory's own
Git history when available, and appends a stamped human `message` commit to the thread without
starting another turn. Preparation and application live in [MemoryIndex.ts][37], while the review
surface is [MemoryAmendmentSheet.tsx][38].

#### Note

An atomic Markdown file in [memory](#memory), identified by its filename stem. Notes connect with
`[[wikilinks]]`; links are associative for graph derivation, and their reverse edges are exposed as
backlinks. Note mentions remain inline text in planning messages and resolve to files only when a
line turn is grounded.

#### Suggested next message

An optional composer chip rendered by [PlanSuggestionsRow][39]. Suggested next messages send
through the ordinary thread composer, and identity-based dismissal hides the current entries
until a new one appears. Nothing derives entries from memory notes; sources are teaching- or
provider-driven, and none are currently built.

#### Skill map

A `.skillmap.md` file stored beside the notes in [memory](#memory). Its YAML frontmatter names the
map and purpose, declares an edge vocabulary, and records ordered `{ from, type, to }` edges; its
Markdown body is the teaching for when and how to use the arrangement. Every arranged edge must
already be supported by a wikilink in either note's prose. Forests render as ordered trees and other
shapes render as static graphs unless the file declares a view. Repeats and cycles are valid map
facts. Malformed or ungrounded skill maps, and superseded tree-YAML maps under `maps/`, remain
visible as refusals rather than degrading into partial maps.

#### Unresolved reference

A wikilink target named by one or more notes but not yet present as a note file. It is a first-class
memory frontier: browse and reader surfaces show it as not yet written and retain the names of the
notes that reference it.

#### Hosting provider

The service that hosts a repository's git remote, such as GitHub, GitLab, Bitbucket, or Azure DevOps. Mercurian detects provider presence and authentication standing from the machine, and derives a repository's provider from its fetch remotes; it never configures, assigns, or stores either fact. Unknown remote hosts remain plain hosting facts and acquire no provider affordances.

#### Repository script

A name and a command declared on a Mercurian repository, optionally carrying a preview address or flagged as setup. App-owned and per-machine: the declarations live in `mercurian.sqlite`, so nothing is ever written into the repository and there is no file format to design. The whole list is replaced on save and ids are minted server-side from names; a script that carries an existing id keeps it, which is what makes an edit an edit. A line can run scripts after it claims a working slot.

#### Plan

The read-only Markdown artifact inside every user-facing [thread](#thread). It describes the implementation approach and is rendered in the right-panel **Plan** tab at the selected checkpoint. Its text is derived from the nearest [Plan revision](#plan-revision) in the thread's history; the user asks the assistant to change it rather than editing it directly.

#### Line

One path of work through a thread's [history](#history). Each line owns one [orchestration thread](#orchestration-thread), and its first turn claims an isolated working slot across the project's repositories. [LineRuntimeService.ts][44] creates the orchestration thread without claiming a slot, records its user-facing thread ownership, and claims or restores the slot when the line first runs.

#### Pending line

A [line](#line) whose thread and runtime record exist but whose first human commit does not yet. Its runtime has a null root and, for a fork, the commit it will continue from. The first send uses the upstream message id as the human commit id, roots the line, clears its fork parent, and then claims its working slot. See [LineRuntimeService.ts][44] and [LineTurnReactor.ts][45].

#### Thread space

The upstream thread view, routed at `/threads/$planId`, with Mercurian's thread-level surfaces and chrome chiseled into its existing slots. `?line=<threadId>` selects the current [line](#line), while `?at=<commitId>` changes the viewing position for Plan, Spec, and Checkpoints without replacing that line's conversation. [ThreadSpaceSurfaces.tsx][48] supplies the read-only Plan and Spec surfaces plus Checkpoints; [ThreadSpaceChrome.tsx][49] supplies line banners, memory overlays, note mentions, and **Fork here**.

Its right panel always contains the [pinned surface](#pinned-surface) **Checkpoints** first. Plan is selected when a line's panel is first seeded, and Plan and Spec can be added from the plus menu alongside the upstream working surfaces. Picking a checkpoint navigates to its line and viewing position; **Back to now** clears the historical position. The ordinary upstream composer sends thread turns, and the [line turn reactor](#line-turn-reactor) records the thread history from those turns.

<a id="planning-space"></a>

#### Planning space — historical alias

**Historical alias.** Use [thread space](#thread-space).

<a id="plan-composer"></a>

#### Plan composer — historical

**Historical.** The dedicated Mercurian composer was removed. A [thread space](#thread-space) uses the upstream thread composer, including its draft persistence, attachments, mention sources, model and mode controls, stop control, and context meter. Legacy drafts from plan records migrate into upstream composer drafts once.

#### Pinned surface

A right-panel surface that the store keeps present and excludes from every close operation. **Checkpoints** is the only pinned surface: [rightPanelStore.ts][46] prepends it when absent and seeds it first for every Mercurian line, while the tab strip omits its close affordance and close menu.

#### Fork

A second child of one commit — two [lines](#line) of work from a shared point. Assistant-authored forks are refused by the commit store outright. Nothing is destroyed by forking; both lines are real and the explorer draws the branch point.

#### Fork here

The user action that opens a new [pending line](#pending-line) from an existing point without changing the origin line. On a user message, it forks from that message's parent and seeds the new line's upstream composer with the message text. The checkpoint popover offers the same action where applicable. [useForkHere.ts][47] creates the line, seeds the draft, and navigates to its thread; the first send roots it.

#### DAG explorer

The thread's history as the Checkpoints [pinned surface](#pinned-surface) draws it as a spatial map. It opens no channel of its own — `parents` and `published` ride on every timeline item, so the explorer is a second _rendering_ of the thread subscription, modelled purely in `PlanGraph.logic.ts`. Published and private commits are distinguished. Picking a commit navigates to its owning line and viewing position, while `mercurian.getPlanTextAt` and `mercurian.getSpecAt` read the two artifacts there. Stale-Spec branch leaves are derived from ancestry: a leaf outside the newest Spec revision's descendant closure is marked **Spec stale** until a merge or revision absorbs it. Nothing is written by moving.

#### Plan revision

A complete Plan snapshot recorded as a `plan-revision` commit in the thread's one history, interleaved with messages at the same standing. Its payload is the Plan's _whole_ text after the edit, not a diff, so the Plan at any commit is the nearest revision at or above it — no patch replay, and a fork's text is just its own path's latest snapshot. Nothing stores the Plan anywhere else: the current text is derived from the history, which is why a thread born blank derives an empty artifact and an imported thread whose root is a revision renders from that root.

#### Spec

The behavioral contract a thread is planned from, held in two prose fields: Goal / user story describes the intended outcome and behavioral context, while Acceptance criteria describes the observable conditions for completion. Neither field is artifact metadata or an implementation approach. It is parallel to the Plan in mechanism and opposite in role — Spec says _what_, Plan says _how_. The current Spec is the nearest [Spec revision](#spec-revision) on the selected path; a blank thread may have none until the assistant drafts it.

#### Spec revision

A complete `{ goal, acceptanceCriteria }` `SpecDocument` snapshot recorded as a `spec-revision` commit in the same history as messages and Plan revisions. Earlier stored `{ title, description }` forms decode at the persistence boundary; new writes use only the semantic prose names. Provenance records how the revision was written; the current UI creates imported or direct revisions. Authorship remains the commit's human/assistant field. Imported issues derive root Spec revisions by mapping issue title to Goal and description to Acceptance criteria. An assistant revision belongs to the line turn that must reconcile the Plan before responding. Reply prose is never authoritative without the commit.

#### Split

A historical Plan shape written by the former implementation flow: a projection for one repository,
landed as a human-authored `plan-revision` branch. Its payload stamps the repository id and name
beside the projected text. A split changes the artifact on its own branch, never the parent line;
existing splits remain readable even if the repository is later disconnected, but line turns no
longer create them.

#### Planning assistant

**Historical.** The dedicated planning assistant was replaced by the [line turn reactor](#line-turn-reactor); the upstream thread runtime now starts, stops, and answers questions for thread lines.

#### Planning turn

**Historical.** The separate planning-turn send path was replaced by an ordinary thread [turn](#turn) whose history is recorded by the [line turn reactor](#line-turn-reactor).

#### Line turn reactor

The server reactor that records thread history from ordinary line turns. Before a turn starts, its send hook records the user message with the message id as its human commit id. It listens to orchestration domain events to adopt new Mercurian-owned orchestration threads as [pending lines](#pending-line), open recorded turns, and handle interruption or deletion; it listens to provider runtime events to fold reply text, grounding, questions, and memory amendments, then commits the assistant reply when the turn completes, aborts, or exits. See [LineTurnReactor.ts][45].

#### Grounding

The assistant reading the project's repositories to answer from what is actually there. A session opens on the project's repositories (cwd plus `additionalDirectories` for providers whose `groundingRoots` capability is `multi`); a `cwd-only` provider grounds the first repository alone and the turn carries which ones were out of reach — narrowed, and visibly so, because silent narrowing is exactly what "grounding is visible" forbids. What was consulted is folded from runtime events (`GroundingFold.ts`) into per-item entries that stream with the turn and persist on the settled commit, rendered folded away until expanded — the history explains itself when reopened. A project with no repositories grounds nothing, legally.

#### Issue status

The one thing a thread row is saying right now, from a vocabulary of three: **awaiting your input** (a line is paused on either an approval or a structured user-input request), **assistant working** (a line turn is running), **unseen updates** (the thread moved while you were not looking at it). When several are true the most urgent wins, in that order, and a row shows exactly one. The vocabulary is deliberately narrower than the upstream thread sidebar's five pills: signals map into these three words _before_ they are ranked, so a pending approval and a structured question are one status and there is nothing left to rank inside a tier.

Every input is a server-side fact on the tree subscription's rows — `hasPendingInput`, `isWorking`, and [visited-at](#visited-at) — and the client only ranks them ([ADR 002](../architecture/event-streaming-model.md) §4). The two booleans are composed at one point, `toWirePlanTreeRow` in [wire.ts][34]: line turns raise `isWorking` while a reply streams and `hasPendingInput` while a structured question, approval, or other user input waits. Unseen is not a wire field at all: it is `updatedAt` against `visitedAt`, which is ranking rather than originating, and the search palette needs both raw timestamps anyway.

**Rollup** is the same resolver applied to a row's children, most urgent wins: a collapsed project speaks for its threads. An _expanded_ project stays quiet — its threads are on screen saying it themselves.

#### Visited-at

When a thread was last opened, stored per plan record in Mercurian's `plan_visits` table. Server-owned rather than client-local ([ADR 002](../architecture/event-streaming-model.md) §5), because unseen is a status the tree ranks and the palette orders — a fact one window's `localStorage` could hold only for that window. It rides back out on the tree subscription like any other row change, so every window agrees. Absent means never visited, which reads as unseen.

Its own table rather than a column on `plans`, so that reading a thread can never bump its plan record's `updated_at` and reorder the tree: the tree's order is activity, not attention. `mercurian.visitPlan` writes only when the visit changes seen-ness, which is what lets the open thread fire it on every activity advance for free.

**Mark unread** (`mercurian.markPlanUnread`) puts a thread back in front of you by standing its visit one millisecond before the thread's latest activity, so unseen falls out of the same comparison every row is read by rather than needing a second flag that could disagree with it. Per-user visited state is deferred until identity exists.

#### Search palette

The one overlay you reach everything from — threads, [Mercurian projects](#mercurian-project), the two workspace sections, and the four actions that start something new (**New thread**, **Import from a tracker**, **New project**, **Open settings**). One chord opens it from anywhere, the sidebar's collapsed state included, because it is an overlay and only its entry row lives in the tree.

Its whole search space is the client's live tree snapshot, so ranking is pure and synchronous and there is no round trip. An empty query answers "where am I needed, where was I": the actions, then threads whose [issue status](#issue-status) is awaiting-input, then unseen, padded with the most recently active threads to about a dozen rows. A `working` thread reaches the list through recency rather than urgency — something streaming is not waiting on you. Typing ranks every kind together on the fork's ladder (exact over prefix over substring, earlier search terms over later, ties keeping source order — which for threads is that same urgency order), and a `>` prefix restricts to actions.

Picking always lands on work, never on a container: a thread opens its [thread space](#thread-space); a project opens its most recently active thread, or opens the composer for its first if it has none; a section is a page; an action runs. Archived threads are absent, since every listing renders the active partition. Results are modelled as a discriminated union by what picking them means.

Its jump chords live with it: modifier-held digits over the tree rows that _open a place_ (project rows expand instead, so they are never targets, and a collapsed project contributes none), a bracket pair stepping between them, and the same digits picking the palette's own numbered rows while it is open. The commands are still named `thread.jump.*` / `thread.previous` / `thread.next` — stale vocabulary kept deliberately, so saved `keybindings.json` files and the whole helper chain keep working.

### Trackers

Mercurian's seam to external issue trackers, held in [TrackerStore.ts][32] and crossing the wire through [mercurianTrackers.ts][33]. Mercurian is where issues get planned, never a mirror of the tracker.

#### Tracker

An external system the backlog lives in — Linear today, with Jira and GitHub Issues the named family. Each one is a [connector](#tracker-connector): one file implementing `TrackerConnector`, one literal on `TrackerKind`, one registry entry. Nothing in the store, on the wire, or in the UI changes shape when a tracker is added, which is what keeps each additional one cheap.

#### Tracker connection

One workspace's link to one tracker, made and unmade in **Settings → Trackers**. The row holds a `connection_id`, a `kind`, and the `label` the tracker named at connect time; it deliberately holds nothing else. The **credential** is a file in the [`ServerSecretStore`](../../apps/server/src/auth/ServerSecretStore.ts) named `mercurian-tracker-<connectionId>`, never a column — it crosses the wire once, inbound, on `mercurian.connectTracker`, and nothing echoes it back. **Standing** (`connected | unauthorized | unreachable`) is a fact about the outside world, so it is probed live behind a one-minute cache rather than stored: a key revoked in the tracker decays on its own, with no refresh button and no column to go stale. Two workspaces of the same tracker are two connections; `kind` is not unique.

#### Tracker connector

The per-tracker adapter, `TrackerConnector`: a `probe` that validates a credential and names what it reaches, `listIssues` for live browse, and `getIssue` for an exact server-side read. The current UI exposes no post-import synchronization control. The connector has **no write method**, which is what makes pull-only a property of the type rather than a rule to remember — reinforced by a test asserting every GraphQL document the connector can send is a `query`, and by a wire surface with no tracker-ward call.

#### Issue import

Turning a tracked issue into a thread from the search palette's **Import from a tracker** action (`mercurian.importPlan`). Outside a project's thread, the palette first asks which project to **Import into**; inside one, it opens that project's tracker picker immediately. Import is _selection, not synchronization_: the browse is live and nothing stores it. The imported content becomes the history's human-authored root `spec-revision`; **issue** remains the tracker object and origin vocabulary, while **Spec** is the thread artifact. Import is idempotent by `(connection_id, issue_id)`, born published, and ungrounded. The issue is not synchronized after import, and issue status is never stored.

#### Origin (thread)

Where an imported thread came from: `(connection_id, issue_id)` plus the issue's `url` and when it was imported, in `plan_origins` — its own table, not columns on `plans`, because most threads are born blank and would carry nothing but empty fields. Origin is **connection identity, not tracker kind**: two Linear workspaces are two connections whose issue keys may collide. `connection_id` is deliberately not a foreign key — origins are content, and disconnecting a tracker must never dangle a thread or cascade into one. The accepted cost, named in the migration: reconnecting the same tracker workspace mints a new `connection_id`, so an import through it is a new origin. The `UNIQUE (connection_id, issue_id)` is the idempotency rule made structural, holding even against two windows importing in the same instant. The row holds no status (a live tracker fact) and no content (that is the root commit; a copy here would be a second truth). `deletePlan` takes the origin row with it, which is what makes deleting a thread leave no trace for a later re-import to find.

#### Minimal common shape

`TrackerIssue`: exactly `id`, `title`, `description`, `url`, `status`, all strings. Every connected tracker, whatever its API, produces this and nothing else. Labels, assignees, sprints and priorities have no field to land in — they stay in the tracker, one click away through `url`, which is the tracker's own canonical link. `id` is the tracker's human-facing key (`M-98`), and `status` is the tracker's own status word left uninterpreted; normalizing status vocabularies across trackers would be rebuilding tracker semantics. The narrowness enforces _don't rebuild the tracker_ structurally rather than by discipline, so adding a field here is a design decision about what Mercurian is, not a refactor. Issues are read live through `mercurian.listTrackerIssues` and never stored: import is selection, not synchronization, so no issue table exists for a stale copy to live in.

### Workspace settings

Settings that belong to the Mercurian workspace rather than to the machine reading it. They live in `mercurian.sqlite`'s `workspace_settings` key-value table behind [WorkspaceSettingsStore.ts][30] and cross the wire through [mercurianWorkspace.ts][31] — deliberately not in `settings.json`, which is machine state (binary paths, the provider-instance map, the machine's own model selections).

#### Planning model

The historical provider/model pair recorded on thread-history commits. Current lines use the upstream thread model selection; each recorded human message may still carry `ranUnder: PlanningModelSelection` so the commit preserves which provider and model produced its turn.

An explicit composer choice is stamped as-is. With no explicit choice, the server stamps the standing pair; on a bare history it seeds from the pair the workspace last planned under. If nothing has ever run, it stamps nothing and the message may land without a reply. Whenever a stamped turn-opening message lands, its pair becomes the workspace's new last-used seed. Assistant replies separately carry `generatedBy`, captured at turn start, so history says which pair actually produced them. None of these shapes can name a [provider instance](#provider): an instance is a connected account on one machine, and a shared history naming one would resolve to nothing everywhere else.

#### Planning-model resolution

The mapping from the abstract pair to an instance, computed per machine by `resolvePlanningModel` and never stored — it is a fact about a machine at a moment. Candidates are that driver's snapshots which are available, enabled, and installed; among those offering the model the provider's default instance wins, otherwise the first in settings order. No candidate resolves `no-instance`; candidates without the model resolve `model-unavailable`, which is also how capability gating surfaces, since a model the installed agent is too old to run is already absent from the snapshot. Curation is deliberately not consulted by resolution: hiding a model is one client's picker preference. An unresolved recorded pair remains visible and unchanged — the machine never rewrites what history chose.

### Appearance

#### Environment theme

A theme an environment's machine publishes for clients to follow, one file per theme under `themes/` in that environment's state directory; the filename is the theme id. [environmentTheme.ts][42] watches the directory and streams the set over `subscribeServerConfig`; clients render each as a library card, generating a full palette when the file carries seed colors and using the palette directly when it is a standard exported theme file. A desktop that retints its apps when the system theme changes rewrites its file, so Astrolabe follows along without a restart. See [environment-theme.md][43].

#### Default theme

The environment's theme, held in its `settings.json` as `defaultTheme` (with `defaultThemeSetAt`
as the set-generation) and set with `t3 theme set <id>`. Web and desktop clients apply each set
once — live when connected, on the next connect otherwise — so setting it switches them, while a
theme a user picks in Settings afterwards sticks until the next set; mobile keeps its own
appearance settings. Naming a published [environment theme](#environment-theme) is how a desktop
ships Astrolabe already matching it.

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
[35]: ../../apps/server/src/mercurian/assistant/LineTurnReactor.ts
[36]: ../../packages/contracts/src/mercurianMemory.ts
[37]: ../../apps/server/src/mercurian/memory/MemoryIndex.ts
[38]: ../../apps/web/src/components/mercurian/MemoryAmendmentSheet.tsx
[39]: ../../apps/web/src/components/mercurian/PlanSuggestions.tsx
[40]: ../../apps/server/src/mercurian/worktreeSlots/SnapshotChain.ts
[41]: ../../apps/server/src/mercurian/worktreeSlots/SlotService.ts
[42]: ../../apps/server/src/environmentTheme.ts
[43]: ../user/environment-theme.md
[44]: ../../apps/server/src/mercurian/lineRuntimes/LineRuntimeService.ts
[45]: ../../apps/server/src/mercurian/assistant/LineTurnReactor.ts
[46]: ../../apps/web/src/rightPanelStore.ts
[47]: ../../apps/web/src/components/mercurian/useForkHere.ts
[48]: ../../apps/web/src/components/mercurian/ThreadSpaceSurfaces.tsx
[49]: ../../apps/web/src/components/mercurian/ThreadSpaceChrome.tsx

### Coding session

**Historical.** A coding runtime formerly born from a thread-history commit as an ordinary t3code
thread with an isolated worktree. New work happens in thread lines. Pre-existing coding-session
leaves remain visible in Checkpoints, open read-only, and decline sends.

**Compaction has two deliberately separate meanings.** Session compaction is automatic provider
bookkeeping inside an orchestration thread: it shortens the runtime context and appears as an
ordinary `context-compaction` activity in the provider-session work log, never as a Mercurian
commit or thread-stream item. In the Merges product sense, deciding how context is assembled going
forward is a human-driven planning act. The two do not share a surface or a write path.

### Former coding-session surface

**Historical.** The separate screen formerly served at `/sessions/$threadId`. That address now
redirects to the owning [thread space](#thread-space) with the historical leaf's line selected;
Checkpoint details label this action **Open line**. Current lines use the upstream thread timeline,
composer, workspace controls, checkpoints, diffs, and changed-file cards.

### Session Plan tab

**Historical.** The separate right-panel surface rendered the exact Plan revision named by a coding-session leaf. The current [thread space](#thread-space) renders that same historical position in its ordinary Plan tab through `mercurian.getPlanTextAt`.

### Coding-session leaf

**Historical.** An immutable terminal commit recording the nearest Plan revision implemented by a
former coding session. Leaves recorded before project scoping also stamp their one repository.
Mutable facts such as branch, outcome, and per-repository snapshot and pull-request facts live in the keyed
`coding_sessions` record and its `coding_session_repositories` rows beside it.

### Session branch

**Historical.** The descriptive `mercurian/<plan-title>-<token>` branch created with a coding
session. It carries only commits made by a person or agent; runtime snapshots never advance it. It
is not a temporary t3code branch and therefore never enters first-turn automatic branch renaming.
