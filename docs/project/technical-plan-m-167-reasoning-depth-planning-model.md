# Technical Plan — M-167: Reasoning depth joins the per-branch planning model choice

_Generated from M-167's Goal/AC and the almagest Assistant note's resolution "the pair becomes a triple" (2026-08). Builds directly on M-128 (`docs/project/technical-plan-m-128-per-branch-planning-model.md`), whose record, derivation, and picker machinery this plan extends. Per the issue, the coding session composer's traits implementation is the UI reference._

**Goal, in one sentence:** the recorded planning choice extends from `{provider, model}` to optionally carry the model's own depth options, under every rule the pair already follows — stamped per turn-opening message, derived from the nearest ancestor, inherited at forks, draft-local until send, gated (never rewritten) on machines that don't offer the level.

**Scope fences:** no coding-session changes (they already have traits), no mobile work, no migration, no new commit kind, no new RPC or store method, no edits to upstream-owned t3 files (`TraitsPicker.tsx`, `ProviderModelPicker.tsx`, `composerDraftStore.ts`).

## Conventions Detected

- **Commit payloads grow through optional fields; no migration.** `PlanMessage` fields are all `Schema.optional` with "commits written before X keep decoding" comments (`packages/contracts/src/mercurian.ts:238-263`); M-128 explicitly rode `payload_json` the same way. **High.**
- **One selection vocabulary, passed whole.** `PlanningModelSelection` is the only planning-model type at every layer: commit payload (`mercurian.ts:260-262`), store inputs and `lastUsed` (`apps/server/src/mercurian/planning/PlanningStore.ts:418-419,455-456`), stamping (`PlanningStore.ts:1582,1889`), ws pass-through (`apps/server/src/ws.ts:1721-1814`), assistant runtime (`PlanningAssistant.ts:172`), client standing walk (`PlanModelChoice.logic.ts`), and the flip store (`planComposerStore.ts:71-73`). Extending the type propagates the triple everywhere. **High.**
- **Depth already has a vocabulary: provider option descriptors.** `ModelCapabilities.optionDescriptors` on each `ServerProviderModel.capabilities` (`packages/contracts/src/server.ts:64-73`, `model.ts:125-127`), selections as `ProviderOptionSelections` (`model.ts:90-94`), session wire already carries `options` (`orchestration.ts:66-70`), and the Claude adapter consumes `getModelSelectionStringOptionValue(input.modelSelection, "effort")` (`apps/server/src/provider/Layers/ClaudeAdapter.ts:1218`). **High.**
- **Mercurian wraps, never edits, t3 picker components.** `PlanModelPicker.tsx` is a "thin adapter" over `ProviderModelPicker`; `TraitsPicker` ships a controlled persistence variant (`onModelOptionsChange`, `TraitsPicker.tsx:38-47`) that needs no thread/draft target — built for exactly this kind of reuse. **High.**
- **Gate-don't-fail with named reasons and copy.** `resolvePlanningModel` returns `unresolved` reasons; wording lives in `PlanningModel.logic.ts` (`describePlanningModel`, `planningModelGateNotice`). **High.**
- **Pure `.logic.ts` modules with colocated `.logic.test.ts`; server tests on `@effect/vitest` + `MercurianSqlite.layerMemory`.** Observed across `apps/web/src/components/mercurian/` and `apps/server/src/mercurian/`. **High.**
- **`server.test.ts` wire mocks must match any ws-visible shape change** (project memory: a mismatch kills the whole mercurian wire suite in CI only). ws.ts passes `modelChoice` through opaquely so no new mock methods are expected, but the suite is in the test plan as a guard. **Medium.**
- **Verification via targeted `vp test run <files>` plus scoped typechecks** in `packages/contracts`, `apps/server`, `apps/web` (M-128's convention). **Medium.**

## Design

### The load-bearing move: extend the vocabulary, not the plumbing

`PlanningModelSelection` (`packages/contracts/src/mercurianWorkspace.ts:42-46`) gains one optional field:

- `options?: ProviderOptionSelections` — the canonical `Array<{id, value}>` shape from `contracts/model.ts`, values abstract strings/booleans, never an instance fact.

Because every layer passes the selection whole, the triple then rides — with no schema change of their own — the `ranUnder`/`generatedBy` commit fields, `CreatePlanInput`/`AppendMessageInput.modelChoice` and `lastUsed`, the stamping rule (explicit → standing → last-used, `PlanningStore.ts:1582,1889`), the `standingModelChoiceAt` ancestor walk, `WorkspaceSettingsStore`'s last-used seed, both ws flows, and the client flip store's `directive`. Old payloads without `options` decode (optional field); a turn with no recorded options passes none and the provider runs its default depth — which is exactly the AC's pre-depth-history behavior, for free.

Two places rebuild or compare selections field-by-field and must learn the third field:

- `standingModelChoice` (web, `PlanModelChoice.logic.ts:24`) reconstructs `{provider, model}` — carry `options` through.
- Selection equality: `sameModelPair` (`PlanNodePopover.logic.ts`) and the assistant's session-continuation check (`PlanningAssistant.ts:1084-1090`). Add `planningModelSelectionsEqual(a, b)` to `contracts/mercurianWorkspace.ts` — order-insensitive on options — used by both sides.

### Resolution and gating: `option-unavailable`

`resolvePlanningModel` (`mercurianWorkspace.ts:135-170`) gains a final step: after choosing the instance, walk the chosen model's `capabilities.optionDescriptors` (plain data — contracts cannot import `packages/shared` helpers, and doesn't need them) and check each recorded option: a select option whose id or value the descriptors don't offer, or a boolean option with no matching descriptor, yields `{ _tag: "unresolved", reason: "option-unavailable" }`. The recorded selection is never rewritten — the same workspace resolves fine on a machine whose agent offers the level (the M-97/M-128 temperament). `describePlanningModel` and `planningModelGateNotice` (`PlanningModel.logic.ts`) gain wording for the new reason, naming the recorded level and pointing at the agent upgrade via the candidate's `versionAdvisory` where present.

Rationale for gating rather than silently dropping unknown options: the vault resolution says "gated rather than failed on a machine whose installed agent doesn't offer the recorded level," and silently running a turn at a different depth than the branch records would falsify the record's promise that descendants derive what a turn ran under.

### The picker: TraitsPicker in controlled mode, beside the model picker

**`PlanTraitsPicker.tsx` (new, `apps/web/src/components/mercurian/`)** — a thin adapter in the exact mold of `PlanModelPicker.tsx`:

- Renders the upstream `TraitsPicker` with the controlled persistence variant (`onModelOptionsChange`) — no `threadRef`/`draftId`, no `composerDraftStore` involvement.
- Feeds it `provider`, `models` (the resolving instance's `snapshot.models`, found by the `instanceId` in the current `PlanningModelResolution`), `model`, and `modelOptions` from the effective selection. When the pair is unresolved or the model declares no descriptors, `shouldRenderTraitsControls` returns false and nothing renders — an unresolvable pair shows its gate, not a depth control.
- Wires `prompt`/`onPromptChange` to the branch draft's text (`planComposerStore`), so Claude's prompt-injected ultrathink behaves exactly as in the session composer: the depth rides the message text, which planning already records verbatim; recorded `options` never contain prompt-injected values (same as sessions).
- `onModelOptionsChange` writes the flip: the current effective selection with the new options, stored via the existing `setModelChoice` head-keyed directive (`planComposerStore.ts:295,369`) — draft-local, persistent, cleared by send, exactly like a model flip.

`PlanningSpace.tsx` composes `<PlanTraitsPicker/>` into the same `modelPicker` slot it already passes to `PlanComposer` (lines ~437 and ~1284 for the live and unborn composers) — **`PlanComposer.tsx` needs no API change.**

**Model-change carryover** — new pure helper `retainOfferedOptions(options, capabilities)` in `PlanModelPicker.logic.ts`: when the user picks a different provider or model, keep a recorded option only if the new model's descriptors offer the same id and value; drop the rest. Predictable, and preserves the common case (same effort scale across a provider's models). Applied where `planningSelectionForInstanceModel` builds the new selection.

### Server: stamp the triple, rebuild on depth change

- **`PlanningStore.ts`:** no structural change — the local payload schemas at lines 88/244 and input schemas at 418/455 reference `PlanningModelSelection` and extend automatically. The stamping and standing-derivation code paths pass selections whole.
- **`PlanningAssistant.ts`:** `TurnRuntime.modelSelection` and the `generatedBy` stamp (line 543) carry the triple. `runRebuild` passes options into the provider session: `modelSelection: { instanceId, model, options }` (`PlanningAssistant.ts:1035`) — the session `ModelSelection` wire already accepts them and adapters already consume them; this is the entire dispatch story. The session-continuation check (line 1084-1090) adds `planningModelSelectionsEqual` on options, so a depth change rebuilds a fresh session, the same continuity rule as a model change — a reply in progress is untouched (its session already started), satisfying the never-retarget AC.
- **`ws.ts` / `WorkspaceSettingsStore.ts`:** unchanged code, extended types. Last-used seeding records whatever triple was stamped, so a new plan seeds with the workspace's last depth — the pair rule generalizing as the vault resolution requires.

### Attribution

`ModelAttribution` (`PlanTimeline.tsx:155`) and the `PlanNodePopover` inherited-choice line append the depth when the recorded selection carries options: descriptor label when this machine's snapshots can resolve one, the raw recorded value otherwise (history stays legible on machines that can't resolve it). Small formatting helper beside `describePlanningModel` in `PlanningModel.logic.ts`.

## Gaps where the AC outruns the repo

Only one: nothing validates recorded options today because nothing records them. The `option-unavailable` resolution reason and its gate copy are the new machinery; everything else is the existing pair machinery with a wider type.

## Implementation Checklist

- [ ] `PlanningModelSelection.options?: ProviderOptionSelections` in `contracts/mercurianWorkspace.ts`; add `planningModelSelectionsEqual`.
- [ ] Extend `resolvePlanningModel` with the descriptor walk and the `option-unavailable` unresolved reason; never rewrite the selection.
- [ ] Carry `options` through `standingModelChoice` (web) and the store's `standingModelChoiceAt` result (verify it already passes whole).
- [ ] Stamp and attribute the triple in `PlanningAssistant`: `TurnRuntime.modelSelection`, `generatedBy`, session `modelSelection` with options, options-aware continuation check.
- [ ] Gate copy for `option-unavailable` in `PlanningModel.logic.ts` (`describePlanningModel`, `planningModelGateNotice`), with upgrade advisory where available.
- [ ] `PlanTraitsPicker.tsx` (new) in controlled mode; compose into `PlanningSpace`'s existing `modelPicker` slot for both live and unborn composers; wire prompt injection to the branch draft text.
- [ ] `retainOfferedOptions` carryover on provider/model change in `PlanModelPicker.logic.ts`.
- [ ] Depth in `ModelAttribution` and `PlanNodePopover`, label-resolved with raw-value fallback.
- [ ] Do not add a migration, RPC, store method, mobile work, or edits to upstream t3 files.

## Test Plan

Server (`@effect/vitest`, `MercurianSqlite.layerMemory`):

- [ ] `PlanningStore.test.ts`: triple stamps and round-trips through `payload_json`; pair-only legacy payload decodes with `options` absent; standing walk returns the triple; last-used seed carries options.
- [ ] `PlanningAssistant.test.ts`: turn dispatches options into the provider session; depth change alone forces a session rebuild while same-triple continues; `generatedBy` records the triple; `option-unavailable` refusal fires when the resolved instance's model lacks the recorded option; absent options dispatch none (default depth).
- [ ] `mercurianWorkspace.test.ts`: `resolvePlanningModel` option gating (unknown id, unoffered value, boolean without descriptor, options all offered); `planningModelSelectionsEqual` order-insensitivity.
- [ ] `server.test.ts`: existing wire suite stays green — `modelChoice` is a pass-through, no mock method changes expected (guard per project memory).

Web (pure logic tests; static markup where rendering is involved):

- [ ] `PlanModelChoice.logic.test.ts`: standing walk carries options; nearest-ancestor and fork inheritance with mixed pair/triple history.
- [ ] `PlanModelPicker.logic.test.ts`: `retainOfferedOptions` keeps offered id+value, drops the rest, across provider and model changes.
- [ ] `planComposerStore.test.ts`: triple-shaped directive persists and clears like the pair.
- [ ] `PlanComposer.logic.test.ts` / `PlanningModel.logic.test.ts`: `option-unavailable` gate state and wording.
- [ ] `PlanNodePopover.logic.test.ts`: equality treats differing options as a different choice; attribution formatting falls back to raw values.

Verification: targeted `vp test run` on the files above plus scoped typechecks in `packages/contracts`, `apps/server`, `apps/web`. Browser AC walk happens at implementation time per project practice (every AC demonstrated in the running app), not as part of this plan.
