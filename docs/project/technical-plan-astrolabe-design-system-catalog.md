# Technical Plan — Astrolabe design system and in-app catalog

_Generated from the Goal/AC in [M-159 — Astrolabe design system: map the inherited aesthetic in an in-app catalog](https://linear.app/mercurian/issue/M-159/astrolabe-design-system-map-the-inherited-aesthetic-in-an-in-app)._

**Goal, in one sentence:** make Astrolabe's current visual language explicit, complete, inspectable, and executable in a normal `/ds` application route, so the later Astrolabe rebrand changes foundations and recipes instead of rewriting product components.

## What TanStack actually built

TanStack's `/ds` is an application-owned style book, not Storybook with different chrome:

- [`/ds`](https://tanstack.com/ds) is a normal TanStack Router route with its own sidebar and child pages. It describes itself as a living catalog rendered with production styles and as a phase-one copy-paste registry.
- The route shell and documentation-only preview pieces live in `src/routes/ds.tsx`, `src/components/ds/DsKit.tsx`, and `src/components/ds/ds-nav.ts` in the locally available `tanstack.com` repository. Each catalog page is an ordinary route such as `src/routes/ds.colors.tsx` or `src/routes/ds.buttons.tsx`.
- Production design-system components live separately under `src/components/ds/ui/` and are imported by the real site. A source scan finds 28 non-DS modules consuming that kit; the catalog renders the implementation that ships.
- `src/styles/app.css` is the token source. Its Tailwind v4 `@theme static` block defines primitive ramps, category aliases, semantic color roles, typography roles, and light/dark remapping. The catalog reads live computed CSS variables, so swatches do not duplicate token values.
- The current `tanstack.com/package.json` has no Storybook or Chromatic dependency or script. The route uses the site's normal Vite, React, Router, Tailwind, theme toggle, lint, typecheck, and build path.
- The July 29 rebrand was not merely a documentation-site change. Commit `ce725bd6` (`New Branding, Design System, and Landing Pages (#1027)`) changed 280 files; the DS-specific slice introduced 33 files and roughly 8,280 lines. The public launch post says the work combined a lead designer, Figma, a logo system, global type, tokens, `/ds`, a component kit, and Phosphor icons. See [TanStack Has a New Look](https://tanstack.com/blog/tanstack-has-a-new-look).

The transferable idea is therefore **production system + in-app catalog + one token source**. TanStack's beach brand, Figma token values, copy-paste distribution model, and duplicated `components/ds/ui` location do not transfer to Astrolabe.

## Conventions Detected

| Convention                                                                                                                                          | Evidence                                                                                                                                      | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Product intent lives in Almagest; contributor and implementation strategy lives in this repository                                                  | Almagest `Visual Language` and `Status Vocabulary`; `docs/internals/design-system.md`                                                         | High       |
| The inherited appearance remains in place until hard-fork cut-over                                                                                  | `docs/architecture/fork-baseline.md`, ADR 004 §3; Almagest `Visual Language` → “What exists today”                                            | High       |
| Web routes use TanStack Router file routing and generated `routeTree.gen.ts` output                                                                 | `apps/web/src/routes/*.tsx`, `apps/web/vite.config.ts`                                                                                        | High       |
| Root-level special surfaces bypass the authenticated application shell explicitly                                                                   | `/pair` and `/connect` handling in `apps/web/src/routes/__root.tsx`                                                                           | High       |
| Reusable web controls remain leaf modules under `apps/web/src/components/ui/`; Mercurian grammar remains under `apps/web/src/components/mercurian/` | 41 non-test UI primitive modules and the current Mercurian components                                                                         | High       |
| Color customization is a typed semantic-role contract, not scattered theme CSS                                                                      | `THEME_COLOR_ROLES`, `ThemeDefinition`, and `APP_THEME_VARIABLES` in `apps/web/src/themePalette.ts`; role mapping in `apps/web/src/index.css` | High       |
| Deterministic synthetic builders are shared by catalog examples and tests                                                                           | `apps/web/src/test/fixtures/` and the existing `*.stories.tsx` imports                                                                        | High       |
| Browser component checks use the existing vite-plus Playwright project and axe; full-browser verification is focused, not repo-wide                 | `apps/web/vite.config.ts`, `.storybook/checks/stories.browser.test.tsx`, `docs/internals/design-system.md`                                    | High       |
| Changes are split into small conventional commits and focused checks                                                                                | recent `git log`; repository `AGENTS.md`; existing design-system stack M-140 through M-144                                                    | High       |
| Mobile does not inherit a web design by implication                                                                                                 | ADR 004 parks `apps/mobile` until Mercurian has a mobile design                                                                               | High       |

## Design

### 1. Treat the catalog and the design system as different things

The design system is the production contract:

1. **Foundations** — theme roles, type voices and sizes, spacing/density, shape, elevation/glass, motion, focus, breakpoints, and icon rules.
2. **Web primitives** — the existing modules under `apps/web/src/components/ui/`.
3. **Mercurian grammar** — product components under `apps/web/src/components/mercurian/`, especially status, artifacts, composer, plan navigation, and the Checkpoint Graph.
4. **Product states** — deterministic compositions built from production components and the builders under `apps/web/src/test/fixtures/`.

`/ds` is only the lens over those layers. Catalog-only layout components must never become the source of a shipping button, badge, status, or palette value.

This differs deliberately from TanStack's `src/components/ds/ui/`: Astrolabe already has an extensively consumed `components/ui` layer. Creating a second primitive kit would manufacture drift and make the eventual rebrand harder.

### 2. First map the inherited visual system without changing a pixel

The first pass names and displays the aesthetic Astrolabe ships today:

- `THEME_COLOR_ROLES` remains the authoritative customizable color contract. The catalog groups all roles into canvas/chrome, surfaces, text/icon, actions, messages, feedback, sidebar, code, and terminal families, but obtains names and live values from `themePalette.ts` rather than copying hex values into catalog modules.
- The standard light/dark maps from `getStandardThemeColors`, all built-in themes, and a synthetic high-chroma theme are rendered through the real `applyThemePalette` path. A role cannot disappear from one theme without the catalog check failing.
- The catalog documents the current compatibility bridge in `index.css`: app theme variables become the existing Tailwind semantic utilities (`background`, `foreground`, `card`, `popover`, `primary`, `muted`, `accent`, `warning`, and so on). This bridge stays during upstream tracking.
- Non-color foundations are inventoried from live CSS and the appearance runtime: `--font-sans`, `--font-mono`, `--font-composer`, interface/prompt/code sizes, the Tailwind spacing scale actually used by components, `--radius*`, borders, shadows, glass variables, breakpoints, transitions, and reduced-motion behavior.
- Iconography records the shipped Lucide conventions and the small Mercurian event-glyph family. It does not introduce a new icon package during the inventory.

Where today's implementation has an aesthetic value but no shared token, the catalog marks it as **unmanaged** and cites the owning production component. The inventory phase does not silently promote every one-off pixel into a global token.

### 3. Add product-semantic status aliases while preserving current values

Almagest's `Status Vocabulary` is more precise than generic success/warning/error. Add a small product-semantic status layer in `apps/web/src/index.css` beside the current role mappings, initially aliased to the exact emerald/amber/update values already rendered:

- attention: awaiting input, assistant working, unseen update;
- honesty: stale plan, stale spec, stale split;
- readiness: ready to implement;
- lifecycle: draft, private, published, archived;
- gates, interruption, selection, and focus.

Migrate Mercurian-owned raw palette classes found in `PlanStatusDot.tsx`, `PlanTimeline.tsx`, `PlanNodePopover.tsx`, `DagExplorer.tsx`, `PlanListSidebar.tsx`, and `PlanComposer.tsx` onto these aliases one family at a time. Each migration must have a before/after computed-style or curated screenshot proof showing no visual change.

This is the seam the future brand will use. A state keeps the same meaning and component API while its light/dark values change centrally.

### 4. Build `/ds` as a normal, lazy application route

Add the following route and catalog-only modules:

- `apps/web/src/routes/ds.tsx` **(new)** — minimal route declaration plus the validated search-param schema (`page`, optional `entry`) that makes catalog pages addressable.
- `apps/web/src/routes/ds.lazy.tsx` **(new)** — lazy catalog shell, so the catalog and fixtures do not enter the initial application bundle.
- `apps/web/src/components/design-system/DesignSystemLayout.tsx` **(new)** — responsive sidebar, search, appearance/theme controls, compact/desktop canvas controls, and registry-driven page switching bound to the route's search params.
- `apps/web/src/components/design-system/DesignSystemPage.tsx` **(new)** — documentation-only `Page`, `Section`, `Preview`, live-token swatch, and source-path components, analogous in responsibility to TanStack's `DsKit` but styled with current Astrolabe roles.
- `apps/web/src/design-system/catalog.tsx` **(new)** — the single typed navigation/entry registry consumed by layout and tests.
- `apps/web/src/design-system/foundations.ts` **(new)** — grouping and explanatory metadata over existing CSS/theme sources; never a second token-value table.

`apps/web/src/routes/__root.tsx` gains a narrow `/ds` branch before environment authentication and a bare `<Outlet />` render branch like the existing pair/connect special surfaces. The route must not initialize the application sidebar, environment connection, tracing, providers, repositories, or workspace state. `AppRoot` can continue to supply renderer-wide infrastructure, but catalog entries cannot assume live environment data.

Catalog pages stay URL-addressable. Rather than 20-odd child route files, the single lazy route carries a validated search-param schema — `?page=foundations-color` and an optional `?entry=…` — and the layout resolves the active page from the registry. This keeps one lazy chunk while preserving what TanStack's child-route design gets for free: reloading returns to the same page, and a pull request or a note can link at a specific state. Unknown or missing values fall back to the overview rather than erroring.

`/ds` stays reachable in production builds. Its data is synthetic, its chunk is lazy, and a build-mode gate would mean the catalog is verified in a configuration that never ships. This also anticipates the marketing-site destination below. The route is simply absent from user navigation.

The same route works under browser history on web and hash history in desktop because both already share `getRouter`. Mobile is explicitly out of scope.

This is the repository's first `createLazyFileRoute`; no route uses one today. Prove the lazy split resolves under vite-plus and under desktop hash history as an early step, before the catalog has enough content for the chunk boundary to matter.

### 5. Replace CSF stories with framework-agnostic catalog entries

Define a small local contract in `apps/web/src/design-system/catalog.tsx`:

- stable id, section, title, description, and source path;
- a render function or component plus typed args;
- preferred canvas/layout and optional viewport tags;
- optional deterministic `exercise(container)` function for the bounded interaction;
- explicit axe exception metadata with a required reason.

Migrate each existing `.stories.tsx` module to a co-located `.catalog.tsx` module using that contract. Preserve every current state and name: foundations, plan statuses, plan/spec artifacts, composer gates, plan sidebar, node popover, timeline, DAG explorer, and stale-plan warning. The existing builders in `apps/web/src/test/fixtures/` remain the only fixture source.

Do not carry Storybook concepts such as `Meta`, `StoryObj`, globals, decorators, or `play` into the local contract. Theme and layout are catalog-shell responsibilities; an interaction is an ordinary function over the mounted DOM.

Components that currently require a Storybook alias are corrected at their presentational boundary instead of recreating an alias layer:

- keep router links on the real router;
- pass inert callbacks or read-only state through existing props where available;
- when a connected Mercurian component cannot render without live atoms, extract the smallest presentational component beside it and keep the connected wrapper as the shipping entry point;
- keep asset placeholders explicit fixture inputs rather than module aliases.

This removes `.storybook/shims/` rather than renaming it.

### 6. Make completeness executable

The catalog should prove that “completely map” stays true:

- A foundation check compares displayed color-role ids with `THEME_COLOR_ROLES` and evaluates every CSS variable under standard light, standard dark, and each supported built-in theme.
- An `import.meta.glob` inventory covers every non-test `apps/web/src/components/ui/*.tsx` module (45 today) and classifies each as catalogued, infrastructure-only with a reason, or **unreviewed**. This inventory is an informational audit table: it renders the current numbers on the audit page but does not fail CI. The weekly upstream sync regularly adds `components/ui` modules, and a required check over that directory would put catalog toil on every sync pull request — the recurring maintenance this whole effort exists to remove. New upstream primitives land in `unreviewed` and get triaged when someone next works in that area.
- The one hard coverage gate is scoped to Mercurian-owned surfaces: every non-test module under `apps/web/src/components/mercurian/` must be catalogued or explicitly classified, because those are the components Astrolabe's own design decisions govern.
- Every entry is mounted by the browser test project, its optional exercise runs, rendered output is non-empty, and axe passes. Exceptions remain rule-scoped and loudly logged as they are today.
- A registry test rejects duplicate ids, broken section references, missing source paths, and empty descriptions.
- A build check confirms `/ds` stays a lazy chunk and does not materially increase the initial renderer entry. Record the before/after entry chunk sizes in the implementing PR.

Keep Playwright, `@vitest/browser-playwright`, and `axe-core`: these provide real value independently of Storybook and already run in the repository's vite-plus test stack.

### 7. Catalog information architecture

The initial navigation maps the current system rather than the future brand:

1. **Overview** — scope, source-of-truth boundaries, current inherited status, and how to review a change.
2. **Foundations** — color roles/themes, typography, spacing/density, shape/elevation/glass, motion/reduced motion, focus/accessibility, iconography, and responsive behavior.
3. **Primitives** — actions, form controls, selection, menus/popovers, dialogs/sheets, navigation, feedback, data display, loading/empty, and editor-specific helpers. Every current `components/ui` module appears once in this inventory — as a catalogued example, an infrastructure-only note, or an unreviewed row — even when several examples share a page.
4. **Mercurian grammar** — status vocabulary, plan navigation, composer, artifacts, Checkpoint Graph, and implementation handoff.
5. **Product states** — representative empty, loading, working, interrupted, stale, gated, recovery, narrow-width, long-content, and reduced-motion compositions.
6. **Audit** — coverage tables for tokens, primitives, product states, themes, a11y exceptions, and unmanaged visual values found during mapping.

Unlike TanStack's public phase-one registry, Astrolabe does not need copy-paste code snippets: all consumers are in the same repository. The useful affordance is the source path and the semantic contract, not a stale duplicated snippet.

### 8. Remove Storybook only after parity

Once `/ds` and the registry checks cover all 24 existing stories:

- remove `@storybook/react`, `@storybook/react-vite`, and `storybook` from `apps/web/package.json`;
- remove Storybook scripts, `.storybook/`, its TypeScript includes, `storybookAliases` from `vite.config.ts`, and all `*.stories.tsx` files after their catalog equivalents land;
- rename the `stories` browser test project and `test:stories` script to `design-system` / `test:design-system`;
- replace Storybook-specific CI steps with `test:design-system`; the normal web build already builds the lazy `/ds` route;
- remove `.github/workflows/storybook-catalog-report.yml` and its downloadable static artifact. This knowingly gives up what M-144's goal promised — a catalog viewable from the pull request without checking out the branch — and makes visual review checkout-based or dev-deployment-based instead. That is an acceptable trade for a solo maintainer who checks the branch out anyway, and it removes a second static build product; it should be reconsidered if more than one person reviews visual changes;
- remove the `esbuild: 0.28.1` workspace override only after a clean install and focused typecheck prove no non-Storybook dependency requires it;
- regenerate the lockfile through the normal package-manager workflow.

The parity commit is deliberately separate from the deletion commit so regressions are attributable and the old workbench remains available until the replacement is proven.

### 9. Keep the catalog portable to the marketing site

The intended destination for this catalog is a `/ds` route on Mercurian's own marketing site, replacing the parked one. Nothing in this pass builds that, but one constraint is cheap now and expensive to retrofit: the catalog's presentation modules — `DesignSystemLayout`, `DesignSystemPage`, and the entry components — depend only on the theme CSS, the registry contract, and the fixtures. They import no application shell, router context beyond the catalog's own params, environment state, or workspace data.

That keeps the eventual move a matter of porting the token stylesheet and the components being shown, rather than untangling the catalog from the desktop application. It is also the same discipline that keeps `/ds` from quietly depending on live state.

### 10. Future Astrolabe visual identity

At hard-fork cut-over, the catalog stays structurally unchanged. The brand work proceeds in this order:

1. define the flagship light and dark foundation values against Almagest `Visual Language`;
2. map those values onto the existing semantic role contract, adding roles only where the audit proves a missing meaning;
3. update primitive recipes under `components/ui` without changing their public behavior;
4. update Mercurian grammar through product-semantic status and geometry roles;
5. judge every catalog entry across light/dark, narrow widths, increased text, keyboard focus, and reduced motion;
6. decide the fate of inherited/custom themes separately, preserving the catalog's theme matrix until that product decision resolves.

No future rebrand should require moving product components, rebuilding fixtures, changing scenario ids, or adopting a design-system package unless a second shipping implementation actually needs the web code.

## File and module impact

### New

- `apps/web/src/routes/ds.tsx` — route declaration and the `page`/`entry` search-param schema
- `apps/web/src/routes/ds.lazy.tsx` — the repository's first lazy route
- `apps/web/src/components/design-system/DesignSystemLayout.tsx`
- `apps/web/src/components/design-system/DesignSystemPage.tsx`
- `apps/web/src/design-system/catalog.tsx`
- `apps/web/src/design-system/foundations.ts`
- co-located `*.catalog.tsx` modules beside mapped primitives and Mercurian components
- `apps/web/src/design-system/catalog.test.ts`
- `apps/web/src/design-system/design-system.browser.test.tsx`

### Changed

- `apps/web/src/routes/__root.tsx` — standalone `/ds` route branch
- `apps/web/src/index.css` — product-semantic status aliases, initially pixel-equivalent
- selected `apps/web/src/components/mercurian/*.tsx` — migrate raw status colors onto aliases without behavior change
- `apps/web/vite.config.ts` — rename and repoint the browser project after parity
- `apps/web/package.json`, `apps/web/tsconfig.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — remove Storybook-only tooling after parity
- `.github/workflows/ci.yml` — run the design-system registry checks without building Storybook
- `docs/internals/design-system.md` — replace the Storybook workbench decision with the in-app catalog, preserve the layers/fixtures/testing rules, and record the parity evidence
- `docs/architecture/fork-baseline.md` — amend only the additive-workbench sentence; the inherited-until-cut-over decision remains unchanged

### Removed after parity

- `apps/web/.storybook/`
- all migrated `apps/web/src/**/*.stories.tsx`
- `.github/workflows/storybook-catalog-report.yml`
- Storybook scripts and dependencies

## Implementation Checklist

- [ ] Record baseline facts: Storybook story count/state ids, browser-check count, initial web entry chunk size, current standard light/dark computed foundation values, and the raw Mercurian status-color occurrences.
- [ ] Add the typed framework-agnostic catalog contract and registry tests (duplicate ids, section integrity, source paths, descriptions).
- [ ] Prove the repository's first `createLazyFileRoute` splits and resolves under vite-plus, in the production build, and under desktop hash history — before building catalog content on top of it.
- [ ] Add the lazy standalone `/ds` route and catalog shell using only current semantic roles; prove it loads in web and desktop routing without an authenticated environment, and that `?page=`/`?entry=` survive a reload.
- [ ] Move the foundations story into catalog entries and add complete live sections for color roles/themes, typography, spacing/density, shape/elevation/glass, motion, focus, iconography, and breakpoints.
- [ ] Add the primitive inventory glob as a non-blocking audit over `components/ui` (catalogued / infrastructure-only / unreviewed), and the blocking coverage gate over `components/mercurian`.
- [ ] Migrate the 24 existing Storybook states (23 Mercurian + 1 foundations) to co-located catalog entries with the same fixtures, labels, layouts, and bounded interaction.
- [ ] Replace alias-dependent examples with explicit presentational seams or fixture props; do not add a catalog transport, fake server, or alias map.
- [ ] Add product-semantic status aliases and migrate current raw Mercurian status colors family by family with pixel-equivalence proof.
- [ ] Move the browser harness from portable stories to catalog entries; retain non-empty render, exercise, axe, and loudly logged rule-scoped exceptions.
- [ ] Add the audit page and checks showing 100% color-role coverage, Mercurian-component classification, the `components/ui` inventory counts including unreviewed, all existing scenarios, theme modes, exceptions, and unmanaged visual values.
- [ ] Verify `/ds` is lazy and the initial renderer bundle remains within the measured baseline tolerance.
- [ ] Update contributor strategy and ADR wording after parity is demonstrated.
- [ ] In a separate commit, remove Storybook packages, config, scripts, aliases, CI build/artifact/report workflow, migrated story files, and—if no longer required—the esbuild override; regenerate the lockfile.
- [ ] Run focused typecheck, unit tests, design-system browser checks, and web build. Do not run repo-wide checks.
- [ ] Commit each coherent slice: catalog contract/shell; foundations; primitives; Mercurian scenarios/status aliases; browser/CI parity; Storybook removal/docs.

## Test Plan

### Contract and inventory

- [ ] `THEME_COLOR_ROLES` and the foundations catalog have exact set equality.
- [ ] Every declared theme/mode resolves every role to a valid live CSS color.
- [ ] Every non-test `components/mercurian/*.tsx` module is registered or explicitly classified — this one fails the build.
- [ ] The `components/ui` inventory resolves every module into catalogued, infrastructure-only, or unreviewed, and reports the counts without failing.
- [ ] Registry ids are unique; sections and source paths resolve; catalog copy is non-empty.
- [ ] Product-semantic status roles each have light and dark values and preserve non-color meaning through labels/icons/position.

### Browser catalog

- [ ] Every catalog entry mounts in headless Chromium, renders content, runs its bounded exercise, and passes axe.
- [ ] Standard light, standard dark, every built-in theme, and a high-chroma synthetic theme apply through the production theme path.
- [ ] Desktop, narrow desktop, increased text, keyboard focus, and reduced-motion canvases work for the entries that claim those modes.
- [ ] The existing inherited-palette contrast exceptions remain rule-scoped, justified, and visible until cut-over; no blanket axe disable is accepted.

### Routing and performance

- [ ] `/ds` loads without a server connection or authenticated environment in the web client, in both development and a production build.
- [ ] A deep link to `?page=…&entry=…` restores that page on reload; unknown values fall back to the overview instead of erroring.
- [ ] Desktop hash navigation reaches the same route without changing normal desktop startup behavior.
- [ ] Normal `/`, `/pair`, `/connect`, settings, plan, and coding-session routing retain their current auth/shell behavior.
- [ ] The production build emits the catalog as a lazy chunk; the initial renderer entry stays within the recorded tolerance.

### Pixel-preserving migration

- [ ] Before/after computed styles or curated screenshots match for each migrated status family in standard light and dark.
- [ ] Existing focused component tests remain green; assertions that referenced raw Tailwind palette classes are updated to assert the semantic role instead.
- [ ] No production component imports from `components/design-system` or `design-system/catalog`.
- [ ] The catalog's presentation modules import no application shell, environment, or workspace state, keeping the marketing-site port viable.

### Storybook removal

- [ ] Catalog scenario count and ids meet or exceed the 24-story baseline before deletion (measured 2026-08-22: `vp test run --project stories` reports 24 passing checks; the earlier "23" in this plan was wrong).
- [ ] A clean install, web typecheck, design-system browser project, and web build pass without Storybook packages or aliases.
- [ ] Lockfile no longer contains Storybook packages; the esbuild override is removed if the clean-install proof permits.
- [ ] CI has no Storybook build, artifact, comment workflow, or Storybook-named step, while browser render/a11y coverage remains required inside the existing `Test` job.

## Explicit non-goals

- Designing Astrolabe's future brand, flagship palette, typography, illustration, or motion language in this pass.
- Copying TanStack's tokens, components, Figma values, icon system, code-snippet registry, or public-site information architecture verbatim.
- Packaging web primitives for mobile or claiming web catalog coverage for React Native.
- Redesigning every inherited upstream surface while Astrolabe is still bounded-tracking T3 Code.
- Introducing visual snapshots for every entry; add only curated baselines where a later regression demonstrates value.
