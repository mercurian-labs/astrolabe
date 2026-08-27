# Technical Plan — M-171: Marketing site foundation, the product's own components live on the page

Generated from the Goal/AC of Linear issue M-171. Goal in one sentence: a fresh Mercurian marketing
site (`apps/landing`) inside this repo that renders the product's real components — starting with the
Checkpoint Graph — from realistic plan data, such that drift between the app and the site is caught
by the repo's checks rather than discovered later.

Design source: the almagest note **Marketing Site** (resolved: fresh sibling app, not a retrofit of
`apps/marketing`; the parked app stays untouched and dies at cut-over per
`docs/architecture/fork-baseline.md:42`).

## Conventions Detected

- **An Astro app is the in-repo precedent for a marketing site** — `apps/marketing/package.json`
  (`astro ^7.0.3`, scripts `dev`/`build`/`preview`/`typecheck: astro check`, devDep
  `@astrojs/check ^0.9.7`), bare `astro.config.mjs` setting only the dev port. Confidence: high for
  the shape, **but see Risk 1: no CI job ever builds it**, so "Astro works under this workspace" is
  unverified.
- **Workspace membership is by directory glob** — `pnpm-workspace.yaml` `packages: apps/*`; root
  `build` script already filters `./apps/*`. New app needs no workspace-file edit. High.
- **Package naming: `@t3tools/<app>`** — every app/package (`@t3tools/marketing`, `@t3tools/web`);
  no `@mercurian` scope exists anywhere; ADR 004 fences renames until cut-over. High.
- **Root convenience scripts per app** — `dev:marketing` / `start:marketing` / `build:marketing` in
  root `package.json` (`vp run --filter @t3tools/<app> <script>`). High.
- **Repo-wide typecheck picks up per-package `typecheck` scripts** — root `typecheck: vp run -r ...`;
  CI "Check" job runs `vpr typecheck` (`.github/workflows/ci.yml:48`), so a landing `typecheck`
  script is exercised in CI automatically. High.
- **CI edits are made in place on `ci.yml`** — the design-system work added/removed steps there
  (e.g. `test:design-system` at `ci.yml:98`). Job names are required status checks; adding a _step_
  to an existing job is the safe move, adding a _job_ is not. High.
- **Tailwind v4, CSS-first, single source of truth** — `apps/web/src/index.css` opens with
  `@import "tailwindcss"` + `@custom-variant dark`; **zero `@source` directives**; semantic roles
  bridged from `apps/web/src/themePalette.ts`. No tailwind.config anywhere. High.
- **Components import via the `~/` alias** — 40 files under `apps/web/src/components/{ui,mercurian}`
  import `~/lib/utils` etc.; alias declared in `apps/web/vite.config.ts` and `components.json`. High.
- **React is pinned exact and deduped** — `react 19.2.6` / `react-dom 19.2.6` exact in
  `apps/web/package.json`; `resolve.dedupe: ["react", "react-dom"]` at `apps/web/vite.config.ts:234`. High.
- **Catalog entries are the precedent for standalone component mounting** —
  `apps/web/src/components/mercurian/DagExplorer.catalog.tsx` builds a branching history from
  `apps/web/src/test/fixtures/timeline.ts` (`timeline`/`message`/`planRevision`/`specRevision`),
  calls `buildPlanGraph` (`PlanGraph.logic.ts`), passes inert callbacks, and seeds the view via
  `EXPLORER_VIEW_STORAGE_KEY`. Fixtures import only `@t3tools/contracts` + `effect/Schema` — no
  test-framework imports, safe to ship in a demo bundle. High.
- **Plan docs live at `docs/project/technical-plan-m-<n>-<slug>.md`**; repo docs that must track new
  apps: `docs/internals/workspace-layout.md`, `docs/internals/scripts.md`,
  `docs/architecture/fork-baseline.md` (disposition table, amended by revision, never silently). High.
- **Dependency discipline** — `pnpm-workspace.yaml` `minimumReleaseAge` policy with explicit
  exclusions; lockfile is workspace-wide; installs happen outside Sol's sandbox (registry access).
  Medium (policy inferred from config, not docs).

## The two load-bearing facts

1. **`DagExplorer` is presentational.** Props are data + callbacks (`graph`, `anchoredCommitId`,
   `providers`, `codingSessions`, `readyCommits`, stale-id sets, handlers); no router, no RPC, no
   app stores; its own docstring says it carries no subscription. Its runtime deps resolve from
   `apps/web/node_modules` when imported by path (pnpm resolves bare specifiers from the _importing
   file's_ package), so `apps/landing` does **not** need to declare `effect`, `lucide-react`,
   `@base-ui/react`, etc.
2. **Risk 1 — the workspace overrides `vite` → `npm:@voidzero-dev/vite-plus-core@0.2.2` globally**
   (`pnpm-workspace.yaml` `overrides`). Astro embeds Vite, so Astro's internals will run against
   vite-plus-core, and nothing in CI has ever proven `astro build` works here (the M-140 spike proved
   Storybook does, with an esbuild override that has since been removed). **Step 0 of the checklist
   is the spike**: run `vp run build:marketing` once. If Astro 7 cannot build under the override,
   stop and re-plan (fallback direction: a plain vite-plus static build with hand-mounted islands —
   worse DX, so only if the spike fails; do not silently switch).

## Design

### The app

`apps/landing` **(new)** — package `@t3tools/landing`, Astro `^7.0.3` matching `apps/marketing` so
the lockfile dedupes. Astro because the AC demands both halves: static pages that ship **zero**
scripting, and one island that hydrates a real React component. Layout:

```
apps/landing/
  package.json          (new) scripts dev/build/preview/typecheck, deps below
  astro.config.mjs      (new) react() integration, tailwindcss() vite plugin, ~ alias, dedupe, dev port
  tsconfig.json         (new) extends astro/tsconfigs/strict; jsx react-jsx; paths "~/*" → ../web/src/*
  src/styles/global.css (new) imports the web app's index.css; @source the web app's src
  src/layouts/Base.astro(new) minimal html shell importing global.css
  src/pages/index.astro (new) static shell — proves the zero-JS page
  src/pages/demo/checkpoint-graph.astro (new) hosts the island
  src/islands/CheckpointGraphDemo.tsx   (new) the live DagExplorer demo
  scripts/assert-static.mjs             (new) post-build guard, see Test Plan
```

Dependencies (declared in `apps/landing/package.json`): `astro ^7.0.3`, `@astrojs/react` (current
compatible release), `react 19.2.6` + `react-dom 19.2.6` (exact, matching `apps/web` so pnpm gives
both apps one instance), `@tailwindcss/vite ^4.0.0`, `tailwindcss ^4.0.0`; dev:
`@astrojs/check ^0.9.7`, `@types/react ~19.2.14`, `@types/react-dom ~19.2.3`,
`typescript catalog:`. Nothing else — every product-component dep resolves via `apps/web` (fact 1).

### Reaching the product's components

- `astro.config.mjs` sets `vite.resolve.alias: { "~": "<abs path to>/apps/web/src" }` and
  `vite.resolve.dedupe: ["react", "react-dom"]` (mirrors `apps/web/vite.config.ts:234`; two React
  copies is the classic failure here and the dedupe plus exact-version pin closes it).
- `tsconfig.json` mirrors the alias in `paths` so `astro check` follows the same resolution.
- **No file under `apps/web/` changes.** The site is a pure consumer; that is what makes AC-7
  ("marketing app untouched" — and by extension the whole product untouched) trivially auditable.

### Tokens and Tailwind

`src/styles/global.css`:

```css
@import "../../../web/src/index.css";
@source "../../../web/src";
```

The first line makes `apps/web/src/index.css` — `@import "tailwindcss"`, the `@theme` role block,
every semantic utility — the single styling source; url()/font assets inside it resolve relative to
that file, which Vite handles. The second line is required because the web app's `index.css` has no
`@source` of its own and Tailwind v4's auto-detection scans only the _building_ project's root
(`apps/landing`); without it the utilities used inside `DagExplorer` and `components/ui` would be
missing from the generated CSS. The demo page must render visually identical to the app (AC-2), so
a correctness check for this line is in the Test Plan.

### The demo island

`src/islands/CheckpointGraphDemo.tsx` mirrors `DagExplorer.catalog.tsx`: build a branching history
with the `timeline()` fixture builders (include a fork and both branches so all three views have
something to show), `buildPlanGraph`, inert callbacks, render `<DagExplorer {...props} />`. Mounted
with `client:only="react"` (the component reads `localStorage` through `useLocalStorage` and
measures itself; SSR would render it dead or mismatched — `client:only` skips server rendering
entirely). The page gives the island a sized container (the component fills its parent). View
switching (AC-3) comes free — `DagExplorer` owns its Thread/Columns/Graph switcher, persisted under
`mercurian:dag-explorer-*` keys; do not seed or reset localStorage in the demo.

### Wiring into the monorepo

- Root `package.json`: add `dev:landing`, `start:landing`, `build:landing` mirroring the
  `*:marketing` trio. The root `build` filter `./apps/*` picks the app up with no edit.
- `typecheck` script `astro check` joins `vpr typecheck` automatically (convention above).
- CI (`.github/workflows/ci.yml`): one new step in the existing **Check** job, after "Typecheck":
  `- name: Build landing site` / `run: vp run build:landing`. This is AC-5: a product-component
  change that breaks the site now fails a required check. No new job (job names are required
  status checks; a step inherits the job's required status).
- Docs: `docs/internals/workspace-layout.md` gains the app; `docs/internals/scripts.md` gains the
  three root scripts; `docs/architecture/fork-baseline.md` gains a disposition row
  (`apps/landing` — **Mercurian-owned**; the Mercurian marketing site, replaces the parked
  `apps/marketing` at cut-over) as a numbered revision per that ADR's own amendment rule.

### Gaps the AC exposes (and their resolution)

- No app outside `apps/web` has ever consumed the product's components — the alias + dedupe + CSS
  `@source` triad above is the new mechanism, and the spike (step 0) plus the Test Plan's visual
  walk are its proof.
- "Pages ship no scripting" has no existing enforcement anywhere — `scripts/assert-static.mjs`
  (run as the app's `postbuild`) fails the build if any `<script` tag appears in the built
  `dist/index.html`, turning AC-6 from a walk-once property into a standing gate.

## Implementation Checklist

- [ ] **Step 0 — spike:** `vp run build:marketing` from the repo root. If Astro 7 fails under the
      workspace `vite → @voidzero-dev/vite-plus-core` override, **stop and report**; the rest of
      this plan assumes the spike passes.
- [ ] Create `apps/landing` with `package.json` (`@t3tools/landing`, private, scripts
      `dev`/`build` (+`postbuild` guard)/`preview`/`typecheck: astro check`, deps exactly as listed
      above), `astro.config.mjs` (react + tailwind vite plugin, `~` alias, react dedupe, dev port
      distinct from marketing's 4173 — use `PORT ?? 4321`), `tsconfig.json` (astro strict, jsx
      react-jsx, `~/*` paths).
- [ ] `src/styles/global.css` with the two-line import/@source; `src/layouts/Base.astro` importing it.
- [ ] `src/pages/index.astro`: static placeholder shell (site name + link to the demo page; no
      product claims — copy is M-172's job), zero client JS.
- [ ] `src/islands/CheckpointGraphDemo.tsx` + `src/pages/demo/checkpoint-graph.astro` mounting it
      `client:only="react"` in a sized container.
- [ ] `scripts/assert-static.mjs` post-build guard on `dist/index.html`.
- [ ] Root `package.json`: `dev:landing`, `start:landing`, `build:landing`.
- [ ] `.github/workflows/ci.yml`: "Build landing site" step in the Check job.
- [ ] Docs: `workspace-layout.md`, `scripts.md`, `fork-baseline.md` disposition row (numbered
      revision).
- [ ] **Do not** touch anything under `apps/marketing/` or `apps/web/`; **do not** extract a shared
      package; **do not** add deployment config (M-175's scope).

## Test Plan

No unit-test runner is added to `apps/landing` (nothing in it has logic to unit-test; the guard
script and the repo's existing gates carry verification).

- [ ] `vp run build:landing` succeeds; built `dist/index.html` contains no `<script` (guard passes);
      built demo page **does** reference an island chunk.
- [ ] `vp run --filter @t3tools/landing typecheck` (astro check) passes; repo-wide `vpr typecheck`
      still passes (marketing + web unaffected).
- [ ] `vp check` (lint/fmt) passes over the new files.
- [ ] Browser walk (dev server via `vp run dev:landing`): demo page shows the Checkpoint Graph with
      the forked fixture history; all three views (Thread / Columns / Graph) switch from the
      component's own toggle; node popovers open; **visual identity vs. the app's `/design-lab`
      DagExplorer entries** — same fonts, colors, spacing (this is the `@source` line's proof; a
      missing-utilities failure shows up here as unstyled or half-styled UI).
- [ ] Sync walk (AC-4): make a throwaway visual edit in
      `apps/web/src/components/mercurian/DagExplorer.tsx`, rebuild landing only, observe the change
      on the demo page, revert the edit.
- [ ] Break walk (AC-5, local proxy for CI): with a deliberate type error in `DagExplorer.tsx`,
      `vp run build:landing` fails; revert.
- [ ] `git status` confirms zero changes under `apps/marketing/` and `apps/web/` (AC-7).
