# Mercurian theme and branding

A fresh install opens in the **Mercurian** theme, following the system
appearance. Ink is the accent. Rust marks the brand and the composer's
controls. The product's name and links read Astrolabe on client surfaces, while
server messages stay T3 Code's, so a stock T3 server stays a drop-in.

## Sub-features

- Default theme `mercurian`, and the Mercurian card leads Settings → Appearance.
  The `iris` theme is hidden from the picker.
- Light and dark halves of the theme follow `prefers-color-scheme` by default.
- The composer's primary button draws Astrolabe's own Send, Queue, Steer and
  Stop icons (`components/brand/ComposerControlIcons.tsx`) on
  `bg-message-action`.
- The page title reads "Astrolabe (Alpha)" while booting and "Astrolabe (Dev)" once loaded in dev
  (a server version can set another stage label), and brand marks and the
  wordmark appear in the sidebar, the boot screen and the welcome wizard.

## How to get to it (user POV)

Theme: **Settings** (icon rail, or the sidebar footer on narrow windows) →
**Appearance**. Branding: everywhere,
starting at the boot screen and the sidebar header.

## Driving it with the Browser panel

```
preview_evaluate   document.documentElement.dataset.themeId        // "mercurian"
preview_set_appearance  colorScheme=dark
preview_evaluate   document.documentElement.classList.contains('dark')  // true
preview_set_appearance  colorScheme=system
preview_navigate   target={kind:'environment-port', port:<webPort>, path:'/settings/appearance'}
preview_wait_for   text=Mercurian
```

**Proof:** `themeId` is `mercurian` on a fresh incognito profile, and the
`dark` class follows the emulated scheme. On Appearance, the Themes list reads
Mercurian, T3 Code, T3 Chat, Grove, …, with Mercurian first. The composer's primary button is ink (`bg-message-action`)
with a rust centre dot: `getComputedStyle(document.documentElement).getPropertyValue('--pivot')`
is `#a0492a` (`--brand-rust`). Save a screenshot of it. `document.title` contains "Astrolabe".

## Gotchas

- Use the `incognito` profile. The default profile may hold a theme the user
  picked, which hides the default.
- Server-originated text (provider errors, "disabled in T3 Code settings")
  correctly says T3 Code. Do not file it as a missed rename.
- The picker hides Iris by leaving it out of `ThemeSettings.tsx`'s list, not through
  `PICKER_HIDDEN_THEME_IDS` (which the command palette and mobile use).
- `apps/web/index.html` keeps its own copy of the default theme and palette for the
  boot screen, `index.css` holds the rust pivot rule, `branding.ts` the name and
  title. A sync conflict in any of them walks this feature.
- The theme also feeds mobile's generated palettes. A change to
  `packages/shared/src/mercurianTheme.ts` needs a mobile pass via test-t3-mobile.
