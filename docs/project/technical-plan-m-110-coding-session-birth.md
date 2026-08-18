# Technical Plan — M-110: Coding sessions — draft, leaf commit, worktree birth

_Generated from the redone Goal/AC for Linear issue M-110 (2026-08-14). Grounded against `main` at `00ecd5df8`, after M-107 landed the implement gate. Product sources consulted in the almagest vault as of commit `fd03ee1` (2026-08-14): **Coding Sessions**, **Splits**, **Commit Tree**, **Plans**, **Specs**, **T3code Worktree Lifecycle**, **T3code Thread**, **Providers**, **T3code Providers**, **Left Sidebar**, **DAG Explorer**, **Settings**, and **Issue Status**._

**Goal, in one sentence:** let a user completely shape a repository-scoped coding-session draft at an implement-ready commit, then promote it on the first turn into an isolated t3code thread/worktree plus an immutable `coding-session` leaf in the plan DAG, with compensating cleanup if any birth step fails.

**Scope fences:** M-107 already owns the implement analysis, recorded readiness verdicts, and split confirmation; M-109 owns the spec-freshness warning, including its implement-moment surfacing _before_ the gate (review plan / continue anyway) — this plan must not assume the draft opens straight from the implement click, but builds none of that warning; M-114 owns subsequent turns, approvals, mode switching, compaction, and thread-derived status; the session screen is 063/064; git actions and PR creation are 065; M-115 owns teardown; M-116 owns preferences and confirm gates. M-110 creates and starts the first turn, records the leaf, exposes its structured facts, and leaves explicit seams for those follow-ups.

**Vocabulary:** the product says **ready to implement**; "split" and "atomic" are internal words for code, payloads, and this document, and never reach a surface (Splits, resolved 2026-08-12).

## Addendum — regrounded 2026-08-14 after rebase onto `18ee435b3`

The branch was rebased onto origin/main after M-130 (mock provider), M-109 (Specs), and M-128 (per-branch planning model) merged. Where this addendum conflicts with the sections below, the addendum wins.

1. **M-109 is built, and the commit-kind claims still hold.** `spec-revision` joined `CommitKind`, aliased at the store boundary onto the stored `issue-revision` value (`CommitStore.ts:258–267`), so the SQL commit-kind CHECK in `001_CommitGraph.ts` is unchanged and migration **010** remains the next free slot. The freshness warning is real: `StalePlanWarning.tsx` and `implementFlowAction` in `splits.logic.ts` already gate the implement flow ahead of the readiness gate. M-110 wires the draft downstream of that flow exactly as planned — build none of it, break none of it.
2. **M-128 replaced the planning-model surface.** `PlanningModelSetting.logic.ts`/`.tsx` are gone; planning model choice now lives in `PlanningModel.logic.ts`, `PlanModelPicker.{logic.ts,tsx}`, and `PlanModelChoice.logic.ts`. The shared utilities the session draft reuses — `deriveProviderInstanceEntries` (`apps/web/src/providerInstances.ts`), `getAppModelOptionsForInstance` (`apps/web/src/modelSelection.ts`), `sortModelsForProviderInstance` (`apps/web/src/modelOrdering.ts`) — are unchanged. The exact-instance `ModelSelection` schema lives in `packages/contracts/src/orchestration.ts` (not `server.ts`).
3. **Rendering surfaces grew.** `planReducer.ts` now carries `spec`, and `PlanTimeline`/`DagExplorer`/`PlanningSpace` gained spec-revision and per-branch model rendering; session rendering integrates beside those cases rather than assuming the pre-M-109 shapes.
4. **M-130 adds a mock provider** (`MockPlanningModelSeed`) for dev-mode planning; no design impact on sessions, which still gate on the machine's installed agent.

## Conventions Detected

| Convention                                                                                                                                                                                                        | Evidence                                                                                                                                                       | Confidence |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Mercurian state is additive under `apps/server/src/mercurian/`, stored in its private `mercurian.sqlite`, with a separate numbered migration manifest                                                             | `apps/server/src/server.ts`, `apps/server/src/mercurian/persistence/Migrations.ts`, ADR 004                                                                    | High       |
| Commit structure is enforced as store refusals; `coding-session` is already a `CommitKind`, and naming one as a parent already raises `CodingSessionParentError`                                                  | `apps/server/src/mercurian/commitTree/schema.ts:37`, `CommitStore.ts:85`                                                                                       | High       |
| Commit payloads are immutable full snapshots; later or mutable facts live in keyed side tables                                                                                                                    | `PlanningStore.ts` payload schemas, migrations `006_PlanVisits.ts` and `009_PlanImplementVerdicts.ts`                                                          | High       |
| Human planning writes call `requireNoActiveTurn`, append through `appendAt`, touch the plan row inside a transaction, then announce after commit                                                                  | `apps/server/src/mercurian/planning/PlanningStore.ts` (`appendMessage`, `savePlanRevision`, `saveSplits`)                                                      | High       |
| Mercurian mutations cross the standard four seams: contracts/RPC, Operate authorization, `observeRpcEffect` handler, then a client-runtime command on `serialPerPlan`                                             | `packages/contracts/src/mercurian.ts`, `rpc.ts`, `apps/server/src/auth/RpcAuthorization.ts`, `ws.ts`, `packages/client-runtime/src/state/mercurianPlanning.ts` | High       |
| A never-born client object uses a small zustand/localStorage store with manual decoding and storage failures swallowed                                                                                            | `apps/web/src/planDraftStore.ts`                                                                                                                               | High       |
| Provider choices are exact `ProviderInstanceId` + model selections; usable choices require an available, enabled, installed instance whose snapshot offers the model                                              | `packages/contracts/src/server.ts`, `mercurianWorkspace.ts`, `PlanningModelSetting.logic.ts`                                                                   | High       |
| Mercurian web components live in `apps/web/src/components/mercurian/`, with pure co-located `*.logic.ts` helpers and targeted tests                                                                               | `SplitSheet.tsx`, `splits.logic.ts`, `PlanGraph.logic.ts`, their tests                                                                                         | High       |
| The current sidebar is a flat, one-line plan list; richer session detail accrues in the plan detail popover rather than adding nested rows or card lines                                                          | almagest **Left Sidebar**, `PlanListSidebar.tsx`, commit `31e9f5ad8`                                                                                           | High       |
| Coding sessions remain ordinary t3code threads for runtime, worktree, provider, terminal, and checkpoint behavior; Mercurian references them by id and composes cross-store facts only at read/reactor boundaries | ADR 001/002, `docs/internals/overview.md`, orchestration contracts                                                                                             | High       |
| Tests are co-located and targeted with `vp test run <files>`; Effect async tests wait on receipts/worker drains, never sleeps                                                                                     | existing server tests and `AGENTS.md`                                                                                                                          | High       |
| Conventional commits are scoped, plain-language, and issue-suffixed; project plans live under `docs/project/technical-plan-*.md`                                                                                  | `git log`, existing `docs/project/` plans                                                                                                                      | High       |

Two lower-confidence precedents are used deliberately:

- Resolving or lazily creating a t3code project for a repository path has one precedent: `resolveAutoBootstrapWelcomeTargets` in `apps/server/src/serverRuntimeStartup.ts:182`. It is the smallest way to satisfy `ThreadCreateCommand.projectId` without teaching orchestration about project-less threads. **Medium.**
- Upstream bootstrap is the choreography donor, not an all-or-nothing implementation: `dispatchBootstrapTurnStart` in `apps/server/src/ws.ts:809` creates a thread/worktree and launches setup before the turn, but its failure cleanup only dispatches `thread.delete`. M-110 must add worktree and branch compensation itself. **High on the finding; medium as a reusable precedent.**

## Discovery Summary

M-107 deliberately stopped at the new feature's seam. `SplitSheet.tsx` already accepts `onOpenSessionDraft` (`SplitSheet.tsx:40`), and its ready state renders a disabled “Coding sessions arrive next” action. `PlanningSpace.tsx` already owns the sheet and the landed-split jump list (`LandedPlan` from `splits.logic.ts`). A ready verdict is immutable, keyed by commit (migration `009_PlanImplementVerdicts.ts`), and includes the repository id/name, so the session draft does not need or permit a repository picker. The sheet already keeps the user on the commit they tried from — confirmation offers jumps, never relocation — so the per-landed-plan session actions attach to that jump list.

The commit model is also ready: the schema and migration already admit `coding-session`, and `CommitStore` already refuses descendants. What is missing is the payload decoder/writer, the keyed session record, and client rendering.

The runtime half exists as t3code machinery: project/thread commands, provider instances, worktree creation, setup terminals, first-turn dispatch, branch-drift following, and thread deletion cleanup. It is spread across `apps/server/src/ws.ts`, `apps/server/src/git/GitWorkflowService.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`, `apps/server/src/project/ProjectSetupScriptRunner.ts`, `apps/server/src/terminal/Manager.ts`, and the orchestration layers `apps/server/src/orchestration/Layers/{ProviderCommandReactor,CheckpointReactor,ThreadDeletionReactor}.ts`. M-110 should orchestrate these services from one Mercurian-owned birth service rather than fork the provider runtime.

One acceptance-criteria tension must be handled explicitly. There is no transaction spanning `mercurian.sqlite`, `state.sqlite`, and git, and upstream intentionally has no general branch-delete operation because established session branches survive teardown. This plan uses a saga with a narrowly scoped compare-and-delete for the branch created during a failed birth. The normal failure path leaves no leaf, thread, worktree, or unchanged birth branch. If the new branch moved away from its captured base commit before compensation, cleanup preserves it rather than destroying possible work and logs the residue. That safety fallback is the only honest exception to the failed-start AC's absolute “no branch” wording.

## Design

### 1. A session draft is local configuration keyed by its implement commit

Add `apps/web/src/codingSessionDraftStore.ts` **(new)**, following `planDraftStore.ts` rather than coupling Mercurian to the high-churn persisted schema in `composerDraftStore.ts`.

```ts
interface CodingSessionDraft {
  readonly draftId: string;
  readonly planId: PlanId;
  readonly parentCommitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly repositoryName: string;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "full-access";
  readonly modelSelection: ModelSelection;
  readonly createdAt: string;
}
```

The reusable key is `(planId, parentCommitId)`, not `planId`: each confirmed repository projection gets its own draft, and reopening Implement at the same ready commit resumes that draft. The repository is copied from the recorded ready verdict and rendered as immutable context; changing repositories means choosing a different implement-ready commit.

The same store owns coding-session stickiness (`lastModelSelection`), separate from upstream's `composerDraftStore` persistence. Starting a session updates it; merely editing or abandoning a draft does not. Seed in this order:

1. the last successfully started coding-session selection if that exact instance is still usable and still offers the model;
2. otherwise the first available/enabled/installed instance in server order and its first curated model;
3. if no usable pair exists, keep Start disabled and explain the installed-agent gate.

`runtimeMode` starts at `full-access`, matching `DEFAULT_RUNTIME_MODE` (`packages/contracts/src/orchestration.ts:126`); the UI offers only `approval-required` (worded **supervised**, the product tier name), `auto-accept-edits`, and `full-access`, never upstream's legacy `auto`. `startFromOrigin` comes from `settings.newWorktreesStartFromOrigin` (`packages/contracts/src/settings.ts:567`). `baseRef` seeds from the repository's default local branch, falling back to its current local branch, using `usePaginatedBranches` against the Mercurian repository path and filtering remote refs out of the picker. Origin's view remains the adjacent toggle, not a second branch namespace.

Persisted draft decoding is manual and defensive like `planDraftStore.ts`. When a tree snapshot no longer contains a plan, prune that plan's session drafts so deleted plans do not leak local entries. A draft is the only pre-start trace; no RPC, Mercurian row, t3code thread, branch, or worktree exists until Start.

Add `apps/web/src/components/mercurian/codingSessionDraft.logic.ts` **(new)** for seeding, instance-grouped option derivation, mode options, and start-payload construction. Reuse `deriveProviderInstanceEntries`, `getAppModelOptionsForInstance`, and `sortModelsForProviderInstance` (`apps/web/src/providerInstances.ts`, `modelSelection.ts`, `modelOrdering.ts`); unlike `PlanningModelSetting`, preserve one group per instance because the session names the machine-local instance directly.

Add `CodingSessionDraftSheet.tsx` **(new)** on the same caller-owned dialog primitives as `SplitSheet`. It shows, in order: implemented commit/repository; local base branch plus Start from origin; runtime mode; provider instance and model; Start. There is no prompt field. The plan text at `parentCommitId` is the first turn's brief, which keeps the leaf's “implemented this revision” statement exact and makes Start all coherent.

### 2. The two implement-gate exits open the same draft

Wire the sheet in `PlanningSpace.tsx`:

- **Already ready:** pass M-107's existing `onOpenSessionDraft` into `SplitSheet`; replace “Coding sessions arrive next” with **Start a coding session**. The proposal's `parentCommitId` and recorded verdict seed the draft without another analysis — the short-circuit path M-107 already records verdicts for.
- **After split confirmation:** extend the local `LandedPlan` shape to retain `repositoryId` as well as returned `commitId`/name. Each post-confirmation row offers **Start a coding session** beside **Go to plan**. A **Start all** action materializes each split's seeded draft and starts them through the same RPC; starts are atomic per session, not as one cross-repository batch, so one failure does not erase successful siblings.

Both exits sit _after_ M-109's freshness warning in the implement flow (warning → gate → draft). Nothing here renders or checks that warning; this plan only avoids assuming the draft opens synchronously from the implement click, so the warning can precede it once M-109 lands.

The ordinary Implement action remains available after a session starts. No “already has a session” refusal is added: a retry is another draft and another sibling leaf, potentially under a different model.

### 3. The leaf record splits immutable commit facts from mutable session facts

Add migration `apps/server/src/mercurian/persistence/Migrations/010_CodingSessions.ts` **(new)** and register it as migration 10.

```sql
CREATE TABLE coding_sessions (
  commit_id      TEXT PRIMARY KEY REFERENCES commits(commit_id),
  plan_id        TEXT NOT NULL REFERENCES plans(plan_id),
  repository_id  TEXT NOT NULL,
  thread_id      TEXT NOT NULL,
  branch         TEXT NOT NULL,
  worktree_path  TEXT NOT NULL,
  base_ref       TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  outcome        TEXT CHECK (outcome IN ('completed', 'stopped', 'failed')),
  pr_url         TEXT
);
CREATE INDEX idx_coding_sessions_plan ON coding_sessions(plan_id);
CREATE UNIQUE INDEX idx_coding_sessions_thread ON coding_sessions(thread_id);
```

`repository_id` is a stamp, not a foreign key: disconnecting a repository must not damage history. Plan deletion explicitly removes its `coding_sessions` rows before deleting commits, matching the existing visit/verdict cleanup.

Add `apps/server/src/mercurian/codingSessions/schema.ts`, `CodingSessionStore.ts`, and `wire.ts` **(new)**. The store owns row decoding and `record`, `listForPlan`, `listAll`, `getByThreadId`, `updateBranch`, `end`, and `attachPullRequest`. Only `record` and `updateBranch` gain writers in M-110; the end/PR operations establish the leaf-record seam owned by M-114/065. Mutations publish a small `changes` signal after commit.

Add the immutable payload beside the existing commit payload schemas in `PlanningStore.ts`:

```ts
const CodingSessionCommitPayload = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
  planRevisionCommitId: CommitId,
});
```

The parent edge is “the commit it implemented from.” `planRevisionCommitId` is the nearest plan-revision ancestor at or above that parent (splits included: a split _is_ a flavored plan revision carrying its projected repository — Splits, resolved 2026-08). It is required: the implement gate already refuses empty plan text, and non-empty plan text can only come from a plan revision.

Extend `PlanningStore` with one guarded `appendCodingSession` method. It calls `requirePlan` and `requireNoActiveTurn`, resolves the parent and nearest plan revision, then performs `appendAt(kind: "coding-session")` and `CodingSessionStore.record` inside one Mercurian SQL transaction, touches the plan, and announces afterward. This is the final durable step of birth. A second call at the same parent is a legal human fork and produces a sibling leaf.

### 4. One Mercurian-owned birth service coordinates the three durability domains

Add `apps/server/src/mercurian/codingSessions/CodingSessionService.ts` **(new)** and wire its layer in `apps/server/src/server.ts`. The service depends on `PlanningStore`, `CodingSessionStore`, `RepositoryStore`, `ProviderRegistry`, `ProjectionSnapshotQuery`, `OrchestrationEngine`, `GitWorkflowService`, `GitVcsDriver`, the terminal manager (`apps/server/src/terminal/Manager.ts`), `ThreadDeletionReactor`, and the existing server id/time helpers.

Add `mercurian.startCodingSession`:

```ts
type MercurianStartCodingSessionInput = {
  planId: PlanId;
  parentCommitId: MercurianCommitId;
  repositoryId: MercurianRepositoryId;
  baseRef: string;
  startFromOrigin: boolean;
  runtimeMode: RuntimeMode;
  modelSelection: ModelSelection;
};

type MercurianStartCodingSessionResult = {
  commitId: MercurianCommitId;
  threadId: ThreadId;
};
```

Preflight re-reads every client-claimed fact:

- the parent belongs to the plan and has a recorded `ready` verdict;
- verdict repository equals `repositoryId`, still belongs to the plan's project, still exists, and `hasGit` is true;
- `baseRef` resolves to a local branch in that repository;
- `modelSelection.instanceId` names an available, enabled, installed snapshot and that exact snapshot offers the model;
- no planning turn is active; there is deliberately no “session already exists” check.

Expose actionable `CodingSessionBlockedError` reasons for `not-ready`, `repository-mismatch`, `repository-not-in-project`, `repository-not-git`, `base-ref-missing`, `no-instance`, and `model-unavailable`; pass through `PlanTurnActiveError` and ordinary plan/repository not-found refusals. User-facing wording for `not-ready` speaks of the plan not being ready to implement — never “split” or “atomic”. Add the method to contracts/RPC, Operate authorization, `ws.ts`, client runtime's `serialPerPlan` scheduler (`packages/client-runtime/src/state/mercurianPlanning.ts:16`), and `useStartCodingSession`.

After preflight, run this saga:

1. Read the plan text/revision and generate ids plus a descriptive session branch.
2. Resolve the t3code project by `repository.path`, lazily dispatching `project.create` if absent. Give the plumbing project the repository name so its origin is legible in `state.sqlite`.
3. Dispatch `thread.create` with the plan title, chosen model/runtime mode, `interactionMode: "default"`, generated branch, and no worktree path.
4. Resolve the base commit: optionally fetch `origin` and resolve its tracking commit, falling back to the local base when no origin exists; otherwise resolve the local branch commit. Capture this OID for compensation.
5. Create the worktree under `ServerConfig.worktreesDir` (`apps/server/src/config.ts:34`) on the generated branch, dispatch `thread.meta.update` with its real path/ref, and refresh git status.
6. If the Mercurian repository has an `isSetup` script, launch it in a thread terminal before the agent starts, using `projectScriptRuntimeEnv` and the same open/write behavior as `ProjectSetupScriptRunner` (`apps/server/src/project/ProjectSetupScriptRunner.ts`). Record setup activities in the established shape. Launch failure is logged and rendered but does not fail birth, matching upstream bootstrap behavior.
7. Dispatch the first `thread.turn.start` with the exact plan text, no attachments, chosen model/runtime mode, and no bootstrap block.
8. Call `PlanningStore.appendCodingSession` to atomically land the leaf and mutable session row in `mercurian.sqlite`.

The leaf is last because commits are append-only and the product says a leaf is never destroyed. Every earlier step has a compensation; adding a commit-delete exception would weaken the central history invariant.

On any failure or interruption before step 8 commits, cleanup runs in an uninterruptible finalizer in this order and never masks the original cause. After cleanup, the service re-emits that original cause, preserving interruption semantics:

1. dispatch `thread.delete` and wait for `ThreadDeletionReactor.drain`, so provider runtime and terminals stop;
2. force-remove the created worktree through `GitWorkflowService.removeWorktree`;
3. use `GitVcsDriver.execute` from inside `CodingSessionService` for one fixed compare-and-delete command (`git update-ref -d refs/heads/<generated> <captured-base-oid>`).

The branch delete is deliberately not a shared RPC or general workflow method. It can only target the generated `mercurian/` name and only succeeds while the ref still equals the base captured before birth. If it moved, preserve it and log a cleanup-residue warning; potential work wins over the literal no-branch clause. Add no commit deletion anywhere.

### 5. Session branches are descriptive at birth and never enter auto-rename

Add `apps/server/src/mercurian/codingSessions/branch.ts` **(new)**. It imports the existing `sanitizeBranchFragment` (`packages/shared/src/git.ts:26`) but owns its product-specific constant and helper:

```ts
const CODING_SESSION_BRANCH_PREFIX = "mercurian";
// mercurian/<plan-title-slug>-<8 hex>
buildCodingSessionBranchName(planTitle, randomHex);
```

The short suffix prevents siblings/retries from colliding. The name is not the exact temporary shape matched by `isTemporaryWorktreeBranch`, so `ProviderCommandReactor.maybeGenerateAndRenameWorktreeBranchForFirstTurn` (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`) returns early and no LLM ever proposes a second name. This is the structural guarantee that generated naming cannot overwrite a human rename.

`CheckpointReactor.followWorktreeBranchDrift` (`apps/server/src/orchestration/Layers/CheckpointReactor.ts`) already updates thread metadata when a dedicated worktree is checked out onto a human-renamed branch. Add `CodingSessionRecordReactor.ts` **(new)** to consume `thread.meta-updated` events with a branch, find a coding session by thread id, and update its stamped branch. The leaf therefore keeps the human name even after the thread or worktree is gone. Do not teach any upstream temporary-branch matcher about `mercurian/`: this prefix is descriptive, never temporary.

### 6. Contracts and streams keep commits sequenced and side facts keyed

Extend `packages/contracts/src/mercurian.ts` with:

- `PlanCodingSession` and the `coding-session` member of `PlanTimelineItem` (immutable commit facts only);
- `PlanCodingSessionRecord` (thread id, branch, worktree path, base ref, timestamps, outcome, PR URL);
- `PlanDetail.codingSessions` and `PlanTreeRow.codingSessions`;
- a `PlanStreamItem` member `{ kind: "coding-sessions"; sessions: PlanCodingSessionRecord[] }`.

`PlanningStore.toTimelineEvent` decodes `coding-session` and returns a commit event with no `planText`. `getPlanSnapshot` reads sessions beside implement verdicts. `subscribePlan` attaches `CodingSessionStore.changes` before its opening read and always emits a complete `coding-sessions` side-fact frame, including on cursor resume; subsequent session changes re-read only that plan's small session list. The frame is an idempotent keyed snapshot, not a fake commit sequence. `planReducer.ts` (`packages/client-runtime/src/state/planReducer.ts`) maintains `codingSessions` as a commit-id map and tolerates the side frame arriving before the corresponding commit.

The tree subscription similarly attaches `CodingSessionStore.changes` and loads `listAll` beside the planning snapshot/status. `planning/wire.ts` groups sessions by plan, includes the compact session records on each row, and sets `isWorking` when either the planning assistant is working or a session has no `endedAt`. It does **not** query `ProjectionSnapshotQuery.getThreadShellById` per session and does not subscribe to all orchestration events. M-114 owns pending approvals/questions and will compose those thread-derived flags at the already-reserved read-layer seam once it introduces them.

### 7. The leaf renders everywhere, while planning acts from its parent

Update the web surfaces that already consume `PlanTimelineItem`:

- `PlanTimeline.tsx`: render a compact session card with repository, implemented revision, running/ended outcome, branch, and PR link when present. Use structured fields only; no generated summary. “Open session” is visibly deferred/disabled until 063/064 supplies a route.
- `PlanGraph.logic.ts`: add the session summary/detail case.
- `DagExplorer.tsx`: give `coding-session` its own terminal glyph so leaf nodes read differently from interior plan revisions, in the row, the node popover, and the graph.
- Thread/columns/graph helpers continue to derive edges from the common commit fields, so the parent edge makes the leaf appear automatically.

Do not make `resolveHead` hide the leaf: selecting it must still show its card and, later, open the inspectable session. Instead add a pure `resolveActingHead(graph, viewedHead)` in `PlanPosition.logic.ts`. For a coding-session node it returns the node's sole parent; otherwise it returns the viewed head. `PlanningSpace` uses the viewed head for the visible timeline/DAG and the acting head for composer sends, plan edits, and Implement. While a leaf is selected, show a banner that new planning continues from the commit before the session and keep the artifact read-only until the user takes that parent continuation. The store refusal remains the final backstop.

The current flat sidebar must stay dense. `PlanListSidebar.tsx` does not gain nested rows or a third card line. Its `SidebarPlanTooltip` detail popover lists each coding session beneath the existing plan facts (repository, running/ended status, branch), and `resolvePlanCardStatus` continues to render the row's rolled-up `isWorking`/unseen status. This follows the current **Left Sidebar** design — “what a plan's coding sessions are doing joins [the popover] when coding sessions land under plans, rather than growing the card back into multiple lines” — not the stale “project tree” wording still present in **Coding Sessions**.

### 8. Documentation and surface accounting

- `docs/user/projects-and-plans.md`: add the draft choices, local-vs-origin base, first-turn birth, isolated worktree/branch, retry behavior, and parent continuation.
- `docs/internals/glossary.md`: add coding session, coding-session leaf, session branch, and the t3code-thread link; update repository live-worktree wording.
- `docs/internals/overview.md`: document the immutable payload/keyed-record split and the saga across the two databases plus git.
- Web and desktop apply: desktop wraps web and shares the server. Local and remotely paired web clients use the same RPC and server-side path; no origin is baked into the bundle. Mobile is parked by ADR 004 and remains untouched. Provider behavior is uniform because all providers enter through the existing exact-instance orchestration model.

## Implementation Checklist

- [ ] Work on `venk/m-110-coding-sessions-draft-leaf-commit-worktree-birth` from `00ecd5df8`.
- [ ] Add migration 010 and its manifest/schema test; leave the existing commit-kind CHECK unchanged.
- [ ] Add `mercurian/codingSessions/{schema,CodingSessionStore,wire,branch,CodingSessionService,CodingSessionRecordReactor}.ts` and focused tests.
- [ ] Extend `PlanningStore` with the coding-session payload decoder/projector, nearest-revision read, guarded transactional `appendCodingSession`, snapshot join, and plan-delete cleanup.
- [ ] Add `startCodingSession` contracts/RPC/result/refusals, Operate authorization, `ws.ts` handler, client-runtime command, and web hook.
- [ ] Wire `CodingSessionStore` and the birth/record-reactor layers in `server.ts`; merge its change signal into tree and plan subscriptions.
- [ ] Add the Mercurian-local branch helper and fixed CAS cleanup command; do not add a public/general branch-delete RPC.
- [ ] Add `codingSessionDraftStore.ts`, its pruning/stickiness tests, and `codingSessionDraft.logic.ts`.
- [ ] Add `CodingSessionDraftSheet.tsx`; use repository path + existing VCS query machinery for local base refs and reuse existing instance/model derivation utilities.
- [ ] Activate M-107's ready callback, add per-landed-plan Start plus Start all, and preserve Implement for retries.
- [ ] Extend `PlanTimeline`, `PlanGraph.logic`, `DagExplorer`, `PlanPosition.logic`, and `PlanningSpace` for leaf rendering and parent-only planning continuation.
- [ ] Add sessions to the sidebar's detail popover and roll running state into the existing plan-card status without changing one-line card geometry.
- [ ] Keep all user-facing wording in readiness vocabulary; “split”, “atomic”, and internal error tags never render.
- [ ] Add the three documentation updates; do not edit the product vault as part of this implementation issue.
- [ ] Do not touch `apps/mobile`, invent a second provider runtime, add commit deletion, route the session screen, implement later turns/approvals, create PRs, tear down successful worktrees, or build the M-109 freshness warning.
- [ ] Commit in coherent slices, for example: `feat(server): coding sessions are born with a leaf and worktree (M-110)`, `feat(web): shape and start coding sessions from plans (M-110)`, `docs: coding-session birth (M-110)`.

## Test Plan

Use targeted `vp test run <files>` plus targeted package typecheck/lint. Server async tests use fake services and receipts/worker drains; no sleeps.

- [ ] `CommitStore.test.ts`: appending any human or assistant commit onto a `coding-session` parent fails with `CodingSessionParentError`; sibling coding sessions at the same parent remain legal.
- [ ] Migration 010 test: table, indexes, outcome CHECK, non-FK repository stamp, manifest id 10, and the existing four-kind commit CHECK.
- [ ] `CodingSessionStore.test.ts`: record/list/get-by-thread, branch update, end/PR updates, plan deletion cleanup, and repository disconnection tolerance.
- [ ] `PlanningStore.test.ts`: coding-session leaf + row land in one Mercurian transaction; payload stamps repository and nearest revision (including a split revision as the nearest); no `planText` rides the event; plan text remains unchanged; two leaves can share a parent; an active planning turn refuses the write.
- [ ] `CodingSessionService.test.ts` happy path: exact ready verdict/repository/model validation; lazy t3code project; thread; local or origin base; descriptive branch/worktree; setup launch before turn; first turn receives exactly the plan text; leaf is last.
- [ ] Birth compensation matrix: failures at project/thread creation, fetch/base resolution, worktree creation, metadata update, turn start, and leaf transaction leave no leaf/session row/thread/worktree; when the generated branch still equals the captured base, CAS cleanup removes it.
- [ ] Compensation safety: if the branch moved before cleanup, the CAS delete refuses, the branch survives, and a cleanup-residue warning is recorded; interruption runs the same uninterruptible cleanup, then remains an interruption.
- [ ] Setup-script tests: no setup is a no-op; launch writes the repository command in the new worktree before turn dispatch; launch failure records/logs and does not fail birth; thread deletion closes the terminal during compensation.
- [ ] Provider tests: unknown/unavailable/disabled/uninstalled instance → `no-instance`; model absent from that exact instance → `model-unavailable`; sibling retry may choose a different valid selection.
- [ ] Branch tests: `mercurian/<slug>-<token>` sanitizes/truncates, avoids collisions, is never `isTemporaryWorktreeBranch`, and therefore triggers no first-turn generated rename; branch-drift events update the keyed record.
- [ ] `codingSessionDraft.logic.test.ts`: ready verdict fixes repository; local base + origin toggle seed correctly; only three supported modes; exact instance grouping; sticky/fallback behavior; start payload contains every editable field.
- [ ] `codingSessionDraftStore.test.ts`: one draft per `(plan, commit)`, separate sibling drafts, corrupt storage ignored, successful Start updates stickiness/discards the draft, and missing plans are pruned.
- [ ] `SplitSheet.test.tsx`: ready action opens a draft; each confirmed repository row can start; Start all invokes once per landed plan; product copy still exposes neither “split” nor “atomic.”
- [ ] `planReducer.test.ts`: snapshot and `coding-sessions` side frames replace the keyed map idempotently, including frame-before-commit and resume cases; coding-session commits advance sequence without changing plan text.
- [ ] `PlanTimeline.test.tsx`: structured repository/revision/outcome/branch/optional PR facts render; no generated summary field exists.
- [ ] `PlanGraph.logic.test.ts`, DAG tests, and `PlanPosition.logic.test.ts`: session glyph/summary, leaf edge, viewed leaf remains visible, acting head is its parent, and sends/edits never target the leaf.
- [ ] `PlanListSidebar` tests: plan cards remain one line; the detail popover lists sessions; a running session rolls the plan to Working; a plan with no sessions renders byte-for-byte as before; no per-session thread-shell query is introduced.
- [ ] Authorization coverage includes `startCodingSession`; contracts round-trip new payloads and refusals.
- [ ] On explicit request, one `test-t3-app` integrated pass: open a ready draft, edit every choice, close/reopen it, verify no server/disk artifacts, Start and see one leaf/worktree/branch, select the leaf and send from its parent, rename the branch and see the record follow it, then start a sibling retry with another model. Do not launch a browser without permission.

---

_Backlog: `backlog/061-coding-session-birth.md` · Phase 6 — Splits and coding sessions._
