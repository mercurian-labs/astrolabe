# @mercurian/landing

The Astrolabe landing page, an Astro app. It is the `drafting/` page of the
`astrolabe-site` repository (`~/dev/mercurian/astrolabe-site`, ported at `86f2338`, with the hero print from `25861ca`), rebuilt one to one:
the same markup, styles and scripts, split into a layout and one component per section.

```sh
vp run --filter @mercurian/landing dev       # http://127.0.0.1:4174 (PORT overrides)
vp run --filter @mercurian/landing build     # dist/
vp run --filter @mercurian/landing typecheck # astro check
```

## How it is put together

- `src/pages/index.astro` lists the sections in order; each is a component in `src/components/`.
  `src/layouts/Layout.astro` holds the head, the icon sprite and the page frame.
- `src/styles/drafting.css` is the page's stylesheet, global and unchanged apart from asset paths.
- `src/scripts/` holds the page's vanilla modules. `drafting.js` runs the page's motion (loaded by the
  layout); `relight.js` and `instrument.js` run the working astrolabe in [02] and its relit ground
  (loaded by `Value.astro`, in that order, because the ground listens for the instrument's
  `astrolabe:time` events). `sky.js`, `places.js` and `twilight.js` are the maths they import.
  `footer.js` prints the footer's night band and runs its naming lens (loaded by `Footer.astro`).
- The astrolabe is the page's light switch: `twilight.js` sets the whole page's palette (and the drawn
  app's light or dark theme) from its sun. `sky-boot.js` sets it for the real sky before the first
  paint; the layout inlines it with the three maths modules. `node scripts/twilight-contrast.mjs`
  reports the text's contrast at every quarter degree.
- `src/pages/relight-test.astro` is the closing section's test bench (`/relight-test/`).
- `/privacy-policy`, `/terms-of-service` and `/licenses` are the paths the apps link to. Their text is
  Markdown in `src/content/legal/`, kept plain so counsel can review it as text; `Legal.astro` renders
  it with a contents list and the draft notice, and marks each `[DECISION: …]`, `[PENDING: …]` and
  `[VERIFY: …]` it finds so they can be scanned. The pages are `noindex` while they are drafts.
- Everything in `public/` is copied from astrolabe-site under the same names, so a new render drops in
  by copying the file over.

The page takes `?t=2026-10-21T21:30&tz=America/New_York` to fix the moment and place, and with them
its light. The bench
also takes `?gl=0` to show the static print that stands in without WebGL.

## Where the art comes from

`public/assets/art/CREDITS.md` records each picture's source and license, including the CC BY-SA
Sphinx prints; update it with any new asset.

The rasters and the static instrument are rendered by Python scripts that stay in astrolabe-site
(`scripts/`, with numpy, scipy, scikit-image, tifffile and Pillow, `cwebp` on the path, and the
Mercury DEM from the branding repository or `MERCURY_DEM`). Regenerate there, then copy the files in:

| File in `public/assets/art/`                                                            | Made by                                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `print-wide-{light,olive}.webp`, `print-tall-{light,olive}.webp`                        | `python scripts/render-art.py print-wide print-tall` (the hero print)                                   |
| `hero-twoink-light.webp`, `hang-twoink-light.webp`, `astro-plate.webp`                  | `python scripts/render-art.py`                                                                          |
| `close-relief.{webp,json}`, `close-relief-{dark,light,olive}.webp`                      | `python scripts/render-relight.py`                                                                      |
| `jaipur-balanced-{ground-day,ground-night,olive,body,building-day,building-night}.webp` | `scripts/samrat/blender_render.py -- jaipur-balanced`, then `scripts/samrat/closing.py jaipur-balanced` |
| `astrolabe-static.svg`                                                                  | `python scripts/render-instrument.py`, then `python scripts/bake-static-instrument.py`                  |

```sh
SITE=~/dev/mercurian/astrolabe-site
cp $SITE/assets/art/print-{wide,tall}-{light,olive}.webp apps/landing/public/assets/art/
```

The closing invitation defaults to a reconstruction of Jaipur's Great Samrat Yantra on Mercury.
`?close=limb` restores the previous globe for comparison. Its six static masks use the existing
astrolabe-driven page palette, with separate building and terrain contrast. The building retains
Jaipur's approximately 27° slope regardless of the fictional Mercury site. Source measurements,
estimated details and regeneration commands live in astrolabe-site's `scripts/samrat/SOURCES.md`;
this is a documented architectural illustration, not a survey model or a live sundial simulation.

The footer's ground (`public/assets/footer/`) is the footer lab's (astrolabe-site `lab/footer/`, variant 4,
the naming lens, at `4aedcc0`): Beethoven basin cut from the MESSENGER DEM, and the named features
around it from the IAU Gazetteer of Planetary Nomenclature.

| File in `public/assets/footer/` | Made by                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `terrain.webp`, `terrain.json`  | `python scripts/lab/render-footer-terrain.py` (the height as 16 bits, and the view that turns a pixel into latitude and longitude)                                                                                             |
| `terrain-{light,olive}.webp`    | the same script (the static print's grain masks, fetched only without WebGL)                                                                                                                                                   |
| `features.json`                 | `python3 -I scripts/lab/gazetteer.py MERCURY_nomenclature_center_pts.dbf lab/footer/terrain.json lab/footer/features.json`, from the gazetteer's shapefile attribute table at https://planetarynames.wr.usgs.gov/GIS_Downloads |

```sh
cp $SITE/lab/footer/{terrain,features}.json $SITE/lab/footer/assets/terrain{,-light,-olive}.webp apps/landing/public/assets/footer/
```

Re-cutting the crop (`SPEC` in the terrain script) needs `features.json` regenerated against the new
`terrain.json`, and a new sun there needs `SUN` in `footer.js` to match its `REST_SUN`.

Brand marks (`public/assets/brand/`) come from the branding repository's `identity/`, and the fonts
(`public/assets/fonts/`, with their SIL Open Font License texts) from astrolabe-site's `assets/fonts/`.
