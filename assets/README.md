# Brand icons

The Icon Composer projects are the source of truth for full application icons. Each channel has two:

- `dev/app-icon.icon` and `dev/app-icon-small.icon`
- `nightly/app-icon.icon` and `nightly/app-icon-small.icon`
- `prod/app-icon.icon` and `prod/app-icon-small.icon`

They draw Astrolabe's approved channel tiles from the branding repository's icon package: the alidade A monogram (`mark.svg`) with its rust pivot (`pivot.svg`) on the channel's ground. Production is a warm alabaster gradient and nightly a deep charcoal gradient, both set as the project fill; development is the olive/stone terrain crop (`terrain.png`). The ring around the pivot severs the monogram's lower-left foot on purpose. The layers are flat, with glass, shadow, and translucency off. iOS draws production's dark, tinted, and clear icons on a dark ground, so its mark switches to nightly's light ink in those appearances. Icon Composer derives tinted and clear from the light appearance, not the dark one, so the mark sets both.

`app-icon-small.icon` is the small drawing, with wider needle tips and a larger pivot whose ring is re-cut so the gap survives at device size. The brand draws any mark 48 px or smaller with it, so the exporter uses it for the 16 and 32 px favicons and the 16 to 48 px ICO frames, and the main project from 64 px up. Change both projects together.

The projects' layers come from the branding repository. After the branding package changes, run `node scripts/sync-brand-marks.ts <branding-repo>` and then `vp fmt apps/mobile/src/components/brand/astrolabeMarkLayers.ts`. The script rewrites each project's `mark.svg` and `pivot.svg` from the package's square tiles, and the in-app marks the same way: the web masks in `apps/web/src/assets/brand`, the boot screen's loading wordmark in `apps/web/public/brand`, and the mobile app's layers. Then run the exports below.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

The desktop app needs the classic macOS icon: a 1024×1024 PNG whose opaque body is 824×824, inset 100 pixels on every side. Icon Composer cannot produce it from these projects. Its command-line exporter has no `macOS pre-Tahoe` preset, and in Icon Composer 27.0 the app's own `macOS pre-Tahoe` export is full bleed too. The export script therefore leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

The three macOS PNGs are copied from the branding package, which renders the approved classic tile (`identity/astrolabe/icons/<channel>/macos-1024.png` in the branding repository):

- `development/macos-1024.png` -> `dev/blueprint-macos-1024.png`
- `nightly/macos-1024.png` -> `nightly/nightly-macos-1024.png`
- `production/macos-1024.png` -> `prod/black-macos-1024.png`

Copy them again whenever the branding package changes, and check the 824×824 body before committing.

## Android launcher and splash artwork

Android masks the central 72dp of a 108dp adaptive canvas, and the Android 12+ splash screen masks
the central two thirds of a 288dp canvas, so the Icon Composer exports cannot be used directly:
their rounded-square silhouette gets framed again and the monogram is cropped. The Android artwork
is instead rendered from the main Icon Composer projects by `vp run icons:export:android`:

- `apps/mobile/assets/android-icon-foreground.png` and `-foreground-nightly.png`: the transparent
  monogram and pivot at two thirds of the tile, or smaller where the needle's tips would leave the
  66dp safe circle (their farthest ink sits 2px inside it at 432px, as in the branding package). Development and production
  share the dark ink; nightly draws the light ink.
- `apps/mobile/assets/android-icon-background-dev.png`, `-nightly.png`, and `-prod.png`: the
  full-bleed ground (the development terrain, or the project's gradient fill).
- `apps/mobile/assets/android-icon-mark.png` and `android-notification-icon.png`: white monogram
  silhouettes without the pivot, for Android's monochrome themed icon and the notification icon.
- `apps/mobile/assets/android-splash-icon-*.png`: the two adaptive layers composed into one 288dp
  image, so the splash mask reproduces the launcher icon's framing.

Rerun the export after changing a project's layers or fill.
