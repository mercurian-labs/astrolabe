# Technical Plan — M-141: Shared fixture builders for planning-domain objects

_Generated from the Goal/AC of Linear issue M-141 (see the issue for the full AC). Implements the fixture rules of the [design-system and Storybook strategy](../internals/design-system.md) (rev 2): builders in shared test support, consumed by unit tests today and stories later (M-143), independent of the tooling spike (M-140). Branch is stacked on `venk/design-custom-astrolabe-experience`, which carries the strategy doc._

**Goal, in one sentence:** give every Mercurian test (and, later, every story) one canonical, typed, deterministic way to build planning-domain objects — timeline items, plan rows and details, specs, coding sessions, split and implement proposals — and retire the per-file hand-rolled helpers that currently duplicate that job across the mercurian test suite.

**Scope fences:** web-app test support only — nothing ships in the app bundle, nothing moves into `packages/contracts`; no story files (M-143); no new test _coverage_ beyond the builders' own suite — existing tests change how they construct data, not what they assert; upstream-owned test files stay untouched (every migrated file is Mercurian-owned).

## What discovery found

- **The duplication is real and uniform.** Seventeen Mercurian test files hand-construct contract objects. The mature pattern is [PlanCheckpoints.logic.test.ts](../../apps/web/src/components/mercurian/PlanCheckpoints.logic.test.ts): local `id(value)` (`MercurianCommitId.make`), `at(sequence)` (a fixed ISO timestamp derived from the sequence), and per-kind helpers `message(name, sequence, parents, authorKind, …)` / `planRevision(…)` / `specRevision(…)` returning typed `PlanTimelineItem` literals. Other files degrade from there down to raw array literals ([DagExplorer.test.tsx:29+](../../apps/web/src/components/mercurian/DagExplorer.test.tsx)). The builders generalize the best existing pattern rather than inventing a new one.
- **The contracts are Effect `Schema.Struct`s with branded ids.** [packages/contracts/src/mercurian.ts](../../packages/contracts/src/mercurian.ts) defines the full planning surface: `PlanTimelineItem` (a union of `PlanMessage`, `PlanRevision`, `PlanSpecRevision`, `PlanCodingSession` over shared `PlanCommitFields`), `PlanShell`, `PlanTreeRow` (shell + status/lifecycle facts + `codingSessions`), `PlanDetail`, `SpecDocument` (with an existing constructor precedent: `specDocumentFromIssue`, [mercurian.ts:299](../../packages/contracts/src/mercurian.ts)), `PlanCodingSessionRecord`, `PlanSplitProposal`, `PlanImplementProposal`/`PlanImplementVerdict`, `PlanQuestion`. Ids come from `makeEntityId` brands (`MercurianCommitId.make(…)`), timestamps are `IsoDateTime`.
- **Runtime schema decoding is an established web-side idiom.** `Schema.decodeUnknownSync(...)` is used at trust boundaries ([promptStashStore.ts:64](../../apps/web/src/promptStashStore.ts), [connection/storage.test.ts:17](../../apps/web/src/connection/storage.test.ts)), imported as `import * as Schema from "effect/Schema"`. Builders can therefore validate their output against the real contract schema at construction for one line each — impossible states throw in the builder, not at render.
- **Shared test support has a home and no fixtures yet.** [apps/web/src/test/](../../apps/web/src/test/) holds exactly `reactHookHarness.ts` and `reactElementTree.ts` — camelCase modules, imported relatively (`../../test/…`) by tests. There is no `fixtures/` directory anywhere in `apps/web` or `packages/contracts`; the strategy doc names this gap explicitly.
- **"Checkpoint" must not name a builder.** Upstream contracts already use checkpoint for thread/diff checkpoints ([contracts/src/orchestration.ts](../../packages/contracts/src/orchestration.ts)); Mercurian's checkpoint is a derived client-side reading produced by `condensePlanGraph` ([PlanCheckpoints.logic.ts](../../apps/web/src/components/mercurian/PlanCheckpoints.logic.ts)) over timeline items. Builders build **timeline items**; anything checkpoint-shaped is obtained by passing them through the production derivation — the strategy doc's "keep derived facts derived" rule, concretely.
- **Determinism is already the local habit, worth preserving as API.** The `at(sequence)` idiom pins timestamps to the sequence number; nothing in the existing helpers calls `Date.now()` or randomness. The builders keep both properties by construction: all defaults are constants or pure functions of the caller's arguments.

## Conventions Detected

| Convention                                                                                                                                   | Evidence                                                                                            | Confidence |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| Test-support modules live in `apps/web/src/test/`, camelCase, imported relatively                                                            | `reactHookHarness.ts`, `reactElementTree.ts`, their importers                                       | High       |
| Tests import the runner from `"vite-plus/test"`, are co-located with their subject, run via `vp test run --project unit`                     | every `*.test.ts(x)` in `apps/web/src`, [apps/web/vite.config.ts:73](../../apps/web/vite.config.ts) | High       |
| Contract objects in tests are typed literals with branded ids via `.make`; runtime decode via `Schema.decodeUnknownSync` at trust boundaries | `PlanCheckpoints.logic.test.ts`, `promptStashStore.ts`                                              | High       |
| Fixture helpers take a short name that seeds both id and default text; timestamps derive from sequence                                       | `id`/`at`/`message` helpers across the mercurian tests                                              | High       |
| Mercurian-owned code and tests live under `components/mercurian/`; upstream files aren't edited for Mercurian needs                          | directory layout, ADR 004                                                                           | High       |
| Commits `<type>(scope): … (M-141)`, branch `venk/m-141-<slug>`, plan docs at `docs/project/`; `vp fmt` on staged files at commit             | `git log`, existing plans, observed commit hooks                                                    | High       |

## Design

### 1. Layout: `apps/web/src/test/fixtures/` (new), one module per contract neighborhood

Four modules, mirroring how the contracts themselves cluster, no barrel (the repo has no barrel convention; tests import the module they use):

- **`timeline.ts` (new)** — the workhorse: `commitId(name)`, `at(sequence)`, and per-kind builders `message`, `planRevision`, `specRevision`, `codingSessionLeaf`, each returning its `PlanTimelineItem` member. Also `timeline(...items)` as a typing convenience for `ReadonlyArray<PlanTimelineItem>`.
- **`plan.ts` (new)** — `planShell`, `planTreeRow` (shell defaults + status/lifecycle facts, empty `codingSessions`), `planDetail`.
- **`spec.ts` (new)** — `specDocument` (delegating defaults to the contracts' own `specDocumentFromIssue` where it fits) and `planSpecAt`.
- **`sessionsAndSplits.ts` (new)** — `planCodingSessionRecord`, `planSplitProposal`, `planImplementProposal`, `planImplementVerdict`, `planQuestion`.

### 2. Builder shape: name-first, overrides-second, constants underneath

The signature generalizes the best existing helper instead of replacing its ergonomics:

`message(name, overrides?)` — `name` seeds the branded `commitId` and the default `text`; `overrides` is a typed `Partial` of the target struct (minus `_tag` and `commitId`) for everything else. Defaults: `sequence: 1`, `parents: []`, `published: false`, `authorKind: "human"`, `createdAt: at(sequence)` — recomputed when `sequence` is overridden, so the timestamp-follows-sequence invariant survives overrides. Graph-shape tests, the dominant caller, then read as `message("root")`, `message("reply", { sequence: 2, parents: ["root"], authorKind: "assistant" })` — with `parents` accepted as plain strings and branded inside the builder, since every existing call site brands by hand today.

Two deliberate properties, both AC clauses:

- **Deterministic by construction**: no clock, no randomness, no module-level counters (a counter would make a builder's result depend on call order — the same call must yield the same object anywhere in a file, and `Date.now()`-family calls are unavailable in some harness contexts anyway).
- **Semantic overrides over raw plumbing**: where a fact the strategy doc names is a multi-field shape, the builder exposes it as one override — `specRevision("s1", { cause: "refresh" })`, `planRevision("p1", { split: { repository: "web" } })` brands and expands underneath — so a story or test states the fact, not the encoding.

### 3. Validation: the contract schema is the gate

Each builder pipes its assembled literal through `Schema.decodeUnknownSync(<ContractSchema>)` before returning — the established trust-boundary idiom applied at construction. Type-level safety alone already catches most misuse at `tsgo` time; the runtime decode additionally rejects what types can't express (a malformed `IsoDateTime`, an empty `TrimmedNonEmptyString`) and keeps builders honest against future contract evolution: a contract field change breaks the builder's own suite immediately rather than silently producing stale shapes. Cost is negligible at test scale.

### 4. Migration: the timeline helpers die everywhere, in one pass

All seventeen files construct through the fixtures after this change; the local `id`/`at`/`message`/`planRevision`/`specRevision` helpers and raw timeline literals are deleted. The heavy files are the graph/history suite (`PlanCheckpoints.logic.test.ts`, `PlanColumns.logic.test.ts`, `PlanThread.logic.test.ts`, `PlanGraph.logic.test.ts`, `PlanPosition.logic.test.ts`, `PlanNodePopover.logic.test.ts` + `.test.tsx`, `DagExplorer.test.tsx` + `.logic.test.ts`, `PlanTimeline.test.tsx`); the rest touch `SpecArtifact.logic.test.ts` + `.test.tsx`, `splits.logic.test.ts`, `SplitSheet.test.tsx`, `codingSessionDraft.logic.test.ts`, `PlanListSidebar.test.tsx` + `.logic.test.ts`, `PlanModelChoice.logic.test.ts`. Migration is mechanical per file — construction changes, assertions don't — and lands as one commit per neighborhood (timeline/graph, artifacts, splits-and-sessions, sidebar) so a regression bisects to a small diff. A helper that encodes something genuinely test-specific (e.g. a prebuilt graph topology used across cases) stays local, expressed _through_ the builders.

### 5. What deliberately doesn't happen

- Builders don't move to `packages/contracts`: contracts are shipping code consumed by server and client; fixtures are web test support until a second surface consumes them (the strategy doc's packaging rule).
- No faker-style randomization, no scenario library, no mock transport — the strategy doc's boundary ("mocks stop at application boundaries") and non-goals stand.
- No new assertions in migrated tests; behavior claims are M-143's and later work.

## Implementation Checklist

- [ ] Create `apps/web/src/test/fixtures/timeline.ts` with `commitId`, `at`, `message`, `planRevision`, `specRevision`, `codingSessionLeaf`, `timeline`, all decode-validated and deterministic.
- [ ] Create `plan.ts` (`planShell`, `planTreeRow`, `planDetail`), `spec.ts` (`specDocument`, `planSpecAt`), and `sessionsAndSplits.ts` (`planCodingSessionRecord`, `planSplitProposal`, `planImplementProposal`, `planImplementVerdict`, `planQuestion`) in the same directory.
- [ ] Write the builders' own suite `apps/web/src/test/fixtures/fixtures.test.ts` (cases in the Test Plan).
- [ ] Migrate the timeline/graph test files onto the builders; delete their local helpers. Commit.
- [ ] Migrate the artifact tests (`SpecArtifact.*`), then splits-and-sessions (`splits.logic`, `SplitSheet`, `codingSessionDraft.logic`), then sidebar/model (`PlanListSidebar.*`, `PlanModelChoice.logic`); delete local helpers as each lands. Commit per neighborhood.
- [ ] Verify no `MercurianCommitId.make` or hand-built `PlanTimelineItem` literals remain in `*.test.*` outside `src/test/fixtures/`.
- [ ] Don't add a barrel, don't export fixtures from any shipping module, don't touch `packages/contracts`, and don't edit upstream-owned test files.
- [ ] Full `vp test run --project unit`, `vp lint`, `typecheck` green.

## Test Plan

The builders get their own co-located suite (`fixtures.test.ts`, `vite-plus/test`, `unit` project) — the one place new assertions belong; migrated suites prove themselves by staying green unchanged.

- [ ] **Validity**: every builder's default output round-trips `Schema.decodeUnknownSync` against its contract schema (message, plan-revision, spec-revision, coding-session leaf, tree row, detail, spec, split and implement shapes).
- [ ] **Determinism**: two identical calls are deeply equal; no field varies across runs or call order.
- [ ] **Overrides**: an override lands in the output; `sequence` override moves `createdAt` with it; string parents come back branded; the semantic `split`/`cause` overrides expand to the contract shape.
- [ ] **Rejection**: an invalid construction (e.g. empty title where `TrimmedNonEmptyString` is required, malformed timestamp) throws from the builder itself.
- [ ] **Derivation stays production**: a sanity case builds a small timeline and passes it through `condensePlanGraph`, asserting the fixtures compose with the real derivation (guarding the checkpoint-collision rule).
- [ ] **Migration regression**: the full unit project passes after each migration commit with no assertion changes.
