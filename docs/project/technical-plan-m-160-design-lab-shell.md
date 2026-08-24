# Technical Plan — M-160: Design Lab shell — the catalog becomes an Astrolabe surface

Generated from the Goal/AC of Linear issue M-160. Goal in one sentence: the design-system
catalog stops being a standalone page with its own chrome and becomes a full main-pane surface
inside the normal app shell — right-hand navigation, Appearance-page grammar, development
builds only — as the read-only shell that later Design Lab issues (M-162+) grow editing into.

Design intent: the `Design Lab` note in Almagest (and `Visual Language` / `Settings` as
amended 2026-08-24). This plan covers the shell and redesign only; no editing capability.

## Conventions Detected

| Convention                                                                                                                                                                             | Evidence                                                                                                                                                                 | Confidence                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| TanStack file-based routes; heavy surfaces split into a `.lazy.tsx` chunk beside the route file                                                                                        | `apps/web/src/routes/ds.tsx` + `ds.lazy.tsx`; `settings.*.tsx` family                                                                                                    | High                                                     |
| Auth gating happens in `beforeLoad`, redirecting to `/pair` unless `authenticated`/`hosted-static`                                                                                     | `apps/web/src/routes/settings.tsx:125`                                                                                                                                   | High                                                     |
| Full main-pane surfaces render `SidebarInset` with a `workspace-topbar` header (web) or a drag-region header (Electron)                                                                | `apps/web/src/routes/settings.tsx:73–117`                                                                                                                                | High                                                     |
| Settings visual grammar comes from shared primitives: `SettingsPageContainer`, `SettingsSection`, `SettingsRow`, `SettingResetButton`                                                  | `apps/web/src/components/settings/settingsLayout.tsx`; used across `SettingsPanels.tsx`, `KeybindingsSettings.tsx`, `ConnectionsSettings.tsx`, `DiagnosticsSettings.tsx` | High                                                     |
| Pure logic is extracted to `*.logic.ts` with a colocated `*.logic.test.ts`                                                                                                             | `SettingsNav.logic.ts`, `PlanListSidebar.logic.ts`, `foundations/foundations.logic.ts`                                                                                   | High                                                     |
| Dev-only behavior is gated on `import.meta.env.DEV` (statically replaced by Vite)                                                                                                      | `apps/web/src/branding.ts:23`, `apps/web/src/components/settings/themeInspector.ts:441`                                                                                  | Medium (two instances, but it is the platform mechanism) |
| Catalog data is a typed registry, rendered by the route and walked by the `design-system` vite-plus browser project (Playwright/Chromium + axe) which CI runs via `test:design-system` | `apps/web/src/design-system/catalog.tsx`, `design-system.browser.test.tsx`, `apps/web/vite.config.ts:100`, `.github/workflows/ci.yml:97`                                 | High                                                     |
| The left sidebar swaps to `SettingsNav` only when the first path segment is `settings`                                                                                                 | `PlanListSidebar.tsx:214`, `planListing.logic.ts:41`                                                                                                                     | High                                                     |
| Technical plans live at `docs/project/technical-plan-m-<n>-<slug>.md`; commits read as a product sentence ending `(M-<n>)`                                                             | `docs/project/` listing; `git log` (`c9c5d4bca`, `d1cf980b6`)                                                                                                            | High                                                     |
| Comments explain design rationale, not mechanics                                                                                                                                       | `__root.tsx` ("The palette is a sibling of the shell…"), `themeEditorStore.ts` header                                                                                    | High                                                     |
| Contributor rules for the catalog live in `docs/internals/design-system.md`, updated only when the system's rules change                                                               | that file, §"Change workflow"                                                                                                                                            | High                                                     |

## Design

### Where the surface sits

The route is renamed to **`/design-lab`** — the surface's real name, matching the vault note
and the settings link that now advertises it — and stops being a parallel app. `/ds` ceases to
exist: no legacy redirect (it was a dev-only address; muscle memory adjusts), and the route
files are renamed, not duplicated (`routes/ds.tsx` → `routes/design-lab.tsx`, `routes/ds.lazy.tsx`
→ `routes/design-lab.lazy.tsx`, with the route id updated to `/design-lab`).

- **Remove both `/ds` special cases from `__root.tsx`**: the `beforeLoad` branch that hands
  `/ds` a `hosted-static` auth-gate context (line 66) and the early `return <Outlet />` that
  bypasses the shell (line 116). Nothing replaces them: `/design-lab` renders through
  `AppSidebarLayout` like every authenticated surface, with the plan-list left sidebar present
  (the pathname's first segment is `design-lab`, not `settings`, so `PlanListSidebar` keeps
  its normal project-tree content — "inside the normal app shell" with no sidebar
  special-casing).
- **`design-lab.tsx` gains a `beforeLoad`** mirroring `settings.tsx`: redirect to `/pair`
  unless the auth-gate status is `authenticated` or `hosted-static`, and — first — **redirect
  to `/` when `!import.meta.env.DEV`**. In production builds the guard collapses to an
  unconditional redirect: the route is unreachable.
- **Production bundles carry no catalog code.** `design-lab.lazy.tsx` keeps the lazy split,
  and the layout import inside it is wrapped in an `import.meta.env.DEV` conditional so
  Vite's static replacement dead-branch-eliminates the dynamic import in production — the
  catalog chunk (registry, entries, layout) is never emitted. The route-tree entry for
  `/design-lab` still exists as a few bytes of redirect logic; that is the closest a
  file-based route tree gets to "not served", and the AC's observable form — production
  offers no entry point and never renders the surface — holds. Verified explicitly in the
  test plan.

The dev-only stance also retires the reason `/ds` bypassed authentication (it had to render
without a backend); development runs always have one.

### The shell, in Appearance-page grammar

`DesignSystemLayout.tsx` (403 lines, own full-page chrome: left aside, bespoke bordered
buttons, `h-dvh` root) is replaced by a new **`DesignLabLayout.tsx`** in the same directory.
Structure mirrors `settings.tsx`'s `SettingsContentLayout`:

- **`SidebarInset` root** with the `workspace-topbar` header on web and the drag-region
  header on Electron (same two-branch pattern as `settings.tsx:76–110`; not extracted to a
  shared component in this issue — three copies is when it earns extraction). The header
  carries the surface title ("Design Lab") and the canvas controls.
- **Body = one flex row**: the page canvas as the flexible main pane, and a **right-hand
  navigation column** (`w-72`, `border-l border-border`, own `overflow-y-auto`) owned by the
  surface. The column carries the filter input and the section → group → entry tree ported
  from the current aside, restyled to the settings vocabulary (list rows styled like
  `SettingsNav`'s, `text-sm`, `rounded-md`, `bg-accent` active state — which the current nav
  already approximates). On narrow viewports the column stacks above the canvas, preserving
  the current mobile behavior with the placement flipped.
- **Canvas controls** (palette, appearance, increased text, reduced motion, canvas width)
  move into the header row and swap bespoke `<select>`/bordered buttons for the app's `ui/`
  primitives (`Select`, `Button` variants) so the toolbar reads as product chrome. The
  underlying state and semantics (palette snapshot/restore, reduced-motion style injection,
  canvas width classes) carry over from `DesignSystemLayout` unchanged.
- **Palette restore is kept as-is**: the mount-time snapshot of root theme variables and the
  unmount restore (`DesignSystemLayout.tsx:131–155`). Inside the shell this machinery is what
  guarantees leaving the Lab returns the user's real theme — and its app-wide repaint while
  on `/design-lab` is now a feature, not a leak: it is the first taste of the Lab painting
  the live app (the M-162 mechanism).

Navigation state logic currently inline in the layout (section grouping, filter matching,
expanded-section behavior) is extracted to **`designLabNav.logic.ts`** with a colocated test,
per the `*.logic.ts` convention.

### Document pages restyled, entry data untouched

The catalog registry (`catalog.tsx`, `*.catalog.tsx` files, `foundations.ts`, `coverage.ts`)
does not change — same entries, same ids, same search-param navigation
(`validateDesignSystemSearch` moves with the renamed route file, otherwise unchanged). The
redesign lands in the shared presentation layer:

- `DesignSystemPage.tsx`'s `Page` / `Section` / `Preview` / token primitives keep their
  public API (so no `*.catalog.tsx` file is touched) but restyle to the settings grammar:
  `Page` adopts `SettingsPageContainer`-style width and vertical rhythm, `Section` headers
  adopt `SettingsSection`'s heading treatment (`text-lg font-semibold tracking-[-0.025em]`
  with the same header row layout), `Preview` keeps its `rounded-xl border bg-card` framing
  (already on-grammar).

### The Appearance page link

`AppearanceSettingsPanel` (`SettingsPanels.tsx:941`) gains a final, `import.meta.env.DEV`-gated
`SettingsSection id="design-lab" title="Design Lab"` containing one `SettingsRow` — description
("The dev-only workbench where Astrolabe's visual language is explored") and a control button
that navigates to `/design-lab`. Gated at render, the section simply does not exist in
production builds, matching the route's own gate.

### Documentation

`docs/internals/design-system.md` describes `/ds` as a standalone hosted-static-capable route;
its route facts change (renamed to `/design-lab`, inside the shell, authenticated, dev-only,
no static deployment story). That is a rules change under the doc's own update policy — one
focused edit to the "Tooling decision" section, plus updating the doc's other `/ds` mentions
to the new address.

## File & Module Layout

Changed:

- `apps/web/src/routes/__root.tsx` — remove the two `/ds` special cases.
- `apps/web/src/routes/ds.tsx` → **renamed** `apps/web/src/routes/design-lab.tsx` — route id
  becomes `/design-lab`; add `beforeLoad` (dev gate, then auth gate); search validation
  unchanged.
- `apps/web/src/routes/ds.lazy.tsx` → **renamed** `apps/web/src/routes/design-lab.lazy.tsx` —
  render `DesignLabLayout` through a DEV-guarded dynamic import; production renders nothing
  (unreachable anyway).
- `apps/web/src/components/settings/SettingsPanels.tsx` — DEV-gated Design Lab section in
  `AppearanceSettingsPanel`.
- `apps/web/src/components/design-system/DesignSystemPage.tsx` — restyle primitives to the
  settings grammar; API unchanged.
- `docs/internals/design-system.md` — route facts update.

New:

- `apps/web/src/components/design-system/DesignLabLayout.tsx` **(new)** — the shell described
  above; placed beside the layout it replaces, in the directory that owns catalog presentation.
- `apps/web/src/components/design-system/designLabNav.logic.ts` **(new)** +
  `designLabNav.logic.test.ts` **(new)** — nav grouping/filter/expansion logic, per the
  logic-extraction convention.

Deleted:

- `apps/web/src/components/design-system/DesignSystemLayout.tsx` — superseded by
  `DesignLabLayout.tsx`.

Not touched (deliberately): `design-system/catalog.tsx` and all `*.catalog.tsx` registries,
`design-system/coverage*.ts`, `design-system.browser.test.tsx` (mounts entries directly, not
the layout), the `design-system` vite-plus project, CI.

## Implementation Checklist

- [ ] Extract `designLabNav.logic.ts` (section grouping, filter matching, expanded-section
      reducer) from the current layout, with `designLabNav.logic.test.ts`.
- [ ] Build `DesignLabLayout.tsx`: `SidebarInset` + web/Electron header carrying title and
      restyled canvas controls (`ui/` `Select`/`Button`); flex row of canvas + right-hand nav
      column; port palette snapshot/restore, reduced-motion injection, canvas-width state,
      and search-param navigation from `DesignSystemLayout.tsx` unchanged.
- [ ] Restyle `DesignSystemPage.tsx` primitives to the settings grammar without changing
      their props.
- [ ] Rename `routes/ds.tsx` → `routes/design-lab.tsx` and `routes/ds.lazy.tsx` →
      `routes/design-lab.lazy.tsx` (route id `/design-lab`; regenerated route tree; no `/ds`
      redirect left behind).
- [ ] Point `design-lab.lazy.tsx` at `DesignLabLayout` via a DEV-guarded dynamic import;
      delete `DesignSystemLayout.tsx`.
- [ ] Add `beforeLoad` to `design-lab.tsx`: redirect `/` when `!import.meta.env.DEV`, else
      the settings-style auth redirect to `/pair`.
- [ ] Remove the `/ds` `hosted-static` branch and the early-`Outlet` branch from
      `__root.tsx`.
- [ ] Add the DEV-gated Design Lab section + link to `AppearanceSettingsPanel`.
- [ ] Update `docs/internals/design-system.md`'s route description and its `/ds` mentions to
      `/design-lab`.
- [ ] Do not add dependencies; do not touch the catalog registry, coverage modules, or the
      `design-system` test project config.

## Test Plan

Unit (vite-plus `unit` project, colocated):

- [ ] `designLabNav.logic.test.ts` — grouping by section/group, filter matching across
      title/description/group/id, auto-expansion of the active entry's section, empty-filter
      result.

Browser (`vp run --filter @t3tools/web test:design-system` — must stay green untouched):

- [ ] All existing catalog-entry checks pass; axe passes. The suite mounts entries, not the
      layout, so a diff here signals an accidental registry change.

Manual AC walk (dev build, `test-t3-app` flow):

- [ ] `/design-lab` renders inside the app shell: left sidebar present, topbar header,
      right-hand nav column; old standalone chrome gone.
- [ ] `/ds` no longer resolves (the router's not-found handling applies).
- [ ] Nav column selects every section; entries render; `?page`/`?entry` deep links land.
- [ ] Palette/appearance switching on `/design-lab` repaints, and leaving `/design-lab`
      restores the user's real theme.
- [ ] Appearance settings page shows the Design Lab section and its link opens `/design-lab`.
- [ ] Escape/back leaves the surface without residue (theme, font-size restored).

Production gate (explicit, because the AC demands it):

- [ ] `vp build` the web app; assert no chunk in `dist/` contains catalog registry code
      (grep for a registry-unique string, e.g. a catalog entry id); assert `/design-lab` in
      the served production build redirects to `/` and the Appearance page shows no Design
      Lab section.
