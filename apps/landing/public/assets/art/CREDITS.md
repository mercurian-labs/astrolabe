# Art credits and licenses

Where each picture on the landing site comes from, and the license it is under. The site's
Licenses page (`src/content/legal/licenses.md`) says the same in prose. Add a row here whenever an
asset is added or re-sourced.

The repository's MIT License does not cover these files. Mercurian's own art and the brand marks
are all rights reserved unless a row says otherwise. (DECISION pending, the same one as in
`LICENSING.md` and the Licenses page: whether art and marks are excluded from the MIT License.)

## `assets/art/`

| File | Source | License |
| --- | --- | --- |
| `sphinx/*.webp` (duotone, geometry, lines, outline, still-ink, still-olive, tone) | Derived from [a photograph by Roy Egloff](https://commons.wikimedia.org/wiki/File:CH.BE.Grindelwald_2021-04-20_Jungfraujoch_Sphinx-Observatory.jpg), Wikimedia Commons, by astrolabe-site's `scripts/observatories/` (inpainted, then shape, tone and line passes). | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as the source requires. Credit: Roy Egloff. The page credits it under the plate. |
| `picdumidi/*.webp` (duotone, geometry, lines, outline, still-ink, still-olive, tone) | Derived from [a photograph by GoginkLobabi](https://commons.wikimedia.org/wiki/File:Observatoire_du_Pic_du_Midi_2022.jpg), Wikimedia Commons, by astrolabe-site's `scripts/observatories/` (cable-car cables, visitors, a crane, a flag and the terrace netting inpainted, the summit isolated from the sky, then shape, tone and line passes). | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as the source requires. Credit: GoginkLobabi. The page credits it under the plate. |
| `lasilla/*.webp` (duotone, geometry, lines, outline, still-ink, still-olive, tone) | Derived from ["La Silla"](https://www.eso.org/public/images/jfs-ls-2011_8538/), a photograph of the New Technology Telescope by ESO/José Francisco Salgado (josefrancisco.org), by astrolabe-site's `scripts/observatories/` (the telescope and its rock isolated from the sky, the rock faded to paper, then shape, tone and line passes). | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: ESO/José Francisco Salgado (josefrancisco.org). The page credits it under the plate. |
| `gemini/*.webp` (duotone, geometry, lines, outline, still-ink, still-olive, tone) | Derived from ["Gemini North in Snow (CFHT Gemini-CC)"](https://commons.wikimedia.org/wiki/File:Gemini_North_in_Snow_(CFHT_Gemini-CC).jpg), Wikimedia Commons, from [NOIRLab](https://noirlab.edu/public/images/CFHT_Gemini-CC/), by astrolabe-site's `scripts/observatories/` (a marker block, two posts, a weather tower and an object at the edge inpainted, the summit isolated from the sky, then shape, tone and line passes). | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: International Gemini Observatory/NOIRLab/NSF/AURA. The page credits it under the plate. |
| `../../og/card-sphinx.jpg`, `../../og/card-sphinx-day.jpg` | Share cards built on the Sphinx print above, with the Astrolabe wordmark. | CC BY-SA 4.0, as adaptations of the photograph. Credit: Roy Egloff. |
| `print-wide-{light,olive}.webp`, `print-tall-{light,olive}.webp`, `astro-plate.webp` | Rendered by astrolabe-site's `scripts/render-art.py` from the Mercury MESSENGER Global DEM 665m v2 (below). | Mercurian's rendering; the DEM's terms below apply to the data. |
| `close-relief.{webp,json}`, `close-relief-{dark,light,olive}.webp` | astrolabe-site's `scripts/render-relight.py`, from the same DEM. | As above. |
| `hemisphere.{webp,json}`, `hemisphere-{dark,light,olive}.webp` | astrolabe-site's `scripts/render-hemisphere.py`, from the same DEM. | As above. |
| `astrolabe-static.svg` | astrolabe-site's `scripts/render-instrument.py` and `bake-static-instrument.py`. | Mercurian's own work. |

## `assets/footer/`

| File | Source | License |
| --- | --- | --- |
| `terrain.{webp,json}`, `terrain-{light,olive}.webp` | Beethoven basin cut from the Mercury MESSENGER Global DEM 665m v2 by astrolabe-site's `scripts/lab/render-footer-terrain.py`. | Mercurian's rendering; the DEM's terms below apply to the data. |
| `features.json` | Feature names and positions from the IAU [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) (Mercury shapefile, GIS downloads), trimmed by astrolabe-site's `scripts/lab/gazetteer.py`. | The gazetteer states no terms of use. Used as factual reference data. VERIFY. |

## The Mercury elevation model

[Mercury MESSENGER Global DEM 665m](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m),
v2 (`Mercury_Messenger_USGS_DEM_Global_665m_v2.tif`), published by the USGS Astrogeology Science
Center. Originators: Kris Becker, NASA, Arizona State University, the Johns Hopkins Applied Physics
Laboratory and the Carnegie Institution for Science. Cite as Becker, K. J., et al. (2016), "First
global digital elevation model of Mercury", 47th Lunar and Planetary Science Conference.

The product page lists "Access constraints: None" and "Use constraints: Please cite authors", and
states no license. The USGS says data it authors or produces is in the U.S. public domain
(usgs.gov, "Copyrights and Credits"). VERIFY: confirm with USGS Astrogeology that this applies to a
product with non-USGS co-originators.

## Fonts (`assets/fonts/`)

| File | Font | Copyright (from the font's name table) | License |
| --- | --- | --- | --- |
| `fraunces.woff2` | Fraunces, variable | 2020 The Fraunces Project Authors (`OFL-Fraunces.txt` says 2018) | SIL OFL 1.1, `OFL-Fraunces.txt` |
| `plex-sans.woff2` | IBM Plex Sans | 2019 IBM Corp. | SIL OFL 1.1, `OFL-IBM-Plex.txt` |
| `plex-mono-400.woff2`, `plex-mono-500.woff2` | IBM Plex Mono | 2017 IBM Corp. | SIL OFL 1.1, `OFL-IBM-Plex.txt` |

IBM Plex Mono's license reserves the font name "Plex" (IBM's own notice, in `OFL-IBM-Plex.txt`), so its files are IBM's own Latin1 web cuts from `@ibm/plex-mono` 2.5.0, unmodified. Fraunces and Plex Sans declare no Reserved Font Name.

## Brand marks (`assets/brand/`)

The Astrolabe wordmark, monogram and symbol, from the branding repository's `identity/`. Trademarks
of Mercurian, Inc. Not licensed for reuse.
