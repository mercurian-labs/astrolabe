# Mercurian theme and branding

A fresh install opens in the **Mercurian** theme, following the system
appearance. Ink is the accent. Rust marks the brand, the composer's controls
and the focus bar. The product's name reads Astrolabe everywhere a person sees it,
including server and provider messages, and the hosted relay service is called
**Remote access**. The rules for what is renamed and what keeps upstream's
spelling live in
[docs/operations/astrolabe-identity.md](../../../../docs/operations/astrolabe-identity.md).

## Sub-features

- Default theme `mercurian`, and the Mercurian card leads Settings → Appearance.
  The `iris` theme is hidden from the picker (left out of its maintainer list
  in `ThemeSettings.tsx`; the command palette and mobile hide it through
  `PICKER_HIDDEN_THEME_IDS`).
- Light and dark halves of the theme follow `prefers-color-scheme` by default.
- The composer's primary button draws Astrolabe's own Send, Queue, Steer and
  Stop icons (`components/brand/ComposerControlIcons.tsx`) on
  `bg-message-action`.
- Mercurian's `focusBar` role is rust (`#a0492a` light, `#d4774f` dark): the bar
  on the focused place's tab in front, through `--focus-bar` (its behaviour is in
  keyboard-nav.md). The theme editor shows it as the **Focus bar** row
  (`[data-theme-color-role=focusBar]`, under Brand & content, with Advanced on).
  The editor paints its draft on the live app, so the bar changes as the row is
  edited.
- The page title reads "Astrolabe (Alpha)" while booting and "Astrolabe (Dev)" once loaded in dev
  (a server version can set another stage label). Brand marks and the
  wordmark appear on the boot screen and the welcome wizard, and the monogram heads the icon rail.
  The monogram also replaces T3's glyph in the chat timeline: on the plain "Created thread" row
  (`components/chat/V2LifecycleRow.tsx`) and as the `t3-code` work-log icon for thread-create
  tools and system notifications (`WorkEntryIcon` in `components/chat/TimelineToolActivityIcon.tsx`).
- **Visible names**: client, server and provider text says Astrolabe, and the
  relay service is Remote access. The allowed exceptions are the "T3 Code"
  theme card and links to upstream's own app-store builds.

## How to get to it (user POV)

Theme: **Settings** (icon rail, or the sidebar footer on narrow windows; the account
menu's Settings row where sign-in is configured) →
**Appearance**, or the Command Palette's **Change theme** (Cmd+P, then type
"theme"), which Cmd+Alt+A (`theme.select`) opens directly. Both lists lead with
Mercurian, then T3 Code, and leave out Iris. Focus bar color: Appearance →
**Create theme** (or a card's **Duplicate**) opens the theme editor → turn on
**Advanced** if it is off → Brand & content → **Focus bar**.

Branding: the wordmark on the boot screen and the welcome wizard, then the
monogram tile heading the icon rail (`[data-app-rail-mark]`). The sidebar's
title-bar row holds no wordmark, and narrow windows (under 768px) have no rail,
so their chrome shows no mark.

## Driving it with the Browser panel

```
preview_evaluate   document.documentElement.dataset.themeId        // "mercurian"
preview_set_appearance  colorScheme=dark
preview_evaluate   document.documentElement.classList.contains('dark')  // true
preview_set_appearance  colorScheme=system
preview_navigate   target={kind:'environment-port', port:<webPort>, path:'/settings/appearance'}
preview_wait_for   text=Mercurian
preview_evaluate   [...document.querySelectorAll('[data-theme-library-card]')].map(e => e.dataset.themeLibraryCard)
preview_click      role=button[name='Duplicate Mercurian']        // the editor opens with Advanced on
preview_wait_for   role=textbox[name='Focus bar hex value']
preview_click      role=button[name='Close the theme editor']
preview_press      key=a  modifiers=["Meta","Alt"]                // opens Change theme
```

**Proof:** `themeId` is `mercurian` on a fresh incognito profile, and the
`dark` class follows the emulated scheme. The cards read `mercurian`, `default`
(T3 Code), `t3-chat`, `grove`, `ocean`, `ember`, with no `iris`; screenshot the
grid. The **Focus bar hex value** field reads `#a0492a` on the light half. The
Change theme list starts Mercurian, T3 Code, with no Iris (Escape closes it).

The composer's primary button is ink (`bg-message-action`) with a rust centre
dot. Insert a character in the composer first (`[data-testid=composer-editor]`,
as vim-mode.md does): the empty composer's button is disabled with
`pointer-events: none`, which `elementFromPoint` skips. Then
`document.elementFromPoint` at the centre of `button[aria-label="Submit message"]`
returns that button, its `backgroundColor` is not transparent, and its
`svg circle` has a computed `fill` of `rgb(160, 73, 42)` (`--pivot`, which is
`--brand-rust` `#a0492a`). Reading `--pivot` alone does not prove the dot
paints, so save a screenshot of the button.

The rail monogram is aria-hidden mask spans, absent from the accessibility
snapshot. On a window 768px or wider, `elementFromPoint` at the centre of
`nav[aria-label="Sections"] [data-app-rail-mark]` lands inside it, and its rust
layer (`[data-app-rail-mark] > span > span:last-child`) has a `backgroundColor`
of `rgb(160, 73, 42)` and a `maskImage` (in dev Vite inlines the small rust layer as a
`data:image/svg+xml` URI, so don't match on its file name).
`document.title` contains "Astrolabe".
On Settings → Connections and the account dialog,
`/T3 Connect|T3 Code settings/.test(document.body.innerText)` is `false`.

For the source side of visible names, run the `git grep` under "After each
sync" in the identity doc; don't copy it here, so there is one place to update.

## Gotchas

- Use the `incognito` profile. The default profile may hold a theme the user
  picked, which hides the default.
- Server and provider text (for example "Pi is disabled in Astrolabe
  settings.") says Astrolabe too. "T3 Code" there is a missed rename unless it
  comes from a stock T3 server you connected to.
- The picker hides Iris by leaving it out of `ThemeSettings.tsx`'s list, not through
  `PICKER_HIDDEN_THEME_IDS` (which the command palette and mobile use). An
  ordering change has to hold in `ThemeSettings.tsx` and in the palette's
  `useThemeCards` (`CommandPaletteThemeItems.tsx`).
- `apps/web/index.html` keeps its own copy of the default theme and palette for the
  boot screen, `index.css` holds the rust pivot rule, `branding.ts` the name and
  title. A sync conflict in any of them walks this feature.
- The marks are the branding repository's masters.
  `node scripts/sync-brand-marks.ts <branding-repo>` copies them into
  `apps/web/src/assets/brand`, the boot screen's `apps/web/public/brand`, the
  mobile layers and the Icon Composer layers under `assets/`; re-run it rather
  than editing the SVGs by hand. Any mark 48px tall or less uses the small
  drawing (`AstrolabeMarkSmall`, `AstrolabeWordmark small`).
- The theme also feeds mobile's generated palettes. A change to
  `packages/shared/src/mercurianTheme.ts` needs a mobile pass via test-t3-mobile.
