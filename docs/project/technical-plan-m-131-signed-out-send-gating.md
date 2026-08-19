# Technical Plan — M-131: Signed-out providers gate sending

_Generated from the Goal/AC of Linear issue M-131; also mirrored into the issue. Grounded against `main` at `2d469fc4e` — after M-107 (implement gate), M-128 (per-branch planning model), M-109 (specs), and M-130 (mock provider) landed. Every file touched is Mercurian-owned except one deliberate ADR 004 upstream edit: `apps/server/src/provider/Layers/ClaudeProvider.ts`, whose auth probe the AC walk found misreporting a signed-out CLI as authenticated (see the probe finding below). Two recorded invariants stay intact: a plan can always be born (the draft composer stays non-blocking), and a message that lands, lands unconditionally — the gate is the composer speaking first, never the server refusing._

**Goal, in one sentence:** teach `resolvePlanningModel` that an installed-but-signed-out provider cannot run a turn — a new `not-signed-in` unresolved reason — so the composer gate, refusal frames, picker display, and implement gate all close and explain honestly, and lift again the moment sign-in lands in a provider snapshot refresh.

**Scope fences:** no new gate machinery (the M-104 gate is the vehicle); no change to message landing; drafts stay informational; coding-session pickers untouched; the recorded choice is never rewritten.

## What discovery found: one predicate is auth-blind, and everything downstream renders reasons

- **The root cause is one filter.** Candidacy in `resolvePlanningModel` (`packages/contracts/src/mercurianWorkspace.ts`) is `driver match + isProviderAvailable + enabled + installed`. `isProviderAvailable` (`packages/contracts/src/server.ts`) checks only `availability !== "unavailable"`; `auth.status` is never consulted, and an installed CLI reports its full model list regardless of sign-in. So a signed-out machine resolves, the gate opens, and every send starts a reply that can only fail.
- **Auth state is already on the snapshot, typed.** `ServerProviderAuth.status` ∈ `authenticated | unauthenticated | unknown`; the probe/refresh machinery keeps it live, and clients re-derive resolution on every snapshot change (`useResolvableProviders` in `apps/web/src/state/mercurianWorkspace.ts`) — which is what makes "signing in lifts the gate without restart" free once resolution consults auth.
- **M-128 changed what "the selection" is.** The effective choice in `PlanningSpace.tsx` is `modelChoice = draft flip ?? branch standing ?? last-used seed`, resolved as `effectiveModelResolution`; the workspace Settings planning-model row is gone, and the composer's `PlanModelPicker` is now the surface that shows the recorded pair and its standing. `describePlanningModel` moved to `apps/web/src/components/mercurian/PlanningModel.logic.ts` (record-centric register: "The model stays selected and resolves wherever one exists").
- **Two consumers landed after the original M-131 work and must learn the reason:**
  - `PlanModelPicker.logic.ts`'s `planningModelDisabledReason` resolves each menu model and disables unresolved ones. Left alone, a signed-out provider's every model would render disabled — violating the vault's "picker keeps offering" refinement. `not-signed-in` must not disable.
  - `PlanningAssistant.tryImplement` forwards `resolution.reason` into `ImplementBlockedError`, whose `ImplementBlockedReason` literals (`packages/contracts/src/mercurian.ts`) don't include `not-signed-in`; the widening is required for the server to typecheck, and gives the implement path the same honest after-the-fact answer.
- **The draft composer is already the informational variant** (`PlanningSpaceDraft` passes the gate notice as non-blocking `notice`) — the AC's draft clause is true today and must merely stay true.
- **The recorded pair already renders from the record, never the options** (`describePlanningModel`'s stated rule), so "never rewrites the choice" needs no new code, only a test that pins it for the new state.
- **M-130's mock provider is always `authenticated`** (`apps/server/src/provider/Drivers/MockDriver.ts`), so it never trips this gate — a fresh dev workspace stays sendable.

## Conventions Detected

| Convention                                                                                                                                                              | Evidence                                                                                                                | Confidence |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| Resolution logic is a pure contracts helper with the rule stated once in its doc comment; client picker/gate and server turn start + implement all call it              | `resolvePlanningModel`; `PlanningAssistant.startTurn`/`tryImplement`; `derivePlanModelPickerState`; `PlanningSpace.tsx` | High       |
| Can't-reply states are literal reasons flowing through exhaustive switches: gate notice, refusal notice, picker display, `turn-refused` frame, `ImplementBlockedReason` | `PlanTurnRefusalReason`, `PlanComposer.logic.ts`, `PlanningModel.logic.ts`, `mercurian.ts`                              | High       |
| Gate wording register (M-128): state the fact, name where to fix it, point at the picker that owns the choice; the machine never rewrites the recorded value            | `planningModelGateNotice`, `describePlanningModel` messages on main                                                     | High       |
| Additive contract evolution; web logic pure in `.logic.ts` with co-located vitest; targeted `vp test run`, no repo-wide checks                                          | repo-wide, AGENTS.md §Verifying                                                                                         | High       |
| Commits `feat(scope): … (M-131)`, branch `venk/m-131-<slug>`; plan docs at `docs/project/`                                                                              | `git log`, existing plans                                                                                               | High       |

## Design

### 1. Resolution learns sign-in: a third unresolved reason, preferring authenticated instances

In `resolvePlanningModel` (`packages/contracts/src/mercurianWorkspace.ts`):

- Candidacy (installed + enabled + available) is unchanged — sign-in is a _readiness_ fact, not a candidacy fact; the distinction keeps `no-instance` meaning "nothing of this provider here."
- Among candidates offering the model, partition by `auth.status`. `unauthenticated` instances are set aside; `authenticated` **and** `unknown` remain usable — `unknown` is the probe failing to tell, and gating on ignorance would false-block working setups. The decisive call, recorded: **only an explicit `unauthenticated` gates.**
- If usable offerers exist: pick as today (default instance first, then snapshot order) — a machine with one signed-in and one signed-out instance quietly resolves to the signed-in one, new behavior the old rule got wrong.
- If offerers exist but all are explicitly unauthenticated: `{ _tag: "unresolved", reason: "not-signed-in" }`.
- `no-instance` and `model-unavailable` keep their exact meanings and precedence.

`PlanTurnRefusalReason` and `ImplementBlockedReason` (`packages/contracts/src/mercurian.ts`) each gain `"not-signed-in"`; `PlanningAssistant.startTurn` and `tryImplement` already forward `resolution.reason`, so the server side is the type widening plus nothing.

### 2. The surfaces render the new reason; the picker keeps offering — and keeps choosable

- `planningModelGateNotice` and `turnRefusalNotice` (`apps/web/src/components/mercurian/PlanComposer.logic.ts`) gain the effective selection as a first argument (to name the provider) and a `not-signed-in` case in M-128's register: gate — "Not signed in to {provider} on this machine — sign in from Settings → Providers to hear back from the assistant."; refusal — "The message was sent, but {provider} isn't signed in on this machine." Existing wordings unchanged.
- `PlanningSpace.tsx` threads `modelChoice` into both helpers at the live and draft call sites (mechanical).
- `describePlanningModel` (`PlanningModel.logic.ts`) renders the signed-out state in the record-centric register, naming the instance whose sign-in would fix it: "Not signed in to {instance label}. The model stays selected and resolves once you sign in." The upgrade nudge attaches only to `model-unavailable`. The recorded pair keeps rendering from the record — pinned by test.
- `planningModelDisabledReason` (`PlanModelPicker.logic.ts`) returns `null` for a `not-signed-in` resolution: **the picker keeps offering — and keeps choosable — a signed-out provider's models.** Choosing a model you intend to sign into is legal; the gate, not absence, says it can't run yet. This is the deliberate offering/readiness asymmetry (vault: Providers, 2026-08 resolution).
- Draft composer: unchanged wiring; the wording flows through the same informational `notice` prop.

### 3. Liveness: sign-in lifts the gate through the existing snapshot stream

No new plumbing: sign-in changes the probed `auth.status`, the snapshot re-emits on `streamChanges`, `useResolvableProviders` recomputes, and the gate re-evaluates. The Providers page's refresh affordance covers a probe that hasn't noticed yet; the manual walk verifies the lag is the probe's, not this feature's.

### 4. Composition with what landed

M-128's effective selection flows through the same `resolvePlanningModel`; the gate/refusal surfaces consume whatever resolution they're handed — no coupling in either direction. M-130's mock is always `authenticated`, so it never trips this gate. M-107's implement path refuses with the same widened reason literal, surfaced through the existing `ImplementBlockedError` message.

## Implementation Checklist

- [ ] `packages/contracts/src/mercurianWorkspace.ts` — `not-signed-in` on `PlanningModelResolution`; the partition-by-auth rule in `resolvePlanningModel`, doc comment stating it once.
- [ ] `packages/contracts/src/mercurianWorkspace.test.ts` — resolver cases (below).
- [ ] `packages/contracts/src/mercurian.ts` — `"not-signed-in"` joins `PlanTurnRefusalReason` **and** `ImplementBlockedReason`.
- [ ] `apps/server/src/mercurian/assistant/PlanningAssistant.ts` (+ test) — no logic change beyond the widened types; pin that the refusal frame carries the new reason and the message still lands.
- [ ] `apps/web/src/components/mercurian/PlanComposer.logic.ts` (+ test) — both notices learn the reason and the provider name.
- [ ] `apps/web/src/components/mercurian/PlanningModel.logic.ts` (+ test) — `describePlanningModel` renders the signed-out state; upgrade nudge stays on `model-unavailable` only.
- [ ] `apps/web/src/components/mercurian/PlanModelPicker.logic.ts` (+ test) — `planningModelDisabledReason` exempts `not-signed-in`; options derivation untouched.
- [ ] `apps/web/src/components/mercurian/PlanningSpace.tsx` — thread the effective selection into the notice helpers (mechanical).
- [ ] `apps/server/src/provider/Layers/ClaudeProvider.ts` (+ registry test) — the probe runs `claude auth status` and maps an explicit `loggedIn: false` to an `unauthenticated` snapshot that keeps the model list; exit code ignored (the CLI exits 1 exactly when logged out); spawn failure/timeout/unparseable output falls back to the previous path.
- [ ] Docs ride the PR: the gate's states in `docs/user/projects-and-plans.md` (composer gating sentence + "The planning model" resolution paragraph).
- [ ] Do **not** gate on an `unknown` auth status, hide or disable signed-out providers' models in the picker, block the draft composer, rewrite the recorded selection, or touch message landing.
- [ ] Commits: `feat(contracts): …`, `feat(web): … (M-131)` on branch `venk/m-131-signed-out-providers-gate-sending-the-composer-says-why-the`.

## Test Plan

Unit — contracts (`vp test run packages/contracts/src/mercurianWorkspace.test.ts`):

- [ ] Sole offering instance `unauthenticated` → `not-signed-in`; `unknown` → resolved; `authenticated` → resolved.
- [ ] Two instances, default signed out, other signed in and offering → resolves to the signed-in one (the new preference).
- [ ] All candidates signed out but none offering the model → still `model-unavailable` (precedence unchanged); no candidates → still `no-instance`.
- [ ] Existing resolver cases pass unchanged.

Unit — web logic:

- [ ] Gate and refusal notices for `not-signed-in` name the provider and point at where to fix it; existing wordings unchanged.
- [ ] `describePlanningModel` signed-out message; recorded pair still rendered from the record; no upgrade nudge on `not-signed-in`.
- [ ] `planningModelDisabledReason`: a signed-out provider's models are offered and not disabled.

Unit — server (`vp test run apps/server/src/mercurian/assistant/PlanningAssistant.test.ts`):

- [ ] A turn against a sole unauthenticated offerer emits `turn-refused` with `not-signed-in`; the message landed first.

Manual, against the AC (dev app; a real CLI signed out via its own logout):

- [ ] Installed-but-signed-out provider as the effective model → live-plan composer gates with the signed-out message; draft composer shows it but sends.
- [ ] Sign in via the CLI, refresh providers → the gate lifts, no restart, no re-pick.
- [ ] All four states produce distinct wording (unset / no-instance / not-signed-in / model-unavailable).
- [ ] Second window racing a sign-out: the message lands and the refusal notice explains.
- [ ] The picker keeps showing the recorded pair and keeps the signed-out provider's models choosable.

## Findings carried out of discovery

- **An `unknown` auth status is treated as usable** — the line between gating on knowledge and gating on ignorance. If a driver reports `unknown` while actually signed out, fix the driver's probe, not this rule.
- **The Claude probe was that driver, and worse** — it reported a signed-out CLI as _authenticated_: `claude auth status` was never run (the SDK-init capabilities probe succeeds signed-out, and any truthy result mapped to authenticated), and the CLI exits 1 exactly when logged out, so the fix parses stdout/stderr regardless of exit code. Found by the AC walk, fixed on this branch as the plan's own finding prescribed — the branch's one ADR 004 upstream edit.
- **The offering/readiness asymmetry** (picker lists and stays choosable; gate blocks) is recorded in the vault's Providers note (2026-08 resolution) and the Composer note's four can't-reply states — and now has a concrete enforcement point in `planningModelDisabledReason`.
- **Signed-in-instance preference is a behavior change beyond gating**: multi-instance machines now resolve past a signed-out default instead of failing on it. Strictly better, but new — recorded so the test pinning it isn't "fixed" away.
- **The implement gate rides along**: `tryImplement` refuses `not-signed-in` through `ImplementBlockedError` — the same honesty, after the fact, for the implement path.
