# Technical Plan — Design Lab axes: shape, typography, and elevation editable live (M-162)

Generated from the Goal/AC of Linear issue
[M-162](https://linear.app/mercurian/issue/M-162/design-lab-axes-shape-typography-and-elevation-editable-live).
Goal in one sentence: the Design Lab shell (M-160, merged) grows editing pages for the
first four axes — color, shape, typography, elevation & glass — whose controls restyle the
entire running app immediately, survive navigation, and leave the user-facing floating
theme editor exactly as it is.

## Conventions Detected

| Convention                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                         | Confidence |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Live-editing state lives in a zustand store above the router, rendered by a host in `__root.tsx`, so drafts survive navigation                                                                                                               | `themeEditorStore.ts` (doc comment says exactly this), `ThemeEditorHost` mounted at `__root.tsx:157`                                                                             | High       |
| Live restyling is done by writing CSS custom properties on `document.documentElement` from a null-rendering sync component                                                                                                                   | `GlassAppearanceSync` / `FontAppearanceSync` in `__root.tsx:163-203`; `applyAppearanceFontVariables` in `appearanceFonts.ts`; `applyThemeColorPreview` in `themePalette.ts:1656` | High       |
| Color drafts paint via `applyThemeColorPreview(colors, appearance)` and are restored by `restoreTheme()`/`refreshTheme()` on close                                                                                                           | `ThemeEditorPanel.tsx:348-358` (paint + restore effects), `ThemeEditorHost`                                                                                                      | High       |
| The whole radius scale derives from one `--radius` base: every `rounded-*` utility compiles to `calc(var(--radius) ± n)`                                                                                                                     | `@theme inline` block `index.css:199-206`; verified in compiled CSS (`.rounded-sm{border-radius:calc(var(--radius) - 4px)}` … `.rounded-2xl{…+ 8px}`)                            | High       |
| Every shadow utility resolves its color through `var(--tw-shadow-color, <default>)`; only a handful of colored variants set it locally                                                                                                       | compiled CSS: `.shadow-xs`/`.shadow-sm`/`.shadow-lg\/5`/`.shadow-2xl` all read the hook; local setters limited to `shadow-black/20`-style variants                               | High       |
| Glass is already fully runtime-variable: `--glass-blur`/`--glass-opacity`/`--glass-saturation` consumed via `var()` throughout `index.css`; opacity is a persisted user setting painted by `GlassAppearanceSync`                             | `index.css:94-96` + ~15 consumer sites; `SettingsPanels.tsx:959-1020` (slider), `MIN/MAX_GLASS_OPACITY` from contracts                                                           | High       |
| Typography voices are already runtime-variable and centrally applied: `--font-sans`/`--font-mono`/`--font-composer`, root font-size, `--font-size-prompt`/`--font-size-code`, via `applyAppearanceFontVariables` with contract-pinned clamps | `appearanceFonts.ts:99-134`; `@t3tools/contracts` size constants                                                                                                                 | High       |
| Border separation is carried by semantic color vars (`--border`, `--input`, `--sidebar-border`, `--toolbar-border`) that map to `--app-theme-*` under `html[data-theme-id]`; an inline root override beats both                              | `index.css:1054-1101,1322-1330`, `APP_THEME_VARIABLES` in `themePalette.ts`                                                                                                      | High       |
| Lab pages are typed `CatalogEntry` objects in sections; nav logic is already generic over any entry with `id/section/group/title/description`; deep links via `?page=`                                                                       | `design-system/catalog.tsx:39-102`, `designLabNav.logic.ts` (generic type params), `DesignLabLayout.tsx`                                                                         | High       |
| Every catalog entry is walked and axe-audited by the browser suite                                                                                                                                                                           | `design-system.browser.test.tsx:27-63` iterates `CATALOG_ENTRIES`                                                                                                                | High       |
| Dev-only surface gating is `import.meta.env.DEV` (route beforeLoad + lazy-import stub, dead-branch-eliminated in prod)                                                                                                                       | `routes/design-lab.tsx:19`, `routes/design-lab.lazy.tsx:4-10`                                                                                                                    | High       |
| Command palette actions are pushed as typed `actionItems` with search terms; the theme editor already has one                                                                                                                                | `CommandPalette.tsx:1491-1506`                                                                                                                                                   | High       |
| Settings controls grammar: `SettingsSection`/`SettingsRow`/`SettingResetButton`, `settings-slider` with progress vars, `FontFamilyPicker` as a controlled component                                                                          | `settingsLayout.tsx:118-237`, glass slider `SettingsPanels.tsx:959+`, `FontFamilyPicker.tsx:104-121`                                                                             | High       |
| Commit messages are product sentences ending `(M-<n>)`; plans live at `docs/project/technical-plan-m-<n>-<slug>.md`                                                                                                                          | `git log`; `docs/project/` listing                                                                                                                                               | High       |

## Design

### One override store above the router

The heart of the change is a small always-loaded module,
`apps/web/src/designLabOverrides.ts` **(new)** — the axis analogue of
`themeEditorStore.ts`. A zustand store holds the Lab's non-color adjustments, all
nullable (null = "as shipped / as the user's settings say"):

- **shape** — `radiusRem: number | null`
- **typography** — `fontSans`, `fontCode`, `fontComposer: string | null`;
  `sizeInterface`, `sizePrompt`, `sizeCode: number | null`
- **elevation & glass** — `shadowOpacity: number | null` (0–0.4),
  `borderStrength: number | null` (0.25–2, 1 = as designed),
  `glassBlurPx`, `glassOpacityPct`, `glassSaturation: number | null`
- **lab return point** — `lastLabLocation: DesignLabSearch | null`
- **`repaintNonce`** — bumped by anything that has just written theme vars directly
  (see "coexisting with the M-160 canvas preview") so the host re-asserts.

Alongside the store, a pure `applyDesignLabOverrides(root, effective)` function does all
DOM writes, and pure helpers compute "effective" values (`override ?? setting`) and the
border color-mixes — these are the unit-testable core, following the
`*.logic`-style extraction the repo favors.

A null-rendering `DesignLabOverridesHost` **(new)** mounts in `__root.tsx` directly
**after** `GlassAppearanceSync`/`FontAppearanceSync` (mount order matters: sibling
effects run in mount order per commit, so the host's writes land last), gated
`import.meta.env.DEV ? <DesignLabOverridesHost /> : null` so prod builds drop it. It
subscribes to the store **and** to the same client-settings selectors the two sync
components use, and on any change applies the merged result:

- **Typography**: build `AppearanceFontPreferences` as `override ?? setting` per field
  and call the existing `applyAppearanceFontVariables` — reusing the one writer means
  clearing an override automatically restores the user's setting, with the same clamps.
- **Glass**: `--glass-opacity` = `override ?? setting`; `--glass-blur`/
  `--glass-saturation` set when overridden, removed when null (stylesheet defaults
  return).
- **Shape**: `--radius: <n>rem` when overridden, removed when null. Because every
  `rounded-*` utility compiles to `calc(var(--radius) ± n)`, this single write restyles
  controls, cards, and overlays at once — the AC's visibility requirement falls out of
  the verified compilation.
- **Shadow strength**: `--tw-shadow-color: rgb(0 0 0 / <opacity>)` when overridden,
  removed when null. Verified: all standard `shadow-*` utilities read
  `var(--tw-shadow-color, <their default>)`. Known and accepted: the override flattens
  the per-elevation alpha differentiation (xs=5% … 2xl=25%) to one value, and the few
  intentionally-colored shadows (`shadow-primary`, `shadow-black/20`, arbitrary values —
  the catalog's `UNMANAGED_ELEVATIONS` debt) keep their local colors. The page says so
  in its description; this is an instrument for judging a stance, not a resolved token.
- **Border strength**: the host resolves the active theme's colors (via `useTheme` +
  `getThemeColorsForMode`, the same data `ThemeEditorHost` uses), computes
  `color-mix(in oklab, <border-role> <pct>%, <canvas|text>)` strings in JS (mixing
  toward canvas below 1, toward text above 1), and writes them to `--border`,
  `--input`, `--sidebar-border`, `--toolbar-border`. Inline root writes beat both the
  `:root` defaults and the `html[data-theme-id]` mappings. Recomputes on theme change
  because it subscribes to `useTheme`. Accepted precedence quirk (noted in a code
  comment): while a border-strength override is active it also wins over a color
  draft's border edits — reset the control to hand borders back to the palette.

Nothing in M-162 persists overrides to disk: adjustments are in-memory experiments that
survive navigation for the session; capturing them is M-163's profiles issue. This
matches the theme editor's draft model exactly.

### Axis pages are catalog entries in a new first section

The four editing pages are ordinary `CatalogEntry` objects in a new section
`{ id: "axes", title: "Axes" }` prepended to `CATALOG_SECTIONS` — so the M-160 nav,
filtering, deep links (`?page=axis-shape`), Escape handling, and the browser walk + axe
audit all apply with zero new navigation machinery. Entry components live in a new
`apps/web/src/design-system/axes/` directory (inside the DEV-only lazy chunk;
importing the main-bundle store from there is the cheap direction):

- `axis-shape` — a corner-rounding stance: preset row (Sharp 0 / Compact 0.375rem /
  Standard 0.625rem / Soft 0.875rem / Round 1.125rem) plus a fine slider over the same
  range, writing `radiusRem`. Built from `SettingsSection`/`SettingsRow`/
  `SettingResetButton` and the `settings-slider` grammar, mirroring the glass-opacity
  row — the Lab pages should read as Appearance-page kin, per the Lab's design brief.
- `axis-typography` — the three voices (interface, code, prompt) each as a
  `FontFamilyPicker` (controlled; `requireMonospace` for code) plus their size sliders
  using the contract clamps (`MIN/MAX_INTERFACE_FONT_SIZE` etc.). Writes store
  overrides only — never `updateSettings`, so a designer's experiments don't silently
  rewrite their own user preferences.
- `axis-elevation` — shadow strength slider, border strength slider, and the glass trio
  (blur, opacity, saturation). The page notes the shadow-flattening caveat and links the
  `UNMANAGED_ELEVATIONS` debt the catalog already tracks.
- `axis-color` — hosts the full theme editor surface docked in the main pane (next
  section).

Each control row carries a reset action, and each page gets a header "Reset axis"
affordance clearing its slice to null.

### Color: one editor instance, two shells

The floating `ThemeEditorPanel` (~1,180 lines) is split, not duplicated:

- `ThemeEditorSurface` **(new, extracted)** — everything that _is_ the editor: name
  field, light/dark appearance toggle (the "both halves editable" AC is this existing
  control), simple/advanced modes, role groups and search, the element inspector
  wiring, error display, save/cancel flow, and the paint effect
  (`applyThemeColorPreview`) + restore-on-close effect. Extraction only — no behavior
  change.
- `ThemeEditorPanel` keeps its floating chrome (drag, resize, minimize, position
  clamping) and renders the surface. The user-facing editor therefore behaves exactly
  as before — the "unchanged floating editor" AC is guaranteed by construction, and the
  keybinding/CommandPalette/host paths are untouched.

To make Lab color editing survive navigation without lifting a dozen `useState`s into a
store, the surface instance is **owned by `ThemeEditorHost`** (already above the router)
and _docked_ into the Lab when appropriate: the host renders the surface either inside
the floating chrome or, when the Lab's color page is active and has published a slot
element to the store, through `createPortal` into that slot. The component instance
never unmounts across the swap, so draft state and the painted preview persist whether
the user is in the Lab, browsing the app, or back again — the same session, two shells.
The Lab color page renders the slot plus a start affordance ("Edit the current theme",
seeding a session via the existing `toggleThemeEditorForTheme` seeding logic) when no
session is open. Rationale for portal-docking over a store lift: it reuses the panel's
existing state model wholesale, keeps the floating editor's code path byte-identical,
and the swap is a pure render-target decision in one host.

### Coexisting with the M-160 canvas preview

`DesignLabLayout` keeps its M-160 header controls (palette/appearance preview, canvas
width, increased text, reduced motion) and its snapshot/restore-on-unmount of theme
vars — that behavior is about _previewing catalog references_, not editing. Two small
integrations:

- The unmount restore now also bumps `repaintNonce`, so the overrides host (and the
  color draft's paint effect, which keys on the same store signal) re-assert their
  writes after the snapshot restore — leaving the Lab must not un-apply adjustments
  (the "stay applied while navigating" AC).
- The layout records `search` into `lastLabLocation` on every page change, which powers
  the return quick action.

### The quick action back to the Lab

A DEV-gated CommandPalette action ("Open Design Lab", search terms "design lab", "axes",
"catalog") pushed alongside the existing theme-editor action, navigating to
`/design-lab` with `lastLabLocation ?? {}` as search — returning to the exact page the
Lab was left on. No new keybinding command is added to `packages/contracts`: the palette
entry satisfies the AC without a server-contract change, and a chord can ride later if
wanted.

### Gaps the AC opens

- No runtime hook existed for shadow or border strength; this plan introduces them as
  the `--tw-shadow-color` root override and JS-computed border color-mixes — both
  verified against the compiled CSS rather than assumed.
- The Lab previously restored all styling on exit; the override store inverts that for
  axis adjustments deliberately, scoped by `repaintNonce` coordination.

## File & Module Layout

| File                                                                                                                        | Status               | Change                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/designLabOverrides.ts`                                                                                        | **(new)**            | Store, types, defaults, `applyDesignLabOverrides`, effective-value + border-mix helpers. Beside `appearanceFonts.ts`/`themePalette.ts`, its runtime kin. |
| `apps/web/src/designLabOverrides.test.ts`                                                                                   | **(new)**            | Unit suite for the pure core.                                                                                                                            |
| `apps/web/src/components/design-system/DesignLabOverridesHost.tsx`                                                          | **(new)**            | Null-rendering host; merged application; theme-aware border mixes.                                                                                       |
| `apps/web/src/routes/__root.tsx`                                                                                            | edit                 | Mount the host (DEV-gated) after the two sync components; order comment.                                                                                 |
| `apps/web/src/components/settings/ThemeEditorSurface.tsx`                                                                   | **(new, extracted)** | The editor body moved out of `ThemeEditorPanel.tsx`.                                                                                                     |
| `apps/web/src/components/settings/ThemeEditorPanel.tsx`                                                                     | edit                 | Floating chrome only; renders the surface.                                                                                                               |
| `apps/web/src/components/settings/ThemeEditorHost.tsx`                                                                      | edit                 | Owns the surface instance; portal-docks it into the Lab slot when published.                                                                             |
| `apps/web/src/design-system/catalog.tsx`                                                                                    | edit                 | New first section `axes`; register the four entries.                                                                                                     |
| `apps/web/src/design-system/axes/AxisShapePage.tsx`, `AxisTypographyPage.tsx`, `AxisElevationPage.tsx`, `AxisColorPage.tsx` | **(new)**            | The editing pages, settings-grammar styled.                                                                                                              |
| `apps/web/src/components/design-system/DesignLabLayout.tsx`                                                                 | edit                 | `lastLabLocation` recording; `repaintNonce` bump in the unmount restore.                                                                                 |
| `apps/web/src/components/CommandPalette.tsx`                                                                                | edit                 | DEV-gated "Open Design Lab" action.                                                                                                                      |
| `docs/internals/design-system.md`                                                                                           | edit                 | Document the Axes section and the override store contract for contributors.                                                                              |

## Implementation Checklist

- [ ] Build `designLabOverrides.ts`: store shape above, pure `applyDesignLabOverrides`,
      effective-merge and border color-mix helpers, `repaintNonce`. No persistence.
- [ ] Build `DesignLabOverridesHost` (merged typography through
      `applyAppearanceFontVariables`; glass merge; radius; `--tw-shadow-color`; border
      mixes from `useTheme` + `getThemeColorsForMode`); mount DEV-gated in `__root.tsx`
      after `FontAppearanceSync` with the ordering comment.
- [ ] Extract `ThemeEditorSurface` from `ThemeEditorPanel` (mechanical; floating chrome
      stays behind; no behavior change — existing editor walkthrough must be
      indistinguishable).
- [ ] Teach `ThemeEditorHost` to portal-dock the surface into a Lab-published slot; add
      the slot element + publish/unpublish to the store.
- [ ] Add the `axes` section and four entries to `catalog.tsx`; build the four pages in
      `design-system/axes/` on the settings grammar with per-row and per-axis resets.
- [ ] Wire `DesignLabLayout`: record `lastLabLocation`; bump `repaintNonce` in the
      unmount restore.
- [ ] Add the DEV-gated CommandPalette action navigating to `lastLabLocation`.
- [ ] Update `docs/internals/design-system.md` (rules change: a new section kind that
      edits rather than documents).
- [ ] Do **not** add dependencies, persist overrides, touch `packages/contracts`, or
      change any user-facing (non-DEV) behavior path.
- [ ] Commit as a product sentence ending `(M-162)`.

## Test Plan

Unit (`vp test run --project unit`, colocated `vite-plus/test`):

`designLabOverrides.test.ts` (drive a fake root style object):

- [ ] Null overrides write nothing beyond the merged settings values and remove
      previously-set vars (radius, glass blur/saturation, shadow color, border vars).
- [ ] `radiusRem` writes `--radius` in rem; clearing removes it.
- [ ] Shadow opacity writes `--tw-shadow-color` as black at the given alpha.
- [ ] Border strength mixes toward canvas below 1, toward text above 1, identity at 1
      (no writes), for all four border vars, from a given `ThemeColors`.
- [ ] Typography merge prefers overrides field-by-field and passes contract clamps
      through (a 200px interface size clamps as `applyAppearanceFontVariables` does).
- [ ] `lastLabLocation` round-trips; `repaintNonce` bumps re-trigger application.

Existing suites that must stay green untouched:

- [ ] The full theme editor / keybindings / CommandPalette unit suites — the extraction
      and host changes must not alter them.

Browser (`vp test run --project design-system`):

- [ ] The four new entries are walked and axe-clean automatically by
      `design-system.browser.test.tsx` (controls render from a default store; the color
      page renders its empty-slot state).

Manual walk (dev build, per the browser-walk practice; each AC demonstrated live):

- [ ] All four axis pages exist in the "Axes" nav section and deep-link via `?page=`.
- [ ] Moving the shape slider restyles buttons, cards, and an open popover at once;
      Sharp → Round is unmistakable app-wide (leave the Lab and check the real
      composer/sidebar).
- [ ] Changing the interface voice and prompt size restyles the whole app; the user's
      Appearance settings values are untouched afterwards (check Settings →
      Appearance).
- [ ] Shadow and border strength sliders visibly change surface separation; glass
      blur/opacity/saturation change the composer/topbar glass.
- [ ] Set adjustments, navigate to a thread, a settings page, and back via the command
      palette action: adjustments held everywhere, and the Lab reopened on the exact
      page it was left on.
- [ ] In the Lab color page: edit both halves, use the element inspector on real app
      chrome, save — parity with everything the floating editor offers.
- [ ] Floating editor regression pass: open via keybinding, drag, resize, minimize,
      edit, cancel-restores, save-activates — identical to before.
- [ ] Prod build gate: `vp build`, then grep the output for axis-page identifiers —
      absent, as with the M-160 stub-chunk check.
