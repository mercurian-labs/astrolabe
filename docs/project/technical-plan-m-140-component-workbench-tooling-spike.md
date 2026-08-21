# Technical Plan — M-140: Component workbench — tooling spike

_Generated from the Goal/AC of Linear issue M-140 (see the issue for the full AC). Executes the first implementation step of the [design-system and Storybook strategy](../internals/design-system.md) (rev 2), under [ADR 004](../architecture/fork-baseline.md) rev 3 (additive workbench before cut-over; minimal edits in upstream-owned files). Branch is stacked on `venk/design-custom-astrolabe-experience`, which carries the strategy doc this plan executes._

**Goal, in one sentence:** prove — by a running catalog, not an argument — whether Storybook can host Astrolabe's component workbench under this repository's toolchain, with the production stylesheet and theme application and one real Mercurian component rendering in both appearances, and record the answer (or the fall back to vite-plus browser mode) in the strategy doc's tooling section.

**Scope fences:** no catalog build-out beyond one component (that's M-143); no fixture work (M-141); no CI wiring (M-144); no interaction-check runner selection beyond _recording_ what the spike learned about it; no restyling of anything. Failure of the preferred tool is a valid, reportable outcome. Timebox: two days of effort.

## What discovery found

- **The `vite` this repo serves is not Vite.** The pnpm catalog maps `vite: npm:@voidzero-dev/vite-plus-core@0.2.2` ([pnpm-workspace.yaml](../../pnpm-workspace.yaml)), and the `overrides:` block routes workspace resolutions through the catalog — so any Storybook package that declares or imports `vite` resolves to vite-plus-core, version string `0.2.2`, whose API tracks Vite 8.1 (the web config's own comment: "Vite 8.1's experimental bundled dev mode", [apps/web/vite.config.ts:58](../../apps/web/vite.config.ts)). Storybook's react-vite framework builds directly on the Vite API and declares Vite peer ranges; whether it accepts this alias — at install time (peer resolution) and at runtime (API surface, version sniffing) — is exactly the unknown this spike exists to burn down.
- **The app's own vite config is mostly hostile to a catalog.** [apps/web/vite.config.ts](../../apps/web/vite.config.ts) wires the TanStack router plugin, the React Compiler babel preset, a dev proxy, dev compression, and a `define` block of `VITE_*` env pins. A story catalog wants almost none of that — only `tailwindcss()` (Tailwind v4 is CSS-first; without the plugin no utility classes exist), `resolve.tsconfigPaths` (the `~` alias → `apps/web/src`), and `dedupe: ["react", "react-dom"]`. The spike therefore composes a minimal Vite config of its own rather than importing the app's.
- **Theme application is two mechanisms, both story-reachable.** The stylesheet ([apps/web/src/index.css](../../apps/web/src/index.css), the app's single CSS file, imported once from `main.tsx`) defines `@custom-variant dark (&:is(.dark, .dark *))` with role variables in `:root`/`.dark`; appearance switching is `classList.toggle("dark", …)` on the document element ([apps/web/src/hooks/useTheme.ts:314](../../apps/web/src/hooks/useTheme.ts), [apps/web/src/themePalette.ts:1667](../../apps/web/src/themePalette.ts)). A preview-level decorator that imports `index.css` and toggles the `dark` class reproduces the production light/dark pair with no app runtime.
- **The first component is already chosen by its shape.** [PlanStatusDot.tsx](../../apps/web/src/components/mercurian/PlanStatusDot.tsx) is small, presentational, Mercurian-owned, and state-complete: `PLAN_STATUS_PRESENTATION` enumerates the three statuses (`awaiting-input`, `working`, `unseen`), each with light and dark classes — exercising Tailwind utilities, the dark variant, an animation (`animate-status-pulse`), and one `ui/` primitive (`Tooltip`, base-ui) in a component with a one-prop surface.
- **Interaction checks are a separate, harder question — deliberately out of scope.** Storybook 9's interaction-testing story is its vitest addon, and this repo replaced vitest with vite-plus (`vp test`; tests import from `"vite-plus/test"`, no `vitest.config.*` outside vendored checkouts). Whatever the build spike finds, interaction-check hosting needs its own answer; the spike only records what it learned.
- **The fallback is already half-declared in the repo.** [apps/web/src/vite-plus-browser-matchers.d.ts](../../apps/web/src/vite-plus-browser-matchers.d.ts) types `expect.element` against `vite-plus/test/browser`, but no config declares a browser test project — browser mode is available and unused. The fallback shape (only sketched here; detailed if taken): a separate config file declaring a browser-mode test project over `*.stories.tsx` modules, with a thin story convention.
- **Dependency discipline will bite an unpinned choice.** pnpm 11 with `minimumReleaseAgeExclude` in the workspace file implies a minimum-release-age policy: a just-published Storybook patch may be refused at install. `apps/web` dependencies use caret ranges (`"@tailwindcss/vite": "^4.0.0"`); Storybook lands there as devDependencies with a caret range on a release old enough to clear the age window, not an exclusion entry.
- **The merge-safety seam is exactly two files wide.** The weekly upstream sync ([.github/workflows/upstream-sync.yml](../../.github/workflows/upstream-sync.yml)) makes `apps/web/vite.config.ts` and `apps/web/package.json` the conflict-prone files. A new `apps/web/.storybook/` directory and new story files have no upstream counterpart and merge clean; the only upstream-owned file this plan touches is `apps/web/package.json`.

## Conventions Detected

| Convention                                                                                                                            | Evidence                                                                                                        | Confidence |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Mercurian code additive; upstream-owned file edits minimal and contiguous (ADR 004 budget language)                                   | [fork-baseline.md](../architecture/fork-baseline.md), M-130 plan's "additive edit" accounting                   | High       |
| New web tooling config lives beside the app, not at repo root; `~` alias resolves via `resolve.tsconfigPaths`                         | [apps/web/vite.config.ts:207](../../apps/web/vite.config.ts), [components.json](../../apps/web/components.json) | High       |
| Dependencies: caret ranges in app manifests, exact pins only via catalog for shared packages; minimum-release-age policy in force     | [apps/web/package.json](../../apps/web/package.json), [pnpm-workspace.yaml](../../pnpm-workspace.yaml)          | High       |
| Appearance = `dark` class on the document element + role variables; no other theme mechanism                                          | `useTheme.ts`, `themePalette.ts`, `index.css`                                                                   | High       |
| Commits `<type>(scope): … (M-140)`, branch `venk/m-140-<slug>`, plan docs at `docs/project/`; `vp fmt` runs on staged files at commit | `git log`, existing plans, observed commit hooks                                                                | High       |
| Strategy decisions are recorded in `docs/internals/design-system.md`; its tooling section owns this spike's outcome                   | [design-system.md](../internals/design-system.md) rev 2                                                         | High       |

## Design

### 1. Dependencies: Storybook 9, react-vite framework, `apps/web` devDependencies only

`storybook`, `@storybook/react-vite`, and `@storybook/react` (all one caret-ranged 9.x minor, old enough to clear the release-age window) join `apps/web` `devDependencies`. No addons in the spike: Storybook 9 bundles controls/docs essentials in core, and every addon widens the surface the alias has to survive. Nothing lands in the root manifest or the catalog — the workbench is a web-app concern until another surface consumes it (strategy doc's staging rule).

Two scripts join `apps/web` (`storybook`: `storybook dev -p 6006`; `storybook:build`: `storybook build`). Deps and scripts are the plan's **only upstream-owned edits**, kept to two contiguous blocks in `apps/web/package.json`.

### 2. Config: `apps/web/.storybook/` (new), a minimal Vite composition

- **`main.ts` (new):** stories glob `../src/**/*.stories.tsx`; framework `@storybook/react-vite`; a `viteFinal` that adds `tailwindcss()`, `resolve.tsconfigPaths: true`, and `dedupe: ["react", "react-dom"]` to Storybook's generated config. Deliberately absent: the TanStack router plugin, the dev proxy, compression, the `define` env block, and the React Compiler preset — stories are not the app shell, and each omission shrinks what the alias must survive. (A story that turns out to need a `VITE_*` define is a story reaching past its presentational boundary — a signal per the strategy doc, not a config gap to fill.)
- **`preview.tsx` (new):** imports `../src/index.css` (the production stylesheet, whole); declares an `appearance` global with a light/dark toolbar switch whose decorator toggles the `dark` class on the document element — the same act `useTheme` performs, so stories render under the exact production variant mechanism. No re-implementation of `themePalette`'s custom-theme applier in the spike; built-in-theme coverage arrives with M-142/M-143 per the staged matrix.

### 3. The proof story: `PlanStatusDot.stories.tsx` (new, beside the component)

One story file at `apps/web/src/components/mercurian/PlanStatusDot.stories.tsx`, named for user-visible states per the strategy doc's taxonomy: `Awaiting input`, `Working`, `Unseen updates`. Renders `<PlanStatusDot status={…}/>` directly — no fixtures needed (the component takes a status literal), which is what keeps this spike independent of M-141. If base-ui's `Tooltip` needs a provider to mount outside the app, that provider joins `preview.tsx` as a decorator — a finding worth the spike's time either way.

### 4. Success, failure, and the recording — the actual deliverable

The spike passes when: `pnpm --filter @t3tools/web storybook` (or `vp run` equivalent) serves the catalog; the three stories render with correct Tailwind styling in light **and** dark via the toolbar; `storybook:build` produces a static build that renders the same when served; and `vp test run --project unit`, `lint`, and `typecheck` still pass.

Whatever happens, the outcome lands as an edit to the **Tooling decision** section of [design-system.md](../internals/design-system.md): the chosen tool and versions on success, or the failure mode (peer refusal, runtime API break, silent mis-build) and the switch to the vite-plus browser-mode fallback. It also records what the spike learned about interaction-check hosting (the vitest-addon incompatibility above) as input to M-143/M-144. If the fallback is taken, the `.storybook/` directory and Storybook deps are removed on this same branch — the branch delivers one answer, not two half-installations.

## Implementation Checklist

- [ ] Add `storybook`, `@storybook/react-vite`, `@storybook/react` (caret-ranged 9.x, release-age-clearing) to `apps/web` devDependencies; run install and commit the lockfile change.
- [ ] Add the `storybook` and `storybook:build` scripts to `apps/web/package.json` — no other upstream-owned file changes.
- [ ] Create `apps/web/.storybook/main.ts` with the stories glob, react-vite framework, and the minimal `viteFinal` (tailwind, tsconfigPaths, react dedupe); no addons.
- [ ] Create `apps/web/.storybook/preview.tsx` importing `../src/index.css` and wiring the light/dark toolbar decorator via the `dark` class.
- [ ] Create `apps/web/src/components/mercurian/PlanStatusDot.stories.tsx` with the three state-named stories.
- [ ] Run the dev catalog; verify all three stories in both appearances, including the `working` pulse animation and tooltip labels.
- [ ] Run `storybook:build`; serve the static output and verify the same rendering.
- [ ] Verify `vp test run --project unit --filter @t3tools/web`, `vp lint`, and `typecheck` are unaffected.
- [ ] Record the outcome (tool + versions, or failure mode + fallback switch) in `docs/internals/design-system.md` § Tooling decision, including the interaction-check finding.
- [ ] If the fallback is taken: remove the Storybook deps and `.storybook/`, and note the browser-mode direction in the same doc edit (its detailed plan is a follow-up, not this spike).
- [ ] Don't add Storybook addons, don't touch `apps/web/vite.config.ts`, don't add CI jobs, and don't write more stories — those belong to M-142/M-143/M-144.

## Test Plan

A spike verifies by demonstration, not by suite growth — no new automated tests; the checklist's manual walk is the evidence, and the AC's sync clause is verified by the next scheduled upstream sync merging without conflict in the touched paths.

- [ ] Catalog serves locally with no running Astrolabe server, no workspace, no provider (AC 1).
- [ ] `PlanStatusDot` renders in light and dark with production styling (AC 2).
- [ ] The recorded outcome exists in the strategy doc's tooling section (AC 3).
- [ ] `git merge --no-commit --no-ff upstream/main` locally shows no conflict introduced by this branch's files (proxy for AC 4 ahead of the Monday sync); existing suites, lint, and typecheck green.
