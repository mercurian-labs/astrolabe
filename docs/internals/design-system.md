# Design system and in-app catalog strategy

**Status:** Direction revised 2026-08-23: Storybook was replaced by the in-app catalog after demonstrated parity, tracked in Linear issue M-159. The design-system scope and contributor rules are unchanged.

Astrolabe's design-system strategy is to keep its visual language coherent across product states with the smallest shared system that earns its place. The in-app `/design-lab` Design Lab is the workbench for inspecting and exercising that system in isolation. It is not the source of product intent and it is not a second implementation of the application.

Product intent lives in Almagest, principally the `Visual Language` note and the notes for each product surface. This document owns the contributor strategy: what enters the workbench, how catalog entries obtain state, which checks they support, and how the system grows. [ADR 004](../architecture/fork-baseline.md) governs when the inherited t3code design may be reworked.

## Goals

- Make Astrolabe's distinctive states inspectable without constructing a real workspace.
- Give visual changes a fast review loop across appearance, viewport, and interaction states.
- Keep semantic tokens, reusable controls, and product-specific visual grammar from drifting apart.
- Make uncommon but consequential states — awaiting input, stale artifacts, forks, merges, splits, interrupted work, and provider failures — cheap to revisit.
- Support accessibility review and a deliberately small visual-regression suite.

## Non-goals

- The catalog does not define product behavior. An entry demonstrates a state already designed in Almagest and represented by the product contracts.
- It does not replace focused logic tests, protocol tests, or an integrated pass in a real client.
- It is not a reason to extract every component into a package or to make private route composition public.
- The first pass does not catalog every inherited primitive or redesign upstream-owned t3code surfaces.
- Catalog entries never connect to a live provider, repository, database, or user workspace.

## Tooling decision

The first workbench was established by the M-140 spike: Storybook 9.1.20 built and served through the workspace's aliased Vite, using the production stylesheet and light/dark document-class theme application. M-144 then placed its portable interaction and accessibility checks in a vite-plus browser project with the Playwright provider, headless Chromium, and `axe-core`. That proved the component model and the browser runner, but it also required separate configuration, dependencies, a static build, and an esbuild override.

M-159 replaced that workbench with an application route, and M-160 made it the Design Lab at `/design-lab`. The development-only route renders inside the normal application shell and uses the same authenticated route gate as other application surfaces. It reads a typed registry, loads the catalog as one lazy chunk, uses search parameters for entry navigation, and runs interaction and accessibility checks over every registry entry in the `design-system` vite-plus browser project. The catalog mounts the same components, fixtures, production stylesheet, and theme machinery that the application ships. It has no hosted-static exception or static deployment story; production builds redirect the route and do not include the catalog chunk.

Parity was measured before removing the old tooling. The 24-story baseline became 23 catalog states migrated one-to-one, while the single foundations story was superseded by eight focused foundations pages. During coexistence, the browser project passed 56 of 56 checks: 24 Storybook checks plus 32 catalog-entry checks. Storybook was removed only after that proof.

The M-144 per-PR artifact trade-off changed with the replacement. The static catalog artifact and its automated pull-request comment workflow are gone; reviewers use `/design-lab` from an authenticated development build. That is acceptable for a solo maintainer and should be reconsidered if more people routinely review visual changes.

## The system's layers

The design system has four layers. A layer earns shared machinery only when more than one consumer needs it.

1. **Semantic foundations** — color roles, typography, spacing, radii, elevation, motion, focus, and status vocabulary. Themes may change values while these meanings stay fixed.
2. **UI primitives** — familiar controls such as buttons, fields, menus, sheets, tooltips, and popovers. They stay conventional and accessible.
3. **Product components** — Astrolabe-specific expressions such as a plan row, artifact header, checkpoint node, status treatment, or composer gate.
4. **Product states** — small compositions that prove the parts together: a draft among active plans, a stale spec beside its plan, or a fork selected in the Checkpoint Graph.

The repository remains the implementation source of truth. The catalog renders the same components and semantic tokens the application ships; there is no catalog-only visual implementation.

Layer 1 is not greenfield. The inherited system already carries a semantic role layer in two coupled places — the `@theme inline` role mapping in `apps/web/src/index.css` and the enumerated color roles in `apps/web/src/themePalette.ts` — and user-facing customization already ships (built-in themes, a theme editor, VS Code theme import). The catalog's eight **foundations entries** render the inherited roles from the enumerated lists: an immediate token audit, the measured starting point for the cut-over rework, and a guard against entries hard-coding raw values. Pre-cut-over entries express appearance exclusively through these existing roles.

## What receives catalog entries

Catalog entries are required when a change introduces or materially changes:

- a semantic token or a reusable visual primitive;
- an Astrolabe-specific component with more than one meaningful state;
- a user-visible empty, loading, error, disabled, streaming, interrupted, or recovery state;
- responsive behavior whose composition changes at a breakpoint;
- interaction that is difficult to recognize from static markup tests; or
- a visual bug whose regression can be reproduced deterministically in isolation.

A catalog entry is normally unnecessary for a pure helper, a route wrapper with no presentation of its own, invisible data wiring, or a component whose only useful state requires the full application. Those continue to use focused tests and integrated verification.

## Catalog taxonomy

Entries live with the catalog registry and are named for user-visible states, not implementation branches. Navigation should say `Awaiting input`, `Unread update`, and `Private draft`, rather than `statusVariant2` or `withBooleanProps`.

The catalog centers on the surfaces that express Astrolabe's identity:

- **Plan navigation** — idle, active, awaiting input, unseen update, draft, archived, long title, and project-scoped list.
- **Composer** — empty, with attachments, assistant working, structured question, provider unavailable, signed out, stale-plan suggestion, and review comments staged.
- **Artifacts** — plan and spec reading, editing, saving, stale, provenance, and reconciliation states.
- **Checkpoint Graph** — linear history, fork, merge, split, coding-session leaf, selected checkpoint, node popover, and constrained viewport.
- **Implementation handoff** — ready plan, stale warning, split proposal, and coding-session draft.

Large compositions should remain bounded. The catalog may show a representative planning-space arrangement, but it should not recreate routing, persistence, or orchestration merely to mount the entire application.

### Axes

The first Design Lab section is **Axes**: live color, shape, typography, and elevation & glass controls for judging a visual stance against the entire running application. Unlike the documentation-oriented catalog entries, an axis page intentionally edits root appearance variables while the contributor moves through real routes. Each control and each axis can return to the shipped state independently.

Non-color adjustments live in the in-memory zustand store at `apps/web/src/designLabOverrides.ts`. A nullable field means “defer to the shipped stylesheet or the current Appearance setting”; it never means a second saved preference. The root host merges current client settings field by field, reuses the production font writer, and removes optional custom properties when an override clears. The store also owns the last Lab search location, the theme-editor docking slot, and a repaint nonce used after another preview restores root theme variables. Keep this override store in-memory and setting-blind: profiles may mirror its adjustable fields into their separate development-only store, but axis controls must not add persistence directly, write through `updateSettings`, or make catalog components another source of production tokens.

The color axis is the existing theme-editor surface docked into the page, not a separate editor. Its single component instance remains above the router so draft state and live color paint survive moving between the dock and the unchanged floating shell.

### Profiles

Design Lab profiles turn the current axes into named, switchable directions without making the Lab a production settings system. A profile captures all 12 nullable axis overrides plus the whole-theme preference and optional light/dark theme halves. It deliberately does not capture appearance mode or follow-system behavior: those remain the contributor's viewing context. Custom palette edits continue to live in the shared theme library rather than being copied into each stored profile.

Profiles and the unnamed current axis state are machine-local zustand state persisted under `t3code:design-lab-profiles:v1`. The root Design Lab host hydrates the override store from that state before painting and continuously mirrors live axes and theme selection back into it. When a profile is active, that mirror updates the profile too, so switching directions is lossless. Returning to shipped appearance clears all Lab axes, selects the product's `system` theme, clears theme halves, and deactivates the profile.

The version 1 `.design-profile.json` interchange format carries the profile name, axes, appearance reference, and a `themes` array. Built-in themes remain id references. Every referenced custom theme is embedded by value using the existing versioned theme-file shape, then installed or updated during import before the imported profile is applied. The runtime product never reads profile files.

Shipping remains a reviewed source change. **Propose as shipped defaults** downloads a `.design-proposal.md` document containing only values that diverge from shipped defaults, with the proposed value, current value, and owning source pointer for each. It also records the shadow, border-role, and palette caveats that cannot be expressed as one mechanical token change, and embeds the complete profile JSON for reproduction. The Lab does not patch source files.

All profile storage, synchronization, pages, and Appearance controls are reachable only through development-gated Design Lab paths. Production builds neither read the profile storage key nor use profiles as an appearance input. Keep profile code on the web/desktop client boundary; it does not belong in contracts, server orchestration, providers, or mobile until those surfaces acquire a Design Lab of their own.

## State and fixtures

Catalog entries use typed fixture builders based on the same public contracts the client consumes. Builders supply stable defaults and accept small semantic overrides, so an entry declares the fact it is demonstrating instead of assembling a protocol-shaped object by hand.

Fixture rules:

- Builders live in shared test support (`apps/web/src/test/fixtures/`), not inside the catalog route. Unit tests and catalog entries consume the same module, and file-local helpers (such as those in `PlanCheckpoints.logic.test.ts` and `DagExplorer.test.tsx`) migrate onto it — one canonical builder per concept cannot hold if entries and tests keep separate factories.
- Builders construct through the contracts' Effect schemas, so impossible states fail at construction rather than at render.
- Prefer one canonical builder per product concept over component-local object literals.
- Mind the checkpoint naming collision: "checkpoint" is two concepts in this repository — upstream's thread/diff checkpoints in the contracts, and Mercurian's client-side reading derived from plan timeline items. Builders and catalog labels stay in the Mercurian namespace, and graph entries obtain checkpoints by passing timeline fixtures through the production derivation (`condensePlanGraph` in `PlanCheckpoints.logic.ts`).
- Use fixed identifiers and timestamps so entries and screenshots are deterministic.
- Represent impossible states as type errors where the contracts allow it; do not loosen production types for catalog convenience.
- Keep derived facts derived. If the application computes status priority or checkpoint shape, the entry passes source facts through the production derivation rather than encoding the answer twice.
- Keep fixtures synthetic and safe to publish. Never copy local workspace or provider data into the catalog.

Mocks stop at application boundaries. The catalog may provide in-memory callbacks, router context, theme state, and read-only client snapshots; it does not mock a second transport or orchestration layer. A component that cannot mount without a large imitation of the application is a signal to isolate its presentational boundary, not to build a parallel runtime.

## Global rendering matrix

Every catalog entry inherits the production stylesheet, fonts, and semantic theme application. The workbench supports reviewing:

- the shipped appearances — before hard-fork cut-over that means the inherited light and dark plus one representative built-in theme; the flagship pair joins the matrix when it exists, at cut-over;
- a representative custom high-chroma theme, once customization is retained by design;
- standard desktop, narrow desktop, and compact widths relevant to the component;
- reduced motion; and
- normal and increased text scaling where the component is sensitive to it.

This is a review matrix, not a Cartesian screenshot explosion. Authors exercise the relevant combinations interactively; automated baselines cover only combinations with a history of regression or unusually high product value.

## Testing ladder

Each layer proves a different thing:

1. **Focused unit and component tests** prove derivation, accessibility semantics, and behavior cheaply.
2. **Catalog interaction checks** run the typed registry through the vite-plus browser project and prove bounded component interactions in a real browser DOM.
3. **Catalog accessibility checks** run `axe-core` in the same headless Chromium session and catch violations in every eligible registry entry.
4. **Visual snapshots** protect a curated set of signature states and theme boundaries after the visual direction stabilizes.
5. **Real-client passes** prove routing, WebSocket transitions, Electron chrome, resizing, keyboard traversal across surfaces, and Checkpoint Graph performance with realistic data.

Rungs 2–3 use the `design-system` vite-plus browser project: it walks the same typed registry as `/design-lab`, mounts each entry in a real headless Chromium DOM through the Playwright provider, executes its interaction check, and runs `axe-core`. The project stays in the existing CI `Test` job because a new required job would also be a branch-protection change.

A visual snapshot is not required merely because a catalog entry exists. Baselines have maintenance cost; add one when the state is important enough that a pixel-level regression would justify review. Baselines also require render determinism, not only data determinism: capture waits for fonts, suppresses transitions (the stylesheet already carries a suppress-transitions rule for theme changes to reuse), and lets layout settle before reading pixels — the Checkpoint Graph's measured d3-dag arrangement especially.

## Contributor workflow

When changing a user-visible component:

1. Check the governing Almagest note for product intent and unresolved decisions.
2. Change semantic foundations or shared primitives only when the new behavior belongs there.
3. Add or update the smallest catalog entry that demonstrates each material visual state.
4. Exercise relevant appearances, widths, keyboard interaction, focus, and reduced motion.
5. Run focused tests and the `design-system` catalog checks for the changed surface.
6. Use the real client when the change depends on integration or when maintainers request a visual pass.
7. Update this document only when the system's rules change; ordinary component additions belong in the registry and code.

Catalog review asks three questions: does the state match the product design, does it use the shared grammar, and can another contributor reproduce it without private setup?

## Adoption stages

### Before hard-fork cut-over

The in-app catalog is additive tooling focused on Mercurian-owned components. It uses the inherited stylesheet and token system as they exist; it does not begin the broad design-system rework early or restructure upstream-owned components for catalog purity.

Catalog and fixture support stay local to the web application unless another shipping surface proves it can consume them. Merge safety still shapes the layout: the weekly upstream sync makes `apps/web/vite.config.ts` and `apps/web/package.json` conflict-prone, so unavoidable edits there remain minimal and contiguous. No visual snapshot service is required for this stage. The value to prove remains faster, more complete review of Astrolabe's product states.

### At hard-fork cut-over

The Mercurian visual-language rework may normalize semantic foundations, replace inherited primitive treatments, add the flagship light and dark appearances, and expand catalog coverage to the shared shell. This is when the catalog becomes the main review bench for the new system and a curated visual-regression gate can be adopted.

Mobile remains separate until Mercurian has a mobile design. The web catalog does not claim coverage of React Native components.

### After stabilization

Coverage grows from observed regressions and repeated design work, not from a percentage target. Shared packaging happens only when multiple shipping surfaces consume the same visual implementation. Periodically remove entries that duplicate another state without protecting a distinct contract.

## Success criteria

The first catalog pass has succeeded:

- the in-app workbench has demonstrated parity with and replaced the earlier tooling;
- the inherited semantic roles are visible across focused foundations entries;
- the four identity-bearing surfaces can be reviewed without constructing a real workspace;
- rare states are produced from typed, deterministic fixtures;
- light, dark, narrow, keyboard, and reduced-motion review are straightforward;
- the catalog contains no catalog-only copy of product logic; and
- maintainers use it to make or review real visual changes before expanding its scope.
