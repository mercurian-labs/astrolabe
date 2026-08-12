# Technical Plan — M-130: Mock provider for dev mode — mock planning replies with zero setup

_Generated from the Goal/AC of Linear issue M-130 (see the issue for the full AC). Built on the t3code-fork base as it stands at M-125, under [ADR 004](../architecture/fork-baseline.md) (Mercurian code additive; minimal edits in upstream-owned files — this plan spends its budget on four small additive edits, named below). The mock rides the fork's generic provider layer, so it is not Mercurian-only machinery: in dev it is equally usable from t3code thread surfaces — a side effect, not a goal._

**Goal, in one sentence:** ship a `mock` provider driver that is registered only when a dev flag says so, always reports installed/ready/signed-in with a small model list, synthesizes deterministic runtime events (streaming text, stop, plan revision, structured question, grounding) instead of spawning any CLI — and, on a dev server whose workspace has no planning model, seed the planning default to it so a fresh dev workspace plans out of the box.

**Scope fences:** no presence outside dev mode (unregistered driver → the existing unavailable-shadow path); coding sessions untouched; no network, no process spawn, no new dependency.

## What discovery found

- **The driver SPI is the whole seam.** `ProviderDriver` ([provider/ProviderDriver.ts:119](../../apps/server/src/provider/ProviderDriver.ts)) is a plain value: `driverKind`, `metadata`, `configSchema`, `defaultConfig`, and `create()` returning a `ProviderInstance` (snapshot source + adapter). [GrokDriver.ts](../../apps/server/src/provider/Drivers/GrokDriver.ts) (163 lines) is the smallest complete template, including `makeManagedServerProvider` for the snapshot lifecycle.
- **`ProviderDriverKind` is an open branded slug** ([contracts/src/providerInstance.ts:70](../../packages/contracts/src/providerInstance.ts)) — `"mock"` needs no contracts change to exist, and `PROVIDER_DISPLAY_NAMES` is a `Partial` record whose consumers fall back to `formatProviderDriverKindLabel` ("Mock"), so no upstream contracts edit is required at all.
- **Registration is a static array with one consumer.** `BUILT_IN_DRIVERS` ([provider/builtInDrivers.ts](../../apps/server/src/provider/builtInDrivers.ts)) feeds `ProviderInstanceRegistryHydration` ([Layers/ProviderInstanceRegistryHydration.ts:78,168](../../apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts)), which synthesizes default instances **only from legacy `settings.providers.<kind>` mirrors** — a mock driver has no legacy key in the closed `ServerSettings.providers` struct, so its default instance needs an explicit bootstrap branch (Design §2).
- **An unregistered driver already degrades correctly.** `ProviderInstanceRegistryLive`'s header documents it: an entry whose `driver` is unknown to this build becomes an `"unavailable"` shadow snapshot — so a saved `mock` reference in a non-dev run resolves `no-instance` and the composer gate closes. The last AC is satisfied by existing machinery.
- **The mock adapter is nine-tenths written.** [integration/TestProviderAdapter.integration.ts](../../apps/server/integration/TestProviderAdapter.integration.ts) implements `ProviderAdapterShape` with queued scripted events; what it lacks for dev use is self-driving behavior (it replays queues a test hands it) and a production home (it lives in the integration harness, outside `src/`).
- **The dev signal has a precedent.** Env-derived config lives in [cli/config.ts](../../apps/server/src/cli/config.ts) (`Config.boolean("T3CODE_…")` per field → `ServerConfig`), and [scripts/dev-runner.ts:796](../../scripts/dev-runner.ts) already defaults an env var for dev runs (`T3CODE_BUNDLED_DEV = "1"` when unset) — the exact pattern for `T3CODE_MOCK_PROVIDER`. Note the server has _no_ general "am I dev" fact (`devUrl` covers only Vite-served web), so an explicit flag is the honest signal.
- **The planning-default seed has a home and an idempotence rule for free.** `WorkspaceSettingsStore` ([mercurian/workspace/WorkspaceSettingsStore.ts](../../apps/server/src/mercurian/workspace/WorkspaceSettingsStore.ts)) exposes `getSnapshot`/`setPlanningModel`; null means "no one has chosen yet", which is exactly the only state a seed may overwrite.
- **The turn loop needs nothing.** `PlanningAssistant` consumes `ProviderService.startSession`/`sendTurn`/`streamEvents` and folds canonical `ProviderRuntimeEvent`s — a mock adapter that emits `content.delta`, `turn.completed`, `user-input.requested`, and item events exercises streaming, stop, questions, and grounding with zero planning-side changes. The plan-revision behavior arrives through the MCP door the same way a real provider's would… except a mock adapter does not run an MCP client — so the mock's "revise the plan" behavior is delivered differently (Design §3).

## Conventions Detected

| Convention                                                                                                                                                                | Evidence                                                   | Confidence |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| Drivers are plain-value SPI implementations in `provider/Drivers/<Name>Driver.ts`, registered via the drivers array, materialized per instance in a child scope           | `ProviderDriver.ts`, `GrokDriver.ts`, `builtInDrivers.ts`  | High       |
| Snapshots are built with `makeManagedServerProvider` and stamped with instance identity                                                                                   | `GrokDriver.ts:97–149`                                     | High       |
| Env-derived server config: `Config.*("T3CODE_…")` in `cli/config.ts` → a `ServerConfig` field; dev-runner defaults dev-only vars when unset                               | `cli/config.ts:79–118`, `dev-runner.ts:796`                | High       |
| Adapter behavior is exercised through canonical `ProviderRuntimeEvent`s; the integration harness's `TestProviderAdapter` is the in-repo reference for a synthetic adapter | `providerRuntime.ts`, `TestProviderAdapter.integration.ts` | High       |
| Mercurian server code additive under `mercurian/`; boot-time effects join the Mercurian block in `server.ts`                                                              | `server.ts:249+` (M-97's wiring precedent)                 | High       |
| Tests co-located; server tests `@effect/vitest`, drained streams, no sleeps; targeted `vp test run`                                                                       | AGENTS.md §Verifying                                       | High       |
| Commits `feat(scope): … (M-130)`, branch `venk/m-130-<slug>`; plan docs at `docs/project/`                                                                                | `git log`, existing plans                                  | High       |

## Design

### 1. The flag: `T3CODE_MOCK_PROVIDER`, defaulted on by the dev-runner

- `cli/config.ts`: `mockProviderEnabled: Config.boolean("T3CODE_MOCK_PROVIDER").pipe(Config.withDefault(false))`; `ServerConfig` gains the field. **(upstream-owned edit 1, additive)**
- `scripts/dev-runner.ts`: beside the `T3CODE_BUNDLED_DEV` default, set `T3CODE_MOCK_PROVIDER = "1"` when unset — every `vp run dev` variant (web, server-only, desktop) gets the mock; an explicit `=0` opts out. **(upstream-owned edit 2, additive)**
- Production and `npx astrolabe` runs never set the var, so the driver never registers there. "Dev mode" is thereby a deliberate launch fact, not an inference.

### 2. The driver: `provider/Drivers/MockDriver.ts` (new)

`driverKind: "mock"`, `metadata: { displayName: "Mock", supportsMultipleInstances: false }`, `configSchema`: an empty struct with defaults (`defaultConfig: () => ({})` — there is nothing to configure), `create()`:

- **Snapshot**: built with `makeManagedServerProvider`, but with a constant `checkProvider`: `installed: true`, `version: "mock"`, `status: ready`, `auth: { status: "authenticated", label: "Mock" }`, `models`: two entries — `mock-default` ("Mock") and `mock-verbose` ("Mock (verbose)") — so model-switch flows are testable. No maintenance capabilities (`makeManualOnlyProviderMaintenanceCapabilities`, `packageName: null`), no version advisory, ever.
- **Adapter**: `provider/Layers/MockAdapter.ts` (new) — `ProviderAdapterShape` implemented from scratch in `src/`, borrowing `TestProviderAdapter`'s session bookkeeping but **self-driving**: each `sendTurn` synthesizes its own event script instead of replaying a queue. The integration harness's adapter stays where it is, untouched — tests keep their explicit-queue control; the dev mock's job is to behave without a test driving it.

Registration: `builtInDrivers.ts` keeps `BUILT_IN_DRIVERS` as-is; the two call sites that consume it via hydration receive `effectiveDrivers = mockProviderEnabled ? [...BUILT_IN_DRIVERS, MockDriver] : BUILT_IN_DRIVERS`, assembled where the registry layers are wired with `ServerConfig` in hand. **(upstream-owned edit 3, additive — a parameter, not a rewrite)**

Bootstrap: `deriveProviderInstanceConfigMap` ([ProviderInstanceRegistryHydration.ts:60+](../../apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts)) gains one branch: a driver in the effective list with **no legacy mirror key** synthesizes its default instance from `driver.defaultConfig()` when no explicit `providerInstances` entry claims the slot. Guarded by a `metadata.bootstrapWithoutSettings: true` flag on the driver (only the mock sets it), so the branch cannot accidentally bootstrap a future real driver. **(upstream-owned edit 4, additive)**

### 3. The mock's behavior: deterministic, message-steerable

The adapter's turn script is derived from the user message, so every renderable state is reachable on demand and repeatably (the AC's determinism clause):

- Default: a short canned reply streamed as `content.delta` chunks (`streamKind: "assistant_text"`) on a fixed cadence, then `turn.completed`. `mock-verbose` streams a longer body — enough to exercise fold/minimap behavior.
- `/question` in the message → `user-input.requested` with one fixed two-option `UserInputQuestion`; the answer resumes and completes the turn (echoing the chosen option).
- `/ground` → a fixed series of file-read/search-shaped item events before the reply, so the grounding fold renders.
- `/revise` → the mock reply _includes_ a plan revision. Discovery's wrinkle: real providers revise through the per-session MCP door, which a synthetic adapter has no client for. Rather than teach the mock to speak MCP (new machinery, new dependency — refused), `MockAdapter` accepts an optional `onPlanRevision` callback in its create options; the **driver** leaves it unset, and `PlanningAssistant` needs no change — instead the mock emits its revision as an ordinary tool-shaped item event _plus_ the reply text stating what it would have written. **Decisive call, recorded:** the MCP write door stays the only plan-revision path; the mock exercises the _rendering_ of revisions no further than a real declined-tool turn would. If dev work later needs true mock revisions, the seam is a dev-only MCP client in the adapter — deliberately not built now. The AC's "plan revision reachable" is satisfied at the surface level the timeline renders for every other commit: by a human-visible mock reply plus the existing direct-edit path; the issue's checkbox should be checked against this recorded narrowing or the AC amended.
- Interrupt: `interruptTurn` emits `turn.aborted` immediately — stop and the interrupted mark work end to end.

Everything is deterministic (fixed scripts, fixed cadence, no randomness) and offline by construction: no spawn, no network, no filesystem beyond what `makeManagedServerProvider` requires.

### 4. Seeding the planning default in dev

A small boot effect in the Mercurian block of [server.ts](../../apps/server/src/server.ts) (beside the M-97 store wiring): when `ServerConfig.mockProviderEnabled` and `WorkspaceSettingsStore.getSnapshot` reports `planningModel: null`, write `{ provider: "mock", model: "mock-default" }`. Null is the only state overwritten — an explicit choice (including an explicit clear that someone re-chooses later) is never touched after the first seed, which is what keeps "a default, not an override" true. The Settings row then honestly shows what the workspace runs under; nothing is hidden in resolution logic.

Dev state lives in the worktree's own `.t3` (or `.t3/dev` under a Vite dev URL — [config.ts:105](../../apps/server/src/config.ts)), so the seed never leaks into a real user's `userdata`.

### 5. What this plan deliberately does not touch

Planning assistant, planning store, contracts, and every client surface: the mock arrives through the same snapshots and events as real providers, so pickers, gates, resolution, and timelines need nothing. `TestProviderAdapter` and the integration harness: untouched. Mobile: parked.

## Implementation Checklist

- [ ] `apps/server/src/cli/config.ts` + `config.ts` — `T3CODE_MOCK_PROVIDER` → `ServerConfig.mockProviderEnabled` (additive upstream edit).
- [ ] `scripts/dev-runner.ts` — default the var to `"1"` when unset, beside `T3CODE_BUNDLED_DEV` (additive upstream edit).
- [ ] `apps/server/src/provider/Layers/MockAdapter.ts` (+ test) — self-driving `ProviderAdapterShape`: scripted streaming, `/question`, `/ground`, `/revise` behaviors, immediate abort; no spawn, no network.
- [ ] `apps/server/src/provider/Drivers/MockDriver.ts` (+ test) — constant-ready snapshot with the two mock models; `metadata.bootstrapWithoutSettings: true`.
- [ ] `apps/server/src/provider/ProviderDriver.ts` — optional `bootstrapWithoutSettings` metadata flag (additive upstream edit).
- [ ] `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts` (+ test) — effective-drivers parameter; defaultConfig bootstrap branch for flagged drivers (additive upstream edit).
- [ ] Wire `effectiveDrivers` where the registry layer meets `ServerConfig`.
- [ ] `apps/server/src/server.ts` — the Mercurian-block seed effect: mock enabled + null planning model → seed `mock`/`mock-default`.
- [ ] Docs: `docs/internals/overview.md` dev-workflow note (mock provider, the env var, opting out); **no `docs/user/` entry** — the mock never exists in a shipped build.
- [ ] Do **not** add a dependency, register the mock unconditionally, touch the integration harness, or let the mock appear in any code path when the flag is off.
- [ ] Commits: `feat(server): … (M-130)`, `chore(dev): … (M-130)` on branch `venk/m-130-mock-provider-dev-mode`.

## Test Plan

Unit — server (`vp test run` on the touched files):

- [ ] `MockAdapter.test.ts` — a turn streams deltas then completes; `/question` pauses with the fixed question and resumes on answer; `/ground` emits item events before text; interrupt yields `turn.aborted`; two sessions share no state; scripts are byte-deterministic across runs.
- [ ] `MockDriver.test.ts` — snapshot constant-ready (installed, authenticated, two models, no advisory); `create` twice → independent instances.
- [ ] `ProviderInstanceRegistryHydration.test.ts` — flagged driver with no legacy mirror bootstraps its default instance; unflagged drivers don't; an explicit `providerInstances["mock"]` entry wins; with the mock absent from the effective list, a saved `mock` entry surfaces as the unavailable shadow (existing behavior, now pinned for this driver).
- [ ] Seed effect test — null planning model + flag → seeded once; non-null → untouched; flag off → untouched.

Manual (dev app, `vp run dev` with a fresh worktree `.t3`):

- [ ] Fresh dev workspace: create a plan, send — a mock reply streams with zero configuration; Settings → Providers shows Mock ready and the planning model set to it.
- [ ] Stop mid-reply → interrupted mark; `/question` → question card, answering resumes; `/ground` → grounding fold renders.
- [ ] Pick a real provider/model in Settings — subsequent turns use it; the mock does not reassert itself.
- [ ] `T3CODE_MOCK_PROVIDER=0 vp run dev` — no mock anywhere; the previously-seeded workspace setting shows as unavailable/no-instance and the composer gates (nothing errors).
- [ ] `node apps/server/src/bin.ts` (no flag) — no mock registered.

## Findings carried out of discovery

- **The `/revise` narrowing** (Design §3) is the one place the plan delivers less than a literal reading of the AC: true mock plan revisions require an MCP client in the adapter, refused as machinery. Check the AC against the recorded narrowing or amend the issue.
- **Four small upstream-owned edits** (config field, dev-runner default, metadata flag, hydration branch) — all additive, each a few lines, within ADR 004's budget; the drivers array itself is untouched.
- **The mock is visible to t3code thread surfaces in dev** (it's a real registered provider). Harmless and occasionally useful; noted so nobody mistakes it for leakage — the fence is the flag, not the surface.
- **Composes with M-128/M-131**: the mock is always signed-in, so M-131's gate never fires on it; under M-128 a per-plan override to the mock works like any other pair. Neither is a dependency.
