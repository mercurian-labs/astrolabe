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

- `apps/web/src/routes/ds.tsx` **(new)** — minimal route declaration and development access policy.
- `apps/web/src/routes/ds.lazy.tsx` **(new)** — lazy catalog shell, so the catalog and fixtures do not enter the initial application bundle.
- `apps/web/src/components/design-system/DesignSystemLayout.tsx` **(new)** — responsive sidebar, search, appearance/theme controls, compact/desktop canvas controls, and `<Outlet>`-free page switching driven by the registry.
- `apps/web/src/components/design-system/DesignSystemPage.tsx` **(new)** — documentation-only `Page`, `Section`, `Preview`, live-token swatch, and source-path components, analogous in responsibility to TanStack's `DsKit` but styled with current Astrolabe roles.
- `apps/web/src/design-system/catalog.tsx` **(new)** — the single typed navigation/entry registry consumed by layout and tests.
- `apps/web/src/design-system/foundations.ts` **(new)** — grouping and explanatory metadata over existing CSS/theme sources; never a second token-value table.

`apps/web/src/routes/__root.tsx` gains a narrow `/ds` branch before environment authentication and a bare `<Outlet />` render branch like the existing pair/connect special surfaces. The route must not initialize the application sidebar, environment connection, tracing, providers, repositories, or workspace state. `AppRoot` can continue to supply renderer-wide infrastructure, but catalog entries cannot assume live environment data.

The same route works under browser history on web and hash history in desktop because both already share `getRouter`. It is not added to user navigation. Mobile is explicitly out of scope.

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
- An `import.meta.glob` inventory covers every non-test `apps/web/src/components/ui/*.tsx` module. Each module must have at least one catalog entry or an explicit infrastructure-only classification and reason. This includes low-frequency primitives; use count is context, not permission to omit one.
- Every entry is mounted by the browser test project, its optional exercise runs, rendered output is non-empty, and axe passes. Exceptions remain rule-scoped and loudly logged as they are today.
- A registry test rejects duplicate ids, broken section references, missing source paths, and empty descriptions.
- A build check confirms `/ds` stays a lazy chunk and does not materially increase the initial renderer entry. Record the before/after entry chunk sizes in the implementing PR.

Keep Playwright, `@vitest/browser-playwright`, and `axe-core`: these provide real value independently of Storybook and already run in the repository's vite-plus test stack.

### 7. Catalog information architecture

The initial navigation maps the current system rather than the future brand:

1. **Overview** — scope, source-of-truth boundaries, current inherited status, and how to review a change.
2. **Foundations** — color roles/themes, typography, spacing/density, shape/elevation/glass, motion/reduced motion, focus/accessibility, iconography, and responsive behavior.
3. **Primitives** — actions, form controls, selection, menus/popovers, dialogs/sheets, navigation, feedback, data display, loading/empty, and editor-specific helpers. Every current `components/ui` module appears once in this inventory even when several examples share a page.
4. **Mercurian grammar** — status vocabulary, plan navigation, composer, artifacts, Checkpoint Graph, and implementation handoff.
5. **Product states** — representative empty, loading, working, interrupted, stale, gated, recovery, narrow-width, long-content, and reduced-motion compositions.
6. **Audit** — coverage tables for tokens, primitives, product states, themes, a11y exceptions, and unmanaged visual values found during mapping.

Unlike TanStack's public phase-one registry, Astrolabe does not need copy-paste code snippets: all consumers are in the same repository. The useful affordance is the source path and the semantic contract, not a stale duplicated snippet.

### 8. Remove Storybook only after parity

Once `/ds` and the registry checks cover all 23 existing stories:

- remove `@storybook/react`, `@storybook/react-vite`, and `storybook` from `apps/web/package.json`;
- remove Storybook scripts, `.storybook/`, its TypeScript includes, `storybookAliases` from `vite.config.ts`, and all `*.stories.tsx` files after their catalog equivalents land;
- rename the `stories` browser test project and `test:stories` script to `design-system` / `test:design-system`;
- replace Storybook-specific CI steps with `test:design-system`; the normal web build already builds the lazy `/ds` route;
- remove `.github/workflows/storybook-catalog-report.yml` and its downloadable static artifact. The catalog is reviewed through the ordinary application/dev deployment rather than a second static build product;
- remove the `esbuild: 0.28.1` workspace override only after a clean install and focused typecheck prove no non-Storybook dependency requires it;
- regenerate the lockfile through the normal package-manager workflow.

The parity commit is deliberately separate from the deletion commit so regressions are attributable and the old workbench remains available until the replacement is proven.

### 9. Future Astrolabe visual identity

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

- `apps/web/src/routes/ds.tsx`
- `apps/web/src/routes/ds.lazy.tsx`
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
- [ ] Add the lazy standalone `/ds` route and catalog shell using only current semantic roles; prove it loads in web and desktop routing without an authenticated environment.
- [ ] Move the foundations story into catalog entries and add complete live sections for color roles/themes, typography, spacing/density, shape/elevation/glass, motion, focus, iconography, and breakpoints.
- [ ] Add the primitive inventory glob and explicit registered/infrastructure-only coverage for every current `components/ui` module.
- [ ] Migrate the 23 existing Storybook states to co-located catalog entries with the same fixtures, labels, layouts, and bounded interaction.
- [ ] Replace alias-dependent examples with explicit presentational seams or fixture props; do not add a catalog transport, fake server, or alias map.
- [ ] Add product-semantic status aliases and migrate current raw Mercurian status colors family by family with pixel-equivalence proof.
- [ ] Move the browser harness from portable stories to catalog entries; retain non-empty render, exercise, axe, and loudly logged rule-scoped exceptions.
- [ ] Add the audit page and checks showing 100% color-role coverage, 100% primitive-module classification, all existing scenarios, theme modes, exceptions, and unmanaged visual values.
- [ ] Verify `/ds` is lazy and the initial renderer bundle remains within the measured baseline tolerance.
- [ ] Update contributor strategy and ADR wording after parity is demonstrated.
- [ ] In a separate commit, remove Storybook packages, config, scripts, aliases, CI build/artifact/report workflow, migrated story files, and—if no longer required—the esbuild override; regenerate the lockfile.
- [ ] Run focused typecheck, unit tests, design-system browser checks, and web build. Do not run repo-wide checks.
- [ ] Commit each coherent slice: catalog contract/shell; foundations; primitives; Mercurian scenarios/status aliases; browser/CI parity; Storybook removal/docs.

## Test Plan

### Contract and inventory

- [ ] `THEME_COLOR_ROLES` and the foundations catalog have exact set equality.
- [ ] Every declared theme/mode resolves every role to a valid live CSS color.
- [ ] Every non-test `components/ui/*.tsx` module is registered or explicitly classified infrastructure-only.
- [ ] Registry ids are unique; sections and source paths resolve; catalog copy is non-empty.
- [ ] Product-semantic status roles each have light and dark values and preserve non-color meaning through labels/icons/position.

### Browser catalog

- [ ] Every catalog entry mounts in headless Chromium, renders content, runs its bounded exercise, and passes axe.
- [ ] Standard light, standard dark, every built-in theme, and a high-chroma synthetic theme apply through the production theme path.
- [ ] Desktop, narrow desktop, increased text, keyboard focus, and reduced-motion canvases work for the entries that claim those modes.
- [ ] The existing inherited-palette contrast exceptions remain rule-scoped, justified, and visible until cut-over; no blanket axe disable is accepted.

### Routing and performance

- [ ] `/ds` loads without a server connection or authenticated environment in the web client.
- [ ] Desktop hash navigation reaches the same route without changing normal desktop startup behavior.
- [ ] Normal `/`, `/pair`, `/connect`, settings, plan, and coding-session routing retain their current auth/shell behavior.
- [ ] The production build emits the catalog as a lazy chunk; the initial renderer entry stays within the recorded tolerance.

### Pixel-preserving migration

- [ ] Before/after computed styles or curated screenshots match for each migrated status family in standard light and dark.
- [ ] Existing focused component tests remain green; assertions that referenced raw Tailwind palette classes are updated to assert the semantic role instead.
- [ ] No production component imports from `components/design-system` or `design-system/catalog`.

### Storybook removal

- [ ] Catalog scenario count and ids meet or exceed the 23-story baseline before deletion.
- [ ] A clean install, web typecheck, design-system browser project, and web build pass without Storybook packages or aliases.
- [ ] Lockfile no longer contains Storybook packages; the esbuild override is removed if the clean-install proof permits.
- [ ] CI has no Storybook build, artifact, comment workflow, or Storybook-named step, while browser render/a11y coverage remains required inside the existing `Test` job.

## Explicit non-goals

- Designing Astrolabe's future brand, flagship palette, typography, illustration, or motion language in this pass.
- Copying TanStack's tokens, components, Figma values, icon system, code-snippet registry, or public-site information architecture verbatim.
- Packaging web primitives for mobile or claiming web catalog coverage for React Native.
- Redesigning every inherited upstream surface while Astrolabe is still bounded-tracking T3 Code.
- Introducing visual snapshots for every entry; add only curated baselines where a later regression demonstrates value.
