# Architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

T3 Code is a server runtime that owns agent sessions, workspaces, and version control, plus clients
(web, desktop, mobile) that talk to it over one authenticated Effect RPC WebSocket. The server is the
execution boundary: every provider process, terminal, git operation, and filesystem read happens
there, never in the client.

```
┌────────────────────────────────────────────────┐
│ Clients: apps/web, apps/desktop, apps/mobile   │
│ shared runtime: packages/client-runtime        │
│  connection supervisor, RPC session, Atom state│
└──────────────────┬─────────────────────────────┘
                   │ Effect RPC over WebSocket (/ws)
                   │ contract: packages/contracts
┌──────────────────▼─────────────────────────────┐
│ apps/server                                    │
│  orchestration engine (event-sourced)          │
│  provider driver registry (6 built-in drivers) │
│  checkpointing, VCS, terminals, filesystem     │
└──────────────────┬─────────────────────────────┘
                   │ per-driver transport
┌──────────────────▼─────────────────────────────┐
│ Agent CLIs: Codex, Claude, Cursor, Grok,       │
│ OpenCode, Antigravity                          │
└────────────────────────────────────────────────┘
```

## The RPC boundary

The client/server contract is an Effect RPC group, not a hand-rolled push protocol. [`rpc.ts`][rpc]
declares `WS_METHODS` and assembles `WsRpcGroup`; each member is either unary or a server stream
(`stream: true`). Streaming members such as `orchestration.subscribeShell`,
`orchestration.subscribeThread`, `subscribeServerConfig`, and `terminal.attach` replace what used to
be a broadcast push bus: a client subscribes to what it needs and the server pushes only on that
subscription.

[`ws.ts`][ws] serves the group. `websocketRpcRouteLayer` mounts `GET /ws`, authenticates the upgrade
through `EnvironmentAuth.authenticateWebSocketUpgrade`, then hands the socket to
`RpcServer.toHttpEffectWebsocket`. Authorization is per method: `RPC_REQUIRED_SCOPE` maps each method
to a scope, and `authorizeEffect`/`authorizeStream` enforce it. Holding a valid socket is not
authorization to call everything on it. See [environment-auth.md](./environment-auth.md).

On the client, [`session.ts`][session] opens the socket and builds the typed client.
`RpcSessionFactory` is the service; a session exposes `client`, `initialConfig`, `ready`, `probe`,
and `closed`. It performs one attempt and does not retry. Retry, backoff, and offline policy belong
to the connection supervisor.

## Shared client runtime

`packages/client-runtime` holds every non-visual client concern: connection lifecycle,
authentication, RPC, cached environment data, and domain state as Atom factories. Web and mobile
compose it the same way (`apps/web/src/connection/runtime.ts` and
`apps/mobile/src/connection/runtime.ts` mirror each other, differing only in platform-specific
background-activity layers) and differ beyond that only in the platform layer they supply and the
UI they build on top. React components never construct transports, retry loops,
or RPC clients. See [connection-runtime.md](./connection-runtime.md).

## Orchestration is event-sourced

The server does not mutate app state directly. Clients dispatch typed commands; the engine turns them
into persisted events; projections derive the read model.

[`OrchestrationEngine.ts`][engine] serializes this. `dispatch` offers a `CommandEnvelope` onto
`commandQueue` and awaits its result; a single worker fiber takes envelopes one at a time, so command
processing is totally ordered. For each envelope `processEnvelope`:

1. checks the durable command receipt, making retries idempotent;
2. runs `decideOrchestrationCommand` ([`decider.ts`][decider]) to produce events from command plus
   current state, pure and side-effect free;
3. inside one SQL transaction, appends events to the event store, applies them to the in-memory read
   model via [`projector.ts`][projector], projects them into persisted tables, and writes the
   accepted receipt;
4. after commit, swaps in the new read model, cleans up attachments, and publishes committed events
   to subscribers. Attachment cleanup failures are logged and do not reject committed commands.

Because persistence and projection share a transaction, the read model cannot durably disagree with
the event log. On dispatch failure the engine rereads persisted events past the starting sequence and
reconciles.

Command and event names live in [`orchestration.ts`][contracts]. Some commands are client
dispatchable (`thread.create`, `thread.turn.start`, `thread.approval.respond`); others are internal
and produced only by server-side reactors (`thread.message.assistant.delta`,
`thread.turn.diff.complete`).

A turn is complete when its session leaves `running` status, projected by
`settledTurnStateForSessionStatus` in [`projector.ts`][projector]. Checkpoint work settling later
does not define turn end.

Thread settlement is server-owned. Each server's own settings control PR and inactivity
settlement. Those keys are user preferences, so clients write them to every shared-settings sync
target (`SHARED_SERVER_SETTING_KEYS` in `packages/client-runtime/src/state/sharedSettings.ts`) and
warn when another target drifts. A target must have an active connection and advertise the
`threadAutoSettlement` capability, which signals that the server can hold every shared key.
[`ThreadSettlementReactor`][settlement] checks threads at startup, when those settings change, and
once per minute, including when no client is connected. It dispatches the guarded internal
`thread.auto-settle` command, which uses the existing settlement event lifecycle. Automatic
settlement excludes live background work and requires a comparable PR timestamp for immediate PR
settlement. The command carries the latest activity timestamp and rejects any later event for its
thread after the reactor's snapshot.
Clients render the persisted settlement state and do not derive settlement from PR or inactivity
state. A committed `thread.settled` event also lets `ProviderCommandReactor` stop an idle provider
session.

## Drainable workers

Follow-up work runs asynchronously in queue-backed workers built on [`DrainableWorker`][worker]:
[`ProviderRuntimeIngestion`][ingest] normalizes provider runtime streams into orchestration commands,
[`ProviderCommandReactor`][cmd] dispatches provider calls in response to intent events, and
[`CheckpointReactor`][checkpoint] captures workspace checkpoints and coordinates snapshot-derived
turn diffs, while [`ThreadSettlementReactor`][settlement] evaluates server-owned automatic
settlement rules.

`DrainableWorker` pairs a transactional queue with a transactional count of outstanding items.
`enqueue` atomically offers and increments; processing always decrements. `drain` retries until the
count reaches zero, so a test can await "queue empty and current item finished" instead of sleeping.
Each of these four services exposes `drain` for exactly this.

Runtime receipts are a test-only mechanism. `RuntimeReceiptBusLive` in
[`RuntimeReceiptBus.ts`][receipts] publishes nothing; only the test layer is PubSub-backed. Do not
build production behavior on receipts.

## Provider drivers

Six drivers ship built in, registered in [`builtInDrivers.ts`][drivers] as `BUILT_IN_DRIVERS`:
Codex, Claude, Cursor, Grok, OpenCode, and Antigravity. A driver declares its kind and config schema and creates a
scoped adapter; `ProviderInstanceRegistry` owns live instances and `ProviderAdapterRegistry` resolves
an instance to its adapter, so `ProviderService` routes session and turn operations without knowing
which agent is behind them. See [providers.md](./providers.md).

Dev runs also enable an offline `mock` driver by default. `T3CODE_MOCK_PROVIDER=1` registers it and
seeds `mock-default` as the workspace planning model when none has been chosen; set
`T3CODE_MOCK_PROVIDER=0` when starting the dev runner to test the production driver set instead.

## Checkpointing

Each turn is bracketed by workspace checkpoints so diffs are exact. `CheckpointStore` captures state
as hidden Git refs through the VCS driver's checkpoint operations; `CheckpointDiffQuery` answers
turn and full-thread diff requests; and `CheckpointReactor` coordinates baseline capture,
completed-turn capture, and diff projection. The storage contract is `VcsCheckpointOps` in
[`VcsDriver.ts`](../../apps/server/src/vcs/VcsDriver.ts), implemented for Git in the same directory.
A provider's mid-turn diff report (such as Codex `turn/diff/updated`) records a placeholder checkpoint
for the turn; upstream threads replace it immediately, while a coding session takes its settled snapshot
at turn completion.

Mercurian coding-session checkpoints form a snapshot chain per planning line. Each snapshot records
the complete working tree, links to the previous line snapshot when one exists, and pins the
checked-out `HEAD` as provenance. The line's hidden snapshot ref advances, while the line's branch
moves only when a person or agent makes a commit. The runtime never runs `git commit`. Settled and
partial turn snapshots keep their turn refs; recovery and external snapshots sit between turns on
the same first-parent chain. Slot restoration reads the latest line snapshot, and turn diffs use the
snapshot's chain parent so between-turn changes remain separate from the agent's next turn.

## Mercurian's commit store

Planning history lives in a second SQLite database, `mercurian.sqlite`, beside `state.sqlite` in the
state directory, with its own migration sequence ([`mercurian/persistence/`][mercurian-persistence]).
Its client is provided privately in [`server.ts`][server]; the ambient `SqlClient` every t3code
consumer resolves is still `state.sqlite`.

[`CommitStore.ts`][commit-store] owns the commit DAG: every commit carries an unbounded ordered
`parents` list (zero for a root, one for a continuation, two or more for an n-ary merge), a `kind`
and an `author`, and a one-way `published` flag. The store enforces the design's structural
guarantees as refusals — forks and merges are human-driven only, coding-session commits are leaves,
a parent must already exist (so the graph is acyclic by construction), and publishing a commit also
publishes its unpublished ancestors along every parent path. See
[ADR 001](../architecture/local-first-runtime.md).

[`PlanningStore.ts`][planning-store] adds projects and plans over that graph. A plan owns exactly
one history and is created together with its root commit, so a plan without a first message cannot
exist. Neither artifact has a table: complete plan and spec snapshots land as `plan-revision` and
`spec-revision` commits, and current or historical values are derived from revisions on the selected
path. Spec provenance distinguishes import, tracker refresh, reconciliation, and direct authorship
without duplicating the commit's author.
A line owns one orchestration thread and claims its worktree slot across every linked repository on
its first turn. Every turn end captures a chained snapshot in each member of the slot, and each
repository's snapshot decides independently whether that repository is built; the runtime commits
nowhere.
The client still warns when the selected path's newest spec revision has no descendant plan revision
in the same ancestry. The warning is advisory and never blocks opening the draft or writes history.
The thread space is the upstream thread view whole, with Mercurian's Checkpoints, unified Plan surface, line
chrome, and overlays chiseled into its existing slots. Its conversation rides the orchestration
thread stream, while `mercurian.subscribePlan` supplies the conversation graph. Project documents are queried separately from their repository files.

The upstream composer sends an ordinary thread turn. The server records the human plan commit with
the orchestration message id, so the two identities are the same; **Fork here** creates a pending
line from the chosen message's parent and seeds that line's composer rather than appending directly
to the commit store. Attachments still use the server's ordinary attachment normalization and asset
door ([`Normalizer.ts`][normalizer]).

Every tree row also carries the facts a status is ranked from — whether something awaits a person,
whether a reply is streaming, and when the plan was last opened — composed at one point in
[`wire.ts`][planning-wire] and ranked into one status per row on the client (ADR 002 §4). Visited-at
is server state in its own `plan_visits` table, written by `mercurian.visitPlan` only when the visit
changes seen-ness and re-armed by `mercurian.markPlanUnread`, so unseen agrees across windows rather
than living in one of them (§5).

[`assistant/LineTurnReactor.ts`][planning-assistant] observes orchestration and provider events for
line threads. It adopts new upstream drafts as pending plan lines, records the human message commit,
folds reply text, grounding, questions, and memory amendments, and lands the assistant commit when
the turn settles. Plans and specs use ordinary filesystem tools. The planning MCP toolkit retains only reviewed
memory amendment proposals. See [project documents](./project-documents.md) for storage and refresh.

[`repositories/RepositoryStore.ts`][repository-store] is the third Mercurian service, in the same
database: the registry of codebases the app can reach, the app-owned scripts declared on each, and
the `project_repositories` join that gives a project its set. Two facts on the snapshot have no
column behind them. `hasGit` is a live `git rev-parse` probe behind a short-TTL `Cache`, on the
`RepositoryIdentityResolver` pattern — a plain directory registers fine, and the working-tree
features light up on their own once it becomes a repository. A row's environment is a fact about
which server answered, not data. Removal deletes the row, its scripts, and its memberships in one
transaction, and is refused while `git worktree list` names a linked worktree under
`ServerConfig.worktreesDir`. The registry streams over `mercurian.subscribeRepositories` with the
same snapshot-re-emit shape as the tree, and project sets ride that snapshot rather than the tree's
— including the cascade a removal leaves behind, whose signal is this store's.

[`mercurian/trackers/`][trackers] holds the seam to external issue trackers, in the same database
and knowing nothing about plans. `TrackerConnector` has `probe`, `listIssues`, and `getIssue`, and no write
method, so pull-only is a property of the type rather than a rule; every connector answers in the
same five-field `TrackerIssue` — id, title, description, url, status — and nothing else crosses.
Credentials are `ServerSecretStore` files keyed by connection id, never rows and never responses;
standing is probed live behind a short-TTL cache, never stored; issues are read live and never
stored at all.

Issue import is the one path that turns an issue into something Mercurian keeps, and it lands in
`PlanningStore` rather than a service of its own: `mercurian.importPlan` creates a plan whose root
commit is the derived spec, of domain kind `spec-revision` and written with `rootPublished: true` — the
one caller of that seam, so an imported plan is published from birth while `append` keeps every
later commit private. The complete spec snapshot has two prose fields, `goal` and
`acceptanceCriteria`; import maps the tracker issue's title and description into them, while the
persistence decoder maps earlier flat and nested `title`/`description` payloads at read time. The
link back lives in `plan_origins`, keyed `(connection_id, issue_id)` with
a `UNIQUE` on the pair: re-importing an origin returns the existing plan, or unarchives it, and the
wire's `created | existing | resurfaced` outcome says which, so idempotency reads as navigation
rather than a refusal. `connection_id` is not a foreign key — origins are content, and disconnecting
a tracker must not dangle a plan — and the origin row joins the delete walk so a deleted plan leaves
nothing for a later import to find. Explicit refresh uses the connector's by-id read and derives its
last upstream baseline from commit ancestry; unchanged reads write nothing, clean and converged
changes append refresh revisions, and divergent local/upstream changes require a reviewed
reconciliation. The issue's `status` is stored nowhere.

## Startup

[`serverRuntimeStartup.ts`][startup] runs a fixed lifecycle: start keybindings, settings, and
reactors; publish welcome; signal command readiness (logged as `Accepting commands`); wait for the
HTTP listener via `markHttpListening`; publish ready; fork the heartbeat; then either print headless
output or open the browser. Command readiness precedes the listener, so a socket that opens can
already dispatch.

## Related

- [Workspace layout](./workspace-layout.md), [Glossary](./glossary.md)
- [Mobile navigation headers](./mobile-navigation.md)
- [Remote environments](./remote.md), [Server updates](./server-updates.md)
- [Resource telemetry](./resource-telemetry.md)
- [Product analytics](./product-analytics.md)
- [Scripts](./scripts.md), [CI gates](./ci.md)

[rpc]: ../../packages/contracts/src/rpc.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[ws]: ../../apps/server/src/ws.ts
[session]: ../../packages/client-runtime/src/rpc/session.ts
[startup]: ../../apps/server/src/serverRuntimeStartup.ts
[engine]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[decider]: ../../apps/server/src/orchestration/decider.ts
[projector]: ../../apps/server/src/orchestration/projector.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[settlement]: ../../apps/server/src/orchestration/ThreadSettlementReactor.ts
[receipts]: ../../apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts
[drivers]: ../../apps/server/src/provider/builtInDrivers.ts
[server]: ../../apps/server/src/server.ts
[mercurian-persistence]: ../../apps/server/src/mercurian/persistence/
[commit-store]: ../../apps/server/src/mercurian/commitTree/CommitStore.ts
[normalizer]: ../../apps/server/src/orchestration/Normalizer.ts
[planning-store]: ../../apps/server/src/mercurian/planning/PlanningStore.ts
[planning-wire]: ../../apps/server/src/mercurian/planning/wire.ts
[planning-assistant]: ../../apps/server/src/mercurian/assistant/LineTurnReactor.ts
[repository-store]: ../../apps/server/src/mercurian/repositories/RepositoryStore.ts
[trackers]: ../../apps/server/src/mercurian/trackers/

## Coding-session birth

Coding-session birth spans three durability domains. The orchestration store owns the ordinary
t3code project and thread, git owns the branch and worktree, and Mercurian owns an immutable leaf
plus a keyed mutable record. The leaf payload stamps repository identity and the plan revision it
implements; branch, worktree, thread, timestamps, outcome, and pull-request URL remain side facts.

The Mercurian leaf is the last step. Before it lands, failures delete and drain the new thread,
remove the worktree, and compare-and-delete the generated branch only while it still points at its
captured base. A moved branch is preserved. The leaf and keyed row then land together in one
Mercurian SQL transaction.
