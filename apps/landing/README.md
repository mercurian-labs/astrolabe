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
  layout); `relight.js` and `instrument.js` run the closing astrolabe and its relit ground (loaded by
  `Close.astro`, in that order, because the ground listens for the instrument's `astrolabe:time` events).
  `sky.js`, `places.js` and `twilight.js` are the maths they import.
- `src/pages/relight-test.astro` is the closing section's test bench (`/relight-test/`).
- Everything in `public/` is copied from astrolabe-site under the same names, so a new render drops in
  by copying the file over.

The instrument takes `?t=2026-10-21T21:30&tz=America/New_York` to fix the moment and place. The bench
also takes `?gl=0` to show the static print that stands in without WebGL.

## Where the art comes from

The rasters and the static instrument are rendered by Python scripts that stay in astrolabe-site
(`scripts/`, with numpy, scipy, scikit-image, tifffile and Pillow, `cwebp` on the path, and the
Mercury DEM from the branding repository or `MERCURY_DEM`). Regenerate there, then copy the files in:

| File in `public/assets/art/`                                           | Made by                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `print-wide-{light,olive}.webp`, `print-tall-{light,olive}.webp`       | `python scripts/render-art.py print-wide print-tall` (the hero print)                  |
| `hero-twoink-light.webp`, `hang-twoink-light.webp`, `astro-plate.webp` | `python scripts/render-art.py`                                                         |
| `close-relief.{webp,json}`, `close-relief-{dark,light,olive}.webp`     | `python scripts/render-relight.py`                                                     |
| `astrolabe-static.svg`                                                 | `python scripts/render-instrument.py`, then `python scripts/bake-static-instrument.py` |

```sh
SITE=~/dev/mercurian/astrolabe-site
cp $SITE/assets/art/print-{wide,tall}-{light,olive}.webp apps/landing/public/assets/art/
```

Brand marks (`public/assets/brand/`) come from the branding repository's `identity/`, and the fonts
(`public/assets/fonts/`, with their SIL Open Font License texts) from astrolabe-site's `assets/fonts/`.
