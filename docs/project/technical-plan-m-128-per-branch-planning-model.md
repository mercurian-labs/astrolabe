# Technical Plan — M-128: Per-branch planning model — last-used seeds, history carries the pair

_Generated from M-128 and the almagest Assistant note, including “Amended (2026-08, second): last-used seeding; the workspace default retires.” Built on the t3code-fork base after M-107, under [ADR 001](../architecture/local-first-runtime.md) and [ADR 004](../architecture/fork-baseline.md)._

**Goal, in one sentence:** every human message that opens a planning turn records the abstract provider/model pair that turn runs under; descendants inherit the nearest recorded pair, while a bare history seeds from the pair the workspace last used.

**Scope fences:** coding-session model choice, `PlanInFlightTurn`, `planReducer`, mobile, merge behavior, and provider-instance storage remain untouched. There is no migration, new commit kind, plan column, planning setter RPC, or instance id in history.

## What discovery found: the record has a home, the seed already has storage, and T3 owns the picker

- **The commit payload is the storage.** `MessageCommitPayload` already grows through optional fields, so `ranUnder` and `generatedBy` ride `payload_json` without a migration. Effect Schema ignores excess properties, so development data written by the first M-128 implementation still decodes.
- **Nearest-ancestor derivation already has a pattern.** `CommitStore.ancestors` and `getPlanTextAt` provide the same self-inclusive history walk this feature needs. No plan-level state is introduced.
- **The workspace row is a seed, not configuration.** The existing `workspace_settings.planningModel` value remains in the snapshot/subscription, but now means “the pair most recently stamped on a turn-opening human message.” The product writes it internally; Settings cannot.
- **The coding-session picker is reusable.** `ProviderModelPicker` already owns the instance rail, curated model list, search, icons, and `ComposerControl` trigger. Mercurian needs only an adapter between instance-free history and machine-local instances.
- **The unresolvable-pair invariant needs wrapper work.** The upstream trigger falls back to an instance’s first option when a slug is absent. Injecting the recorded slug as a disabled option makes the trigger render history faithfully without editing upstream code.

## Design

### The load-bearing shape: one pair on the commit, one pair on the input

`PlanningModelSelection` — `{ provider, model }` — is the only planning-model vocabulary on the planning wire.

- `PlanMessage.ranUnder?: PlanningModelSelection` records the pair stamped on a turn-opening human message.
- `PlanMessage.generatedBy?: PlanningModelSelection` records the pair captured when an assistant reply started.
- `MercurianCreatePlanInput.modelChoice?` and `MercurianAppendPlanMessageInput.modelChoice?` are the same optional pair. Absence means inherit the standing choice.

The first implementation’s directive and record-with-mode types are removed. An older payload containing the retired `followedDefault` property still decodes because it is excess data; no migration is warranted for development-stage history.

**Standing choice:** walk first-parent ancestry from the current position, self-inclusive. The nearest message with `ranUnder` answers with that pair. No record answers `null`. Forks inherit because their ancestry is shared; branches diverge when a message stamps a different pair.

**Stamping rule, inside the same PlanningStore transaction as the message append:**

1. An explicit `modelChoice` is stamped.
2. Otherwise the nearest ancestor’s pair is stamped.
3. With no ancestor record, the `lastUsed` value supplied by `ws.ts` is stamped.
4. With none of those, no stamp is written; the message can land without a reply.

There is no live default or mode to follow. The last-used value seeds only a bare history; once a branch has a record, history wins.

### Server

- **Contracts:** the message and two command inputs use `PlanningModelSelection` directly. The workspace subscription remains, while the public planning-model setter method, RPC entry, authorization row, and client mutation are removed.
- **`PlanningStore.ts`:** `CreatePlanInput` and `AppendMessageInput` accept `modelChoice?` and `lastUsed`; `standingModelChoice` returns a pair or `null`; assistant messages keep `generatedBy` unchanged.
- **`PlanningAssistant.ts`:** `StartTurnInput.ranUnder?` is a pair. `startTurn` resolves `ranUnder ?? workspaceSnapshot.planningModel`. The fallback covers older/bare messages; `unset` now means no record and nothing has ever run. `tryImplement` resolves `standing ?? lastUsed`.
- **`WorkspaceSettingsStore.ts`:** storage and subscription retain the `planningModel` field. The internal writer is `recordLastUsedPlanningModel(selection)` and cannot clear the value through a user act.
- **`ws.ts`:** create and append read last-used, pass it with the optional choice, then record the returned stamp as last-used before kicking off the assistant with exactly that stamp. This keeps the commit, seed, and turn start in agreement.

### Client

- **Standing and drafts:** `PlanModelChoice.logic.ts` returns a pair or `null`. `planComposerStore` keeps `{ directive: pair, atHead }`; the historical property name remains local storage structure, while its value is pair-shaped. `planDraftStore.modelChoice` is also a pair. A flip remains head-keyed, persistent, draft-local intent.
- **Effective pair:** `PlanningSpace` computes `flip ?? standing ?? lastUsed`. Both live and unborn composers show that value and send the pair they show. An unset unborn plan can still be created without a reply; the live composer gates until a pair is chosen.
- **Picker adapter:** `PlanModelPicker.tsx` renders `ProviderModelPicker`. `deriveProviderInstanceEntries` maps snapshots to `ProviderInstanceEntry[]`; resolved pairs use the resolving instance, while an unresolvable pair displays on that provider’s default instance when present. Selection maps back through `entry.driverKind`, so no account id reaches history.
- **Unavailable models:** wrapper logic builds instance-keyed curated options with `getAppModelOptionsForInstance`, injects a missing recorded slug as disabled, and uses `describePlanningModel` for M-97’s no-instance/model-unavailable and upgrade wording.
- **Composer:** `PlanComposer.tsx` remains presentational but mirrors `ChatComposer`’s rounded frame, bottom toolbar, `ComposerControl` buttons, bottom-left model picker, and message-action send/stop styling.
- **Settings:** the Planning model row and component are deleted. `usePlanningModel` retains subscription/provider/resolution reads and loses the setter.
- **Timeline:** `generatedBy` renders as a quiet provider · model line inside the assistant reply's hover-revealed action row — the same element as the copy action and timestamp — so it appears only on hover. _(2026-08-18 amendment: it originally stood always-visible beside that row, which read as text floating to the right of controls that only exist on hover.)_

### Docs

- `docs/user/settings.md` no longer advertises a planning default.
- `docs/user/projects-and-threads.md` explains last-used seeding, the shared coding-session picker, per-branch inheritance, draft locality, and unchanged gating.
- `docs/internals/glossary.md` defines the pair record, nearest-ancestor standing choice, and last-used seed.

## Gaps where the AC outran the repo

None require new architecture. The machine-local picker necessarily displays an instance while the durable record cannot name one; the wrapper is the adapter boundary. A future merge can stamp its own explicit pair under the same rule without changing the record shape.

## Implementation Checklist

- [x] Pair-only contracts for `ranUnder` and both model-choice inputs; `generatedBy` unchanged.
- [x] Remove the public workspace planning-model setter end to end.
- [x] Store explicit → standing → last-used stamps transactionally; return pair/none from standing derivation.
- [x] Record every stamped turn-opening pair as workspace last-used before kickoff.
- [x] Resolve assistant turns from the stamp, with last-used fallback; resolve implement from standing then last-used.
- [x] Convert live and unborn client drafts to pair semantics.
- [x] Reuse `ProviderModelPicker` and composer controls without editing upstream-owned files.
- [x] Preserve an unresolvable pair by injecting its slug as a disabled option.
- [x] Remove the Providers Settings row and setter hook.
- [x] Keep timeline attribution unchanged and update user/internal documentation.
- [x] Do not add a migration, commit kind, plan field, RPC, instance id, mobile work, or reducer work.

## Test Plan

Server, with `@effect/vitest` and `MercurianSqlite.layerMemory`:

- `PlanningStore.test.ts`: explicit stamp; bare last-used seed; nothing-anywhere no stamp; nearest ancestor across a fork; pair/none standing result; old excess `followedDefault` payload decode; `generatedBy` persistence.
- `PlanningAssistant.test.ts`: stamped and bare-seeded turns; model-switch rebuild; provider-independent forks; unset/no-instance/model-unavailable refusals; settled attribution; standing-pair implement resolution.
- `WorkspaceSettingsStore.test.ts`: null before first use, pair round-trip/replacement, mutation signal, corrupt-value refusal.
- `server.test.ts`: wire mocks match the pair shape; append inherits and re-stamps; the settings subscription reports the sent pair as last-used.

Web, with pure logic tests and static markup where rendering is involved:

- `PlanModelChoice.logic.test.ts`: nearest ancestor, fork inheritance, pair/none result.
- `PlanModelPicker.logic.test.ts`: pair↔instance mapping, default-instance display fallback, disabled reasons and upgrade advisory, missing-slug injection/no rewrite.
- `planComposerStore.test.ts`: pair-shaped head-keyed flip, persistence, and clearing.
- `PlanComposer.logic.test.ts`: picker-directed unset copy and remaining gate states.
- `PlanTimeline.test.tsx`: attribution stays visible and absent on old replies.

Verification uses targeted `vp test run <files>` commands and scoped typechecks in `packages/contracts`, `apps/server`, and `apps/web`; no repo-wide check or browser pass is part of this plan.

## Findings carried out of discovery

- **Last-used is a seed, not standing state.** Applying it only when ancestry has no record prevents activity on one plan from moving established branches elsewhere.
- **The turn trusts the stamp.** Passing the returned `ranUnder` into kickoff keeps history honest against any later workspace activity.
- **Pair-only history is sufficient.** The nearest record fully determines descendants; retaining a mode would recreate the retired mutable default.
- **Unresolvable means preserve.** UI option lists are machine facts and may be incomplete; history is authoritative, so a missing slug is injected for display and disabled rather than normalized or replaced.
- **The adapter is the complexity boundary.** The picker can be instance-aware while the durable selection stays portable because mapping in both directions lives in one Mercurian wrapper.
