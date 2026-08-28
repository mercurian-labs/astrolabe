# Technical Plan — Design Lab profiles: directions that save, switch, and ship (M-163)

Generated from the Goal/AC of Linear issue M-163. Goal in a sentence: every Lab adjustment
accumulates into named, switchable, machine-local profiles that export as files and leave the Lab
as a reviewable proposal against the product's shipped defaults — the product never reads a
profile at runtime.

## Conventions Detected

| Convention                                                                                                       | Evidence                                                                                                                             | Confidence |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Plans live at `docs/project/technical-plan-m-<n>-<slug>.md`                                                      | `docs/project/technical-plan-m-162-design-lab-axes.md`                                                                               | High       |
| Versioned interchange files with hand-rolled parse + friendly errors                                             | `parseThemeFile` / `serializeThemeFile` / `THEME_FILE_VERSION` in `apps/web/src/themePalette.ts:1852`                                | High       |
| Machine-local appearance state is `localStorage`, keyed `t3code:<thing>:v1`                                      | `CUSTOM_THEMES_STORAGE_KEY = "t3code:themes:v1"`, `THEME_HALVES_STORAGE_KEY` (`themePalette.ts:32-35`); `t3code:diff-panel-state:v1` | High       |
| Persisted client stores use zustand `persist` + `createJSONStorage` with `name`/`version`/`partialize`/`migrate` | `apps/web/src/rightPanelStore.ts:655-668`, `apps/web/src/diffPanelStore.ts:136`                                                      | High       |
| Dev-only Lab code is DEV-gated at the use site and dead-code-eliminated from prod; verified by dist grep         | `SettingsPanels.tsx:1167` (`import.meta.env.DEV ?`), `__root.tsx` host mount, M-162's prod-dist check                                | High       |
| Lab pages are `CatalogEntry`s in sections; axis pages get their own directory                                    | `apps/web/src/design-system/catalog.tsx:46-76,665-707`, `apps/web/src/design-system/axes/`                                           | High       |
| Live painting flows through the overrides store + `DesignLabOverridesHost`; overrides never write user settings  | `apps/web/src/designLabOverrides.ts`, `apps/web/src/components/design-system/DesignLabOverridesHost.tsx`                             | High       |
| File download via anchor + `URL.createObjectURL`                                                                 | `downloadPlanAsTextFile`, `apps/web/src/proposedPlan.ts:112`                                                                         | High       |
| File import via `<input type="file">` with optional desktop-bridge picker                                        | `ThemeImportDialog.tsx:278-299` (bridge optional; browser input is the fallback everywhere)                                          | High       |
| Colocated `.test.ts` on `vite-plus/test`; targeted runs only                                                     | `apps/web/src/designLabOverrides.test.ts`; AGENTS.md "Verifying"                                                                     | High       |
| Settings-page grammar for Lab pages (`SettingsSection`/`SettingsRow`)                                            | `apps/web/src/design-system/axes/AxisTypographyPage.tsx`                                                                             | High       |
| Commits are product sentences ending `(M-<n>)`                                                                   | `git log` (`Design Lab axes: … (M-162)`)                                                                                             | High       |

## Design

### What a profile is

A profile is a named snapshot of the Lab's whole adjustable state:

```ts
type DesignLabProfileAppearance = Readonly<{
  theme: string; // ThemePreference id ("system", "ocean", custom id, …)
  halves: Readonly<{ light?: string; dark?: string }> | null;
}>;

type DesignLabProfile = Readonly<{
  id: string; // slug of the name, uniquified
  name: string;
  axes: DesignLabAxisOverrides; // the 12 nullable knobs from designLabOverrides.ts
  appearance: DesignLabProfileAppearance;
  updatedAt: number;
}>;
```

Color rides the existing theme system (the vault's color axis "is the one users already have"):
a profile captures the theme _preference and halves_, not a copy of the palette. Custom-theme
color edits stay in the shared theme library (`t3code:themes:v1`); profiles reference themes by
id and only embed their definitions **by value at export time**, so a file reproduces the
appearance on another machine. Appearance _mode_ (light/dark/system) and follow-system are
deliberately not captured — they are the viewer's context, not part of a direction; a direction
that is inherently light carries that in its theme and halves.

### Store and persistence

New module `apps/web/src/designLabProfiles.ts` **(new)**, sibling of `designLabOverrides.ts`:

- zustand store with `persist` (`name: "t3code:design-lab-profiles:v1"`, `version: 1`,
  `createJSONStorage(() => window.localStorage)`), state
  `{ profiles: DesignLabProfile[]; activeProfileId: string | null; currentAxes: DesignLabAxisOverrides }`.
- Actions: `captureCurrent(axes, appearance)` (equality-guarded no-op when nothing changed — no
  storage churn), `saveProfile(name)` (names the current state: updates the active profile or
  creates one and activates it), `activateProfile(id)`, `deactivate()`, `deleteProfile(id)`,
  `addImportedProfile(profile)` (uniquifies a colliding id).
- Pure helpers: `parseDesignLabProfileFile(value: unknown)` and
  `serializeDesignLabProfileFile(profile, embeddedThemes)` with
  `DESIGN_LAB_PROFILE_FILE_VERSION = 1`, mirroring `parseThemeFile`'s hand validation and error
  voice. Axis values are clamped to the axis pages' ranges (radius 0–1.125; shadow 0–0.4; border
  0.25–2; blur 0–32; saturation 0.5–2; glass opacity `MIN/MAX_GLASS_OPACITY`; font sizes contract
  `MIN/MAX_*_FONT_SIZE`). Embedded themes are validated by delegating each to `parseThemeFile`.

The file format:

```json
{
  "version": 1,
  "name": "Solar light",
  "axes": { "radiusRem": 0.375, "fontSans": null, ... },
  "appearance": { "theme": "solar-light", "halves": null },
  "themes": [ { ...ThemeFile object per themePalette... } ]
}
```

`themes` carries the `ThemeFile` object form (same shape `serializeThemeFile` emits) for every
_custom_ theme the profile's `theme`/`halves` reference; built-ins are referenced by id only.

**Production safety (AC 5).** The module is imported only from DEV-gated code paths
(`DesignLabOverridesHost`, the Lab's dev-only chunk, the Appearance page's
`import.meta.env.DEV` section). Those branches are dead-code-eliminated in production builds, so
prod never reads the storage key and ships none of this code — same posture M-162 established,
re-verified by the dist grep in the test plan. No contracts or server change anywhere in this
issue: profiles are a client-local concern.

### Accumulate + lossless switching (AC 1, 2)

`DesignLabOverridesHost` (already DEV-mounted above the router) becomes the single
synchronization point:

- **Hydrate:** on mount, seed the in-memory overrides store from the persisted `currentAxes`
  (zustand persist hydrates synchronously from localStorage, so this is one `setOverrides` before
  the first paint effect). The theme needs no hydration — the theme system already persists
  itself.
- **Capture:** an effect mirrors the live state — `selectDesignLabAxisOverrides(store)` plus
  `{ theme, themeHalves }` from `useTheme()` — into `captureCurrent(...)`. When a profile is
  active, `captureCurrent` also writes the same data into that profile's record. This is what
  makes switching lossless in both directions with no switch-time bookkeeping: the active
  profile is always current, including theme changes made anywhere in the app while it is active.
  The equality guard breaks the apply→capture cycle.

**Applying a profile** (shared hook `useDesignLabProfileActions()` **(new)**, in
`apps/web/src/components/design-system/`, used by the Lab page and the Appearance row):
`setOverrides({ ...profile.axes })`, then `setTheme(profile.appearance.theme)` and
`setThemeHalf(...)` per stored half (in that order — `setTheme` clears halves, see
`useTheme.ts:473`), then `activateProfile(id)`. Repainting is free: the host already reacts to
both the overrides store and the theme snapshot.

**Return to shipped appearance** (also the delete-active path, AC 6):
`setOverrides(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES)`, `setTheme("system")`, `clearThemeHalves()`,
`deactivate()`. "Shipped appearance" is read literally: the product default (`useTheme.ts:38`
defaults to `"system"`), not the user's pre-Lab selection. `deleteProfile` on a non-active
profile touches nothing else (AC 6 first half). If a profile references a since-deleted custom
theme, applying it falls back to the default palette exactly as the theme system already does
for unknown ids — accepted, and the export path is what protects portability.

An unnamed working state (no active profile) persists across reloads via `currentAxes`; applying
a profile replaces it. The page says so in one line next to Save rather than interposing a
confirm — guardrails are M-166's scope.

### Export / import (AC 3)

- Export: collect the custom `ThemeDefinition`s referenced by the profile (via
  `getThemeDefinition` + membership in `getCustomThemes()`), serialize with
  `serializeDesignLabProfileFile`, download as `<slug>.design-profile.json` with a local
  `downloadTextFile` helper mirroring `proposedPlan.ts:112` (JSON mime). Lives in the actions
  hook — DOM side effects stay in the component layer.
- Import: `<input type="file" accept=".json,application/json">` like
  `ThemeImportDialog.tsx:467`; no desktop bridge needed — the browser input works in the Electron
  shell, and this surface is dev-only. Parse; for each embedded theme, `updateCustomTheme` when
  the id exists else `installCustomTheme` (reproducing the appearance is the point of the file);
  `addImportedProfile` then apply it — one action reproduces the appearance, the literal AC.

### Shipping a direction (AC 4)

Resolved in the vault as "a reviewable change to the defaults" with the review step mandatory.
The Lab's job is to make authoring that change mechanical, not to rewrite source files from the
browser: **"Propose as shipped defaults" generates a proposal document** — a markdown changeset
naming, for every axis that diverges from the shipped default: the proposed value, the current
shipped value, and the exact source location that owns it — with the profile file embedded in a
fenced block. It downloads as `<slug>.design-proposal.md`; turning it into the PR (by maintainer
or agent) is the normal review that the AC requires. A mechanical source-patcher was considered
and rejected: it could cover radius/glass/fonts but not shadow alphas, border roles, or palette
tables — most of a direction — so it would be machinery that still ends in hand work.

New module `apps/web/src/designLabProposal.ts` **(new)**:

- `SHIPPED_DESIGN_DEFAULTS`: one record per axis, each with the shipped value and its owning
  source pointer. Contract-owned values are **imported**, not restated
  (`DEFAULT_INTERFACE_FONT_SIZE` et al from `@t3tools/contracts`, `DEFAULT_SANS_FONT_STACK` /
  `DEFAULT_CODE_FONT_STACK` from `appearanceFonts.ts`). CSS-owned values are transcribed with
  their pointers — `--radius: 0.625rem` (`index.css:1390`), `--glass-blur: 12px`,
  `--glass-opacity: 80%`, `--glass-saturation: 1.14` (`index.css:103-105`, noting the wide-screen
  override at `index.css:119`) — and kept honest by a test that reads `index.css?raw` and asserts
  each transcribed declaration still exists.
- `buildDesignLabProposal(profile, embeddedThemes): string`. Divergence-only. Axes with no
  single shipped knob state their target plus where the design work lands: shadow opacity notes
  the per-elevation alphas it flattens (the caveat the elevation page already carries), border
  strength points at the `border`/`input`/`sidebarBorder`/`toolbarBorder` roles of the standard
  palettes, and a non-default theme points at the standard theme tables in `themePalette.ts` with
  the theme file embedded.

### Surfaces (AC 2, 5)

- **Lab page:** `apps/web/src/design-system/profiles/ProfilesPage.tsx` **(new)**, registered in
  `catalog.tsx` under a new section `{ id: "profiles", title: "Profiles" }` placed right after
  `axes` — nav, deep links (`/design-lab?page=profiles`), Escape handling, and the browser-suite
  axe walk all come free with the entry. Settings-page grammar (`SettingsSection`/`SettingsRow`),
  like the axis pages. Content: a "Current direction" section (name field, Save, Return to
  shipped appearance, unsaved-state hint) and a "Saved profiles" section (per row: name, active
  marker, Apply, Export, Propose, Delete; plus Import).
- **Appearance page (dev builds):** extend the existing `import.meta.env.DEV` Design Lab section
  (`SettingsPanels.tsx:1167`) with a "Design profile" row — a `Select` listing "Shipped
  appearance" plus each saved profile, applying on change through the same actions hook, and the
  existing button already links to the Lab for management.
- **Clients:** web and desktop (which wraps web) get this by construction; mobile does not carry
  the Lab — not applicable. No provider, contract, or connection-mode impact.
- **Docs:** extend `docs/internals/design-system.md` with the profiles contract (what a profile
  captures, storage key, file format, the proposal path, production posture).

## Implementation Checklist

- [ ] `apps/web/src/designLabProfiles.ts` (new): types, versioned parse/serialize with clamps and
      `parseThemeFile`-style errors, persisted store (`t3code:design-lab-profiles:v1`) with
      equality-guarded `captureCurrent`, save/activate/deactivate/delete/import actions.
- [ ] `apps/web/src/designLabProposal.ts` (new): `SHIPPED_DESIGN_DEFAULTS` with source pointers
      (importing contract/font constants rather than restating them) and
      `buildDesignLabProposal`.
- [ ] `DesignLabOverridesHost.tsx`: hydrate overrides from persisted `currentAxes` on mount;
      capture effect mirroring axes + theme/halves into `captureCurrent`.
- [ ] `apps/web/src/components/design-system/useDesignLabProfileActions.ts` (new): apply, return
      to shipped, delete (active vs inactive), export, import, propose; local `downloadTextFile`
      helper.
- [ ] `apps/web/src/design-system/profiles/ProfilesPage.tsx` (new) + `catalog.tsx` section
      `profiles` and entry (`sourcePath: "src/design-system/profiles/ProfilesPage.tsx"`,
      `layout: "document"`).
- [ ] `SettingsPanels.tsx`: profile `Select` row inside the existing DEV Design Lab section.
- [ ] `docs/internals/design-system.md`: profiles section.
- [ ] No new dependency; no `packages/contracts` or server changes; `designLabOverrides.ts`
      stays in-memory and setting-blind (profiles code imports it, never the reverse).

## Test Plan

Colocated `vite-plus/test` suites, run targeted (`vp test run <files>`); no repo-wide checks.

- [ ] `designLabProfiles.test.ts`: file round-trip (serialize → parse, with and without embedded
      themes); parse rejects wrong version/missing name/non-object axes; out-of-range axis values
      clamp to the documented ranges; embedded theme validation delegates to `parseThemeFile`
      (bad theme fails with its message); `captureCurrent` no-ops on equal input and updates the
      active profile's record otherwise; `saveProfile` creates-then-activates and updates on
      re-save; `deleteProfile` of a non-active profile leaves active state untouched; import
      uniquifies a colliding id.
- [ ] `designLabProposal.test.ts`: divergence-only output; each emitted axis carries proposed
      value, shipped value, and source pointer; shadow/border/theme caveat lines present when
      those diverge; profile JSON embedded; **honesty check** — every CSS-transcribed shipped
      default still appears in `index.css?raw`.
- [ ] Design-system browser suite: the profiles entry is picked up by the existing catalog walk
      (axe + render); update `catalog.test.ts` expectations for the new section/entry counts.
- [ ] Production build: dist grep shows no profiles page, no `design-lab-profiles` storage key,
      no proposal strings (M-162's check, extended).
- [ ] Manual AC walk (dev server): adjust axes → shows as current; save/name; adjust more; save a
      second direction; switch A↔B (instant whole-app restyle incl. theme, lossless both ways,
      reload keeps everything); export A, delete A, import the file (appearance reproduced,
      profile re-listed); propose A (document lists divergent axes with pointers); delete active
      → shipped appearance; Appearance-page Select applies profiles; prod build unaffected.
