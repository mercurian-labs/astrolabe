# Technical Plan — M-168: A reconstruction meter on the planning composer

_Generated from M-168's Goal/AC and the almagest Composer note's resolution "adopted, in the folded-honesty temperament" (2026-08). Base is main after M-167 (`e475d3cba`), so the effective selection is the depth-carrying triple._

**Goal, in one sentence:** the planning composer shows a quiet, position-derived meter measuring how much of the next reply's context budget the record at the current position consumes — recomputed on branch switches, checkpoint picks, and picker flips; saying when older history will stop arriving verbatim; informational only; showing nothing when the composer is gated.

**Scope fences:** no change to how reconstruction, elision, or provider compaction works; no meter-driven automation; no session (t3 thread) changes; no migration, and nothing recorded in any history.

## Conventions Detected

- **Reconstruction is already measurable, server-side.** A rebuilt session's first turn renders ancestors via `projectTranscript` (`apps/server/src/mercurian/assistant/PlanningAssistant.ts:402-428`) into `transcriptPreamble` (`apps/server/src/mercurian/assistant/PlanningPrompt.ts:99-156`), which budgets characters against `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` (120_000, `packages/contracts/src/orchestration.ts:144`) minus reserved chars (appendix + current message), the plan section, the spec section, and `TRANSCRIPT_FRAMING_MARGIN` (2_000) — **eliding oldest entries first** with an explicit "first N entries are elided for length" header. This elision is the built meaning of "history stops arriving verbatim." **High.**
- **One-shot plan reads have a ws precedent.** `getPlanTextAt` (M-108) is the model for a read-once, position-keyed mercurian ws method: contract input/output in `packages/contracts/src/mercurian.ts`, method constant in `MERCURIAN_WS_METHODS`, handler in `apps/server/src/ws.ts`. **High.**
- **A new ws method requires the matching mock on `server.test.ts`** or the whole mercurian wire suite fails in CI only (project memory; observed on prior issues). **High.**
- **The session meter is the visual grammar.** `ContextWindowMeter` (`apps/web/src/components/chat/ContextWindowMeter.tsx`) renders a `ContextWindowSnapshot` — circular gauge, percentage, `used/max` token counts — and already presents gracefully when `maxTokens` is null (tokens-only, no percentage). **High.**
- **Mercurian wraps t3 components; pure logic in `.logic.ts` with colocated tests; positions come from the surface.** `PlanComposer` receives everything (banner, pickers) from `PlanningSpace`, which owns `actingHead`, the effective `modelChoice`, and `effectiveModelResolution` (`PlanningSpace.tsx:380-437`). **High.**
- **Every new Mercurian component module must be classified in the design-system coverage inventory** (`apps/web/src/design-system/coverage.ts` + the pinned module count in `coverage.test.ts` — the guard that failed CI on M-167). **High.**
- **Server tests on `@effect/vitest` + `MercurianSqlite.layerMemory`; verification via targeted `vp test run` + scoped typechecks.** **High.**

## Design

### What the meter measures (the one significant call)

The meter measures the **next reply's context budget at the current position**: the characters the reconstruction of this position would submit (rendered transcript + plan section + spec section + appendix + framing margin + the live draft text), against `min(PROVIDER_SEND_TURN_MAX_INPUT_CHARS, the effective model's declared context window in character-equivalents)`. Today the send cap is the binding term for every real model (120k chars ≈ 30k tokens, far under a 200k-token window), so the displayed number is the _true_ elision boundary — the meter never claims room the pipeline won't actually use. The computation consumes the effective selection (model, and M-167's `contextWindow` option where the model declares one, via its capability descriptors), so a picker flip recomputes live; if a model ever declares a window smaller than the send cap, the meter becomes model-relative automatically with no further change.

Honesty note carried to the AC walk: with today's caps, two models usually measure the same — AC3's observable is the live recompute on flip (and the unknown-window/tokens-only presentation differences), not a different percentage.

The "leaning on summarized history" state is exact, not estimated: it is precisely `transcriptPreamble`'s elision condition — rendered entries exceed the remaining budget — surfaced as the meter's warning tone plus a sentence ("the next reply will see its oldest N entries elided" temperament, matching the prompt's own header).

### Server: a measure read from the same code that builds the real preamble

To keep the number honest against the prompt logic forever, the measurement comes from the rendering code itself — no client re-implementation.

- **`PlanningPrompt.ts`:** refactor `transcriptPreamble`'s internals so the rendering of entries and the plan/spec sections is shared by a new exported `measureTranscript(input)` returning `{ renderedEntryLengths, planSectionChars, specSectionChars }` (pure; the budget subtraction stays where it is). `TRANSCRIPT_FRAMING_MARGIN` becomes exported.
- **`PlanningAssistant.ts`:** new service method `measureReconstruction({ planId, parentCommitId })` — walks `commits.ancestors` + `projectTranscript` exactly like `buildRebuildMaterials`, computes the appendix length from the project's repositories (same inputs), and returns `{ transcriptChars, entryCount, fixedReservedChars }` where `fixedReservedChars` = appendix + plan section + spec section + framing margin. No session, no provider call, no turn state touched.
- **Contracts (`packages/contracts/src/mercurian.ts`):** `MercurianMeasureReconstructionInput` `{ planId, commitId }` and a result schema for the three numbers; a `MERCURIAN_WS_METHODS.measurePlanReconstruction` entry.
- **`ws.ts`:** the read handler on the `getPlanTextAt` pattern, plus the authorization row — **and the matching method on `server.test.ts`'s assistant/store mocks.**

### Client: position-keyed read, live math, quiet gauge

- **`PlanReconstructionMeter.logic.ts` (new, `apps/web/src/components/mercurian/`):** pure math — `reconstructionMeterState({ measure, draftChars, selection, providers, resolution })` returning `null` when the resolution is not `resolved` (gated composer shows nothing rather than a guess), else `{ fillFraction, approxUsedTokens, approxMaxTokens | null, willElide }`. Window derivation: the effective selection's `contextWindow` option value (or the descriptor's default) mapped to tokens where the model declares that descriptor; models without one contribute no window and the send cap alone binds. Chars→tokens display estimate is a single documented constant (≈4 chars/token), used for labels only — the boundary math stays in characters.
- **`PlanReconstructionMeter.tsx` (new):** thin renderer reusing `ContextWindowMeter`'s presentation if its props allow, else a small sibling gauge in the same visual grammar (the null-max tokens-only fallback carries the unknown-window case). When `willElide`, the gauge wears a small corner warning dot — no standing text beside the control — and the elision sentence lives in the popover alongside the budget facts. No button, no action, `aria` as status text. _(Amended 2026-08-26 per the vault's presentation amendment: warning-as-mark + popover sentence replaced the original warning-tone-plus-inline-sentence.)_
- **`PlanningSpace.tsx`:** fetch the measure keyed by `(planId, actingHead)` — re-read on position change (branch switch, checkpoint pick, edit-and-branch staging), never per keystroke; the draft's live length joins client-side. Compose the meter into the composer footer **beside the send control** — the session composer's meter position, which means `PlanComposer` gains a small `meter` slot rendered in the footer's right-hand group next to `SendControl` rather than riding the `modelPicker` slot _(amended 2026-08-26; the first build placed it in the left picker cluster)_ — for both the live and unborn composers (the unborn draft has no history: measure is zero entries + empty artifacts — render the meter only once a plan exists, or show the near-empty state; pick whichever reads quieter in the built UI and say so in the report). While a turn streams on the branch, the meter keeps its last value (position is unchanged until the reply lands).
- **Design-system coverage:** classify `PlanReconstructionMeter.tsx` (`requires-live-workspace` — its value derives from the environment's plan history read) and bump the pinned module count.

## Gaps where the AC outruns the repo

- Nothing measures reconstruction today; the measure read is the new machinery (built from existing renderers rather than beside them).
- No per-model window table exists and none is invented: the window enters only through capability descriptors the providers already declare (M-167's `contextWindow`), with the send cap as the always-true bound.

## Implementation Checklist

- [ ] Export shared rendering measurement from `PlanningPrompt.ts` (`measureTranscript`, `TRANSCRIPT_FRAMING_MARGIN`) without changing `transcriptPreamble`'s output for identical inputs.
- [ ] `PlanningAssistant.measureReconstruction` returning `{ transcriptChars, entryCount, fixedReservedChars }` from the same ancestors walk and appendix inputs as a real rebuild.
- [ ] Contract input/result + `MERCURIAN_WS_METHODS.measurePlanReconstruction`; ws handler + authorization; **matching `server.test.ts` mock method**.
- [ ] `PlanReconstructionMeter.logic.ts`: state math, window derivation from capability descriptors, gated → `null`, elision boundary condition equal to the prompt's.
- [ ] `PlanReconstructionMeter.tsx`: quiet gauge in the session meter's visual grammar, tokens-only when no window; when eliding, a corner warning dot on the gauge with the sentence in the popover only; composed beside the send control via a new `PlanComposer` `meter` slot for live (and, if it reads well, unborn) composers, re-keyed on `actingHead` and model flips.
- [ ] Design-system coverage classification + module-count bump.
- [ ] No migration, no new commit fields, no automation, no t3 upstream file edits.

## Test Plan

Server (`@effect/vitest`, `MercurianSqlite.layerMemory`):

- [ ] `PlanningPrompt.test.ts`: `measureTranscript` lengths agree with what `transcriptPreamble` actually keeps/elides at the boundary (a fixture directly at ±1 char of the budget); framing-margin export unchanged behavior.
- [ ] `PlanningAssistant.test.ts`: `measureReconstruction` on a seeded plan returns sizes consistent with the rendered rebuild for the same position; empty history measures zero entries; position on a fork measures that branch's path only.
- [ ] `server.test.ts`: the new read round-trips over the wire seam (and the mock parity holds).

Web (pure logic tests):

- [ ] `PlanReconstructionMeter.logic.test.ts`: gated resolution → null; fill math at 0%, mid, >100% clamp; `willElide` flips exactly at the boundary; window from `contextWindow` option vs descriptor default vs absent (tokens-only); draft length moves the number; selection flip recomputes.
- [ ] `coverage.test.ts` stays green with the new classification.

Verification: targeted `vp test run` on the files above plus scoped typechecks in `packages/contracts`, `apps/server`, `apps/web`. Browser AC walk happens post-implementation per project practice.
