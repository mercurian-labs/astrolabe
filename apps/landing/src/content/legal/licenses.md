---
title: Licenses
description: Which license covers which part of Astrolabe, the third-party software inside it, and the sources of this website's art and fonts.
updated: October 26, 2026
---

Astrolabe is open source. This page explains which license covers which part, what Astrolabe is built on, and where this website's pictures and fonts come from. It is a summary. The license files in the [repository](https://github.com/mercurian-labs/astrolabe) are what count; [LICENSING.md](https://github.com/mercurian-labs/astrolabe/blob/main/LICENSING.md) gives the details.

## The Astrolabe app: MIT

Astrolabe's repository is licensed under the [MIT License](https://github.com/mercurian-labs/astrolabe/blob/main/LICENSE), apart from the four directories in the next section and files that carry their own license notice, such as code copied in from other projects. The MIT License covers the desktop app, the web app, the command-line server and the shared packages they use.

You may use, copy, change and redistribute it, for any purpose, as long as you keep the copyright and license notice. The license file names two copyright holders:

- Copyright (c) 2026 Mercurian, Inc.
- Copyright (c) 2026 T3 Tools Inc.

## The cloud backend: FSL-1.1-MIT

Four directories hold the code for hosted services Mercurian plans to run, such as accounts and workspaces. Mercurian doesn't offer those services yet, and the software you download doesn't need them. That code is licensed under the [Functional Source License, Version 1.1, MIT Future License](https://fsl.software/) (FSL-1.1-MIT), copyright Mercurian, Inc.:

- `apps/cloud`: the account and workspace service;
- `apps/auth`: the sign-in pages;
- `apps/admin`: the administration console;
- `infra/cloud`: the infrastructure that deploys them.

In plain terms:

- **You can read it, run it, change it and share it** for any purpose except a competing use. Internal use, non-commercial education and research, and professional services for someone who uses it under the license are all allowed.
- **A competing use** means making it available to others in a commercial product or service that substitutes for it, or for a Mercurian product or service built on it, or that offers the same or substantially similar functionality.
- **After two years, each version becomes MIT.** Two years after we make a version available, it is also available under the MIT License, with no competing-use limit.

## Built on T3 Code

Astrolabe is built on [T3 Code](https://github.com/pingdotgg/t3code), made by T3 Tools Inc. and released under the MIT License. We keep its copyright notice, as that license requires.

Astrolabe is a separate product made by Mercurian. T3 Tools Inc. doesn't make, support or endorse it. T3 Code's name and logos belong to T3 Tools Inc.

## Trademarks

The names Astrolabe and Mercurian, and the Astrolabe wordmark, monogram and symbol, are trademarks of Mercurian, Inc. The open-source licenses cover code, not these names and marks. If you publish a fork, give it its own name and logo; you may say truthfully that it is based on Astrolabe. The [trademark policy](https://github.com/mercurian-labs/astrolabe/blob/main/TRADEMARKS.md) has the details.

## Third-party software

Astrolabe includes open-source software from many authors, under their own licenses, such as MIT, Apache 2.0, BSD and ISC. Each build lists every package, its version and its license, with the license text, in **Settings → General → Open source licenses**. The desktop app, the command-line downloads and the npm package also carry Astrolabe's own license file.

Not everything Astrolabe ships is open source. The server includes Anthropic's Claude Agent SDK, which is subject to [Anthropic's legal agreements](https://code.claude.com/docs/en/legal-and-compliance), and Cursor's SDK, which is subject to [Cursor's terms](https://cursor.com/terms-of-service). Those terms, not the MIT License, apply to them.

## This website

The text, layout and code of this website are part of the Astrolabe repository. Its pictures and fonts come from these sources.

The site's own artwork, and the brand marks, are Mercurian's, and all rights in them are reserved, except where a section below says otherwise.

### The Sphinx Observatory

The print of the Sphinx Observatory on the Jungfraujoch is adapted from "[CH.BE.Grindelwald 2021-04-20 Jungfraujoch Sphinx-Observatory](https://commons.wikimedia.org/wiki/File:CH.BE.Grindelwald_2021-04-20_Jungfraujoch_Sphinx-Observatory.jpg)", a photograph by Roy Egloff, licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0). We changed it: we painted out the visitors, the flag and a mast, cropped it, faded the rock to paper, derived shape, tone and line drawings from it, and print it lit by the astrolabe's sun.

Our adaptations are licensed under CC BY-SA 4.0 too. They are the files in `/assets/art/sphinx/` and the Sphinx share cards (`/og/card-sphinx.jpg` and `/og/card-sphinx-day.jpg`). You may reuse them under that license if you credit Roy Egloff and this site and say what you changed.

### The Pic du Midi Observatory

The print of the Pic du Midi Observatory in the Pyrenees is adapted from "[Observatoire du Pic du Midi 2022](https://commons.wikimedia.org/wiki/File:Observatoire_du_Pic_du_Midi_2022.jpg)", a photograph by GoginkLobabi, licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0). We changed it: we painted out the cable-car cables, the visitors, a crane, a flag and the terrace netting, cut the summit from the sky, faded its rock to paper, derived shape, tone and line drawings from it, and print it lit by the astrolabe's sun.

Our adaptations are licensed under CC BY-SA 4.0 too. They are the files in `/assets/art/picdumidi/`. You may reuse them under that license if you credit GoginkLobabi and this site and say what you changed.

### The New Technology Telescope at La Silla

The print of ESO's New Technology Telescope at La Silla is adapted from "[La Silla](https://www.eso.org/public/images/jfs-ls-2011_8538/)", a photograph by ESO/José Francisco Salgado (josefrancisco.org), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). We changed it: we cut the telescope and its rock from the sky, faded the rock to paper, derived shape, tone and line drawings from it, and print it lit by the astrolabe's sun. The files are in `/assets/art/lasilla/`.

### Gemini North

The print of the Gemini North telescope on Maunakea is adapted from "[Gemini North in Snow (CFHT Gemini-CC)](<https://commons.wikimedia.org/wiki/File:Gemini_North_in_Snow_(CFHT_Gemini-CC).jpg>)", a photograph by International Gemini Observatory/NOIRLab/NSF/AURA, licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). We changed it: we painted out a marker block, two posts, a weather tower and an object at the edge, cut the summit from the sky, faded its slopes to paper, derived shape, tone and line drawings from it, and print it lit by the astrolabe's sun. The files are in `/assets/art/gemini/`.

### Mercury

The planet's terrain throughout this site, including the footer's Beethoven basin, is drawn from the [Mercury MESSENGER Global DEM 665m](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m) (version 2), published by the USGS Astrogeology Science Center. It was made by Kris Becker and colleagues from NASA's MESSENGER mission data, with NASA, Arizona State University, the Johns Hopkins Applied Physics Laboratory and the Carnegie Institution for Science. See Becker et al., "First global digital elevation model of Mercury", 47th Lunar and Planetary Science Conference, 2016. The USGS places no constraints on its use and asks users to cite the authors.

The names of features around the Beethoven basin come from the [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/), which the USGS Astrogeology Science Center maintains for the International Astronomical Union's Working Group for Planetary System Nomenclature, with NASA support.

### The astrolabe

The instrument is drawn from first principles, the way real astrolabes were made, not traced from a museum object or a photograph. Its star positions and the formulae for the sun's position are public astronomical data.

### The agents' marks

The marks beside Codex, Claude Code, Cursor, Grok, OpenCode and Antigravity belong to OpenAI, Anthropic, Anysphere, xAI, the OpenCode project and Google. We show them only to name the tools Astrolabe works with, printed in the page's ink, and no license here covers them.

### Fonts

- **Fraunces**, copyright 2018 The Fraunces Project Authors ([github.com/undercasetype/Fraunces](https://github.com/undercasetype/Fraunces)).
- **IBM Plex Sans**, copyright 2019 IBM Corp., and **IBM Plex Mono**, copyright 2017 IBM Corp., with Reserved Font Name "Plex".

Both families are licensed under the [SIL Open Font License, Version 1.1](https://openfontlicense.org/). The license texts are served with the fonts: [Fraunces](/assets/fonts/OFL-Fraunces.txt) and [IBM Plex](/assets/fonts/OFL-IBM-Plex.txt).

## More

- [Privacy Policy](/privacy-policy)
- [Terms of Service](/terms-of-service)
