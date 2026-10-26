---
title: Licenses
description: Which license covers which part of Astrolabe, the third-party software inside it, and the sources of this website's art and fonts.
updated: October 23, 2026
---

Astrolabe is open source. This page explains which license covers which part, what Astrolabe is built on, and where this website's pictures and fonts come from. It is a summary. The license files in the repository are what count.

## The Astrolabe app: MIT

Astrolabe's repository is licensed under the [MIT License](https://opensource.org/license/mit), apart from the four directories in the next section and files that carry their own license notice, such as code copied in from other projects. The MIT License covers the desktop, web and mobile apps, the command-line server, and the shared packages they use.

You may use, copy, change and redistribute it, for any purpose, as long as you keep the copyright and license notice.

[PENDING: astrolabe/licensing] The repository's license file names two copyright holders:

- Copyright (c) 2026 Mercurian, Inc.
- Copyright (c) 2026 T3 Tools Inc.

## The hosted backend: FSL-1.1-MIT

[PENDING: astrolabe/licensing] The code that runs our hosted services is licensed under the [Functional Source License, Version 1.1, MIT Future License](https://fsl.software/) (FSL-1.1-MIT), copyright Mercurian, Inc. It lives in four directories:

- `apps/cloud`: the account and workspace service;
- `apps/auth`: the sign-in pages;
- `apps/admin`: our waitlist administration;
- `infra/cloud`: the infrastructure that deploys them.

In plain terms:

- **You can read it, run it, change it and share it** for any purpose except a competing use. Internal use, non-commercial education and research, and professional services for someone who uses it under the license are all allowed.
- **A competing use** means making it available to others in a commercial product or service that substitutes for it, or for a Mercurian product or service built on it, or that offers the same or substantially similar functionality.
- **After two years, each version becomes MIT.** Two years after we release a version, that version is also available under the MIT License, with no competing-use limit.

## Built on T3 Code

Astrolabe is built on [T3 Code](https://github.com/pingdotgg/t3code), made by T3 Tools Inc. and released under the MIT License. We keep its copyright notice, as that license requires.

Astrolabe is a separate product made by Mercurian. T3 Tools Inc. doesn't make, support or endorse it. T3 Code's name and logos belong to T3 Tools Inc.

## Trademarks

The names Astrolabe and Mercurian, and the Astrolabe wordmark, monogram and symbol, are trademarks of Mercurian, Inc. The open-source licenses cover code, not these names and marks.

If you publish a fork, give it its own name and logo. You may say truthfully that it is based on Astrolabe. [DECISION: trademark policy, proposed: publish a short policy that allows "based on Astrolabe" and forbids using the names or marks for forks and hosted services]

## Third-party software

Astrolabe includes open-source packages from many authors, under their own licenses, such as MIT, Apache 2.0, BSD and ISC. Every build lists each package, its version and its license:

- **Desktop and web:** Settings → General → Open source licenses.
- **Mobile:** Settings → About → Open source licenses.

[DECISION: public location for the third-party notices file, proposed: publish the same `third-party-licenses.json` that each build ships at astrolabe.sh/licenses/third-party-licenses.json with every release] Until then, the in-app list is the reference.

Not everything Astrolabe ships is open source. The server includes Anthropic's Claude Agent SDK, which brings Claude Code with it. Anthropic reserves all rights in it, and its use is subject to [Anthropic's legal agreements](https://code.claude.com/docs/en/legal-and-compliance). Those terms, not the MIT License, apply to it.

## This website

The text, layout and code of this website are part of the Astrolabe repository. Its pictures and fonts come from these sources.

[DECISION: license for the site's own artwork and brand marks, proposed: all rights reserved, and a note in apps/landing saying the art isn't covered by the repository's MIT License]

### The Sphinx Observatory

The print of the Sphinx Observatory on the Jungfraujoch is made from a [photograph by Roy Egloff](https://commons.wikimedia.org/wiki/File:CH.BE.Grindelwald_2021-04-20_Jungfraujoch_Sphinx-Observatory.jpg), published on Wikimedia Commons under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0). We inpainted it, derived its shape, tone and line drawings from it, and print it lit by the astrolabe's sun.

Because the license requires it, our prints of it (the files in `/assets/art/sphinx/`) are also licensed under CC BY-SA 4.0. You may reuse them under that license, crediting Roy Egloff and this site.

### Mercury

The planet's terrain throughout this site, including the footer's Beethoven basin, is drawn from the [Mercury MESSENGER Global DEM 665m](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m) (version 2), published by the USGS Astrogeology Science Center. It was made by Kris Becker and colleagues from NASA's MESSENGER mission data, with NASA, Arizona State University, the Johns Hopkins Applied Physics Laboratory and the Carnegie Institution for Science. See Becker et al., "First global digital elevation model of Mercury", 47th Lunar and Planetary Science Conference, 2016.

The USGS treats data it produces as being in the U.S. public domain, and asks users to cite the authors. [VERIFY: the product page states no license, and the elevation model has co-originators outside the USGS; confirm its public-domain status with USGS Astrogeology before relying on it]

The names of features around the Beethoven basin come from the [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/), which the USGS Astrogeology Science Center maintains for the International Astronomical Union's Working Group for Planetary System Nomenclature, with NASA support. [VERIFY: the gazetteer states no terms of use; we use its names and positions as factual reference data]

### Jaipur's Great Samrat Yantra

The sundial on the closing globe is our own reconstruction of the Great Samrat Yantra at Jantar Mantar, Jaipur. We modelled it from published measurements and drawings, chiefly UNESCO's World Heritage nomination dossier 1338 and M. N. Ashish Ganju's 1985 plans and elevations. No photographs or drawings by others appear in the finished art.

### Fonts

- **Fraunces**, copyright 2020 The Fraunces Project Authors ([github.com/undercasetype/Fraunces](https://github.com/undercasetype/Fraunces)).
- **IBM Plex Sans**, copyright 2019 IBM Corp., and **IBM Plex Mono**, copyright 2017 IBM Corp.

Both families are licensed under the [SIL Open Font License, Version 1.1](https://openfontlicense.org/). The license texts are served with the fonts: [Fraunces](/assets/fonts/OFL-Fraunces.txt) and [IBM Plex](/assets/fonts/OFL-IBM-Plex.txt).

## More

- [Privacy Policy](/privacy-policy)
- [Terms of Service](/terms-of-service)
