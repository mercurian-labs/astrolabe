# Design system and Storybook strategy

**Status:** Direction accepted 2026-08-20; documentation first, implementation not started. Rev 2 (2026-08-20) grounded the strategy against the repository: tooling spike and fallback, shared fixture location, foundations story, staged rendering matrix, CI and merge-safety shape — no direction changed.

Astrolabe's design-system strategy is to keep its visual language coherent across product states with the smallest shared system that earns its place. Storybook is the workbench for inspecting and exercising that system in isolation. It is not the source of product intent and it is not a second implementation of the application.

Product intent lives in Almagest, principally the `Visual Language` note and the notes for each product surface. This document owns the contributor strategy: what enters the workbench, how stories obtain state, which checks they support, and how the system grows. [ADR 004](../architecture/fork-baseline.md) governs when the inherited t3code design may be reworked.

## Goals

- Make Astrolabe's distinctive states inspectable without starting a server or constructing a real workspace.
- Give visual changes a fast review loop across appearance, viewport, and interaction states.
- Keep semantic tokens, reusable controls, and product-specific visual grammar from drifting apart.
- Make uncommon but consequential states — awaiting input, stale artifacts, forks, merges, splits, interrupted work, and provider failures — cheap to revisit.
- Support accessibility review and a deliberately small visual-regression suite.

## Non-goals

- Storybook does not define product behavior. A story demonstrates a state already designed in Almagest and represented by the product contracts.
- It does not replace focused logic tests, protocol tests, or an integrated pass in a real client.
- It is not a reason to extract every component into a package or to make private route composition public.
- The first pass does not catalog every inherited primitive or redesign upstream-owned t3code surfaces.
- Stories never connect to a live server, provider, repository, database, or user workspace.

## Tooling decision

The strategy is tool-shaped but not tool-guaranteed, and this repository is not a stock Vite app: `vite` is aliased to vite-plus, tests run under `vp test` rather than vitest, Tailwind v4 is configured entirely in CSS, and the web build carries the React Compiler. Storybook's framework packages configure Vite directly; whether they hold up against this toolchain is unproven.

The first implementation step is therefore a time-boxed spike: prove that Storybook builds and serves under the aliased Vite with the production stylesheet and theme application, and that one real Mercurian component story renders in both appearances. If the spike fails or fights the toolchain, the named fallback is vite-plus browser mode — already declared but unused in `apps/web` (`src/vite-plus-browser-matchers.d.ts`) — hosting the same catalog as browser-mode component tests under a thin story convention. Everything else in this document — the layers, fixture rules, taxonomy, testing ladder, and review matrix — is written to survive either answer.

**M-140 spike outcome (recorded 2026-08-20; browser-verified by the reviewer same day):** Storybook is viable as the component workbench. Storybook, `@storybook/react-vite`, and `@storybook/react` 9.1.20 produced a static catalog through the workspace's `vite` alias (`@voidzero-dev/vite-plus-core` 0.2.2, reported by the build as Vite 8.1.2) with `@tailwindcss/vite` 4.3.0, the production stylesheet, and the light/dark document-class decorator. The working recipe includes a workspace override pinning esbuild 0.28.1: Storybook's esbuild dependency range caps at `^0.25`, but it dedupes cleanly onto 0.28.1; without the override pnpm creates a second `vite-plus-core` peer instance whose plugin types break the `apps/web` typecheck. The build emitted `dist/storybook/index.html` and an index registering the `Awaiting input`, `Working`, and `Unseen updates` stories. The reviewer's browser walk over the built catalog confirmed the rest: all three stories render with production styling in light and dark (the `dark`-class decorator drives the real role variables), the working pulse animation runs, and the tooltip trigger mounts with its accessible label and no provider.

**M-144 interaction-runner resolution (recorded 2026-08-20):** interaction and accessibility checks run the portable stories in a vite-plus browser-mode project, using the Playwright provider with headless Chromium and an `axe-core` pass. The Storybook Vitest addon stays uninstalled: the catalog and its executable checks share stories without adding a second test configuration or addon integration. This closes the runner question M-140 left open.

## The system's layers

The design system has four layers. A layer earns shared machinery only when more than one consumer needs it.

1. **Semantic foundations** — color roles, typography, spacing, radii, elevation, motion, focus, and status vocabulary. Themes may change values while these meanings stay fixed.
2. **UI primitives** — familiar controls such as buttons, fields, menus, sheets, tooltips, and popovers. They stay conventional and accessible.
3. **Product components** — Astrolabe-specific expressions such as a plan row, artifact header, checkpoint node, status treatment, or composer gate.
4. **Product states** — small compositions that prove the parts together: a draft among active plans, a stale spec beside its plan, or a fork selected in the Checkpoint Graph.

The repository remains the implementation source of truth. Storybook renders the same components and semantic tokens the application ships; there is no story-only visual implementation.

Layer 1 is not greenfield. The inherited system already carries a semantic role layer in two coupled places — the `@theme inline` role mapping in `apps/web/src/index.css` and the enumerated color roles in `apps/web/src/themePalette.ts` — and user-facing customization already ships (built-in themes, a theme editor, VS Code theme import). The first pass therefore includes a **foundations story** that renders the inherited roles from the enumerated list: an immediate token audit, the measured starting point for the cut-over rework, and a guard against stories hard-coding raw values. Pre-cut-over stories express appearance exclusively through these existing roles.

## What receives stories

Stories are required when a change introduces or materially changes:

- a semantic token or a reusable visual primitive;
- an Astrolabe-specific component with more than one meaningful state;
- a user-visible empty, loading, error, disabled, streaming, interrupted, or recovery state;
- responsive behavior whose composition changes at a breakpoint;
- interaction that is difficult to recognize from static markup tests; or
- a visual bug whose regression can be reproduced deterministically in isolation.

A story is normally unnecessary for a pure helper, a route wrapper with no presentation of its own, invisible data wiring, or a component whose only useful state requires the full application. Those continue to use focused tests and integrated verification.

## Story taxonomy

Stories sit beside the component they exercise and are named for user-visible states, not implementation branches. The sidebar should say `Awaiting input`, `Unread update`, and `Private draft`, rather than `statusVariant2` or `withBooleanProps`.

The initial catalog should center on the surfaces that express Astrolabe's identity:

- **Plan navigation** — idle, active, awaiting input, unseen update, draft, archived, long title, and project-scoped list.
- **Composer** — empty, with attachments, assistant working, structured question, provider unavailable, signed out, stale-plan suggestion, and review comments staged.
- **Artifacts** — plan and spec reading, editing, saving, stale, provenance, and reconciliation states.
- **Checkpoint Graph** — linear history, fork, merge, split, coding-session leaf, selected checkpoint, node popover, and constrained viewport.
- **Implementation handoff** — ready plan, stale warning, split proposal, and coding-session draft.

Large compositions should remain bounded. Storybook may show a representative planning-space arrangement, but it should not recreate routing, persistence, or orchestration merely to mount the entire application.

## State and fixtures

Stories use typed fixture builders based on the same public contracts the client consumes. Builders supply stable defaults and accept small semantic overrides, so a story declares the fact it is demonstrating instead of assembling a protocol-shaped object by hand.

Fixture rules:

- Builders live in shared test support (`apps/web/src/test/fixtures/`), not under Storybook configuration. Unit tests and stories consume the same module, and the existing file-local helpers (such as those in `PlanCheckpoints.logic.test.ts` and `DagExplorer.test.tsx`) migrate onto it — one canonical builder per concept cannot hold if stories and tests keep separate factories. Building and adopting the builders in existing tests is worthwhile even before any catalog lands.
- Builders construct through the contracts' Effect schemas, so impossible states fail at construction rather than at render.
- Prefer one canonical builder per product concept over component-local object literals.
- Mind the checkpoint naming collision: "checkpoint" is two concepts in this repository — upstream's thread/diff checkpoints in the contracts, and Mercurian's client-side reading derived from plan timeline items. Builders and story titles stay in the Mercurian namespace, and graph stories obtain checkpoints by passing timeline fixtures through the production derivation (`condensePlanGraph` in `PlanCheckpoints.logic.ts`).
- Use fixed identifiers and timestamps so stories and screenshots are deterministic.
- Represent impossible states as type errors where the contracts allow it; do not loosen production types for story convenience.
- Keep derived facts derived. If the application computes status priority or checkpoint shape, the story passes source facts through the production derivation rather than encoding the answer twice.
- Keep fixtures synthetic and safe to publish. Never copy local workspace or provider data into the catalog.

Mocks stop at application boundaries. Storybook may provide in-memory callbacks, router context, theme state, and read-only client snapshots; it does not mock a second transport or orchestration layer. A component that cannot mount without a large imitation of the application is a signal to isolate its presentational boundary, not to build a parallel runtime.

## Global rendering matrix

Every story inherits the production stylesheet, fonts, and semantic theme application. Global controls cover:

- the shipped appearances — before hard-fork cut-over that means the inherited light and dark plus one representative built-in theme; the flagship pair joins the matrix when it exists, at cut-over;
- a representative custom high-chroma theme, once customization is retained by design;
- standard desktop, narrow desktop, and compact widths relevant to the component;
- reduced motion; and
- normal and increased text scaling where the component is sensitive to it.

This is a review matrix, not a Cartesian screenshot explosion. Authors exercise the relevant combinations interactively; automated baselines cover only combinations with a history of regression or unusually high product value.

## Testing ladder

Each layer proves a different thing:

1. **Focused unit and component tests** prove derivation, accessibility semantics, and behavior cheaply.
2. **Portable-story interaction checks** run through the vite-plus browser-mode project and prove bounded component interactions in a real browser DOM.
3. **Portable-story accessibility checks** run `axe-core` in the same headless Chromium session and catch violations in every eligible story.
4. **Visual snapshots** protect a curated set of signature states and theme boundaries after the visual direction stabilizes.
5. **Real-client passes** prove routing, WebSocket transitions, Electron chrome, resizing, keyboard traversal across surfaces, and Checkpoint Graph performance with realistic data.

Rungs 2–3 use one vite-plus browser-mode project: it composes the Storybook stories, mounts each in a real headless Chromium DOM through the Playwright provider, executes any play function, and runs `axe-core`. In CI, the story build and its checks run inside the existing job names first (`Check` and `Test` are required status checks, so a new job is also a branch-protection change; a dedicated job can come at cut-over). CI also publishes the static catalog as a build artifact on every pull request that touches it — the review loop this document promises requires reviewers to see stories without checking out the branch. No snapshot service is implied by either.

A visual snapshot is not required merely because a story exists. Baselines have maintenance cost; add one when the state is important enough that a pixel-level regression would justify review. Baselines also require render determinism, not only data determinism: capture waits for fonts, suppresses transitions (the stylesheet already carries a suppress-transitions rule for theme changes to reuse), and lets layout settle before reading pixels — the Checkpoint Graph's measured d3-dag arrangement especially.

## Contributor workflow

When changing a user-visible component:

1. Check the governing Almagest note for product intent and unresolved decisions.
2. Change semantic foundations or shared primitives only when the new behavior belongs there.
3. Add or update the smallest story that demonstrates each material visual state.
4. Exercise relevant appearances, widths, keyboard interaction, focus, and reduced motion.
5. Run focused tests and Storybook checks for the changed surface.
6. Use the real client when the change depends on integration or when maintainers request a visual pass.
7. Update this document only when the system's rules change; ordinary component additions belong in stories and code.

Story review asks three questions: does the state match the product design, does it use the shared grammar, and can another contributor reproduce it without private setup?

## Adoption stages

### Before hard-fork cut-over

Storybook may land as additive tooling focused on Mercurian-owned components. The initial target is roughly ten to fifteen high-value stories across plan navigation, the composer, artifacts, and the Checkpoint Graph. It uses the inherited stylesheet and token system as they exist; it does not begin the broad design-system rework early or restructure upstream-owned components for catalog purity.

Configuration and fixture support stay local to the web application unless another shipping surface proves it can consume them. Merge safety shapes the file layout: the weekly upstream sync makes `apps/web/vite.config.ts` and `apps/web/package.json` the conflict-prone files, so configuration prefers new sibling files (a `.storybook/` directory with its own config) over edits to upstream-owned ones, and unavoidable `package.json` edits stay a minimal, contiguous block. No visual snapshot service is required for the first pass. The value to prove is faster, more complete review of Astrolabe's product states.

### At hard-fork cut-over

The Mercurian visual-language rework may normalize semantic foundations, replace inherited primitive treatments, add the flagship light and dark appearances, and expand stories to the shared shell. This is when stories become the main review bench for the new system and a curated visual-regression gate can be adopted.

Mobile remains separate until Mercurian has a mobile design. Web Storybook does not claim coverage of React Native components.

### After stabilization

Coverage grows from observed regressions and repeated design work, not from a percentage target. Shared packaging happens only when multiple shipping surfaces consume the same visual implementation. Periodically remove stories that duplicate another state without protecting a distinct contract.

## Initial success criteria

The first Storybook pass has succeeded when:

- the tooling spike has a recorded answer — Storybook under the aliased Vite, or the vite-plus browser-mode fallback;
- the inherited semantic roles are visible in a foundations story;
- the four identity-bearing surfaces can be reviewed without a running Astrolabe server;
- rare states are produced from typed, deterministic fixtures;
- light, dark, narrow, keyboard, and reduced-motion review are straightforward;
- the catalog contains no story-only copy of product logic; and
- maintainers use it to make or review a real visual change before expanding its scope.
