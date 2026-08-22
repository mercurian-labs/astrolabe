# Technical Plan — M-152: Plan and session awareness

_Generated from the Goal/AC of Linear issue M-152 (see the issue for the full AC). Design sources: the almagest vault's "Mobile App" note (§Awareness — push notifications are why the client exists with the app closed; notifications follow pairing) and "Issue Status" (the awaiting-input / working vocabulary), plus the t3code-docs "Mobile Client" note (the shell's push pattern this plan extends)._

**Stack context:** this is the TOP branch, `venk/m-152-plan-and-session-awareness`, stacking on `venk/m-151-coding-sessions-on-mobile` (below it: M-150 implement moment, M-149 graph map, M-148 Thread view, M-147 planning space, M-146 plan list). Everything those branches build — above all their mobile screens and linking routes — is treated as present. Where this plan names a mobile route, the coordination rule at the end of §Deep links governs.

**Goal, in one sentence:** when a plan's turn ends, a plan or session enters awaiting-input, or a session's turn settles or the session ends, a paired phone gets a push notification that opens directly onto that plan or session — riding the shell's existing awareness pipeline, not a second one.

**Scope, stated plainly:** server-side publishing of Mercurian plan and session states into the existing agent-awareness pipeline, plus the mobile deep-link handling to land on the Mercurian screens. The relay cloud service (`infra/relay/`), the APNs delivery rules, per-device notification preferences, device registration, and pairing itself all already exist and are not modified.

## Conventions Detected

- **The awareness pipeline is generic over `RelayAgentActivityState`** — the environment publishes `{environmentId, threadId, projectTitle, threadTitle, phase, headline, detail?, modelTitle, updatedAt, deepLink}` per thread (`packages/contracts/src/relay.ts:95-107`); the relay stores rows keyed (environment, threadId), fans out to the users linked to that environment (`infra/relay/src/agentActivity/AgentActivityPublisher.ts:158-161`), and fires alerts **on phase transitions between delivered aggregates**, gated by per-device `notifyOnApproval/Input/Completion/Failure` (`infra/relay/src/agentActivity/ApnsDeliveries.ts:156-289`). Alert copy is `title: threadTitle, body: "{status}: {projectTitle}"`. Nothing in the relay assumes a t3 thread — a state with a synthetic threadId and a Mercurian deep link flows through unchanged. Confidence: high.
- **Phase vocabulary** — `starting | running | waiting_for_approval | waiting_for_input | completed | failed | stale` (`packages/shared/src/agentAwareness.ts:8-15`). Mercurian's Issue Status vocabulary (awaiting-input, working) maps onto it without new phases. Confidence: high.
- **Environment-side publishing shape** — `AgentAwarenessRelay` (`apps/server/src/relay/AgentAwarenessRelay.ts`) subscribes to `orchestrationEngine.streamDomainEvents`, filters (`shouldPublishAgentAwarenessEvent`), resolves thread+project shells, projects a state (`projectThreadAwareness`), dedupes by state identity, signs a JWT proof, and POSTs `publishAgentActivity`. Publishing is gated by the Connections page's publish switch (`PUBLISH_AGENT_ACTIVITY_SECRET`) plus relay link credentials — any new publisher must go through the same gate. Pure decision helpers are exported for unit tests. Confidence: high.
- **Mercurian reactors beside the stores** — `CodingSessionRecordReactorLive` (`apps/server/src/mercurian/codingSessions/CodingSessionRecordReactor.ts`) is the precedent: a `Layer.effectDiscard` that `forkParked`-subscribes a stream and calls a store, merged in `server.ts:465-468`. Runtime state is never persisted (ADR 002 §3: `PlanTurnRegistry.ts:12-13`); status is composed at the read layer, never stored (ADR 002 §4: `ws.ts:1137-1139`). Confidence: high.
- **Layer ordering permits the wiring this plan needs** — `ReactorLayerLive` (holds `AgentAwarenessRelay`, `server.ts:249-257`) sits above `PlanningAssistant.layer` (`:417`) and `MercurianPersistenceLayerLive` (`:469`), so the relay may consume `CodingSessionStore`, and a new Mercurian reactor merged beside `CodingSessionRecordReactorLive` may consume both the assistant and the relay. t3-owned files already import Mercurian modules directly (`ws.ts:113-115`, `server.ts:27-31`). Confidence: high.
- **Mobile deep links** — react-navigation linking with prefixes `t3code://` (+`-dev`/`-preview`) (`apps/mobile/src/App.tsx:37`); thread route `threads/:environmentId/:threadId` (`Stack.tsx:224`). Notification taps navigate via `linkTo(deepLink)` (`features/agent-awareness/notificationNavigation.ts`), and the payload extractor **strictly normalizes** the deep link, today accepting only `/threads/{env}/{threadId}` (`notificationPayload.ts:47-88`). The Live Activity widget converts any rooted link to `t3code://…` generically (`src/widgets/AgentActivity.tsx:151-154`) — no widget change for new link shapes. Confidence: high.
- **Web route shapes to mirror** — `/plans/$planId` and `/sessions/$threadId` (`apps/web/src/routeTree.gen.ts:130-141`); the session screen is keyed by its threadId. Confidence: high.
- **Testing & verification** — colocated `.test.ts` (Vitest), run targeted: `vp test run <files>`; `pnpm tc` for types; never repo-wide (AGENTS.md §Verifying). Async server flows assert on receipts/drains, never sleeps. Every AC is then demonstrated live, per house practice. A new method on `PlanningAssistant`'s interface must also land on `server.test.ts`'s `Layer.mock` (`server.test.ts:1011-1026`) or the wire suite dies in CI. Confidence: high.
- **Commits & docs** — conventional, issue-tagged (`feat(server): … (M-152)`); plan documents at `docs/project/technical-plan-m-<n>-<slug>.md`. Confidence: high.

## Design

### What the pipeline already gives us, verified

**Coding sessions already publish.** A session's birth dispatches a real `thread.create` into the orchestration engine with a project and the plan's title (`CodingSessionService.ts:339-351`), so session threads have shells and their provider events flow through ingestion into `streamDomainEvents`. The existing `AgentAwarenessRelay` therefore already publishes session states end to end: turn running → `running`, approval request → `waiting_for_approval` (`thread.activity-appended` with `approval.requested` passes the filter, `AgentAwarenessRelay.ts:82-90`), structured question → `waiting_for_input`, turn settled → `completed`. AC2's session half and AC3's turn-settling half work today at the pipeline level. What's wrong for Mercurian is only the _identity_ of the published state: `deepLink` is `/threads/{env}/{threadId}` (the t3 thread screen) and the titles are the t3 shell's.

**Plan turns publish nothing.** The planning assistant drives provider sessions directly (`providerService.startSession`, `PlanningAssistant.ts:1001`) on minted ids `mercurian-plan-${uuid}` (`:462-463`) with no orchestration shell — and `ProviderRuntimeIngestion.processRuntimeEvent` drops events whose thread has no shell (`ProviderRuntimeIngestion.ts:1477-1478`). Plan turns are invisible to the relay. This is the gap the AC's plan half outruns, and the new code this plan introduces.

**Pairing scoping already holds.** The relay fans out per environment link: `listDeliveryUsersForEnvironment` (`infra/relay/src/environments/EnvironmentLinks.ts:244`) returns only users who linked that environment to their T3 Connect account, and `revokeForUser` severs it. A workspace, in Mercurian's plumbing-not-navigation stance (almagest "Environments"), is the machine's environment — so "notifications respect which workspaces this phone is paired to; unpairing stops them" (AC5) is existing behavior to _verify_, not build. Two honest boundaries, stated for the record: push awareness requires the T3 Connect link and the environment's publish switch (bearer-only QR pairing has no push path — the same boundary the shell has), and delivery is per linked _user account_ whose devices registered (`RelayDeviceRegistrationRequest`, `relay.ts:41-57`).

**Relay hygiene is inherited.** In-flight rows that never see a terminal publish expire relay-side (2h running / 24h waiting, `agentActivityPayloads.ts:22-41`), terminal rows age out of aggregates after 15 minutes (`AgentActivityPublisher.ts:232`) — so a server that dies mid-plan-turn self-heals with no Mercurian boot logic (plan turns rightly don't survive restart, ADR 002 §3).

### Part 1 — sessions: enrich the one existing path, don't build a second

`AgentAwarenessRelay.make` gains a `CodingSessionStore` dependency (available per the layer ordering; the store is sql-only, no cycle). In `publishThreadUnsafe`, after `resolveAgentAwarenessRelayPublishSnapshot`, the state is passed through a new **pure, exported** helper:

- **`applyMercurianSessionAwareness(state, session, environmentId)`** _(new, in `AgentAwarenessRelay.ts`, beside the other exported pure helpers)_ — when `getByThreadId(threadId)` finds a coding-session record:
  - `deepLink` becomes `/sessions/{environmentId}/{threadId}` — the Mercurian session screen, not the t3 thread screen.
  - If the record has `endedAt`, the phase is overridden terminally: `outcome === "failed"` → `failed`, `completed`/`stopped` → `completed`, with headline "Session ended". An ended session must read as ended whatever the thread shell's last turn state says.
  - Titles stay: the session thread's title already is the plan's title and its project the repository — exactly the alert copy we want (`"Done: <repo>"` under the plan's name).

Because this runs inside the existing path, dedupe, the tombstone/confirmation deferrals, the publish switch, proof signing, and the boot-time active-thread snapshot all apply unchanged.

**Session end as a trigger (AC3's second half).** `CodingSessionStore.end` exists (`CodingSessionStore.ts:172-176`) and announces on the store's `changes` PubSub, but nothing republishes awareness when it fires (today nothing calls `end` at all — the ending act is still to land in the stack below; this wiring makes it notify the moment it does). The new Mercurian reactor (Part 2's layer, one subscription more) subscribes `codingSessionStore.changes`, and for each announced plan enqueues `relay.publishThread(session.threadId)` for that plan's sessions (`listForPlan`) — the re-run projection sees `endedAt`/`outcome` through the enrichment helper and publishes the terminal state. Thread deletion already tombstones via the existing event path. `attachPullRequest` announcements ride the same subscription harmlessly (identity dedupe drops no-op publishes).

### Part 2 — plans: a Mercurian publisher feeding the same pipeline

**New module `apps/server/src/mercurian/awareness/`** (a sibling area to `codingSessions/`, following the mercurian-area layout):

- **`planAwareness.ts` (new)** — the pure projection, mirroring `projectThreadAwareness`'s shape server-side (it stays out of `packages/shared`: no client consumes it):
  - `planAwarenessThreadId(planId)` → `ThreadId.make(`mercurian:plan:${planId}`)`. `ThreadId` is a branded non-empty string (`baseSchemas.ts:51-56`), so a synthetic id is wire-valid; the `mercurian:plan:` prefix cannot collide with the assistant's `mercurian-plan-${uuid}` provider ids or real thread uuids, and it is **stable per plan** — successive turns upsert one relay row, which is what makes the relay's transition-based alerting fire correctly (a rotating id would ring "Done" as a fresh row and never transition).
  - `projectPlanAwareness({environmentId, plan, project, turnStatus, modelTitle})` → `RelayAgentActivityState | null`: `hasPendingInput` → `waiting_for_input` (headline "Waiting for input"), `isWorking` → `running` ("Assistant is working"), settled → `completed` ("Reply finished"); `threadTitle` = plan title, `projectTitle` = Mercurian project name, `deepLink` = `/plans/{environmentId}/{planId}`. No `starting`, no `waiting_for_approval` (a plan's only wait is the structured question — Issue Status's awaiting-input), no `failed` phase for now: a failed turn settles as an interrupted commit and reads as the turn ending.
- **`PlanAwarenessReactor.ts` (new)** — `Layer.effectDiscard`, the `CodingSessionRecordReactor` pattern:
  - Subscribes `planningAssistant.changes` (fires on turn start, question pause, settle — `PlanningAssistant.ts:271-272`). On each tick it reads `planningAssistant.status` (`Map<PlanId, PlanTurnStatus>`) and diffs against its previously seen map (a local `Ref` — runtime state, nothing persisted):
    - plan newly present or its status changed → publish the projected live state;
    - plan vanished from the map → the turn settled → publish `completed` **unless** the plan is gone or archived from `planningStore.getTreeSnapshot` (teardown by archive/delete settles turns too — that must tombstone, not ring "Done"; `PlanningAssistant.ts:1513-1527`). A user-stopped (interrupted) turn still publishes `completed` — the turn ended, which is AC1's event; the per-device `notifyOnCompletion` switch is the user's volume knob, matching how t3 treats interrupted-with-completedAt as completed (`agentAwareness.ts:98-105`).
  - Publishes through a new door on the relay (below). The reactor's stream consumption is sequential, so per-plan publish order holds without the relay's drainable worker.
  - Also carries the `codingSessionStore.changes` subscription from Part 1.
- **`AgentAwarenessRelay` gains `publishState(threadId, state | null)`** — the external door: the same enabled-switch check, relay config read, proof signing, POST, per-thread identity dedupe, and logging as `publishThreadUnsafe`, extracted into a shared core, but taking the state as given instead of resolving projections (so none of the shell-race confirmation deferrals apply — the assistant runtime is the authority for plan states, there is no mid-write projection to race).

**`PlanTurnStatus` grows `modelTitle`** (`PlanningAssistant.ts:108-111`): the state schema requires a model title, and the turn runtime already holds `modelSelection` (`:168`). `wire.ts` keeps reading only the two booleans; the reactor caches the last-published state per plan so the settle publish (when the turn is already gone from the map) reuses the model it ran under. `server.test.ts`'s assistant mock gets the field.

### Part 3 — mobile: two new deep-link shapes, landing on the stack's screens

- **`notificationPayload.ts`** — generalize the strict normalizer: accept exactly three shapes, `/threads/{env}/{threadId}`, `/plans/{env}/{planId}`, `/sessions/{env}/{threadId}` (same rules: no `//`, no query/hash, re-encode segments). Everything else still returns null. The `environmentId`+`threadId` data-field fallback stays thread-only.
- **Routes** — the stacked branches own the screens: M-147's planning space and M-151's session screen. Canonical linking strings, mirroring the web shapes with the environment prefix mobile's connection resolution needs (the `threads/:environmentId/:threadId` precedent): **`plans/:environmentId/:planId`** and **`sessions/:environmentId/:threadId`**. Coordination rule: the server's deep-link builders (`projectPlanAwareness`, `applyMercurianSessionAwareness`) and the mobile normalizer are the two ends of one contract — if the stacked branches registered different linking strings in `Stack.tsx`, align all three to the stack's strings in this branch rather than renaming the stack's routes from the top.
- **Nothing else moves**: registration, permissions, preferences UI, response routing (`notificationNavigation.ts` just calls `linkTo`), and the Live Activity widget are shape-agnostic.

### What is deliberately not built

- **No relay (`infra/relay/`) or contracts changes.** Phases, preferences, alert rules, and the state schema fit as-is; the relay keeps zero product knowledge.
- **No "am I viewing it" suppression.** The AC's "while I'm not viewing it" is carried by the inherited OS semantics — banners present when the app is backgrounded or closed, which is when push awareness exists at all (Mobile App §Awareness). The shell's feature makes the same trade today; per-screen foreground suppression would be new product surface for another issue.
- **No per-workspace notification toggles.** Scoping is the pairing itself (AC5); finer controls stay with the existing per-device preference switches.
- **No plan-side Live Activity divergence.** Plan states ride the same aggregate card as everything else, by construction.

## Implementation Checklist

- [ ] Work on `venk/m-152-plan-and-session-awareness`, stacked on `venk/m-151-coding-sessions-on-mobile`.
- [ ] `apps/server/src/relay/AgentAwarenessRelay.ts`: add the `CodingSessionStore` dependency; export pure `applyMercurianSessionAwareness(state, session, environmentId)` (deep link rewrite + ended-session terminal override) and apply it in `publishThreadUnsafe` after snapshot resolution.
- [ ] `apps/server/src/relay/AgentAwarenessRelay.ts`: extract the publish core (switch check, config, proof, POST, identity dedupe, logging) and expose `publishState(threadId, state | null)` on the service.
- [ ] `apps/server/src/mercurian/assistant/PlanningAssistant.ts`: add `modelTitle` to `PlanTurnStatus`, filled from the turn's `modelSelection`; mirror the field on `server.test.ts`'s assistant mock.
- [ ] `apps/server/src/mercurian/awareness/planAwareness.ts` **(new)**: `planAwarenessThreadId` + pure `projectPlanAwareness` as designed.
- [ ] `apps/server/src/mercurian/awareness/PlanAwarenessReactor.ts` **(new)**: status-diff reactor over `planningAssistant.changes` (live states, settle→completed, archive/delete→tombstone via tree-snapshot check) publishing through `relay.publishState`; plus the `codingSessionStore.changes` → `relay.publishThread(session.threadId)` subscription.
- [ ] `apps/server/src/server.ts`: merge `PlanAwarenessReactorLive` beside `CodingSessionRecordReactorLive` (`RuntimeDependenciesLive`).
- [ ] `apps/mobile/src/features/agent-awareness/notificationPayload.ts`: extend extraction/normalization to `/plans/{env}/{planId}` and `/sessions/{env}/{threadId}`.
- [ ] Verify the stacked branches' `Stack.tsx` linking strings for the plan and session screens match `plans/:environmentId/:planId` / `sessions/:environmentId/:threadId`; align the server builders and normalizer to the stack's strings if they differ.
- [ ] No new dependencies; no `packages/contracts` schema changes; no `infra/relay` changes.
- [ ] Commit as `feat(server,mobile): plan and session awareness — Mercurian states on the push pipeline (M-152)` (split server/mobile commits if the diff wants it).

## Test Plan

Colocated unit tests, run targeted (`vp test run <files>`), plus `pnpm tc`:

- [ ] `AgentAwarenessRelay.test.ts` — `applyMercurianSessionAwareness`: session thread gets `/sessions/{env}/{threadId}`; ended session maps `failed`→failed and `completed`/`stopped`→completed over a shell that still reads running; non-session threads pass through untouched. `publishState`: respects the publish switch, dedupes identical states, publishes tombstones.
- [ ] `apps/server/src/mercurian/awareness/planAwareness.test.ts` **(new)** — phase mapping (pending input beats working), synthetic id stability and prefix-collision freedom, deep-link shape, title/model plumbing.
- [ ] `apps/server/src/mercurian/awareness/PlanAwarenessReactor.test.ts` **(new)** — status-diff transitions: start→running publish; question→waiting_for_input; answer→running; settle→completed exactly once; teardown-by-archive→tombstone, not completed; session-end announcement triggers a thread republish. Drive with mocked assistant status snapshots + a queue-backed `changes` stream; assert on publishes, no sleeps.
- [ ] `PlanningAssistant.test.ts` — `status` carries the running turn's `modelTitle`.
- [ ] `notificationPayload.test.ts` — the two new shapes normalize; queries, hashes, `//`, and wrong segment counts still reject; thread links unchanged.
- [ ] `vp test run apps/server/src/server.test.ts` — the wire suite stays green with the extended assistant mock.

Live walk (every AC demonstrated, per house practice — push delivery needs a relay-linked environment and a device/simulator with the dev push path; where APNs itself is out of reach, the environment-side evidence is the relay publish log lines `publishing agent activity for thread` with the expected phase + deep link):

- [ ] Send a plan message from desktop, background the phone app: turn settle publishes `completed` for `mercurian:plan:{planId}` (AC1); notification arrives; tapping lands on that plan's planning space (AC4).
- [ ] Have the assistant ask a structured question: `waiting_for_input` publish and notification (AC2, plan half); answering returns the state to `running` without a spurious "Done".
- [ ] Trigger a session approval request: `waiting_for_approval` notification deep-links to the session screen (AC2, session half + AC4).
- [ ] Let a session turn settle: `completed` with the `/sessions/…` link (AC3); when the ending act lands in the stack, ending a session publishes the terminal state (AC3, second half — until then, evidence is the reactor test plus a direct `CodingSessionStore.end` call in a dev environment).
- [ ] Archive a plan mid-turn: tombstone published, no notification.
- [ ] Unlink the environment from the T3 Connect account (and separately: flip the publish switch off): publishes stop / are skipped — notifications cease for that workspace while another paired workspace keeps ringing (AC5).
