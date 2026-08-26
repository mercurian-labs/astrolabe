# Technical Plan — M-172: Marketing hero — Mercury in stone, and the positioning

Generated from the Goal/AC of Linear issue M-172. Goal in one sentence: the landing page opens on
Mercurian's identity — the still Mercury globe in its original neutral stone/taupe coloring plus a
positioning statement in the design's own words — with no waitlist and no upstream branding anywhere
on the site.

Baseline: everything in `docs/project/technical-plan-m-171-marketing-site-foundation.md` holds —
`apps/landing` exists (Astro 7, React islands, web-app tokens via `src/styles/global.css`), and this
issue builds on `main` after PR #76. Design source: the almagest notes **Marketing Site** (hero =
"the site's one expressive brand moment … the rendered Mercury globe … paired with the product's
name and its positioning statement"; resolved: the still poster, neutral stone/taupe, no waitlist)
and **Visual Language** (expressive brand moments are rare so working surfaces stay quiet).

## Conventions Detected

- **The landing page is `apps/landing/src/pages/index.astro`** — currently the M-171 static
  placeholder (site name + demo link) rendered through `src/layouts/Base.astro`, which imports the
  web app's tokens and sets `bg-background text-foreground`. High.
- **Static pages ship zero JS, enforced** — `apps/landing/scripts/assert-static.mjs` fails the build
  if `dist/index.html` contains `<script`. The hero is a still image + text, so this issue keeps the
  guard exactly as is (the guard is re-scoped later by M-173/M-174 when islands land on the index —
  not here). High.
- **Semantic Tailwind utilities from the shared `index.css`** are the styling vocabulary
  (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, …), per the M-171
  pages. High.
- **Poster asset provenance** — the neutral stone poster is the prototype repo's
  `public/mercury-globe-poster.png` (1920×1080 RGBA, 598,345 bytes; generated from the USGS MESSENGER
  DEM by that repo's `scripts/prepare-mercury-assets.mjs`; the gold recolor is a different file that
  is deliberately NOT carried over). The asset and its provenance JSON have been placed by hand at
  `apps/landing/public/mercury-globe-poster.png` and
  `apps/landing/public/mercury-elevation-metadata.json` (outside the implementation sandbox, which
  cannot reach the prototype repo). Untracked as of this plan; the implementation commit picks them
  up. High.

## Design

**One page changes.** `src/pages/index.astro` becomes the hero. No new dependencies, no new islands,
no config changes — this is a static composition:

- **Layout**: a full-viewport (`min-h-screen`) hero. Text block (name + positioning) vertically
  centered, left-aligned on wide viewports with the globe poster occupying the right half
  (prototype precedent: globe offset right of center); on narrow viewports the globe sits above or
  behind-faded and the text stacks. Use plain flex/grid with the semantic utilities — no new CSS
  files.
- **The globe**: `<img src="/mercury-globe-poster.png">` with `alt` text naming it (e.g. "Mercury,
  rendered from MESSENGER elevation data"), `loading="eager"`, explicit `width`/`height` (1920/1080)
  to avoid layout shift. It is a still; nothing about it animates, no parallax, no fade-in.
- **The words** (pinned — do not invent copy; these derive from the vault's canonical language):
  - Page `<title>`: `Mercurian`
  - `<h1>`: `Mercurian`
  - Positioning statement (one line, prominent): `Mercurian turns engineering issues into plans.`
  - Supporting line (muted, smaller): `Every plan is a version-controlled artifact you and an
assistant evolve together — grounded in your connected repositories, implemented through
coding sessions.`
- **What stays**: the quiet link to `/demo/checkpoint-graph/` remains for now, restyled small and
  muted below the supporting line (M-174 owns the page's final composition and close; the link's
  fate belongs there). The demo page itself is untouched.
- **What must not exist** (AC): any waitlist or signup form (there is none today — keep it that
  way), and any upstream/T3 branding, copy, links, or assets anywhere under `apps/landing/` (today's
  only branding is the "Astrolabe" title — replace with Mercurian; verify nothing else with a grep
  for `t3`/`T3` over `apps/landing/src` and `dist`).

Why "Mercurian" and not "Astrolabe": the vault's root note names the product Mercurian; Astrolabe is
the app. The marketing site markets the product (Marketing Site note speaks of "the product's name").
The M-171 placeholder title said Astrolabe; this issue corrects it.

## Implementation Checklist

- [ ] Rewrite `src/pages/index.astro` as the hero per the Design section, using the pinned copy
      verbatim. Update `Base.astro` only if the title plumbing needs it (it already takes a `title`
      prop — pass `Mercurian`).
- [ ] Reference the hand-placed `public/mercury-globe-poster.png` (do not re-download, regenerate,
      or recolor it; do not bring the gold variant).
- [ ] No new dependencies, no changes to `astro.config.mjs`, `tsconfig.json`, the guard script, CI,
      root scripts, or anything under `apps/web/` / `apps/marketing/`.
- [ ] Grep `apps/landing/src` for `t3`, `T3`, `t3tools` (package name `@t3tools/landing` in
      `package.json` is fenced by ADR 004 and is NOT visitor-facing — it stays), and `Astrolabe`;
      the built pages must carry none of them.

## Test Plan

- [ ] `node_modules/.bin/vp run build:landing` passes — including the unchanged `assert-static.mjs`
      guard (hero adds no scripts).
- [ ] `node_modules/.bin/vp run --filter @t3tools/landing typecheck`, `vp lint`, `vp fmt --check`
      pass.
- [ ] Built `dist/index.html` contains: `Mercurian` as title and h1, the positioning statement
      verbatim, the poster `<img>`; and does NOT contain `<script`, `waitlist`, `T3`, or `Astrolabe`.
- [ ] Browser walk: hero renders calm on load (no animation, no motion), globe is the neutral
      stone/taupe poster (not gold), text legible at desktop and mobile widths.
