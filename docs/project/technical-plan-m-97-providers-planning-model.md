# Technical Plan — M-97: Providers — machine-scoped instances and the planning-model setting

_Generated from the Goal/AC of Linear issue M-97 (see the issue for the full AC). Implements backlog 041 (Phase 4 — Assistant and providers) on the t3code-fork base as it stands at M-93/M-108, under [ADR 001](../architecture/local-first-runtime.md) (local-first: the Mercurian workspace lives in its own database) and [ADR 004](../architecture/fork-baseline.md) (bounded tracking: Mercurian code additive, minimal edits in upstream-owned files). Design sources are the almagest vault notes the issue cites: Providers (resolved 2026-07: machine-scoped), T3code Providers and T3code Settings (documented-as-built — describing this repository's own code), Settings, Assistant (resolved: a workspace setting), plus Coding Sessions for the picker-reuse fence._

**Goal, in one sentence:** make providers, provider instances, and models exist as configuration for both agent surfaces — which on this codebase means verifying that the t3code three-level pattern the fork already ships _is_ the instance grammar, curation, standing, gating, and nudges the vault resolved to adopt, and building the one genuinely new thing: a **workspace planning-model setting** that names a provider and model abstractly — never an instance — and is resolved by each machine to its own instance at runtime.

**Scope fences, restated from the issue:** the assistant that consumes the setting is 042's; per-session pickers for coding sessions are 061's (the pickers built here must merely stay reusable). Nothing in this plan starts a turn, and nothing adds a login flow of Mercurian's own.

## What discovery found: four of five ACs are already built

The issue says it plainly — "T3code Providers" is an extraction note that now describes our own code — and discovery verified it clause by clause:

- **AC 1 (instance grammar).** The three-level pattern is in [contracts/src/providerInstance.ts](../../packages/contracts/src/providerInstance.ts): `ProviderDriverKind` (the provider), `ProviderInstanceId` (one connected account — a user-defined slug, branded separately, minted once and never changed, because "everything that ever ran under an instance refers to it by that identity"), and models per instance. The creation wizard (pick provider, label, accent color via `ProviderAccentColorPicker`) is [AddProviderInstanceDialog.tsx](../../apps/web/src/components/settings/AddProviderInstanceDialog.tsx) + [AddProviderInstanceWizardSteps.tsx](../../apps/web/src/components/settings/AddProviderInstanceWizardSteps.tsx); label and accent color stay editable on the instance card while the id never changes ([ProviderInstanceCard.tsx](../../apps/web/src/components/settings/ProviderInstanceCard.tsx)); every provider has a default instance (`defaultInstanceIdForDriver`, providerInstance.ts:148) that resets to stock rather than disappearing (`buildProviderInstanceUpdatePatch` in [SettingsPanels.logic.ts:159](../../apps/web/src/components/settings/SettingsPanels.logic.ts) restores the legacy per-driver defaults on reset); added instances delete. All of it is housed at `/settings/providers`, which Mercurian's settings nav (M-93) already points at from the Workspace group.
- **AC 2 (standing, no login flow).** The `ServerProvider` snapshot ([contracts/src/server.ts:160](../../packages/contracts/src/server.ts)) carries `installed`, `auth: { status: authenticated | unauthenticated | unknown, label, email }`, `status`, and `message`; the server probes and caches it in [apps/server/src/provider/providerSnapshot.ts](../../apps/server/src/provider/providerSnapshot.ts) and [providerStatusCache.ts](../../apps/server/src/provider/providerStatusCache.ts). No login flow exists anywhere in the repo — signing in belongs to the provider's CLI, exactly the vault's line.
- **AC 3 (curation shapes every picker).** Favorites and per-instance model preferences (`hiddenModels`, `modelOrder`) live in `ClientSettings` ([contracts/src/settings.ts:96–110](../../packages/contracts/src/settings.ts)), are edited in [ProviderModelsSection.tsx](../../apps/web/src/components/settings/ProviderModelsSection.tsx), and are honored by the chat pickers ([ProviderModelPicker.tsx](../../apps/web/src/components/chat/ProviderModelPicker.tsx), [ModelPickerContent.tsx](../../apps/web/src/components/chat/ModelPickerContent.tsx)). One scope nuance recorded under Findings: curation is client-scoped (it follows the browser/app), t3code's semantics; the vault pins curation to the instance in Settings but does not pin its scope, so this plan keeps it as built.
- **AC 4 (gating and the update nudge).** Per-driver capability floors with explicit upgrade-naming messages are in the driver layers — e.g. [ClaudeProvider.ts:54–57, 350–365](../../apps/server/src/provider/Layers/ClaudeProvider.ts) ("…is too old for …. Upgrade to v… or newer to access it."), the OpenCode minimum-version floor ([OpenCodeProvider.ts:31, 376–387](../../apps/server/src/provider/Layers/OpenCodeProvider.ts)), the Cursor picker version-date gate. Gated models are omitted from the snapshot's `models` list, and the nudge is `versionAdvisory` (`behind_latest`, `latestVersion`, `canUpdate`) plus the one-click `updateState` machinery ([providerMaintenance.ts](../../apps/server/src/provider/providerMaintenance.ts)), toggleable via `ServerSettings.enableProviderUpdateChecks`.
- **AC 5 is the gap.** Nothing workspace-scoped exists. The repo's two standing model selections — `textGenerationModelSelection` and `sourceControlWriterModelSelection` in `ServerSettings` ([settings.ts:506–519](../../packages/contracts/src/settings.ts)) — both name a `ProviderInstanceId`, which is precisely the shape the planning-model setting must **not** take, and both live in `settings.json`, which is machine state. The planning-model setting is this plan's construction; everything above is verification and adaptation.

## Conventions Detected

| Convention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                                                        | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Mercurian server code is additive under `apps/server/src/mercurian/`, in its own `mercurian.sqlite` with its own migration sequence (001–002 landed, own tracking table, "deliberately not appended to upstream's sequence"); Mercurian `SqlClient` provided privately                                                                                                                                                                                                                                                                                    | [mercurian/persistence/Migrations.ts](../../apps/server/src/mercurian/persistence/Migrations.ts) header; the Mercurian block in [server.ts:249–251](../../apps/server/src/server.ts)                                                                                            | High       |
| Canonical single-file Effect service: schemas/refusals → `Context.Service` tag `"t3/mercurian/<area>/<Name>"` → `make` → `layer`; refusals as `Schema.TaggedErrorClass` with message getters; writes in transactions; a `PubSub`-backed `changes: Stream<void>` published by every mutation                                                                                                                                                                                                                                                               | [mercurian/planning/PlanningStore.ts](../../apps/server/src/mercurian/planning/PlanningStore.ts)                                                                                                                                                                                | High       |
| RPC surface: domain-owned method map in its own contracts file; `Rpc.make` consts + `WsRpcGroup` membership in [contracts/src/rpc.ts](../../packages/contracts/src/rpc.ts); scope per method in `RPC_REQUIRED_SCOPES` ([auth/RpcAuthorization.ts:24](../../apps/server/src/auth/RpcAuthorization.ts), type- and test-enforced; Mercurian rides the orchestration scopes under the recorded rationale at :33); handlers in [ws.ts](../../apps/server/src/ws.ts) wrapped in `observeRpcEffect`/`observeRpcStreamEffect` with `"rpc.aggregate": "mercurian"` | `MERCURIAN_WS_METHODS` end to end (contracts `mercurian.ts` → `rpc.ts` → `RpcAuthorization.ts` → `ws.ts:1050+`)                                                                                                                                                                 | High       |
| Small human-paced collections stream as snapshot-re-emit, no resume state: queue attached to `changes` before the first snapshot query, `Stream.debounce(50ms)`, re-query per signal                                                                                                                                                                                                                                                                                                                                                                      | the `subscribeTree` handler in `ws.ts`                                                                                                                                                                                                                                          | High       |
| Client data layer: atom factories in `packages/client-runtime/src/state/` with a shared write scheduler, instantiated in `apps/web/src/state/` over `connectionAtomRuntime`; streaming subscriptions register in `EnvironmentSubscriptionRpcTag`                                                                                                                                                                                                                                                                                                          | [client-runtime/src/state/mercurianPlanning.ts](../../packages/client-runtime/src/state/mercurianPlanning.ts), [apps/web/src/state/mercurian.ts](../../apps/web/src/state/mercurian.ts), [client-runtime/src/rpc/client.ts:42](../../packages/client-runtime/src/rpc/client.ts) | High       |
| Contracts host branded ids, Effect Schema shapes, and small derived helpers over their own types — no heavy runtime logic                                                                                                                                                                                                                                                                                                                                                                                                                                 | `isProviderAvailable` (server.ts:208), `defaultInstanceIdForDriver` (providerInstance.ts:148)                                                                                                                                                                                   | High       |
| Web UI: `ui/` primitives, lucide icons, behavior factored into pure `.logic.ts` with co-located vitest tests; Mercurian components in `components/mercurian/`; upstream-owned files get minimal edits (M-93's budget was a one-token redirect edit)                                                                                                                                                                                                                                                                                                       | `components/mercurian/*`, [SettingsNav.logic.ts](../../apps/web/src/components/mercurian/SettingsNav.logic.ts), ADR 004                                                                                                                                                         | High       |
| Settings surface: Mercurian nav (M-93) with the Workspace group — Trackers, **Providers**, Preferences, Archived; `/settings/providers` renders the fork's `ProviderSettingsPanel` ([SettingsPanels.tsx:1693](../../apps/web/src/components/settings/SettingsPanels.tsx))                                                                                                                                                                                                                                                                                 | [routes/settings.providers.tsx](../../apps/web/src/routes/settings.providers.tsx), SettingsNav.logic.ts                                                                                                                                                                         | High       |
| Tests: co-located `*.test.ts`, `@effect/vitest` `it.layer(...)` over `MercurianSqlite.layerMemory`; streams drained, never sleeps; targeted `vp test run <files>` only                                                                                                                                                                                                                                                                                                                                                                                    | [PlanningStore.test.ts](../../apps/server/src/mercurian/planning/PlanningStore.test.ts), [002_ProjectsPlans.test.ts](../../apps/server/src/mercurian/persistence/Migrations/002_ProjectsPlans.test.ts), AGENTS.md §Verifying                                                    | High       |
| Conventional commits `feat(scope): … (M-97)`, branch `venk/m-97-<slug>`, docs ride the PR (user docs in shipped-product voice, glossary for new vocabulary)                                                                                                                                                                                                                                                                                                                                                                                               | `git log` (M-93/M-106/M-108 series), AGENTS.md §Hit every surface                                                                                                                                                                                                               | High       |
| Plan documents live at `docs/project/technical-plan-m-<issue>-<slug>.md` in this house format                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the seven existing plans                                                                                                                                                                                                                                                        | High       |

## Design

### The load-bearing decision: workspace state lives in `mercurian.sqlite`, not `settings.json`

The vault's resolution is a scoping rule: instances belong to the machine, the planning model belongs to the workspace, and "nothing workspace-level ever names an instance." The repo has exactly one home for each scope. `ServerSettings`/`settings.json` is the machine — binary paths, the instance map, the machine's own model selections. `mercurian.sqlite` is the workspace — the database ADR 001 designates as the thing a future shared workspace hosts, where projects, plans, and history already live. So the planning-model setting is a row in the Mercurian database, and the setting's _type_ has no instance field — the invariant is enforced structurally, the same move M-98's plan makes with its write-free connector interface, not by review discipline.

Resolution is the complementary rule: the abstract pair is the only thing ever persisted, and the mapping to an instance is computed, on a machine, from that machine's live provider snapshots — never stored, because it is a fact about a machine at a moment, not about the workspace.

### Contracts: `packages/contracts/src/mercurianWorkspace.ts` (new)

Its own domain-owned method map, keeping `mercurian.ts` the planning surface its header says it is (the precedent M-98's in-flight plan sets with `mercurianTrackers.ts`):

```ts
export const MERCURIAN_WORKSPACE_WS_METHODS = {
  subscribeWorkspaceSettings: "mercurian.subscribeWorkspaceSettings",
  setPlanningModel: "mercurian.setPlanningModel",
} as const;
```

Wire schemas:

- **`PlanningModelSelection`** — `Schema.Struct({ provider: ProviderDriverKind, model: TrimmedNonEmptyString })`, with a doc comment quoting the vault: this struct is the workspace's whole vocabulary for the planning model; **it has no field an instance id could occupy**, and adding one is a design decision, not a refactor. `provider` is the open branded driver-kind slug, so a workspace setting can name a provider this build doesn't ship (fork/rollback reality, providerInstance.ts's forward-compat invariant) and still round-trip — it simply resolves to nothing here.
- **`WorkspaceSettingsSnapshot`** — `{ planningModel: Schema.NullOr(PlanningModelSelection) }`. Null is a real state: no planning model chosen yet.
- **`WorkspaceSettingsStreamItem`** — `{ kind: "snapshot", snapshot }` only. Workspace settings are few and change on discrete human acts — the `PlanningTreeStreamItem` shape, no sequenced deltas.
- **`MercurianSetPlanningModelInput`** — `{ planningModel: Schema.NullOr(PlanningModelSelection) }`; null clears the setting.
- **`MercurianWorkspaceError`** — the operation-tagged catch-all, `MercurianPlanningError`'s shape (mercurian.ts:283).

And one small derived helper, the contracts' `isProviderAvailable` idiom, because the same pure function serves the Settings row now, 042's server-side turn start later, and any 061 surface that shows planning-model context:

```ts
export type PlanningModelResolution =
  | { _tag: "unset" }
  | { _tag: "resolved"; instanceId: ProviderInstanceId; provider: ProviderDriverKind; model: string }
  | { _tag: "unresolved"; reason: "no-instance" | "model-unavailable" };

export const resolvePlanningModel = (
  setting: PlanningModelSelection | null,
  providers: ServerProviders,
): PlanningModelResolution => …
```

The resolution rule, stated once and pinned by tests: candidates are snapshots whose `driver` matches, that are available (`isProviderAvailable`), `enabled`, and `installed`. Among candidates offering the model in their `models` list, the provider's default instance (`defaultInstanceIdForDriver(provider)`) wins; otherwise the first candidate in snapshot order (which is settings order) — the t3code temperament of "new work quietly falls back to the first instance that is available." No candidate at all → `"no-instance"`; candidates but none offering the model → `"model-unavailable"`. Capability gating flows through for free: models the agent is too old to run are already omitted from `models` by the driver layers, so a gated model resolves to `"model-unavailable"` — and the UI can name the unlocking upgrade from the candidate's `versionAdvisory` (below). Nothing here consults curation: hiding a model is a picker preference, not a capability fact, and the workspace setting must keep resolving on a client that hid it.

Wire touchpoints, each mechanical: barrel line in `contracts/src/index.ts`; two `Rpc.make` consts + `WsRpcGroup` membership in `rpc.ts` (`subscribeWorkspaceSettings` with `stream: true`); scopes in `RpcAuthorization.ts` — subscribe → `AuthOrchestrationReadScope`, set → `AuthOrchestrationOperateScope`, under the same recorded rationale comment; `"mercurian.subscribeWorkspaceSettings"` joins `EnvironmentSubscriptionRpcTag` in `client-runtime/src/rpc/client.ts`.

### Server: `apps/server/src/mercurian/workspace/` (new area)

**`persistence/Migrations/003_WorkspaceSettings.ts` (new)**, registered as `[3, "WorkspaceSettings"]` in `Migrations.ts` — the idempotent 001/002 shape:

```sql
CREATE TABLE IF NOT EXISTS workspace_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

A key-value table rather than a `planning_model` column table: workspace-scoped settings will accrete (this phase alone implies more), rows are cheap, and each key's value is schema-validated JSON at the store layer, so the shapelessness never crosses the boundary. **Numbering note:** the in-flight M-96 and M-98 branches each claim 003 in their plans; the loader keys on `[id, name]`, so whichever lands later renumbers in a one-line rebase — recorded here so no branch is surprised.

**`workspace/WorkspaceSettingsStore.ts` (new)** — canonical single-file service, tag `"t3/mercurian/workspace/WorkspaceSettingsStore"`, depending only on the Mercurian `SqlClient`. Small enough that its row codec lives in the file (no separate `schema.ts`; that file exists in `planning/` for a store with many row shapes — this one has one key today).

- `getSnapshot() → WorkspaceSettingsSnapshot` — read the `planningModel` key, decode through the contract schema; a row that fails decoding surfaces as `MercurianWorkspaceError`, never a silent null (a workspace setting must not vanish because a build got confused — the same preserve-don't-destroy temperament as unknown driver envelopes).
- `setPlanningModel(selection | null) → void` — validate, encode, upsert (or delete on null) in a transaction, publish `changes`.
- `changes: Stream<void>` — `PubSub`-backed, the `PlanningStore.changes` shape.
- **Deliberately absent:** any dependency on the provider registry. Resolution is not this store's business — the workspace database holds workspace facts only, which is the whole design.

Wiring: `WorkspaceSettingsStore.layer` joins the Mercurian block in `server.ts` (:249–251) beside `PlanningStore.layer`, same private-`SqlClient` discipline. Handlers in `ws.ts`: `setPlanningModel` via `observeRpcEffect`; the subscription as queue-before-snapshot + `Stream.debounce(50ms)` re-emit — the `subscribeTree` handler shape verbatim, `"rpc.aggregate": "mercurian"`.

**Resolution stays client-side in this issue** — a decisive call, recorded: the server has no consumer of the resolved instance until 042 starts planning turns, and the clients already hold a live providers subscription. When 042 lands, its turn start calls the same `resolvePlanningModel` contracts helper against the server's own registry output; nothing needs restructuring, because the helper's inputs are contract types both sides already have.

### Client plumbing

- **`packages/client-runtime/src/state/mercurianWorkspace.ts` (new)** — `createMercurianWorkspaceAtoms(runtime)`: the subscription atom family plus the `setPlanningModel` command on a shared write scheduler (the `mercurianPlanning.ts` shape; setting a workspace preference is rare, global ordering is fine).
- **`apps/web/src/state/mercurianWorkspace.ts` (new)** — instantiates over `connectionAtomRuntime`, exports primary-environment-keyed hooks: `usePlanningModel()` returning `{ setting, resolution, isPending, error }` — `resolution` computed by joining the snapshot with `primaryServerProvidersAtom` through `resolvePlanningModel` — and `useSetPlanningModel()`.

### UI: the planning-model row, housed where the vault says

The vault's Settings note places the assistant's model choice inside the Providers section ("The assistant's model is chosen here too, as a workspace setting… named as provider and model, never as an instance"). So:

- **`components/mercurian/PlanningModelSetting.tsx` (new)** + **`PlanningModelSetting.logic.ts` (new, pure)** + co-located tests. A titled card rendered at the top of the Providers settings page: label **Planning model**, a one-line description in the vault's register (workspace-wide; names a provider and model, never an account), the current value shown as provider display name + model (via `PROVIDER_DISPLAY_NAMES`, [model.ts:218](../../packages/contracts/src/model.ts)), and a **resolution affordance**:
  - _Resolved_ → "runs on **{instance label}**" with the instance's accent color — the label and color that "follow the instance into every picker."
  - _Unresolved, `no-instance`_ → the AC's clause verbatim in behavior: the row keeps showing the saved pair with an explicit message ("No {provider} instance on this machine — the setting stays saved and resolves wherever one exists"). The machine never clears or rewrites the workspace setting.
  - _Unresolved, `model-unavailable`_ → explicit message; when a candidate instance wears a `behind_latest` `versionAdvisory`, name the unlocking upgrade from `latestVersion` and point at that instance's existing one-click update nudge — adaptation of the built gating voice, not new machinery.
- The picker itself is a popover/command list on the existing `ui/` primitives, grouped **by provider, not by instance** — the visible difference between this picker and the fork's per-thread one, on purpose. Options derive in the `.logic.ts` from the live snapshots: for each driver with at least one resolvable instance, the models of the instance resolution would pick, with that instance's curation applied (hidden filtered, order applied, favorites floated — the same `ClientSettings` inputs the fork pickers read), so "every model picker reflects that curation" holds here too. A saved selection that is currently unresolvable still renders as the selected value (from the setting, not the options list) — selection display never depends on availability.
- **Mounting is the plan's one upstream edit:** a one-line render of `<PlanningModelSetting />` at the top of `ProviderSettingsPanel` ([SettingsPanels.tsx:1693](../../apps/web/src/components/settings/SettingsPanels.tsx)) — within ADR 004's minimal-edits budget, the M-93 one-token-redirect precedent. Everything else on that page (wizard, cards, curation, nudges) ships byte-identical.

**The 061 reuse fence, stated plainly:** coding sessions pick per session, instance-grouped — which is the fork's existing composer picker, already built and untouched here. What 061 reuses from this plan is the pure layer: `resolvePlanningModel`, the option-derivation and resolution-display logic in `PlanningModelSetting.logic.ts`, and the resolution-affordance pattern. Keeping those pure and exported is this plan's obligation to 061; building 061's picker is not.

### What this plan deliberately does not touch

The fork's provider page mechanics — grammar, wizard, curation, standing, gating, nudges — beyond the one-line mount. No `ServerSettings` field (nothing machine-scoped is added). No assistant consumption (042), no per-session pickers (061), no mobile (parked, ADR 004 §2), no login flow of Mercurian's own, and no rebranding pass on the providers page (M-121 owns identity work).

### Gaps where the AC outran the repo

Exactly the workspace surface introduced above: the contracts file, migration 003, the store, two RPC methods, the client atoms, and the settings row. Everything else the AC names exists and is verified, not rebuilt.

## Implementation Checklist

- [ ] `packages/contracts/src/mercurianWorkspace.ts` — method map, `PlanningModelSelection` (no instance field, doc comment quoting the vault), `WorkspaceSettingsSnapshot`, stream item, set input, `MercurianWorkspaceError`, `resolvePlanningModel` + `PlanningModelResolution`.
- [ ] `packages/contracts/src/mercurianWorkspace.test.ts` — resolver cases (see Test Plan).
- [ ] `packages/contracts/src/index.ts` — barrel line.
- [ ] `packages/contracts/src/rpc.ts` — two `Rpc.make` consts, `WsRpcGroup` membership (`subscribeWorkspaceSettings` streaming).
- [ ] `apps/server/src/auth/RpcAuthorization.ts` — scopes: subscribe → read, set → operate, under the existing Mercurian rationale comment.
- [ ] `apps/server/src/mercurian/persistence/Migrations/003_WorkspaceSettings.ts` (+ co-located test) — idempotent `workspace_settings` kv table; renumber at rebase if M-96/M-98 land 003 first.
- [ ] `apps/server/src/mercurian/persistence/Migrations.ts` — register `[3, "WorkspaceSettings"]`.
- [ ] `apps/server/src/mercurian/workspace/WorkspaceSettingsStore.ts` (+ co-located test) — single-file service, tag `"t3/mercurian/workspace/WorkspaceSettingsStore"`, `getSnapshot`/`setPlanningModel`/`changes`; decode failures refuse loudly, never null out.
- [ ] `apps/server/src/server.ts` — `WorkspaceSettingsStore.layer` joins the Mercurian block, private `SqlClient`.
- [ ] `apps/server/src/ws.ts` — the two handlers; subscription as queue-before-snapshot + `debounce(50ms)` re-emit, `"rpc.aggregate": "mercurian"`.
- [ ] `packages/client-runtime/src/rpc/client.ts` — `"mercurian.subscribeWorkspaceSettings"` joins `EnvironmentSubscriptionRpcTag`.
- [ ] `packages/client-runtime/src/state/mercurianWorkspace.ts` — `createMercurianWorkspaceAtoms` (subscription + command, shared write scheduler).
- [ ] `apps/web/src/state/mercurianWorkspace.ts` — instantiation, `usePlanningModel` (joined with `primaryServerProvidersAtom` through the resolver), `useSetPlanningModel`.
- [ ] `apps/web/src/components/mercurian/PlanningModelSetting.logic.ts` (+ test) — option derivation (by provider; resolving instance's models; curation applied), resolution display model (resolved label/color; both unresolved messages; upgrade naming from `versionAdvisory`).
- [ ] `apps/web/src/components/mercurian/PlanningModelSetting.tsx` — the card + picker on `ui/` primitives.
- [ ] `apps/web/src/components/settings/SettingsPanels.tsx` — one-line mount at the top of `ProviderSettingsPanel`; **the only upstream-owned edit in this plan**.
- [ ] Docs ride the PR: a short planning-model passage in `docs/user/projects-and-threads.md` (shipped-product voice, no paths), and a **planning model** entry in `docs/internals/glossary.md`.
- [ ] Do **not** add a dependency, a `ServerSettings` field, an instance reference anywhere workspace-scoped, or any persisted resolution.
- [ ] Do **not** edit the wizard, instance cards, curation section, driver layers, or maintenance machinery — AC 1–4 ship as verified, byte-identical but for the mount line.
- [ ] Commits: `feat(contracts): …`, `feat(server): …`, `feat(web): … (M-97)` on branch `venk/m-97-providers-planning-model`.

## Test Plan

Unit — contracts (`vp test run packages/contracts/src/mercurianWorkspace.test.ts`):

- [ ] `resolvePlanningModel`: null setting → `unset`; no snapshot of the provider → `no-instance`; disabled, uninstalled, and `availability: "unavailable"` snapshots are never candidates; default instance preferred when it offers the model; default lacking the model falls through to the first candidate offering it; model offered nowhere → `model-unavailable`; an unknown (fork) driver slug resolves `no-instance` without throwing.

Unit — server (`@effect/vitest` over `MercurianSqlite.layerMemory`):

- [ ] `003_WorkspaceSettings.test.ts` — migration applies, is idempotent, table exists (the 002 pattern).
- [ ] `WorkspaceSettingsStore.test.ts` — snapshot of an empty store is `{ planningModel: null }`; set → snapshot round-trip; set null clears; `changes` emits once per mutation (drained, no sleeps); a hand-corrupted stored value surfaces `MercurianWorkspaceError` rather than a silent null.

Unit — web logic (`pnpm --filter web test`):

- [ ] `PlanningModelSetting.logic.test.ts` — options group by provider and come from the resolving instance; hidden models filtered, order respected, favorites floated; a saved-but-unresolvable selection still renders as the selected value; both unresolved messages produced; upgrade naming appears exactly when a candidate wears `behind_latest`.

Manual, against the AC (dev app):

- [ ] Set the planning model in Settings → Providers; restart the server — the setting survives (it lives in `mercurian.sqlite`, not the client).
- [ ] Delete the resolving instance — the row flips to the explicit no-instance state and the saved pair remains visible; recreate an instance of that provider — it resolves again with no re-picking.
- [ ] Two instances of one provider — resolution names the default; disable the default — it names the other.
- [ ] The picker never offers a hidden or version-gated model; instance cards, wizard, curation, standing, and the update nudge behave exactly as before the change.
- [ ] Web and desktop both pass the walk; mobile untouched.

## Findings carried out of discovery

- **Model curation is client-scoped** (`ClientSettings`), so two clients of the same machine can curate differently — t3code's shipped semantics, kept. The vault pins curation to the instance but not to a scope; if Mercurian ever wants machine-scoped curation, that is a design decision for the vault first, not a silent migration here.
- **Resolution is client-side until 042** consumes it server-side at turn start; the contracts helper is written for both callers from day one.
- **Migration 003 is contended** by the in-flight M-96 and M-98 branches; last to land renumbers (loader keys on `[id, name]`).
- **The `provider`/instance-id migration is mid-flight upstream** (`ProviderSession.providerInstanceId` optional "post-slice-4", providerInstance.ts) — nothing in this plan depends on its completion, because the workspace setting names driver kinds, not instances, by design.
- **The one upstream edit** is the `ProviderSettingsPanel` mount line; everything else Mercurian-owned and additive, per ADR 004.
