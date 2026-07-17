# Technical Plan — M-121: Branding pass: Mercurian identity on the inherited design

*Generated from the Goal/AC of Linear issue M-121 (see the issue for the full AC). Implements ADR 004 §3 (amended 2026-07-17), recorded in `docs/architecture/fork-baseline.md`.*

**Goal, in one sentence:** switch the user-visible identity — name, wordmark, icons, titles — to Astrolabe/Mercurian across the web app and desktop shell, while t3code's design system, internal names, and parked surfaces stay byte-for-byte untouched, keeping the diff small enough that live upstream tracking stays cheap.

## Conventions Detected

| Convention | Evidence | Confidence |
|---|---|---|
| Centralized branding seam: one constant per app drives all derived display names | `apps/web/src/branding.ts` (`APP_BASE_NAME = "T3 Code"`, desktop-injected override via `window.desktopBridge.getAppBranding()`); `apps/desktop/src/app/DesktopEnvironment.ts:79` (`const APP_BASE_NAME = "T3 Code"` → `displayName` → `app.setName`/about panel/menu via `DesktopAppIdentity.configure`) | High |
| Brand image assets flow from `assets/{dev,nightly,prod}/` through copy/generate scripts; app-local files are checked-in copies | `assets/README.md`; `scripts/lib/brand-assets.ts` (`BRAND_ASSET_PATHS`, `resolveWebIconOverrides`); `scripts/apply-web-brand-assets.ts` (copies into web build output); `scripts/build-desktop-artifact.ts:1111-1132` (generates `.icns` from the macOS 1024 PNG via `sips`/`iconutil` at package time); `apps/desktop/scripts/electron-launcher.mjs:169-219` (dev icns generated from `assets/dev/blueprint-macos-1024.png`) | High |
| Tests are co-located `*.test.ts(x)`, run with vite-plus (`vp test run`), `@effect/vitest` | `apps/web/src/branding.test.ts`, `apps/desktop/src/app/DesktopAppIdentity.test.ts`; `apps/web/package.json` `"test": "vp test run --passWithNoTests --project unit"`; root `"test": "vp run -r test"` | High |
| Commit messages loosely follow conventional-commit prefixes | `git log`: `fix(web): …`, `fix(server): …`, `docs: add fork guideline`; but also unprefixed messages | Medium — use `feat(web)`/`feat(desktop)`-style prefixes, matching the dominant pattern |
| Internal identifiers are t3-flavored and deliberately stable | `userDataDirName = "t3code"`, localStorage key `"t3code:theme"` (`apps/web/index.html:20`), `@t3tools/*` package names, service ids like `@t3tools/desktop/app/DesktopAppIdentity` | High — and ADR 004 §3 explicitly defers renaming these to cut-over |

## Design

### The two name constants are the whole naming seam

Discovery confirmed the fork's branding seam works as ADR 004 describes:

- **Web:** `apps/web/src/branding.ts` derives `APP_DISPLAY_NAME` from `APP_BASE_NAME` (fallback `"T3 Code"`) + stage label (`Dev`/`Alpha`/`Nightly`/hosted channel). Consumers (`routes/__root.tsx` document title + meta, `routes/_chat.index.tsx`, `components/Sidebar.tsx`, `components/auth/PairingRouteSurface.tsx`, `observability/clientTracing.ts`, `versionSkew.ts`) all read the constants — they inherit the change with zero edits.
- **Desktop:** `apps/desktop/src/app/DesktopEnvironment.ts` has its own `APP_BASE_NAME = "T3 Code"`; `resolveDesktopAppBranding` builds `displayName`, which `DesktopAppIdentity.configure` pushes into `app.setName(...)` and `setAboutPanelOptions(...)`, the application menu (`DesktopApplicationMenu.ts` uses `label: appName`), and window titles. It is also injected into the web app over the preload bridge (`preload.ts` `getAppBranding`), overriding the web fallback. Again: change the one constant, everything user-visible follows.

**Base name: `"Astrolabe"`.** Titles then read "Astrolabe (Alpha)", "Astrolabe (Dev)", etc. via the existing stage-label mechanism. "Mercurian" appears in the about panel (see below), matching the issue's "Astrolabe / Mercurian" phrasing. (Significant choice; flagged for review.)

**About panel:** `setAboutPanelOptions` in `DesktopAppIdentity.configure` gains a `copyright` line: `© 2026 Mercurian — built on t3code, MIT © 2026 T3 Tools Inc.` This puts Mercurian on the about surface and keeps the upstream attribution user-visible, per ADR 004 §3 "Always".

**What deliberately does not change** (each is an internal identifier ADR 004 defers to cut-over, and several are load-bearing):

- `userDataDirName = "t3code"` / `legacyUserDataDirName` (`DesktopEnvironment.ts:160-161`) — renaming moves user data; the legacy-path migration in `DesktopAppIdentity.resolveUserDataPath` exists precisely because that's costly.
- `productName: "T3 Code (Alpha)"` in `apps/desktop/package.json` — packaging/release identity, explicitly deferred by ADR 004 ("Packaging and release identity under the Mercurian name lands at cut-over").
- `@t3tools/*` package names, Effect service ids, `t3codeCommitHash` metadata key, localStorage keys (`t3code:theme`), `~/.t3` base dir (`config.t3Home`).
- File names inside `assets/` and `scripts/lib/brand-assets.ts` path constants (`t3-black-*`, `blueprint-*`) — they're repo-internal paths; renaming them touches the scripts and buys merge conflicts for zero user-visible gain. Contents change, names stay.

### Literal user-visible strings: sweep, don't refactor

Beyond the constants there are ~35 literal `"T3 Code"` occurrences in `apps/web/src` (17 non-test files — settings copy in `ConnectionsSettings.tsx`, `KeybindingsSettings.tsx`, `SettingsPanels.tsx`, dialogs, `SplashScreen.tsx`, `connection/platform.ts` labels, `desktopUpdate.logic.ts`, `RightPanelTabs.tsx`, etc.) and ~12 in `apps/desktop/src` non-test files (`DesktopApplicationMenu.ts`, `DesktopWslEnvironment.ts`, `DesktopBackendPool.ts`, `DesktopLocalEnvironmentAuth.ts`, `DesktopSshPasswordPrompts.ts`, `DesktopSshEnvironment.ts`, `DesktopApp.ts`).

Replace the literal `"T3 Code"` with `"Astrolabe"` in place. Do **not** refactor these into imports of the branding constant: that would grow the diff (imports + template conversions on ~50 lines across files upstream actively edits) against the bounded-tracking discipline. A literal-for-literal swap keeps each conflict, if upstream edits the same sentence, trivial to resolve. (Significant choice; flagged for review.)

**Exception — "T3 Connect"** *(amended during implementation)*: "T3 Connect" names t3code's hosted relay *service* — a real external service, not our product — and it turns out to be a coherent surface of ~40 occurrences (settings panel title, sign-in buttons, onboarding wizard, `T3ConnectSidebarSignIn.tsx`), not two dialog sentences. Rewording all of it would misdescribe what the app connects to and spread the diff; rewording only part would be inconsistent. Resolution: **keep "T3 Connect" everywhere**, recorded as the sole deliberate exception to the AC's no-t3-strings rule (alongside the license/attribution text). Its disposition belongs with the relay/cloud question at cut-over.

**Out of AC scope, listed for a follow-up issue:** `apps/server` emits a few user-adjacent strings — `vcs/GitVcsDriver.ts:661-663` (`GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME: "T3 Code"` — visible in commit history the app renders), `mcp/McpHttpServer.ts:212` (`name: "T3 Code"`), `provider/Layers/CodexProvider.ts:280,337` (`title: "T3 Code Desktop"`), `startupAccess.ts:124`. The AC scopes this issue to "the web app and desktop shell"; these should become a small follow-up rather than silently widening this diff.

Parked surfaces `apps/mobile` and `apps/marketing`: zero edits, per the issue. `LICENSE` (MIT, © 2026 T3 Tools Inc.): untouched.

### Icons and wordmark: swap contents inside the existing pipeline

The asset pipeline is already channel-aware and script-driven; we replace file *contents* and let every consumer follow:

- **Source of truth:** `assets/prod/`, `assets/nightly/`, `assets/dev/` each hold an Icon Composer project (`app-icon.icon`) plus exported PNGs/ICOs (macOS 1024, iOS 1024, universal/Linux 1024, Windows `.ico`, web favicon set). The Mercurian mark comes from the **landing repo** (per the issue). **Gap:** the landing repo is not connected to this session and no Mercurian mark exists in any connected folder (the scaffold's `logo*.png` are stock React logos) — acquiring the master art (1024×1024 icon art, per channel treatment, + wordmark SVG) is the first checklist item.
- **Derived files we regenerate and check in** (same filenames, new contents): the web favicon sets (`*-web-favicon.ico`, `*-16x16.png`, `*-32x32.png`, `*-apple-touch-180.png`) and platform icons in each `assets/<channel>/`; the checked-in web defaults `apps/web/public/{favicon.ico,favicon-16x16.png,favicon-32x32.png,apple-touch-icon.png}` and their copies in `apps/web/src/assets/`; and `apps/desktop/resources/icon.{png,icns,ico}`. All are derivable from the 1024 masters with ImageMagick (the repo's own Linux path in `build-desktop-artifact.ts` already assumes ImageMagick) plus an icns packer; `.icns` can alternatively be produced on macOS with `iconutil` exactly as `electron-launcher.mjs` does.
- **In-app wordmark/splash:** `SplashScreen.tsx` and the `index.html` boot shell render `/apple-touch-icon.png` — they pick up the new mark with no code change. `index.html` keeps its structure; only `<title>`, the splash `aria-label`, and the `<img alt>` text change.
- **Icon Composer projects:** updating `assets/*/app-icon.icon` requires Icon Composer on macOS (`assets/README.md`). This is a manual step for Venkat's Mac; until it's done, `vp run icons:check` will report the regenerated exports as out of sync with the `.icon` sources. The plan accepts that as a known, documented intermediate state (checklist item, not a blocker).
- **Provider icons in `apps/web/src/components/Icons.tsx`** (Gemini, Antigravity, JetBrains, etc.) are third-party marks, not t3 branding — untouched.

### Why this shape

Everything above rides seams upstream already maintains (branding constants, asset pipeline), so routine `upstream/main` merges touch our diff only where upstream edits the exact same literal sentence — the cheapest possible conflict. The only spread-out part is the literal string sweep, which the AC forces, and it is one-line-per-site by construction.

## Implementation Checklist

- [ ] **Acquire Mercurian marks** — connect the landing repo (or drop the files in): 1024×1024 icon art (per-channel treatment for prod/nightly/dev, or one mark reused), wordmark/logo SVG.
- [ ] Branch `venk/m-121-branding-pass-mercurian-identity-on-the-inherited-design` off `main`.
- [ ] `apps/web/src/branding.ts`: `APP_BASE_NAME` fallback → `"Astrolabe"`.
- [ ] `apps/desktop/src/app/DesktopEnvironment.ts`: `APP_BASE_NAME` → `"Astrolabe"`. Leave `userDataDirName`, `legacyUserDataDirName`, `t3Home` untouched.
- [ ] `apps/desktop/src/app/DesktopAppIdentity.ts`: add `copyright` to `setAboutPanelOptions` (`© 2026 Mercurian — built on t3code, MIT © 2026 T3 Tools Inc.`).
- [ ] `apps/web/index.html`: `<title>Astrolabe (Alpha)</title>`; splash `aria-label` and logo `alt` → Astrolabe. Do not touch the `t3code:theme` key or splash styling.
- [ ] Literal sweep, `apps/web/src` (17 files listed in Design): `"T3 Code"` → `"Astrolabe"`; "T3 Connect" stays everywhere (amended — see Design).
- [ ] Literal sweep, `apps/desktop/src` (7 files listed in Design): `"T3 Code"` → `"Astrolabe"`.
- [ ] Regenerate and replace icon files (same names, new contents): `assets/{prod,nightly,dev}` exported PNG/ICO sets; `apps/web/public` favicon set; `apps/web/src/assets` favicon set; `apps/desktop/resources/icon.{png,icns,ico}`.
- [ ] Update `assets/*/app-icon.icon` Icon Composer projects on macOS (manual, Icon Composer 2+; see `assets/README.md`) — may land as an immediate follow-up commit; until then `icons:check` divergence is expected and noted in the commit message.
- [ ] Update test expectations that assert the old default name (see Test Plan). Fixture literals that are arbitrary (e.g. injected-branding fixtures in `branding.test.ts`, path fixtures in `DesktopAppIdentity.test.ts`) may stay as-is where the assertion doesn't encode the new default.
- [ ] Do **not** touch: `apps/mobile`, `apps/marketing`, `LICENSE`, `apps/desktop/package.json` `productName`, `@t3tools/*` names, `scripts/lib/brand-assets.ts`, any color/type/spacing/component code.
- [ ] Commit as `feat(branding): present as Astrolabe/Mercurian on the inherited design (M-121)` citing ADR 004 §3.

## Test Plan

Runner: `vp test run` per app (co-located `*.test.ts` convention).

- [ ] `apps/web/src/branding.test.ts` — update expectations for the new default base name in the hosted-channel cases (`"Astrolabe (Nightly)"`); the injected-desktop-branding case keeps its explicit fixture and still passes unchanged.
- [ ] `apps/desktop/src/app/DesktopAppIdentity.test.ts` — `setName`/`setAboutPanelOptions` assertions become `"Astrolabe (Alpha)"` etc.; add/extend assertion for the new `copyright` field. Legacy-user-data-path cases keep asserting the `"T3 Code (Alpha)"` legacy directory (behavior must not change).
- [ ] `apps/desktop/src/window/DesktopApplicationMenu.test.ts`, `apps/desktop/src/electron/*.test.ts` — fixtures inject names explicitly; verify they pass, update only where an expectation encodes the default.
- [ ] Full `vp run -r test` for `apps/web` + `apps/desktop`.
- [ ] **AC sweep (no-t3-strings):** `rg -n "T3 Code|T3 Tools|T3Code" apps/web/src apps/desktop/src --glob '!*.test.*'` returns nothing (after the sweep the only allowed hits are the about-panel attribution line and internal identifiers like `t3code:theme`, `t3codeCommitHash`, `@t3tools/*` imports — enumerate and eyeball).
- [ ] **Visual no-drift check:** diff touches no `.css`/tailwind/theme files; `git diff --stat` shows only the files enumerated above.
- [ ] **Parked surfaces:** `git diff --stat` shows zero changes under `apps/mobile` and `apps/marketing`; `LICENSE` unchanged.
- [ ] Manual smoke: `vp run dev` web — tab title "Astrolabe (Dev)", Mercurian favicon; desktop start — window title, menu, about panel read Astrolabe, dock icon is Mercurian's (dev icon path `assets/dev/blueprint-macos-1024.png` contents replaced).

---

*Review note: the significant calls made here — base name "Astrolabe" (vs "Mercurian Astrolabe"), literal string sweep (vs refactoring copy onto the branding constant), keeping "T3 Connect" as the named external service, keeping t3-flavored asset filenames, and deferring `productName` — can be pressure-tested with `technical-plan-decision-review`.*
