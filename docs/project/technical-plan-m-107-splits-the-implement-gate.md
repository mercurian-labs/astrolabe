# Technical Plan — M-107: Splits: the implement gate

_Generated from the Goal/AC of Linear issue M-107 (rescoped 2026-08-11; see the issue for the full AC). Supersedes the prior plan on this issue (`docs/project/technical-plan-m-107-technical-plans.md`, still present on the branch) — the derived-layer design it implemented is retired; splits are flavored plan revisions, per the resolved decisions on the almagest vault's "Splits" note. Plan authored 2026-08-11 against main @ `0191196d1`, with the unmerged branch `venk/m-107-technical-plans` (5 commits, +2831/−66 across 44 files) as the rework base. Design sources: vault notes Splits (four resolutions, 2026-08), Plans ("atomic"), Commit Tree, Coding Sessions, Composer, Technical Plans (superseded record). ADRs 001/002/004 apply unchanged; this plan needs zero edits in upstream-owned files._

**Goal, in one sentence:** one verb — **implement**, from any commit — behind a gate: an agent analysis turn answers "is the plan here atomic?"; atomic hands off toward a coding session (M-110's seam), multi-repo produces a **split sheet** of per-repository projections the user edits and confirms, and confirmation — the human act — lands each split as a sibling **plan-revision commit** flavored with the repository it projects onto. No new commit kind, no migration, nothing lands without the user's confirmation.

**Scope fences:** the session draft that opens after the gate is M-110's (this plan builds the seam, not the draft); the node popover is M-129's; the split-merge path is deliberately absent (resolved).

> **Amended 2026-08-12 — read [Addendum](#addendum-2026-08-12--readiness-recorded-verdicts-no-navigation-on-confirm) first.** The first live run of the gate produced three vault resolutions (almagest `b943cdd`: "Splits", with consequent touches on "Plans", "DAG Explorer", "Issue Planning Flow"). They change the gate's verdict handling, where confirmation leaves you, and every user-facing word. §§2–5 below are superseded where the addendum says so; §1's payload and plan-text rules stand unchanged.

## Base strategy: rework the branch, don't restart

The old implementation is fully landed on `venk/m-107-technical-plans` (server + web + tests). Roughly 60% survives reshaped; the rest is removed. Work continues on a new branch `venk/m-107-splits-the-implement-gate` cut **from the old branch** (Linear's branch name for the rescoped issue), so the reusable machinery keeps its history and the removals are honest commits.

**Removed outright:** migration `009_TechnicalPlanCommitKind` + its test (never merged, so simply deleted — `migrationEntries` returns to 8, `mercurian/persistence/Migrations.ts:24-33`); the `technical-plan` member of `CommitKind` (`mercurian/commitTree/schema.ts`); `PlanTechnicalPlan`, the `technical-plan` timeline variant, `getTechnicalPlanAt` (contracts, RPC, auth entry, store method, wire, hook); `TechnicalPlanDerivationBlockedError`; `deriveTechnicalPlan` RPC; `saveTechnicalPlan` (store); `save_technical_plan` (MCP tool); `TechnicalPlanDialog.tsx`, `technicalPlans.logic.ts`, the `DeriveMenu` in `PlanArtifact.tsx`, the stale badge, and their tests; the `sourceRevisionCommitId` stamp everywhere.

**Survives reshaped:** the `flavor` field on `PlanTurnRegistry.ActivePlanTurn` and `TurnRuntime` (`"derivation"` → `"implement"`); the sync-refusal preflight of `startDerivation`; the one-shot provider session with `runtimeMode: "approval-required"`, auto-answered questions, `stopRequested`, no `turn-delta`, and `stopSession` at settle; the pending-document MCP door pattern (last call wins, validated at settle); the reducer's turnId-routed `turn-grounding`; `GroundingFold`'s write-tool filter; the `derivation-*` frame plumbing (renamed `implement-*`, reshaped payloads).

**The pivotal semantic change:** on the old branch, settle **landed the commit**. Now settle only publishes a **proposal**; the only write path to history is the human `confirmSplits` RPC. All-or-nothing becomes: nothing at settle, everything at confirm.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                      | Confidence |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| Commit payloads are opaque full snapshots, decoded with Schema; kind-specific payload schemas live in `PlanningStore.ts` beside the feature that writes them; optional fields are the extension mechanism (`MessageCommitPayload`'s `interrupted?`, `grounding?` — `PlanningStore.ts:71-85`) — so flavoring `PlanRevisionCommitPayload` (`:95`, today `{text}` only) needs **no migration** | `PlanningStore.ts:71-112`                                                     | High       |
| Timeline items are constant-size on the wire: `PlanRevision` carries no text (`contracts/mercurian.ts:229-237`); artifact text crosses once as `PlanDetail.planText` and as `planText` on `commit` events "only when this commit changed the artifact" (`:330-336`); historical text via `getPlanTextAt`                                                                                    | contracts + `PlanningStore.toTimelineEvent:944-950`, `derivePlanText:641-649` | High       |
| A fork is nothing special: "a commit that already has a child is a legal parent: that append _is_ the fork" (`PlanningStore.ts:423-424`); human appends hardcode `authorKind:"human"` in `appendAt` (`:1231`); assistant structural writes are refused in `CommitStore`                                                                                                                     | `PlanningStore.ts:1190-1240`                                                  | High       |
| Human write paths (`appendMessage:1260`, `savePlanRevision:1290`) consult `requireNoActiveTurn` (`PlanTurnActiveError`); assistant writes don't; mutations are one `sql.withTransaction` + `touchPlanRow` inside, `announceChange` after                                                                                                                                                    | `PlanningStore.ts:1248-1311`                                                  | High       |
| ws handler shape: `observeRpcEffect` + scope from `RPC_REQUIRED_SCOPES` (reads→Read, mutations→Operate; coverage test enforces), server-minted `DateTime.now`, refusals pass through, the rest wraps in `MercurianPlanningError{operation}`, tag `"rpc.aggregate":"mercurian"`                                                                                                              | `ws.ts:1690-1714`, `auth/RpcAuthorization.ts:36-48`                           | High       |
| Assistant turn machinery: registry claim = one turn per plan (`PlanTurnRegistry.ts:33-86`); frames via `publishFrame`; multi-root grounding via `buildRebuildMaterials` (`cwd` + `additionalDirectories`, `groundingScope` when a `cwd`-only provider narrows — `PlanningAssistant.ts:529-592`); model via `resolvePlanningModel` with `unset`/`no-instance`/`model-unavailable`            | `PlanningAssistant.ts:636-796`                                                | High       |
| MCP door routing: thread→turn via `registry.getByThread`; flavor enforcement in handlers, not the approval layer (branch comment: "a reply turn calling save_technical_plan is still refused server-side")                                                                                                                                                                                  | `mcp/toolkits/planning/*`, branch diff §7.5                                   | High       |
| Client layer: reducer folds `PlanStreamItem`s with a monotonic `sequence` guard and `withInFlightX` helpers; commands in `mercurianPlanning.ts` on the shared write scheduler with `serialPerPlan`; one-line hooks in `apps/web/src/state/mercurian.ts` via `useEnvironmentBoundCommand`                                                                                                    | `planReducer.ts`, `mercurianPlanning.ts:16-148`                               | High       |
| Web components: pure logic in co-located `*.logic.ts` + tests; dialogs on `ui/dialog` primitives with caller-owned `open` state (`ImportIssueDialog` precedent); component tests are `renderToStaticMarkup` + `toContain`, `vi.mock` for hooks, all on `vite-plus/test`                                                                                                                     | `components/mercurian/*`, `ImportIssueDialog.tsx:49-61`                       | High       |
| Composer action rail is `justify-between` with an empty left side (`PlanComposer.tsx:314-351`) — the natural seat for the implement action; notices dock above the editor (`banner`/gate/refusal, `:247-258`)                                                                                                                                                                               | `PlanComposer.tsx`                                                            | High       |
| Position semantics: `PlanningSpace` tracks `PlanPosition`, `head = resolveHead(...)`, acts carry `parentCommitId: head`; `visibleInFlight` filters by `ancestorClosure`                                                                                                                                                                                                                     | `PlanningSpace.tsx:167-243`                                                   | High       |
| Docs per AGENTS.md §Hit every surface; plans in `docs/project/technical-plan-*.md`; conventional commits `feat(scope): … (M-107)`; tests co-located, `vp test run <files>` only                                                                                                                                                                                                             | AGENTS.md, `docs/project/`, `git log`                                         | High       |

## Design

### 1. A split is a flavored plan revision — payload, wire, and what it does to plan text

`PlanRevisionCommitPayload` (`PlanningStore.ts:95`) widens by one optional field:

```ts
export const PlanRevisionCommitPayload = Schema.Struct({
  text: Schema.String,
  /**
   * Present when this revision is a split: the plan projected onto one
   * repository at the implement moment. Name is record, not link —
   * histories survive repository removal. Absent on ordinary revisions.
   */
  split: Schema.optional(
    Schema.Struct({
      repositoryId: MercurianRepositoryId,
      repositoryName: TrimmedNonEmptyString,
    }),
  ),
});
```

Old rows decode unchanged; **no migration, no schema surgery** — the branch's rebuild recipe is deleted, and M-94's "features land without schema surgery" promise is restored. The wire `PlanRevision` (`contracts/mercurian.ts:237`) gains the same optional `split` struct — constant-size, so the timeline discipline holds.

**A split never changes the artifact of the line you're standing on.** `toTimelineEvent`'s plan-revision branch (`PlanningStore.ts:944-950`) forks on the flavor: an ordinary revision emits `planText` as today; a split emits its item (with `split`) and **no `planText`**. `derivePlanText` (`:641`) then skips splits by construction, so the snapshot's current text never jumps to a sibling branch's projection at confirm time. On the split's own branch the projection _is_ the plan, and that already falls out of `getPlanTextAt` (`:1547-1574`): it walks ancestors to the first `plan-revision`, and a split is one — standing on a split branch shows the projected plan, refinable by ordinary planning (AC 6), with zero new machinery.

### 2. The gate: `tryImplement` starts an analysis turn

New RPC `mercurian.tryImplement` `{planId, repositoryless — no repo is chosen at try, parentCommitId?}` → `MercurianPlanAcknowledged`; the stream carries everything after. Like the branch's `startDerivation` and unlike `startTurn`, it **refuses synchronously**: `PlanNotFoundError`, `PlanTurnActiveError` (registry claim, shared across flavors — one live thing per plan), and a new `ImplementBlockedError { reason: "plan-empty" | "model-unset" | "no-instance" | "model-unavailable" }` (the branch's error class minus `repository-not-in-project` and `up-to-date`, both meaningless now). `plan-empty` reads from a slimmed store read `getImplementContext({planId, atCommitId?}) → {atCommitId, planText}` — the branch's `getDerivationContext` with the stamp and per-repo map deleted.

The turn is a third flavor of the one turn machinery: `flavor: "implement"` on `ActivePlanTurn` and `TurnRuntime`. The session opens with **planning's full multi-root grounding** — this is the significant reversal of the branch's single-root choice, forced by the design: coverage analysis must see every repository the plan might touch, and projection generation needs them all in one turn. Reuse `buildRebuildMaterials`' repository/capability/narrowing logic (`PlanningAssistant.ts:539-561`): `cwd` = first project repository, `additionalDirectories` = the rest, `groundingScope` when a `cwd`-only provider narrows (the narrowing is visible on the analyzing card, the existing "grounding is visible" move; a narrowed provider's coverage verdict is honest about what it could see). Everything else rides the branch's derivation session shape unchanged: fresh one-shot session, `runtimeMode: "approval-required"`, `isolateProviderSettings`, questions auto-answered `{}`, no `turn-delta`, `stopRequested`, `stopSession` at settle.

**Prompt** (`PlanningPrompt.ts`, replacing `derivationTurnInput`): `implementTurnInput({repositories, planText})` — the project's repositories by exact name; the plan text as of the try commit; instructions: decide which of the named repositories this plan requires work in; if exactly one, call `save_implement_proposal` with just that repository and no splits; if several, also project the plan onto each — self-contained, in plan register, carrying what that repository's implementation needs and nothing another repository owns — plus a one-line rationale for the cut; call the tool with the complete result (last call wins), never edit files or the plan, never ask questions.

**The MCP door** (`mcp/toolkits/planning/`, replacing `save_technical_plan`): `save_implement_proposal({ repositories: string[], rationale?: string, splits?: [{repository: string, text: string}] })`. The handler routes thread→turn and refuses unless the claim's flavor is `implement` (and `save_plan_revision` refuses implement turns — an analysis must not workshop the plan; the branch's two-sided flavor gate, reshaped). The call only sets `turn.pendingProposal`; nothing lands. `read_plan` serves all flavors unchanged. `GroundingFold.isPlanningWriteTool` swaps in the new tool name.

**Settle validates, then publishes — never commits.** On `turn.completed`, the pending proposal is validated: every named repository resolves by exact, unique name to a project repository; coverage of one → verdict **atomic**; coverage of several → `splits` must exist for exactly the coverage set. Valid → publish `implement-analyzed` and retain the proposal (§3). Invalid or absent → `implement-failed` with `"invalid-proposal"` / `"no-proposal"`; stop → `"stopped"`; abnormal end → `"provider-error"`. In every case the claim closes, the session stops, and **history is untouched** — the branch's all-or-nothing ladder (`settleDerivation`, diff §7.3) with the commit write replaced by a publish.

### 3. The proposal: transient, server-held until confirmed

Contracts (`packages/contracts/src/mercurian.ts`), all additive after the branch's removals:

```ts
PlanSplitProposal    = { repositoryId, repositoryName, text }
PlanImplementVerdict = { kind: "atomic", repositoryId, repositoryName }
                     | { kind: "needs-split", rationale?: string,
                         splits: NonEmptyArray(PlanSplitProposal) }
PlanImplementProposal = { turnId, parentCommitId, verdict: PlanImplementVerdict }
PlanInFlightImplement = { turnId, parentCommitId, grounding: Array(PlanGroundingItem) }
```

`PlanDetail` gains `inFlightImplement?` and `implementProposal?` (the `inFlightTurn` snapshot-join precedent — a window opening mid-analysis or mid-sheet sees the truth). `PlanStreamItem` gains `{kind:"implement-started", implement: PlanInFlightImplement}`, `{kind:"implement-analyzed", proposal: PlanImplementProposal}`, `{kind:"implement-failed", turnId, reason: Literals(["no-proposal","invalid-proposal","stopped","provider-error"])}`. Proposal texts ride the frame whole — frames are transport (ADR 002 §3), the documents are plan-sized, and nothing here persists.

The assistant holds `proposals: Map<PlanId, PlanImplementProposal>` (beside `sessions`). A proposal is cleared by: `confirmSplits` success, the new `mercurian.cancelImplementProposal` RPC (the sheet's Cancel — also what makes "cancelled lands nothing" a server truth), any subsequent `startTurn` or `tryImplement`, and `teardownPlan`. Nothing expires it on a clock — a draft costs nothing and "nothing exists until its first commit" already names its standing.

### 4. Confirmation is the human act: `confirmSplits` lands sibling revisions

New RPC `mercurian.confirmSplits` `{planId, parentCommitId, splits: [{repositoryId, text}]}` → the landed commit ids. The client sends the **edited card texts** — the sheet is the overrule, so the server takes what the user confirmed, not what the agent proposed. New store method:

`saveSplits({planId, parentCommitId, splits, createdAt}) → PlanRevision[]` — a **guarded human write**, symmetric with `savePlanRevision`: `requirePlan`, `requireNoActiveTurn` (unlike the branch's guard-exempt `saveTechnicalPlan` — confirmation is not a turn's write, it's a person's), then validation: non-empty, no duplicate repository, every `repositoryId` linked to the plan's project (resolving `repositoryName` from `RepositoryStore` **at land time** — record-not-link, stamped by the server, so the RPC never carries a name to lie about). Refusals: a new `ConfirmSplitsBlockedError { reason: "no-splits" | "duplicate-repository" | "repository-not-in-project" }` beside the pass-throughs; an unknown parent surfaces as today's `CommitNotFoundError`→`MercurianPlanningError` wrap, matching `savePlanRevision`.

The write is one `sql.withTransaction`: for each split, append kind `"plan-revision"` with payload `{text, split:{repositoryId, repositoryName}}` via the existing `appendAt` (`authorKind:"human"` hardcoded — the commits are yours; parent = the same `parentCommitId` for every split, so they land as **sibling branches**, and appending onto a commit with children is already the store's one legal fork). `announceChange` once; each commit streams as its own `commit` event (no `planText`, §1). The ws handler then clears the assistant's proposal. All-or-nothing across the N appends is the transaction.

**One live thing per plan** (AC 8's second clause) holds by composition: the analysis turn holds the registry claim; `confirmSplits` is guarded by it; a reply turn blocks `tryImplement` and vice versa.

### 5. Client: reducer, hooks, and the two new surfaces

**Reducer** (`packages/client-runtime/src/state/planReducer.ts`): state gains `inFlightImplement`, `implementProposal`, and transient `implementFailure` (the branch's `derivationFailure`, renamed). Folding mirrors the branch exactly: `implement-started` sets the in-flight (clearing failure), `turn-grounding` routes by turnId across `inFlightTurn`/`inFlightImplement` (branch precedent), `implement-analyzed` clears the in-flight and sets `implementProposal`, `implement-failed` clears and records the reason, `snapshot` replaces wholesale, `turn-started`/`implement-started` clear a stale proposal (the server cleared its copy; the fold agrees). Split commits append like any commit and never touch `planText`.

**Commands/hooks**: `tryImplement`, `confirmSplits`, `cancelImplementProposal` in `mercurianPlanning.ts` (write scheduler, `serialPerPlan`), one-line hooks `useTryImplement` / `useConfirmSplits` / `useCancelImplementProposal` in `apps/web/src/state/mercurian.ts`. The branch's `useDeriveTechnicalPlan`/`useGetTechnicalPlanAt` go.

**The implement action** sits on the composer's action rail left side (`PlanComposer.tsx:314` — currently empty; the vault: "the implement act lives here too… the gate, and any splits, apply at the commit where you stand"). A ghost button, `HammerIcon` + "Implement": disabled while `turnActive` (either flavor), in draft spaces, or when the plan text at the position is empty (client pre-check; the server refuses authoritatively). Pressing calls `tryImplement({planId, parentCommitId: head})` — act-from-anywhere for free, and the `DeriveMenu` leaves the artifact header, which returns to main's shape.

**The analyzing card** (in `PlanTimeline.tsx`, the branch's deriving card reshaped): while `inFlightImplement` is visible on the rendered path (`visibleInFlight` closure precedent in `PlanningSpace.tsx:237-243`), a quiet bordered card — Spinner, "Working out where this plan implements…", live `GroundingFold`, Stop — and the composer treats it as `turnActive`. Failures surface through the composer notice slot via `implementFailureNotice` in `PlanComposer.logic.ts` (branch's `derivationFailureNotice` reworded; `invalid-proposal`/`no-proposal` → "The assistant couldn't produce a usable analysis; nothing landed.").

**The split sheet** — `SplitSheet.tsx` **(new)**, on the `ui/dialog` primitives with caller-owned open state (`ImportIssueDialog` precedent). `PlanningSpace` renders it when `detail.implementProposal !== undefined`. Contents by verdict:

- **atomic** — the terminal state this issue owns of M-110's moment: repository name, "This plan is atomic — it implements in _{repositoryName}_.", and a single primary action that is the M-110 seam — rendered disabled with "Coding sessions arrive next" until M-110 lands (the seam is a `onOpenSessionDraft?: (input) => void` prop the sheet invokes when wired). Dismissing cancels the proposal.
- **needs-split** — the agent's one-line rationale, then one card per proposed split: repository name, the projected plan in an editable textarea (`PlanArtifactEditor`'s pattern), a remove action. Cards for repositories that **already have a split child at this commit** render as already-split rows instead — repository name, "Already split — jump to it", navigating via the existing `onSelect` — never a fresh editable card (the resolved return path; detection is pure client logic over the graph, §below). Footer: Cancel (→ `cancelImplementProposal`) and **Confirm** — "Land N splits", or "Land split" with one card remaining (the overrule's collapse: one landed split is that repository's implement base). Confirm sends the current card texts to `confirmSplits`; on success the sheet closes and the fork is visible in the timeline and DAG.

**`splits.logic.ts` (new, pure, tested)** beside `PlanGraph.logic.ts`: `existingSplitsAt(graph, commitId)` (children of the commit whose item is a split-flavored revision, per repository), `partitionProposal(proposal, existing)` (cards vs. already-split rows), `confirmPayload(cards)` (drop removed, trim, validate non-empty), `implementDisabledReason({turnActive, planTextEmpty, isDraft})`.

**Timeline row and graph reading:** the plan-revision fallthrough row (`PlanTimeline.tsx:162-175`) gains the flavor: `item.split` → "You split the plan for _{repositoryName}_" (splits are always human). `planCommitSummary` (`PlanGraph.logic.ts:289-302`) gains the same case ("Split for {repositoryName}"). The glyph map (`DagExplorer.tsx:1742-1750`) is **deliberately untouched** — a split draws as a plan revision, per "no new kind"; saying "split" is the label's and (later) M-129's job.

### 6. Docs (AGENTS.md §Hit every surface)

`docs/user/projects-and-threads.md`: the branch's "Technical plans" section becomes "Implementing a plan" — the implement action, the gate, atomic plans, the split sheet, editing and deleting cards, splits as ordinary plan branches, nothing lands without confirming. `docs/internals/glossary.md`: **Atomic plan**, **Split**, and **Implement gate** entries replace the branch's Technical plan/Derivation entries; the Commit kinds list stays at four. `docs/internals/overview.md`: the derived-layer clause becomes the implement-gate clause.

## Addendum (2026-08-12) — readiness, recorded verdicts, no navigation on confirm

_Authored after the first live AC walk of the gate on this branch (tip `dedabf27b`, `origin/main` merged at `5630c9976`). Design source: almagest `b943cdd` — "Splits" gains three resolutions dated 2026-08-12 ("What does the product call a plan that can implement?", "Where does confirming leave you?", "Is a readiness verdict remembered?"), with consequent touches on "Plans", "DAG Explorer" and "Issue Planning Flow". Everything below supersedes the referenced section; unreferenced sections stand._

**What changes, in one sentence:** a readiness verdict becomes a recorded fact about a commit — badged where the commit renders and short-circuiting a second try — the ready verdict lands **no commit at all**, confirmation lands the branches and **leaves you where you tried from** with the branches offered as jumps, and no surface says "split" or "atomic" ever again.

### A1. The verdict is recorded on the commit that earned it (new; supersedes §3's "transient, server-held")

History above a commit never changes, so a verdict about a commit cannot go stale for that commit. The in-memory `proposals` map stays exactly as it is — it holds the _sheet's_ pending state — and gains a durable sibling that holds the _answer_.

**Migration `009_PlanImplementVerdicts`** (`migrationEntries` returns to 9; the manifest test asserts 9). Modelled on `006_PlanVisits.ts` — a keyed table beside the commit rather than a column on it, because a verdict is not a fact about what a commit _is_, and absence carries meaning (never evaluated):

```sql
CREATE TABLE IF NOT EXISTS plan_implement_verdicts (
  commit_id    TEXT PRIMARY KEY REFERENCES commits(commit_id),
  plan_id      TEXT NOT NULL REFERENCES plans(plan_id),
  kind         TEXT NOT NULL CHECK (kind IN ('ready', 'needs-split')),
  payload_json TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_implement_verdicts_plan
  ON plan_implement_verdicts(plan_id);
```

`payload_json` follows the store's opaque-payload convention, decoded with Schema beside the feature that writes it (`PlanningStore.ts`, next to `PlanRevisionCommitPayload`): `ready` carries `{repositoryId, repositoryName}`; `needs-split` carries `{repositories: [{repositoryId, repositoryName}], rationale?}` — the coverage set, which is what makes A4's jump-only path deterministic. Names are records, not links, exactly as the split stamp is. `deletePlan` gains a `DELETE FROM plan_implement_verdicts WHERE plan_id = ?` beside the existing `plan_visits` delete (`PlanningStore.ts:937`).

New store methods: `recordImplementVerdict({planId, commitId, verdict, recordedAt})` (idempotent — `INSERT … ON CONFLICT(commit_id) DO NOTHING`, because the verdict for a commit is immutable once known) and `listImplementVerdicts({planId})`.

**Who writes one.** Settle writes the verdict it just computed, before publishing. `saveSplits` writes a `ready` verdict for **each split it lands, inside the same transaction** — splits are born ready, since a split covers one repository by construction — which is what makes implementing a split cost no evaluation at all.

### A2. Readiness crosses the wire as a keyed side-fact, and is badged (new)

A verdict is recorded _after_ its commit exists, so it cannot ride the commit payload, and timeline items must stay constant-size. It crosses as its own keyed collection, the way `PlanTreeRow` joins `visitedAt`:

```
PlanImplementReady = { commitId, repositoryId, repositoryName }
```

- `PlanDetail` gains `readyCommits: Schema.Array(PlanImplementReady)` — every ready verdict in the plan, joined in `getPlanSnapshot` from one `listImplementVerdicts` read (not per-commit lookups in `toTimelineEvent`).
- `PlanStreamItem` gains `{kind: "implement-ready", ready: PlanImplementReady}`, published when a verdict is recorded: once at settle, and once per split at confirm.
- The reducer keeps a `readyCommits` map keyed by commitId; `snapshot` replaces it wholesale, `implement-ready` inserts.

Only `ready` verdicts cross. A `needs-split` verdict is server-side machinery for A4's short-circuit and has nothing to badge — "not ready yet" is the absence of a badge, not a mark of its own.

**Where the badge renders:** the plan-revision and message rows in `PlanTimeline.tsx`, and `DagExplorer`'s thread rows and graph nodes (the three `planCommitSummary` call sites at `DagExplorer.tsx:1362,1424,1832` are where a row's accessible label is built — the badge is a sibling element, not a change to the summary string). Copy: **"Ready to implement"**. The node popover's version of it is M-129's; this plan supplies the fact it will read.

### A3. A ready verdict lands nothing — the commit tried from _is_ the base (supersedes §5's atomic sheet state)

Already true mechanically: settle publishes, never commits. What the resolution adds is the governing rule and its one interpretation, both of which belong in the code's comments because the next case has to decide itself: **a node exists only when its content differs from its parent.** A plan already covering one repository needs no projection, so writing one would put a copy of the plan beside the plan.

The interpretation that needed stating: **narrowing a multi-repository proposal down to one card still lands a node.** That card's text is a projection — content that differs from the parent — so `confirmSplits` with a single split is unchanged, and the session's brief is the projection rather than the multi-repository plan it came from. The no-node rule governs the gate's own verdict, where nothing was projected at all.

The ready sheet therefore says the session will hang off `proposal.parentCommitId` (the commit tried from) and offers only the M-110 seam and a dismiss.

### A4. Trying again short-circuits (new; changes `tryImplement`'s preflight)

`tryImplement` consults the recorded verdict for the resolved `atCommitId` before it resolves a model or opens a session:

1. **A `ready` verdict exists** → publish `implement-analyzed` immediately with an `atomic` verdict built from the record. No registry claim, no provider session, no wait.
2. **A `needs-split` verdict exists and every repository in its coverage set already has a split child at this commit** → publish `implement-analyzed` immediately with the new `already-covered` verdict (below). Nothing is left to project, so no agent is needed.
3. **Otherwise** → the analysis turn exactly as §2 describes; settle records the verdict (A1) and publishes.

Both short-circuits mint a `PlanTurnId` for the proposal's identity and claim nothing — nothing is running. Two consequences to get right:

- **The reducer's `implement-analyzed` fold currently drops a proposal whose `turnId` has no matching `inFlightImplement`** (`planReducer.ts`, the `implement-analyzed` case returns state unchanged when the in-flight is absent or mismatched). A short-circuit has no in-flight, so this fold must accept a proposal with no in-flight and only reject one that contradicts a _different_ live turn.
- The synchronous refusals (`plan-empty`, model reasons, `PlanTurnActiveError`) still apply to case 3. A short-circuit needs no model, so **`model-unset` must not block a commit already known ready** — the check moves after the verdict lookup.

`PlanImplementVerdict` gains a third member for case 2, whose repositories are all already covered and therefore carry no projected text:

```
| { kind: "already-covered", repositories: NonEmptyArray({repositoryId, repositoryName}) }
```

### A5. Confirming lands the branches and leaves you where you were (supersedes §5's `onConfirm`)

The live run made the cost concrete: with two branches landed there is no non-arbitrary one to ride onto, `advance` took the first-born, and an edit meant for the parent line landed as a child of the beta-web projection and overwrote it. Landing structure and going somewhere are two acts.

`PlanPosition.logic.ts` already names the fix in `advance`'s own comment — "a window that sent the second sibling set its own position from the send and never consults this". So on a successful confirm, `PlanningSpace` pins the position itself:

```
setPosition({ _tag: "at", commitId: proposal.parentCommitId, live: false })
```

`live: false` is the honest standing and is deliberate: the try commit now has children, so continuing to plan there **is** a fork, and that is exactly what `isViewingPast` promises the composer ("sending from there starts a new branch"). It also makes the read-only artifact correct — per the existing rule, "a fork opens with a message", never with a revision. The alternative, `live: true`, re-enters `advance` and rides straight back onto a split; that is the bug.

**The sheet becomes the jump list.** `confirmSplits` returns the landed commit ids and the ws handler still clears the server's proposal — so the sheet cannot keep rendering from `detail.implementProposal`. `PlanningSpace` captures the landed rows in local state on success (`Array<{commitId, repositoryName}>`, zipping the returned ids with the confirmed cards in order) and renders the sheet from that until dismissed: one row per landed branch, named by its repository, each a jump through the existing `onSelect` (which routes to `positionAfterPick` — a childless split resolves `live: true`, so taking a jump does stand you in that branch). No confirmation action in this state; dismissing closes.

### A6. The product never says "split" or "atomic" (supersedes every user-facing string)

Internal vocabulary is untouched: `PlanImplementVerdict.kind: "atomic"`, the `split` payload stamp, `splits.logic.ts`, `saveSplits`, `SplitSheet.tsx` as a filename. Only copy changes, and the reason travels with it — a coding session works in one repository at a time.

| Where                               | Now                                                | Becomes                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SplitSheet.tsx:113`                | "This plan is atomic — it implements in _{repo}_." | "This plan is ready to implement." + the repository named as where the session will run                                                                                   |
| `SplitSheet.tsx` needs-split header | (rationale only)                                   | "This plan covers work in more than one repository. A coding session works in one repository at a time." then the agent's rationale                                       |
| `SplitSheet.tsx:131`                | "Already split — jump to it"                       | "This repository already has its own plan" + a go-to-it affordance                                                                                                        |
| `SplitSheet.tsx:193`                | "Land split" / "Land N splits"                     | names what it creates in the user's terms — a plan per repository — and **never a count of splits**                                                                       |
| `PlanTimeline.tsx:175`              | "You split the plan for {repo}"                    | "You added a plan for {repo}"                                                                                                                                             |
| `PlanGraph.logic.ts:306`            | "Split for {repo}"                                 | "Plan for {repo}"                                                                                                                                                         |
| analyzing card (`PlanTimeline.tsx`) | "Working out where this plan implements…"          | narrates the same way the sheet does — checking whether the plan is ready to implement, because a session works in one repository at a time — so the wait explains itself |
| `implementFailureNotice`            | "…nothing landed."                                 | unchanged in substance; drop any "split" wording                                                                                                                          |

**The zero-to-create defect, folded in:** the confirmation action offered "Land 0 splits" when every repository at that commit was already covered. `confirmPayload` returning `null` (no cards, or a blank card) must mean **no confirmation action rendered at all** — the sheet is a jump list — rather than a disabled button naming a count of zero.

Docs (§6 additions): `docs/user/projects-and-threads.md` loses the words "atomic", "split", "Land N splits" (lines 153 and 159 today) and gains the readiness vocabulary, the badge, and the jump list; `docs/internals/glossary.md` keeps **Split**/**Atomic plan** but marks them internal — never surfaced — and gains **Readiness verdict**; `docs/internals/overview.md`'s implement-gate clause gains the recorded verdict.

### What this addendum does not change

§1 entirely (the `split` payload stamp, no new commit kind, no `planText` on split events, `getPlanTextAt` walking to the projection); the analysis turn's session shape, prompt, and MCP door (§2); the all-or-nothing settle and `saveSplits`' guarded transactional write (§4), beyond the verdict rows it now writes in the same transaction; the M-110 seam's shape; the untouched glyph map.

## Gaps and findings carried out of discovery

- **Coverage analysis under narrowed grounding:** a `cwd`-only provider sees one repository (`getCapabilities().groundingRoots`, `PlanningAssistant.ts:550-559`); its coverage verdict can miss repositories it couldn't read. The narrowing is already surfaced (`groundingScope` → the analyzing card), and the sheet is the overrule either way. Accepted, recorded here.
- **Repository-by-name resolution in the proposal:** the agent names repositories; settle resolves by exact unique name. Two same-named repositories in one project make a proposal ambiguous → `invalid-proposal`. Rare and honest; the prompt lists exact names.
- **Snapshot `planText` is tip-most across branches** (pre-existing: `derivePlanText` folds the whole history). §1's no-`planText`-on-splits keeps confirms from churning it; ordinary edits on split branches behave as any branch edit does today.
- **The M-110 seam** is a sheet prop plus the landed split commit itself (`getPlanTextAt` at a split commit returns the projection — the session's brief needs nothing more). The vault's "confirmation opens session drafts (start-all affordance)" activates when M-110 wires the prop; until then the atomic action and post-confirm draft-opening render as the disabled "coding sessions arrive next" state.
- **Vault follow-up:** the DAG Explorer note's popover section says splits name their repository — satisfied by the wire `split` field this plan adds; no extra server work waits on M-129.

## Implementation Checklist

- [ ] Branch `venk/m-107-splits-the-implement-gate` off `venk/m-107-technical-plans`.
- [ ] **Retire the old surface** (one commit): delete `009_TechnicalPlanCommitKind.ts` + test, revert `CommitKind`, remove `PlanTechnicalPlan`/timeline variant/`getTechnicalPlanAt`/`deriveTechnicalPlan`/`TechnicalPlanDerivationBlockedError` from contracts + `rpc.ts` + `RpcAuthorization` + `ws.ts` + wire, remove `saveTechnicalPlan`/`getDerivationContext` leftovers, `save_technical_plan` tool, `TechnicalPlanDialog.tsx`, `technicalPlans.logic.ts`, `DeriveMenu`, stale badge, their tests, and the old plan doc.
- [ ] `PlanningStore.ts`: `PlanRevisionCommitPayload.split?`; `toTimelineEvent` plan-revision branch forks on flavor (split → no `planText`); `getImplementContext`; `saveSplits` (guarded, transactional, name-stamped, `announceChange` once); wire `PlanRevision.split?` through `planning/wire.ts`.
- [ ] `packages/contracts/src/mercurian.ts` + `rpc.ts`: methods `tryImplement`/`confirmSplits`/`cancelImplementProposal`; `PlanSplitProposal`/`PlanImplementVerdict`/`PlanImplementProposal`/`PlanInFlightImplement`; `PlanDetail.inFlightImplement?` + `implementProposal?`; `implement-*` stream items; `ImplementBlockedError`, `ConfirmSplitsBlockedError`; `MercurianPlanningError.operation` updates; `PlanRevision.split?`.
- [ ] `auth/RpcAuthorization.ts`: `tryImplement`/`confirmSplits`/`cancelImplementProposal` → Operate (coverage test forces).
- [ ] `PlanTurnRegistry.ts` + `PlanningAssistant.ts`: flavor `"implement"`; `tryImplement` (sync refusals; multi-root materials; prompt; frames; settle validates → publishes proposal, never commits; proposal map + clearing rules; `stopPlanningTurn`/`teardownPlan`/`status`/`inFlight` covering the flavor); `implementTurnInput` in `PlanningPrompt.ts`.
- [ ] `mcp/toolkits/planning/`: `save_implement_proposal` (implement turns only); `save_plan_revision` refuses implement turns; `read_plan` unchanged; `GroundingFold` filter rename.
- [ ] `ws.ts`: three handlers on the established shape; snapshot join gains `implementProposal`; proposal cleared on confirm.
- [ ] `planReducer.ts` + `mercurianPlanning.ts` + `apps/web/src/state/mercurian.ts`: implement folding + proposal + failure; three commands/hooks; remove the derive pair.
- [ ] `apps/web/src/components/mercurian/`: Implement button on the composer rail; analyzing card + Stop + composer gating; `SplitSheet.tsx` **(new)**; `splits.logic.ts` **(new)**; split timeline-row label; `planCommitSummary` case; artifact header back to main's shape.
- [ ] Do **not** touch: upstream-owned files, `CommitStore` invariants, the glyph map, migrations (back to 8), `apps/mobile`, coding-session anything (M-110).
- [ ] Docs: user section rewrite; glossary entries; overview clause; new plan doc at `docs/project/technical-plan-m-107-splits-the-implement-gate.md`.
- [ ] Commits: `refactor: retire the technical-plan derive surface (M-107)`, `feat(server): the implement gate — analysis proposes splits, confirmation lands them (M-107)`, `feat(web): implement action, split sheet, split branches (M-107)`.

### Addendum checklist (2026-08-12)

- [ ] **A1** `Migrations/009_PlanImplementVerdicts.ts` + test; `migrationEntries` → 9. `PlanningStore.ts`: verdict payload schemas, `recordImplementVerdict` (idempotent), `listImplementVerdicts`, the `deletePlan` cascade row, and a `ready` verdict per split written **inside `saveSplits`' transaction**.
- [ ] **A2** Contracts: `PlanImplementReady`, `PlanDetail.readyCommits`, `implement-ready` stream item. `getPlanSnapshot` joins verdicts in one read; `ws.ts` snapshot join carries them; reducer keeps a commitId-keyed map.
- [ ] **A2** Badge on `PlanTimeline.tsx` rows and `DagExplorer.tsx` thread rows + graph nodes: "Ready to implement". Glyph map still untouched.
- [ ] **A4** `tryImplement` preflight: ready → publish immediately; needs-split with full coverage → `already-covered`; else the turn. Model resolution moves **after** the verdict lookup. `PlanImplementVerdict` gains `already-covered`.
- [ ] **A4** `planReducer.ts`: `implement-analyzed` accepts a proposal with no `inFlightImplement` (the short-circuit path) and only rejects one contradicting a different live turn.
- [ ] **A5** `PlanningSpace.tsx`: pin `setPosition({_tag:"at", commitId: proposal.parentCommitId, live: false})` on confirm success; hold the landed jump rows in local state and render the sheet from them after the server proposal clears.
- [ ] **A6** Every user-facing string per the A6 table; `confirmPayload === null` renders **no** confirmation action; docs lose "atomic"/"split"/"Land N splits".
- [ ] Commit: `feat(m-107): readiness verdicts, jump-list confirmation, and the readiness vocabulary`.

## Test Plan

Runner: `vp test run <files>` (targeted only); server tests co-located `@effect/vitest` over in-memory stacks; web tests `vite-plus/test`, logic + `renderToStaticMarkup`.

- [ ] `PlanningStore.test.ts`, mapped to AC: `saveSplits` lands N sibling plan-revision commits under the named parent in one transaction (AC 4) — all-or-nothing on a poisoned input; payload carries `split` with server-stamped name; refuses `no-splits`/`duplicate-repository`/`repository-not-in-project`; **guarded** — refuses `PlanTurnActiveError` mid-turn (AC 8); split events carry no `planText` and snapshot `planText` is unchanged by a confirm; `getPlanTextAt` at a split commit returns the projection (AC 6); `getImplementContext` resolves text at tip and at an interior commit; decoding a pre-existing revision row (no `split`) still works.
- [ ] `CommitStore.test.ts`: no changes needed — assert nothing new; the sibling-fork legality is already covered.
- [ ] Migration suite: `migrationEntries` has exactly 8 entries; no `technical-plan` in the kind CHECK.
- [ ] `PlanningAssistant.test.ts` (fake provider, receipts-not-sleeps): sync refusals (`plan-empty`, model reasons, `PlanTurnActiveError` against a reply turn and vice versa — AC 8); analysis session opens multi-root with `approval-required` (asserted on `startSession` input); atomic proposal (coverage 1, no splits) publishes `implement-analyzed` with an atomic verdict and **zero commits** (AC 2 seam); multi coverage requires matching splits — publishes needs-split proposal, zero commits (AC 3, AC 5); tool never called → `implement-failed{"no-proposal"}`; unknown/ambiguous repository name or coverage/splits mismatch → `"invalid-proposal"`; stop → `"stopped"`, teardown discards — nothing lands in any failure (AC 4); proposal cleared by cancel, by a new turn, by confirm; questions auto-answered; no `turn-delta` during analysis; `status` reports working.
- [ ] Toolkit tests: `save_implement_proposal` refused for reply turns and unknown threads; `save_plan_revision` refused for implement turns; last call wins.
- [ ] `planReducer.test.ts`: `implement-started`/`turn-grounding` routing/`implement-analyzed`/`implement-failed` folds; proposal survives snapshot join; split commit appends without touching `planText`; failure reason surfaces and clears.
- [ ] `splits.logic.test.ts`: `existingSplitsAt` finds split children per repo and ignores ordinary revisions; `partitionProposal` marks already-split repos as jump rows (return path); `confirmPayload` drops removed cards and refuses empty texts; disabled reasons.
- [ ] `SplitSheet.test.tsx` (markup): needs-split renders a card per split with editable text and remove; already-split rows render jump affordance, no textarea; one-card footer reads "Land split"; atomic renders the disabled M-110 seam and no textarea; `PlanTimeline.test.tsx`: split row label with repository name; analyzing card with Stop.
- [ ] `RpcAuthorization` coverage test fails until all three entries land.
- [ ] AC walk in a real client (`test-t3-app`, on request per AGENTS.md): implement from the tip of a multi-repo-grounded plan → analyzing card with grounding, composer gated → sheet with N editable cards + rationale → edit one, delete one, confirm → sibling branches appear in timeline and DAG, artifact text unchanged on the parent line → stand on a split branch: artifact shows the projection; converse and revise it → implement at the split tip → atomic verdict sheet → re-implement at the original commit → sheet shows the landed split as "already split — jump to it" + fresh proposals only for the missing repos → cancel lands nothing; stop mid-analysis lands nothing; second window sees card, sheet state, and landed splits live.
- [ ] Targeted `tsgo --noEmit` + lint for `contracts`, `client-runtime`, `server`, `web` — removing the `technical-plan` timeline variant makes the typecheck sweep every `_tag` switch the branch had touched.

### Addendum test plan (2026-08-12)

- [ ] Migration suite: `migrationEntries` has exactly **9** entries; `plan_implement_verdicts` exists with its `kind` CHECK; the commit-kind CHECK still names exactly four kinds.
- [ ] `PlanningStore.test.ts`: `recordImplementVerdict` is idempotent (second write for a commit is a no-op, first answer wins); `listImplementVerdicts` returns only this plan's; `saveSplits` writes one `ready` verdict per landed split **in the same transaction** (a poisoned split lands neither commits nor verdicts); `getPlanSnapshot().readyCommits` carries them; `deletePlan` removes them.
- [ ] `PlanningAssistant.test.ts`: a recorded `ready` verdict makes `tryImplement` publish `implement-analyzed` **without opening a provider session** (assert `startSessions` stays empty) and **without a planning model set** — the `model-unset` refusal must not fire on the short-circuit; a recorded `needs-split` whose repositories all have split children publishes `already-covered` with no session; a partially covered commit still runs the turn; settle records the verdict it published.
- [ ] `planReducer.test.ts`: `implement-analyzed` with no in-flight is folded (short-circuit), not dropped; `implement-ready` inserts into the ready map and `snapshot` replaces it; a ready verdict for a commit not yet in the timeline is tolerated.
- [ ] `splits.logic.test.ts`: `confirmPayload` returning `null` is the "no confirmation action" signal; `partitionProposal` handles the `already-covered` verdict as jumps-only; the ready verdict shape drives the badge predicate.
- [ ] `SplitSheet.test.tsx`: the ready state says "ready to implement" and names no internal vocabulary; the not-ready state states the one-repository-at-a-time reason before the rationale; the jumps-only state renders **no** confirmation action; the post-confirm state renders one jump row per landed branch; no rendered string anywhere contains "split" or "atomic" (assert it — a regression guard on the vocabulary resolution).
- [ ] `PlanTimeline.test.tsx`: the row label reads "You added a plan for {repo}"; a badged commit renders "Ready to implement"; the analyzing card narrates the readiness question.
- [ ] `PlanPosition.logic.test.ts` / `PlanningSpace`: confirming pins the position at the try commit and `advance` does not move it (the regression the live run found — an edit after confirm must land on the parent line's fork, never inside a projection).
- [ ] AC walk additions: a badge appears on the commit a ready verdict was reached at and on every landed split without any evaluation; re-trying at a badged commit opens the session seam with no wait and no analyzing card; confirming leaves the surface on the try commit with the branches offered as jumps, and taking a jump is what moves you; re-trying where every repository is already covered shows a jump list with no confirmation action.

---

_Review note — significant calls a reviewer may want to pressure-test with_ `technical-plan-decision-review`_: split as optional payload field on plan revisions (vs. a parallel struct or new kind — kind was resolved in the vault, the field shape was not); split events carrying no `planText` (vs. reusing the ordinary revision event); the proposal held server-side on the assistant with explicit clearing rules (vs. client-only sheet state); `confirmSplits` taking client texts and stamping repository names server-side; `saveSplits` consulting the active-turn guard (diverging from the old guard-exempt settle write); multi-root analysis sessions (reversing the branch's single-root choice); exact-name repository resolution at settle; the composer rail as the implement seat (vs. the artifact header the branch used); the untouched glyph map._

---

_Backlog file:_ `backlog/060-technical-plans.md` _· Phase 6 — Splits and coding sessions · Plan authored 2026-08-11 against main @ `0191196d1` + branch `venk/m-107-technical-plans` (also at `docs/project/technical-plan-m-107-splits-the-implement-gate.md`)_
