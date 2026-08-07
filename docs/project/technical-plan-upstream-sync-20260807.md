# Technical Plan — Upstream sync 20260807: faithful conflict resolution

Generated from a request to plan the conflict resolution for `sync/upstream-20260807`, not from a
Linear Goal/AC. **Goal:** land t3code `main` through 2026-08-07 on Mercurian's `main` with every
conflict resolved deliberately — Mercurian-owned behavior preserved, upstream's work on inherited
surfaces inherited — and with the two silent regressions this merge carries fixed before the pull
request goes green.

Everything below was measured by replaying the merge out-of-tree in a throwaway clone. Your
checkout was not touched.

## What discovery found: four conflicts, seven hunks, and one moved component

- The merge is a real two-sided merge, not a fast-forward. Merge base `5192f777f`
  (2026-08-02, the last upstream commit `main` already contains); `main` carries 80 commits the
  branch lacks, the branch carries 107 upstream commits, 488 files changed upstream, 295 on our
  side, **41 touched by both**.
- `sync/upstream-20260807` is the unmodified upstream head (`72d673a85`), pushed by the
  `[CONFLICTS]` path of `.github/workflows/upstream-sync.yml`. Nothing has been resolved yet.
- **Exactly four files conflict, seven hunks total**, and the set is identical in both merge
  directions:

  | File                                                  | Hunks | Nature                                        |
  | ----------------------------------------------------- | ----- | --------------------------------------------- |
  | `apps/server/src/server.test.ts`                      | 2     | import block + a layer block upstream deleted |
  | `apps/web/src/components/ChatView.tsx`                | 1     | import block                                  |
  | `apps/web/src/hooks/useThreadActions.ts`              | 1     | import block                                  |
  | `apps/web/src/components/settings/SettingsPanels.tsx` | 3     | component extraction + theme rework           |

- **The automatic merge lost nothing.** For all 41 both-touched files I extracted every line
  Mercurian added since the merge base and checked its presence in the merged tree: **zero missing**.
  The `navigateToParkedThreadRoute` call sites — the app-shell reshaping's load-bearing edit — match
  `main` exactly, file for file (`ChatView` 4, `CommandPalette` 4, `Sidebar` 4, `SidebarV2` 2,
  `useHandleNewThread` 3, `useThreadActions` 2, `__root` 2).
- **Two regressions are not marked as conflicts and will not announce themselves:**
  1. Upstream extracted `ProviderSettingsPanel` into its own file. Our one-line
     `<PlanningModelSetting />` mount lives in the copy inside `SettingsPanels.tsx`, which the
     resolution deletes. Take upstream naively and the planning-model row silently disappears from
     Settings → Providers, with nothing failing to compile.
  2. Upstream's new theme system reintroduces the literal string `T3 Code` into six files that
     M-121's branding sweep never saw (14 occurrences). `main` has exactly three allowed hits under
     `apps/web/src` + `apps/desktop/src`; the merged tree has seventeen.
- One upstream deletion reaches into our code: `HttpResponseCompression` is gone (class,
  `layerNode`, `layerBun`, `httpCompressionLayer`), and our Mercurian test layer block still provides
  `HttpResponseCompression.layerNode`. It is inside conflict hunk 2, so it cannot be missed — but the
  resolution is "drop it", not "keep ours".
- `SERVICE_LAUNCHER_PROTOCOL` also shows as removed in the diff; it merely moved to
  `apps/server/src/cloud/serviceProtocol.ts` and all merged references resolve. Not a problem.
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `t3.json`, and `AGENTS.md` are **upstream-only** changes —
  Mercurian has never diverged on them. The runbook's lockfile hazard does not apply this time.
- CI job names `Check`, `Test`, `Release Smoke` are **unchanged** by this merge, so the branch
  protection ruleset needs no amendment before merging (`docs/operations/upstream-sync.md`,
  "Protect `main`").
- **There is one prior resolved sync to follow.** `sync/upstream-20260802` landed on `main` through
  PR #6 as merge commit `056c310ad`, and its commit message is a written resolution ledger —
  the single most useful precedent in the repo (quoted throughout below). `sync/upstream-20260803`
  was never merged. Note that ADR 004 rev 2's tracking status is now stale: it records `main` as
  containing upstream through `7b8d126` (2026-07-18) with the cadence "not yet exercised", but
  `main` in fact contains upstream through `5192f777f` (2026-08-02) via that merge. Worth correcting
  in the ADR, separately from this PR.

## Conventions Detected

- **Merge direction and procedure — high.** `docs/operations/upstream-sync.md` §"Resolve a
  conflicted sync pull request" and the `[CONFLICTS]` branch of
  `.github/workflows/upstream-sync.yml` both prescribe: stay on the sync branch and
  `git merge origin/main` into it. The one resolved precedent, `056c310ad`, has exactly that shape
  ("Merge origin/main into sync/upstream-20260802"). The plan follows this exactly. **Consequence to
  hold onto: `ours` is upstream and `theirs` is Mercurian.**
- **How a sync conflict is resolved — high.** `056c310ad`'s message states the rule this plan
  applies: _"keep Mercurian's brand identity and CI/release ownership, take upstream everywhere
  else"_, and for the case that dominates this sync — _"Structural conflicts where upstream moved
  code — took upstream's structure and re-applied branding at the new site, avoiding duplicated
  logic."_ That precedent also establishes the sweep of "user-visible product names in new upstream
  surfaces" as part of a sync, and the commit-message shape: a resolution ledger grouped by
  rationale, ending with a `Verified:` line naming typecheck/check/fmt/test results.
- **Required checks for a sync — high.** The runbook names `vp check`, `vp run typecheck`,
  `vp run test`. This is narrower than it looks in tension with `AGENTS.md` §Verifying ("Do not run
  repo-wide checks... CI owns the full suite"): the AGENTS rule governs feature work, the runbook is
  sync-specific and wins here. A 488-file merge is exactly the case where repo-wide checks earn
  their keep.
- **Lockfile discipline — high.** "Do not regenerate or accept lockfile conflicts automatically"
  (`docs/operations/upstream-sync.md`). No lockfile conflict exists this round; take upstream's
  lockfile, workspace file, and patch renames as they come.
- **Fork discipline — high.** ADR 004 §1 (`docs/architecture/fork-baseline.md`): Mercurian code is
  "additive where practical... minimal edits inside upstream-owned files", and "**No tree-wide
  renames or rebranding** while tracking". The M-97 plan enforces the same rule at the file level —
  its `SettingsPanels.tsx` mount is described as "**the only upstream-owned edit in this plan**".
  Resolution therefore biases toward upstream inside upstream-owned files, and re-applies the small
  Mercurian seams by hand.
- **Parked surfaces — high.** ADR 004 §2: `apps/mobile` (55 changed files this sync),
  `apps/marketing` (1), `packages/ssh` (2), `packages/tailscale`, and T3 Connect are parked — they
  "merge cleanly from upstream and cost nothing but tree weight". They get no review beyond "did it
  merge".
- **Branding seam and sweep — high.** ADR 004 §3 and
  `docs/project/technical-plan-m-121-branding-pass.md`: identity lives in `apps/web/src/branding.ts`
  and `DesktopEnvironment.ts`, plus a literal sweep of `"T3 Code"` → `"Astrolabe"` in
  `apps/web/src` and `apps/desktop/src`. M-121's AC gives the exact regression check, reused verbatim
  in the Test Plan. Upstream did not touch `branding.ts` this sync.
- **Design authority for inherited surfaces — high.** The `almagest` vault documents t3code's
  surfaces as-built (`T3code Settings`, `T3code Thread View`) and reconciles them on Mercurian notes.
  `Settings` states that "appearance, keybindings, and Git-glue settings" **"[don't] transfer yet"** —
  they "belong to surfaces Mercurian hasn't designed" and "can accrete here when those surfaces
  exist". Upstream's theme rework lands squarely in that space, so inheriting it wholesale overwrites
  no Mercurian decision.
- **Plan location and commits — high.** Plans live at `docs/project/technical-plan-<slug>.md`
  (twelve precedents on `main`); commit titles are conventional and plain (`AGENTS.md` §Pull
  requests).

## Design

### The shape of the work

Three of the four conflicts are import-block collisions with an objectively checkable answer: for
each symbol either side wants, does the merged file body actually use it? That question was answered
during discovery, so the resolutions below are stated as facts rather than judgment. The fourth file
is the only one carrying design content, and the real work of this sync is the two unmarked
regressions plus a scoped review of the 37 files that auto-merged.

Do the merge in your own checkout on the sync branch, per the runbook:

```sh
git fetch origin
git switch sync/upstream-20260807
git merge origin/main
```

`git config rerere.enabled true` before starting is worth it — this branch is likely to be
re-merged at least once if `main` moves under you, and rerere will replay these seven hunks for
free. It is a local convenience, not a repo convention; nothing in the repo configures it.

### Conflict 1 — `apps/server/src/server.test.ts` (2 hunks)

**Hunk 1 (imports).** Ours (upstream) collapses to
`import { isThreadDetailEvent, resolveAvailableEditorsForConfig } from "./ws.ts";`. Theirs (main)
carries the Mercurian store imports, the `stubTrackerConnector` const, and the un-collapsed
`resolveAvailableEditorsForConfig` import. **Keep both:** the Mercurian import block and stub
verbatim, with upstream's combined import line replacing ours. `isThreadDetailEvent` is genuinely
needed — the merged test uses it at the thread-transfer assertion, and `ws.ts` exports it
(`apps/server/src/ws.ts`, `export function isThreadDetailEvent`).

**Hunk 2 (the test layer stack).** Ours is empty; theirs provides
`HttpResponseCompression.layerNode` followed by the Mercurian store layers (`PlanningStore`,
`RepositoryStore`, `WorkspaceSettingsStore`, `TrackerStore` over the stub connector, all under
`CommitStore` / `MercurianSqlite.layerMemory` / `ProcessRunner`). **Keep the Mercurian block, drop
the `HttpResponseCompression.layerNode` line** — upstream deleted that module outright, and it is
upstream's own layer, not ours. The comment above the Mercurian block ("Mercurian's stores, real but
in-memory: they own their own database file, so nothing here reaches t3code's store") stays; it is
still true and it is the reason this block exists.

### Conflict 2 — `apps/web/src/components/ChatView.tsx` (1 hunk)

Theirs: `import { navigateToParkedThreadRoute } from "../threadRoutes";`. Ours:
`buildPhysicalToLogicalProjectKeyMap` from `../sidebarProjectGrouping` **and**
`buildDraftThreadRouteParams` from `../threadRoutes`.

**Resolution: keep `navigateToParkedThreadRoute`, add `buildPhysicalToLogicalProjectKeyMap`, drop
`buildDraftThreadRouteParams`.** `buildPhysicalToLogicalProjectKeyMap` is used by upstream's new
code in the merged body and `apps/web/src/sidebarProjectGrouping.ts` exists in the merged tree;
`buildDraftThreadRouteParams` has no remaining call site, because Mercurian replaced every
`navigate({ to: "/draft/$draftId" })` with `navigateToParkedThreadRoute({ kind: "draft", ... })`
when the thread routes were parked.

This is the merge honoring the app-shell reshaping rather than upstream's route-based navigation,
and it is deliberate. `apps/web/src/threadRoutes.ts` says why: the thread routes "left the app with
the app-shell reshaping: navigation is the project tree now, and the thread surfaces are parked in
place", and "[e]very parked navigation goes through here, so it is inert and greppable rather than
silently broken." The vault agrees — `Left Sidebar`'s main content is the project tree, and there is
no thread route in the design. Restoring upstream's `navigate` calls here would un-park those
surfaces by accident.

`navigate` itself stays declared and used elsewhere in the file (the Settings → Connections link),
so no unused-local lint fallout.

### Conflict 3 — `apps/web/src/hooks/useThreadActions.ts` (1 hunk)

Same shape. Theirs: `navigateToParkedThreadRoute, resolveThreadRouteRef`. Ours: `useUiStateStore`
plus `buildThreadRouteParams, resolveThreadRouteRef`.

**Resolution: `navigateToParkedThreadRoute` + `resolveThreadRouteRef` from `../threadRoutes`, plus
upstream's `useUiStateStore` import.** `useUiStateStore` is used by upstream's new
`markThreadVisited` line in the merged body; `buildThreadRouteParams` has no call site left in this
file. `router` remains used (two `router.navigate({ to: "/" })` calls upstream added and a
`router.state.matches` read), so nothing goes unused.

### Conflict 4 — `apps/web/src/components/settings/SettingsPanels.tsx` (3 hunks) — the only one with design content

Mercurian's entire divergence in this file is three lines: the `PlanningModelSetting` import, the
`<PlanningModelSetting />` mount, and one branding string. Upstream rewrote roughly 1,400 lines of
it, extracting `ProviderSettingsPanel` into `apps/web/src/components/settings/ProviderSettingsPanel.tsx`
and replacing the flat theme `Select` with a `ThemeLibrary` (backed by twelve new theme files under
`settings/`: `ThemeSettings.tsx`, `ThemeEditorPanel.tsx`, `themeEditorStore.ts`, `themeInspector.ts`,
and friends).

**Take upstream for all three hunks, then re-apply the Mercurian seam by hand** — this is
`056c310ad`'s rule for structural moves ("took upstream's structure and re-applied branding at the
new site, avoiding duplicated logic") applied to a mount instead of a brand string. Concretely:

- **Hunk 1** — take upstream (empty). This removes the `PlanningModelSetting` import, the
  `useAtomCommand` import, and the `THEME_OPTIONS` const, all of which belong to code that is moving
  or gone.
- **Hunk 2** — take upstream's `<ThemeLibrary … />` block. Our side of this hunk is only the
  rebranded description string `"Choose how Astrolabe looks across the app."`, which has no home in
  the new component. The vault sanctions inheriting here: `Settings` puts appearance in the
  "doesn't transfer yet" bucket, so upstream's rework displaces no Mercurian design. The branding
  string is not lost, only relocated — it is picked up by the branding sweep below.
- **Hunk 3** — take upstream (empty). The 518-line `ProviderSettingsPanel` body leaves this file;
  `apps/web/src/routes/settings.providers.tsx` already imports it from its new home in the merged
  tree.
- **Then port the mount into `apps/web/src/components/settings/ProviderSettingsPanel.tsx`:** add
  `import { PlanningModelSetting } from "../mercurian/PlanningModelSetting";` and render
  `<PlanningModelSetting />` as the **first child of the `inert` wrapper `div` inside the Providers
  `SettingsSection`** — i.e. immediately before the first `SettingsRow` in that wrapper, which is
  where it sits on `main` today (first child of the section body, just above the health-check
  interval row).

  The `inert` wrapper is new upstream scaffolding for read-only sessions ("This session can view
  … but its credential does not allow changing their configuration"). Mounting inside it is the
  right call: the planning model writes through a Mercurian RPC that requires the `operate` scope
  (`apps/server/src/auth/RpcAuthorization.ts`), so a read-only session would only be offered a
  control it cannot use. Mounting outside the wrapper is the defensible alternative — the planning
  model is workspace-scoped while the read-only gate is environment-scoped — and is the one
  judgment call in this file worth a second opinion.

  Design constraints on the ported row, from the vault: nothing workspace-level ever names an
  instance — "a workspace-level choice — the planning model — names a provider and model abstractly,
  and each machine resolves the pair to its own instance at runtime" (`Providers`, resolved 2026-07).
  The row's own logic is untouched by this merge; only its mount point moves.

### The silent-conflict review set

Thirty-seven files were touched by both sides and merged without a marker. They are where a fork
sync actually goes wrong, so they were checked rather than trusted, by three passes:

1. **Line preservation** — every line Mercurian added since the base is present in the merged tree.
   Zero misses across all 41 files.
2. **Fork-marker preservation** — per-file counts of `mercurian|astrolabe` are identical between
   `main` and the merged tree for every file that has any.
3. **Dangling references** — the only reference to an upstream-deleted module anywhere in the merged
   tree is the `HttpResponseCompression` line inside conflict hunk 2.

Most of the 37 are M-121 branding one-liners colliding with upstream churn in the same file
(`bootService.ts`, `serviceLauncher.ts`, `McpHttpServer.ts`, `platform.ts`, and a dozen more, each a
`Description=Astrolabe server`-shaped edit) — exactly the recurring collision ADR 004 §3 predicted,
and all clean. Four deserve a human read after the merge commit exists, because line preservation is
not behavior preservation and each is a place where our additions and upstream's restructuring
interleave:

- `apps/server/src/ws.ts` — our +615 lines of Mercurian handlers against upstream's 36-line change.
- `packages/contracts/src/rpc.ts` — our +330 (the Mercurian RPC group) against upstream's +21.
- `packages/contracts/src/settings.ts` and `orchestration.ts` — small on our side (+11, +2),
  large upstream (+91, +209); read for shape changes that our decoders assume.
- `.github/workflows/ci.yml` and `release.yml` — our CI-spend and release-identity work against
  upstream's new transfer-budget steps and its switch from the release App token to `github.token`
  in the publish job. Verified during discovery: the merged `release.yml` keeps a coherent
  `app_token` step in the job that still needs it, and the `--publish-name @mercurian/astrolabe`
  flags survive.

`vp run typecheck` is the real gate on all of this; the reading is for the class of error a
typechecker cannot see.

### Branding regression (M-121)

Running M-121's own AC sweep against the merged tree:

| File                                                       | `T3 Code` hits |
| ---------------------------------------------------------- | -------------- |
| `apps/web/src/themePalette.ts`                             | 7              |
| `apps/web/src/components/settings/ThemeSettings.tsx`       | 2              |
| `apps/desktop/src/linuxSecretStorage.ts`                   | 2              |
| `apps/web/src/components/settings/ThemePreviewCircles.tsx` | 1              |
| `apps/web/src/components/settings/ThemeImportDialog.tsx`   | 1              |
| `apps/web/src/components/settings/ThemeEditorPanel.tsx`    | 1              |

`main`'s baseline for the same sweep is three hits, all pre-existing and allowed
(`DesktopAppIdentity.ts`'s T3 Tools attribution line, `DesktopEnvironment.ts`'s legacy user-data
path, `DesktopClerk.ts`). These fourteen are new.

**Resolution: sweep them in this pull request** — this is what the prior sync did ("Swept
user-visible product names in new upstream surfaces… URL schemes, `T3CODE_*` env vars, `@t3tools`
scope, legacy user-data directory names, upstream docs, and parked surfaces are intentionally
untouched", `056c310ad`), and it matches M-121's rule: literal user-visible `"T3 Code"` →
`"Astrolabe"`, no refactoring, no touching identifiers such as `t3code:theme`, nothing under
`apps/mobile` or `apps/marketing`. Two caveats worth a look while sweeping: `themePalette.ts`'s hits
are likely built-in _theme names_ (renaming a theme changes a persisted user-facing identifier —
check before rewriting), and `linuxSecretStorage.ts`'s are likely a keyring service label, where a
rename could orphan a stored secret. Anything that turns out to be an identifier rather than a
label stays, and gets noted in the commit body as an enumerated allowance the way M-121 did.

If this grows past a handful of lines, splitting it into a follow-up branded commit on the same PR
is fine — but it should not leave the PR unaddressed, or the next sync will bury it.

### What this plan deliberately does not do

- **Does not extend the merge to upstream's newest head.** Upstream has moved a couple of commits
  past `72d673a85` since the branch was cut. The PR is built on that snapshot, CI runs on that
  snapshot, and next Monday's scheduled run collects the remainder. Re-fetching mid-resolution
  changes the conflict set under you for nothing.
- **Does not regenerate `pnpm-lock.yaml`.** There is no lockfile conflict; upstream's lockfile,
  `pnpm-workspace.yaml`, and the `effect@4.0.0-beta.102 → .103` patch renames come across as-is.
- **Does not review or strip parked surfaces.** `apps/mobile`'s 55 changed files, `apps/marketing`,
  `packages/ssh` merge and are left alone (ADR 004 §2).
- **Does not rename anything.** No `@t3tools/*` renames, no workspace rename — ADR 004 §1 and §3
  keep those behind the cut-over.
- **Does not amend the branch-protection ruleset.** Verified unnecessary: `Check`, `Test`, and
  `Release Smoke` survive this merge unrenamed.

### The ADR 004 question this merge raises

ADR 004 §1 sets a cut-over trigger: "the app-shell reshaping (backlog 020) lands on `main`, or a
routine upstream merge costs more than a working day to resolve." The first clause appears to have
fired — `threadRoutes.ts` on `main` describes the thread routes as having "left the app with the
app-shell reshaping", and `main` has deleted `_chat.$environmentId.$threadId.tsx` and
`_chat.draft.$draftId.tsx` while adding the plans and repositories routes. The ADR also records an
open question — "Where upstream's direction and Mercurian's design conflict inside a kept surface
(e.g. upstream reworks the thread view we are reshaping), which side yields is a per-merge judgment
until cut-over" — which is precisely what conflicts 2 and 3 are.

This plan makes the per-merge judgment (Mercurian's parked navigation wins; upstream's undesigned
surfaces win) and does not touch the ADR. But this is the **first `[CONFLICTS]` pull request the
automation has produced** — `056c310ad` was resolved by hand before the workflow landed — and rev 2
explicitly flags that "what the first `[CONFLICTS]` PR actually costs[] is unmeasured". **Record the
actual resolution time on the pull request**, and open the cut-over reassessment (plus the stale
tracking-status correction noted above) as its own issue rather than smuggling an ADR amendment into
a sync PR.

## Implementation Checklist

- [ ] `git fetch origin && git switch sync/upstream-20260807 && git merge origin/main` — do **not**
      re-fetch `upstream`. Optionally `git config rerere.enabled true` first.
- [ ] Confirm the conflict set is exactly the four files below. If it is larger, `main` moved —
      re-read the both-touched analysis before continuing.
- [ ] `apps/server/src/server.test.ts` hunk 1 — keep the Mercurian store imports + `stubTrackerConnector`;
      replace our `resolveAvailableEditorsForConfig` import with upstream's combined
      `{ isThreadDetailEvent, resolveAvailableEditorsForConfig }`.
- [ ] `apps/server/src/server.test.ts` hunk 2 — keep the Mercurian layer block and its comment; **delete**
      the `Layer.provide(HttpResponseCompression.layerNode)` line (module deleted upstream).
- [ ] `apps/web/src/components/ChatView.tsx` — keep `navigateToParkedThreadRoute`; add
      `buildPhysicalToLogicalProjectKeyMap` from `../sidebarProjectGrouping`; drop
      `buildDraftThreadRouteParams`.
- [ ] `apps/web/src/hooks/useThreadActions.ts` — keep `navigateToParkedThreadRoute, resolveThreadRouteRef`;
      add `useUiStateStore` from `../uiStateStore`; drop `buildThreadRouteParams`.
- [ ] `apps/web/src/components/settings/SettingsPanels.tsx` — take upstream for all three hunks
      (theme library in, `ProviderSettingsPanel` out, imports and `THEME_OPTIONS` gone).
- [ ] `apps/web/src/components/settings/ProviderSettingsPanel.tsx` — add the
      `PlanningModelSetting` import and render `<PlanningModelSetting />` as the first child of the
      `inert` wrapper inside the Providers `SettingsSection`. **This is the only Mercurian edit to an
      upstream-owned file in this resolution** — keep it to two lines.
- [ ] Grep the resolved tree for leftovers: no `<<<<<<<`, no `HttpResponseCompression`, no
      `buildDraftThreadRouteParams`/`buildThreadRouteParams` import without a call site.
- [ ] Branding sweep — the six files in the table above; literal user-visible `"T3 Code"` →
      `"Astrolabe"` only. Leave `t3code:theme`-style identifiers, `@t3tools/*`, `apps/mobile`,
      `apps/marketing`, and `LICENSE` untouched; enumerate any deliberate non-rewrite in the commit body.
- [ ] Read the four interleave-risk files (`ws.ts`, `rpc.ts`, `settings.ts` + `orchestration.ts`,
      `ci.yml` + `release.yml`) against their upstream deltas before pushing.
- [ ] Do **not** regenerate `pnpm-lock.yaml`, re-fetch upstream, rename anything, or touch parked
      surfaces.
- [ ] `vp check`, `vp run typecheck`, `vp run test` — all three, per the runbook, before pushing.
- [ ] `git add <resolved files> && git commit` — merge commit titled as the precedent does,
      `Merge origin/main into sync/upstream-20260807`. Body follows `056c310ad`'s resolution-ledger
      shape: the ADR 004 rule invoked, then grouped entries for the structural move
      (`ProviderSettingsPanel` + the ported mount), the deleted upstream layer
      (`HttpResponseCompression`), the parked-navigation calls kept in `ChatView`/`useThreadActions`,
      the branding sweep with its enumerated exclusions, and a closing `Verified:` line with the
      typecheck/check/fmt/test results. End with the model and harness that did the work
      (`AGENTS.md` §Pull requests).
- [ ] `git push origin sync/upstream-20260807`; let CI run; merge the PR through the normal
      protected-branch flow. Do not squash — the merge commit is what records the upstream lineage.
- [ ] Record the wall-clock resolution cost on the PR (ADR 004 §1 cut-over trigger), and open a
      separate issue for the cut-over reassessment if the app-shell clause is agreed to have fired.

## Test Plan

Repo-wide, by the runbook — this is the exception to `AGENTS.md`'s "no repo-wide checks" rule.

- [ ] `vp run typecheck` — the primary gate. It is what catches an upstream type change flowing into
      Mercurian's handlers in `ws.ts` / `rpc.ts` / `contracts`, which no amount of line-level checking can.
- [ ] `vp check` — lint and format across the merged tree.
- [ ] `vp run test` — full suite. Watch specifically:
  - [ ] `apps/server/src/server.test.ts` — the Mercurian store layers still build without
        `HttpResponseCompression`, and upstream's thread-transfer assertions using `isThreadDetailEvent` pass.
  - [ ] `apps/web` settings tests — upstream's new `themeEditorStore.test.ts`, `themeInspector.test.ts`,
        `ThemeImportDialog.test.ts` and `ProviderSettingsPanel.logic.test.ts` pass unmodified.
  - [ ] `apps/web/src/components/mercurian/PlanningModelSetting.logic.test.ts` — unchanged and passing.
  - [ ] `apps/web/src/threadRoutes.test.ts` — the parked-navigation contract still holds.
  - [ ] `apps/desktop` branding tests — `branding.test.ts`, `DesktopAppIdentity.test.ts`; the legacy
        `"T3 Code (Alpha)"` user-data-path expectations must still assert the legacy directory (M-121
        Test Plan — behavior must not change).
- [ ] **M-121 branding AC, re-run:** `rg -n "T3 Code|T3 Tools|T3Code" apps/web/src apps/desktop/src --glob '!*.test.*'`
      returns only the enumerated allowances (`DesktopAppIdentity.ts` attribution, `DesktopEnvironment.ts`
      legacy path, `DesktopClerk.ts`) plus anything deliberately kept as an identifier.
- [ ] **Parked-surface check:** the merge's own diff shows no hand edits under `apps/mobile`,
      `apps/marketing`, `packages/ssh`, or `LICENSE` — only upstream's incoming changes.
- [ ] **Invariant grep:** `navigateToParkedThreadRoute` call-site counts match `main` file for file —
      `ChatView` 4, `CommandPalette` 4, `Sidebar` 4, `SidebarV2` 2, `useHandleNewThread` 3,
      `useThreadActions` 2, `__root` 2, `threadRoutes` 1 (the definition).
- [ ] **Manual smoke, web (`vp run dev`):** Settings → Providers shows the planning-model row above the
      health-check interval, and setting it survives a server restart; Settings → Appearance shows
      upstream's new theme library and it applies a theme; the project tree still opens plans; tab
      title and favicon are still Astrolabe's.
- [ ] **Manual smoke, desktop:** window title, menu, and about panel read Astrolabe; the about panel's
      T3 Tools MIT attribution is intact (ADR 004 §3, "Always").
- [ ] CI green on the PR — `Check`, `Test`, `Release Smoke` (the three required contexts), with
      `Mobile Native Static Analysis` non-blocking as parked.

## Findings carried out of discovery

- The `[CONFLICTS]` automation worked as designed: unmodified upstream head, nothing auto-resolved.
  Seven hunks across four files, over five days and 107 upstream commits, is a cheap sync — but the
  wall-clock number is what ADR 004's "more than a working day" clause needs, so measure it rather
  than assuming.
- The genuine hazard in this fork's syncs is not textual conflict but **upstream extraction** —
  code moving to a new file, carrying our seam away with it. Two of this sync's real risks were of
  that class (`ProviderSettingsPanel`, `HttpResponseCompression`), and only one of them announced
  itself as a conflict. A cheap standing check for future syncs: after every sync merge, grep for
  each Mercurian seam into upstream-owned files (today: the `PlanningModelSetting` mount) and confirm
  it still sits in a file that is actually rendered.
- **Upstream's new work keeps reintroducing `T3 Code` strings.** M-121 swept once against a
  snapshot, `056c310ad` swept again, and this sync adds fourteen more. Worth a lint rule (an
  `oxlint-plugin-t3code` rule banning the literal in `apps/web/src` + `apps/desktop/src` non-test
  files) rather than a recurring manual sweep — the repo already has that plugin as a home for it.
- The vault's `Settings` note is the reason the theme conflict was cheap to decide: because
  appearance is explicitly "doesn't transfer yet", upstream can be inherited there without anyone
  adjudicating design. That framing is doing real work per-sync and is worth preserving as more
  surfaces get reconciled.
