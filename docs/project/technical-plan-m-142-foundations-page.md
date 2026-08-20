# Technical Plan — M-142: Foundations page — the inherited semantic roles, visible

_Generated from the Goal/AC of Linear issue M-142 (see the issue for the full AC). Third link in the design-system stack: builds on the M-140 workbench (Storybook 9.1.20 under the vite alias, `apps/web/.storybook/`) and sits above M-141's fixtures in the branch stack, though it uses none of them. Governed by [design-system.md](../internals/design-system.md) rev 2's "foundations story" clause._

**Goal, in one sentence:** one catalog page that renders every inherited semantic color role — name, declared value, live swatch — plus the two type voices, derived entirely from the shipped role definitions so the page can never drift from the product, updating live across light, dark, and the built-in themes.

**Scope fences:** no new roles, no role renames, no palette edits — the page shows what ships, it changes nothing; no product-component stories (M-143); no CI (M-144); no new dependencies.

## What discovery found

- **The role enumeration and its entire read API already ship in one module.** [apps/web/src/themePalette.ts](../../apps/web/src/themePalette.ts): `THEME_COLOR_ROLES` (58 camelCase roles, line 24), `getThemeColorVariable(role)` → the `--app-theme-*` CSS variable name (line 1644), `getStandardThemeColors(appearance)` (line 602) for the default theme's concrete colors, the five built-in `ThemeDefinition`s (`T3_CHAT_THEME`, `GROVE_THEME`, `OCEAN_THEME`, `EMBER_THEME`, `IRIS_THEME`), and `getThemeDefinition`/`getThemeColorsForMode`/`getThemeModes` to resolve a definition's palette per appearance. A page that iterates `THEME_COLOR_ROLES` and resolves values through these functions satisfies the derivation AC by construction: a role added to or removed from the product appears or disappears with no page edit.
- **Theme application is one function and one attribute.** `applyThemePalette(theme, appearance)` (line 1674) stamps `data-theme-id` on the document element and writes each role's `--app-theme-*` variable; [index.css:1053](../../apps/web/src/index.css) (`html[data-theme-id]`) is where those variables take over the base `--background`/`--toolbar-*`/… tokens. Passing the standard theme clears the attribute and removes the variables — exactly the reset path. A Storybook global whose decorator calls `applyThemePalette` therefore reproduces the production pipeline; no story-only theme plumbing exists to write.
- **The workbench already has the appearance toggle.** [apps/web/.storybook/preview.tsx](../../apps/web/.storybook/preview.tsx) (M-140) declares the `appearance` global toggling the `dark` class. The theme global composes with it: appearance picks the mode, theme picks the palette — the same two axes `useTheme`/`applyThemePalette` use in the app.
- **The type voices are two `@theme` font tokens.** [index.css:136](../../apps/web/src/index.css): `--font-sans` (the chrome voice) and `--font-mono` (the code/identifier voice). The inherited system has no separate reading face yet — the page shows the two that exist, which _is_ the honest audit.
- **Where the page lives.** The M-140 story sits beside its component (`PlanStatusDot.stories.tsx`). The foundations page has no component to sit beside; the natural home mirroring the `src/test/fixtures/` precedent is a small dedicated module + story under `apps/web/src/foundations/` — but nothing ships from it except through Storybook, so it must not enter the app bundle. Discovery confirms nothing imports `*.stories.tsx` from shipping code (the stories glob is Storybook-only; the unit test include `src/**/*.test.{ts,tsx}` doesn't match stories).

## Conventions Detected

| Convention                                                                                                              | Evidence                                                      | Confidence |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| Stories are `.stories.tsx`, state-named, mounted from the production stylesheet + `dark`-class decorator                | `PlanStatusDot.stories.tsx`, `.storybook/preview.tsx` (M-140) | High       |
| Theme machinery is consumed through `themePalette.ts` exports, never by hand-writing `--app-theme-*` values             | `ThemeEditorPanel.tsx`, `useTheme.ts`, `themeInspector.ts`    | High       |
| Pure logic split into a sibling `.logic.ts` with a co-located `.logic.test.ts`                                          | `*.logic.ts` pattern across `components/mercurian/`           | High       |
| No new dependencies without reviewer involvement (Sol sandbox has no registry; deps land via catalog/caret conventions) | M-140 process, `pnpm-workspace.yaml`                          | High       |
| Commits `<type>(scope): … (M-142)`, branch `venk/m-142-<slug>`, plan docs at `docs/project/`                            | `git log`, existing plans                                     | High       |

## Design

### 1. One derivation module, one story file

- **`apps/web/src/foundations/foundations.logic.ts` (new):** a pure derivation from the shipped exports — `foundationsThemes()` returns the standard entry plus the five built-in definitions (id, label, available modes via `getThemeModes`); `foundationsRoles(theme, appearance)` returns `Array<{ role, cssVariable, value }>` by iterating `THEME_COLOR_ROLES` over `getStandardThemeColors(appearance)` or `getThemeColorsForMode(def, appearance)`, with `cssVariable` from `getThemeColorVariable`. No literals: every name and value flows from `themePalette.ts`.
- **`apps/web/src/foundations/Foundations.stories.tsx` (new):** a single story, `Foundations/Semantic roles`, rendering: a header naming the active theme + appearance; the role table (role name, CSS variable in the mono voice, declared value, and a live swatch painted `var(<cssVariable>, <declared>)` so the swatch proves the runtime pipeline while the fallback keeps the standard theme honest); and a type-voices section rendering a sample line in `var(--font-sans)` and one in `var(--font-mono)` with the token names. Layout uses the existing Tailwind utilities — the page is itself written against the inherited system, not bespoke CSS.

### 2. The theme axis joins the preview globals

`.storybook/preview.tsx` gains a `theme` global (toolbar: Standard, T3 Chat, Grove, Ocean, Ember, Iris — items derived from the exported definitions, not hardcoded strings) whose decorator calls `applyThemePalette(themeId === "standard" ? <standard preference> : themeId, appearance)` and composes with the existing `appearance` decorator (appearance still toggles the `dark` class; `applyThemePalette` receives it so single-appearance themes resolve per `getThemeColorsForMode`). Standard resets via the applier's own clear path. This makes the matrix's "representative built-in theme" available to _every_ story, not just this page — the staged-matrix step the strategy doc names.

### 3. What deliberately doesn't happen

- No visual snapshot, no CI wiring (M-144), no interaction checks.
- The page doesn't enumerate spacing/radius/motion tokens: the shipped enumerable layer is the color roles and the font tokens; inventing an enumeration for un-enumerated tokens would be a new source of truth, which the strategy doc forbids. Recorded as a finding for the cut-over rework instead.
- No `data-theme-id` or variable writing outside `applyThemePalette`.

## Implementation Checklist

- [ ] Create `apps/web/src/foundations/foundations.logic.ts` with `foundationsThemes()` and `foundationsRoles()` derived exclusively from `themePalette.ts` exports.
- [ ] Create `apps/web/src/foundations/foundations.logic.test.ts`: every enumerated role appears exactly once per theme/appearance; values are valid theme colors; the standard and built-in resolutions match `getStandardThemeColors`/`getThemeColorsForMode`; role-set equality with `THEME_COLOR_ROLES` (the derivation guard).
- [ ] Create `apps/web/src/foundations/Foundations.stories.tsx` rendering the role table, swatches, and type voices from the logic module.
- [ ] Add the `theme` global + `applyThemePalette` decorator to `apps/web/.storybook/preview.tsx`, items derived from the exported theme definitions.
- [ ] Verify in the dev catalog: swatch grid updates across light/dark and at least two built-in themes; the whole canvas (not just the table) wears the applied theme.
- [ ] `storybook build -o dist/storybook` registers the foundations story alongside the three M-140 stories.
- [ ] `tsgo --noEmit` (apps/web), `vp test run --project unit`, root `vp lint` all green.
- [ ] Don't add dependencies, don't touch `themePalette.ts` or `index.css`, don't write any color literal in the page.

## Test Plan

Logic is unit-tested; rendering is review-walked (the strategy doc's ladder — no snapshot service yet).

- [ ] `foundations.logic.test.ts` (cases above) passes under `vp test run --project unit`.
- [ ] Reviewer browser walk: the story lists all 58 roles with correct values in light and dark; switching to a built-in theme (e.g. Grove) repaints swatches and canvas; the mono/sans samples render distinctly; a spot-checked role's swatch matches the app's actual surface color for that theme.
- [ ] Derivation AC demonstrated: the logic test's role-set-equality case is the executable form of "a role added or removed appears or disappears without editing the page."
