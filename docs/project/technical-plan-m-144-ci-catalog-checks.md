# Technical Plan — M-144: CI — catalog checks and a browsable build per PR

_Generated from the Goal/AC of Linear issue M-144 (see the issue for the full AC). Last link in the design-system stack, on top of M-143's catalog. This plan also **resolves the open interaction-check-runner decision** recorded in [design-system.md](../internals/design-system.md): portable stories running as a vite-plus browser-mode test project — no Storybook addon, no standalone vitest._

**Goal, in one sentence:** every pull request builds the catalog, renders every story in a real headless browser with an axe accessibility pass, fails the existing required checks when any of that breaks, and publishes the static catalog where the PR links to it — with no external service.

**Scope fences:** no new required status checks (everything lands inside the existing `Test` job, per the strategy doc); no visual snapshots; no play-function authoring (the harness _supports_ them, M-143's stories carry only one); no Chromatic or any external service.

## What discovery found

- **vite-plus _is_ Vitest 4.1.9 under an alias.** `vite-plus/test/config` re-exports `vitest/config`; `vp test` resolves and execs the real Vitest CLI (`vite-plus/dist/bin.js:307`), so `--project <name>` and every Vitest flag work. Browser mode is first-class: `@vitest/browser` and `@vitest/browser-preview` are already hard dependencies of vite-plus; the **playwright provider (`@vitest/browser-playwright`) and `playwright` itself are the only missing pieces** (only `playwright-core` exists, as an `apps/desktop` dep). Providers are factory functions re-exported at `vite-plus/test/browser-playwright`.
- **Portable stories need no addon.** The installed `@storybook/react@9.1.20` exports `composeStories`/`composeStory`/`setProjectAnnotations` ([dist/index.d.ts:92](../../apps/web/node_modules/@storybook/react)). A browser-mode test can `import.meta.glob` every `*.stories.tsx`, compose with the preview annotations, render, and assert — which is exactly the interaction-check shape the strategy doc left open.
- **The second test project slots into the existing config.** `apps/web/vite.config.ts` ends with `test.projects: [defineProject(unitTestProject)]`; a `stories` project with `extends: true` inherits the app's full plugin pipeline (react + compiler, tailwind) — which a separate config file would have to re-derive. One contiguous addition to a conflict-prone file, accepted for that reason; the unit project's include (`src/**/*.test.{ts,tsx}`) doesn't overlap a harness living under `.storybook/checks/`. M-143's shim alias map (`.storybook/shims/aliases.ts`) is reused as the project's `resolve.alias`, so the harness mounts stories under the same shims the catalog uses.
- **No axe anywhere yet** — `axe-core` (plain library, no framework binding) is the third new dependency.
- **CI shape.** [ci.yml](../../.github/workflows/ci.yml): `pull_request` + push-to-main, no path filters; jobs `check`/`test` (names `Check`/`Test` are the required status checks) on `blacksmith-8vcpu` runners via `voidzero-dev/setup-vp@v1` (`run-install: true`), 10-minute timeouts; the `test` job already uploads an artifact (`actions/upload-artifact@v7`, `thread-transfer-results`). Actions are tag-pinned, not SHA-pinned.
- **The PR-visibility precedent is in-repo.** `thread-transfer-report.yml` uses `on: workflow_run: workflows: [CI]` with `actions: read` to download a CI artifact and post/update a PR comment from the trusted default-branch context — the exact safe pattern for linking the catalog artifact on the PR (forked-PR tokens never publish anything themselves).

## Conventions Detected

| Convention                                                                                                               | Evidence                                   | Confidence |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------- |
| CI uses `setup-vp@v1` + `vp` commands on blacksmith runners; required checks are the job names `Check`/`Test`            | `ci.yml`, design-system.md §Testing ladder | High       |
| Artifacts via `actions/upload-artifact@v7`; PR comments via the `workflow_run` + `github-script` pattern                 | `ci.yml:105`, `thread-transfer-report.yml` | High       |
| Actions pinned by tag; third-party binaries pinned by version+SHA                                                        | all `.github/workflows/*`                  | High       |
| Per-package test scripts fanned out by `vp run -r test`; project selection via `--project`                               | root + apps/web `package.json`             | High       |
| New deps land as apps/web devDependencies with reviewer involvement; exact-pin when matching an installed version family | M-140 process; vitest 4.1.9 via vite-plus  | High       |

## Design

### 1. Dependencies (reviewer-installed): `@vitest/browser-playwright@4.1.9`, `playwright@1.60.0`, `axe-core` (caret)

Exact 4.1.9 matches vite-plus's vitest; playwright 1.60.0 matches the `playwright-core` already in the lockfile. All `apps/web` devDependencies.

### 2. The harness: `apps/web/.storybook/checks/stories.browser.test.tsx` (new)

One browser-mode suite that is the catalog's executable contract:

- `setProjectAnnotations` with the preview module (theme/appearance decorators included).
- `import.meta.glob("../../src/**/*.stories.tsx", { eager: true })` — same glob as `main.ts`, so a story cannot exist that the checks don't see.
- For every composed story: mount into a fresh container (`react-dom/client` `createRoot`; no testing-library exists in this repo and none is added), `await story.run()` so `play` functions execute, assert the container rendered content, then run `axe.run(container)` and fail with the formatted violation list if any violations return. One `it` per story via `describe`/dynamic test registration, so failures name the story id.
- Known-exception escape hatch: a story can declare `parameters: { a11y: { disable: true } }` — honored with a logged skip, so a deliberate exception is visible, never silent.

### 3. The `stories` test project (one contiguous edit in `apps/web/vite.config.ts`)

A second `defineProject` entry: `name: "stories"`, `include: [".storybook/checks/**/*.browser.test.{ts,tsx}"]`, `extends: true`, `resolve.alias` from `.storybook/shims/aliases.ts`, and `browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }], screenshotFailures: false }`. `apps/web/package.json` gains `"test:stories": "vp test run --project stories"`. The default `test` script stays `--project unit`, so `vp run -r test` (what CI's `Test` job runs today) is unchanged — story checks are an explicit step, not a tax on every package test run.

### 4. CI: three steps appended to the existing `test` job, one new report workflow

In `ci.yml`'s `test` job, after the existing `vp run test` step: build the catalog (`vp run --filter @t3tools/web storybook:build` with `STORYBOOK_DISABLE_TELEMETRY=1`); install the browser (`pnpm --filter @t3tools/web exec playwright install chromium`); run `vp run --filter @t3tools/web test:stories`; upload `apps/web/dist/storybook` as artifact `storybook-catalog` (`upload-artifact@v7`, `if-no-files-found: error`, 30-day retention). Because these are steps inside `Test`, a broken build or failing check fails the existing required check — no branch-protection change.

New `storybook-catalog-report.yml` (new file, merge-safe): `workflow_run` on CI completion, mirroring `thread-transfer-report.yml` — finds the PR, posts or updates one comment linking the run's `storybook-catalog` artifact (and states pass/fail of the story checks). Viewing requires only GitHub itself — the no-external-service AC.

### 5. The decision record

`design-system.md`'s tooling section gains the resolution: interaction and accessibility checks run as portable stories in a vite-plus browser-mode project (chromium, headless); the Storybook vitest addon stays uninstalled; the testing-ladder rungs 2–3 now name this mechanism.

## Implementation Checklist

- [ ] (Reviewer) add the three devDependencies and install; commit the lockfile.
- [ ] Create `.storybook/checks/stories.browser.test.tsx` (glob → compose → render → `run()` → axe, per-story test names, `a11y.disable` escape hatch honored loudly).
- [ ] Add the `stories` project block to `apps/web/vite.config.ts` (one contiguous edit) and the `test:stories` script to `apps/web/package.json`.
- [ ] Run locally: `pnpm --filter @t3tools/web exec playwright install chromium`, then `test:stories` — all M-143 + M-142 + M-140 stories render and pass axe; fix real violations found in Mercurian-owned components, or mark deliberate exceptions with `a11y.disable` + a comment.
- [ ] Append the three steps + artifact upload to the `test` job in `ci.yml`; create `storybook-catalog-report.yml` from the in-repo precedent.
- [ ] Record the interaction-runner resolution in `docs/internals/design-system.md`.
- [ ] `tsgo --noEmit`, unit project, lint all green; `vp run -r test` unchanged in behavior.
- [ ] Don't add a CI job, don't touch branch protection, don't add snapshots or an a11y addon.

## Test Plan

CI changes are proven by running exactly what CI will run, locally and in order:

- [ ] `storybook:build` → `playwright install chromium` → `test:stories`: green, with per-story test names visible in output.
- [ ] Break-glass negatives, run locally then reverted: a story that renders nothing fails its check; an intentionally-inaccessible probe story (e.g. iconic button with no accessible name) fails with a readable axe report naming the story.
- [ ] `vp run test` (the unchanged CI step) still passes and does not run the stories project.
- [ ] Workflow YAML validated (`gh workflow` syntax check via a dry parse or actionlint if present; else careful review) — full end-to-end CI proof lands with the stack's PRs, and the report workflow can only be observed there; both are called out in the PR description as the post-merge verification.
