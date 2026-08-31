# Technical Plan — M-201: The Try Astrolabe door

**Issue:** M-201 · **Branch:** `venk/m-201-the-try-astrolabe-door-the-button-wears-the-wallpapers-black` · **2026-08-29**

Two refinements, one door: the landing page's single outward control darkens to the desk
wallpaper's ground, and the repository it opens stops introducing itself as T3 Code. The
branch stacks on M-175's tip (`566b85fa9`) because the button lives in
`apps/landing/src/pages/astrolabe.astro` — a file that exists under that name only on the
stack; branching from `main` would edit `index.astro` and conflict with the rename the
moment stack #91 merges. If the stack merges first, this becomes an ordinary main-based
branch with no rework.

## Design

### 1. The button wears the wallpaper's black

Current markup (`astrolabe.astro:16-28`): an `<a>` with `border border-border
bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground`, carrying an
inline GitHub-mark SVG with `fill="currentColor"` and the label "Try Astrolabe".

The restyle changes color only — geometry, typography, destination, and content stay:

- Ground: `bg-[#13120A]` — the exact hex the desk section already uses
  (`astrolabe.astro`, desk section `bg-[#13120A]`), so the page's two darkest surfaces are
  the same surface.
- Text: `text-[#F7F7F3]` — the page's own ground color as the button's type, closing the
  palette loop. The GitHub mark follows automatically: `fill="currentColor"` means light
  text _is_ the light-rendered mark; no second SVG variant is needed.
- Border: `border-transparent` (replacing `border-border`) — keeps the box geometry
  byte-compatible while dropping the light hairline that would read as a seam on black.
- Hover: `hover:bg-[#2A2820]` — one step lighter within the same warm-black family
  (between the ground and the Cursor-observed `#26251E` recorded in the M-172 plan);
  `hover:text-foreground` and `hover:bg-accent` are removed so the text never darkens.
  `transition-colors` stays.

### 2. The README introduces Astrolabe

`README.md` at the repo root is upstream's file verbatim ("# T3 Code", store links,
`npx t3@latest`, t3.codes endpoints — none of which apply to this fork). Full rewrite,
grounded in three sources so no sentence is invented:

- **Positioning copy is quoted, not paraphrased** (the vault's Copy convention): the README
  leads with the pinned claim — the aphorism _Chart twice, build once._ and the canonical
  paragraph ("Astrolabe is your agent development environment for building ambitious
  software. Every message, every plan edit, every code change is a checkpoint in a
  branching history. …") — and links `https://mercurian.ai/astrolabe`.
- **Lineage from ADR 004** (`docs/architecture/fork-baseline.md`): Astrolabe is a fork of
  [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools, MIT-licensed, full upstream
  history preserved, upstream actively tracked. One short section credits this plainly and
  points at `LICENSE` (which already carries both copyright lines, per M-169).
- **Only instructions that work today**: a minimal Development section —
  clone, `vp i`, `vp run dev` (the commands `AGENTS.md` documents for this repo) — plus a
  pointer to `docs/` for the deeper material. No install stores, no `npx t3`, no hosted
  endpoints, no download links (none exist yet), no release claims.

Tone: shipped-product voice, short — a front door, not a manual.

**Known recurring cost, accepted:** a rewritten `README.md` will conflict on upstream syncs
that touch it, exactly as `LICENSE` does; the sync runbook already absorbs that class of
conflict (the M-169 LICENSE change survived the 2026-08-26 sync).

### 3. Out of scope

No other landing styling, no NOTICE/licensing changes (M-169's machinery stands), no
CONTRIBUTING or docs restructuring, no vault edits inside the repo (the vault's CTA/Type
sections gain one line recording the black-button ruling at implementation time, in the
vault's own repository).

## Implementation checklist

- [ ] `apps/landing/src/pages/astrolabe.astro`: restyle the Try Astrolabe `<a>` per §1
      (ground, text, border, hover — nothing else changes).
- [ ] `README.md`: full rewrite per §2 (positioning quote + site link, lineage section,
      working-only Development section, docs pointer).
- [ ] Vault (almagest `Marketing Site.md`): one-line amendment recording the button's
      wallpaper-black ground (Claude, at implementation).

## Verification

- The four landing gates from the worktree root: `vp run build:landing` (postbuild guard),
  `vp run --filter @t3tools/landing typecheck`, `vp lint
--report-unused-disable-directives`, `vp fmt --check`.
- Served walk: computed background of the control is `rgb(19, 18, 10)` at rest and the
  hover value on hover; computed color is light; the mark renders light (currentColor);
  destination unchanged; legibility screenshot at desktop and 375px.
- README checks: no occurrence of "T3 Code" outside the lineage/credit section; the
  pinned paragraph appears verbatim; every command in the file runs in a fresh clone of
  this repo; the marketing-site link and upstream link resolve.
- Isolation, adjusted for this issue's scope: the branch diff beyond the stack tip touches
  only `apps/landing/`, `README.md`, and `docs/`; the web app's typecheck passes untouched.

## Conventions detected

- Landing styling changes are class-level edits in the page file with arbitrary-value
  Tailwind colors for the fixed palette (`bg-[#13120A]`, `#F7F7F3` — both already in
  `astrolabe.astro`).
- Marketing copy is quoted from the vault's pinned claims, never paraphrased (vault Copy
  section; the hero page does the same).
- Fork lineage and licensing posture live in `docs/architecture/fork-baseline.md` (ADR 004) and `LICENSE` (dual copyright) — the README cites, not restates.
- Repo dev commands are `vp i` / `vp run dev` (`AGENTS.md`, Dev servers).
- Plans live in `docs/project/technical-plan-*.md`; stacked branches note their base and
  the post-merge posture (M-175 v2 plan does the same).

## Amendment 1 — the link card (2026-08-29)

Venkat's third refinement, same door: sharing the site over SMS/iMessage/RCS shows no
preview card. The prototype landing designed one — `og-card.svg`, the Mercury constellation
on cream, 1200×630 — with two defects for exactly this use: the image is SVG (iMessage and
most Open Graph scrapers render only raster formats) and its reference was relative
(scrapers need absolute URLs). Its tagline is also the retired positioning ("You already
branch your AI chats…"). Venkat's ruling: keep the artwork, update the text to the current
positioning.

- **The asset** (produced by Claude, like the favicon): the prototype SVG's text layer
  edited — wordmark gains the terracotta full stop, the two retired tagline lines become
  one line, `Chart twice, build once.`, same face/size/color/position system — then
  rasterized at exactly 1200×630 with the real Fraunces and Spline Sans Mono variable
  fonts (headless Chrome over a data-URI-font harness). Ships as
  `apps/landing/public/og-card.png` (110KB). The edited SVG source stays in the session
  scratchpad; the prototype repo remains the design source of record.
- **The metadata** (Sol): `Base.astro` gains a `description` prop and the meta block —
  `meta name=description`, `og:title` (the page title), `og:description`, `og:type`
  website, `og:url` (the canonical page URL), `og:image` as an **absolute** URL built from
  `Astro.site` (set on this branch by M-175), `og:image:width/height` 1200/630,
  `og:image:alt`, and `twitter:card summary_large_image`. `astrolabe.astro` passes the
  description: the pinned positioning sentence ("Astrolabe is your agent development
  environment for building ambitious software.").
- **Scraper path for the bare domain:** no extra work — the root's 308 leads scrapers to
  `/astrolabe`, whose tags they read.

Checks added to Verification: dist HTML carries the og/twitter block with the absolute
image URL; `dist/og-card.png` exists at 1200×630; served `GET /og-card.png` returns 200
`image/png`.

## Amendment 2 — the demo answers (2026-08-30)

Venkat's fourth refinement: the hero window stops being read-only theater. A visitor who
sends a message gets a real exchange, the graph grows the way the product grows it, and
the composer sheds what cannot act. Everything below is HeroDesk island state plus scoped
landing CSS — nothing under `apps/web/` changes.

- **Send appends checkpoints.** The 20-commit fixture `history` becomes the _base_ of an
  island-state timeline (`useState` extension list; reload = fixture reset). `onSend`
  (today `() => Promise.resolve(false)`, `HeroDesk.tsx:279`) becomes real: it appends a
  user message entry built with the same `message()` fixture builder, parented at the
  current `head` (`resolveHead`) — so a send from the tip continues the branch and a send
  from an earlier point opens a new branch, with no new logic; `buildPlanGraph` recomputes
  from the extended list. Position moves to `LATEST` (the new message is globally newest,
  so the camera and conversation follow the product's own centering). Returns `true` so
  the composer clears the draft.
- **The reply.** After the send, `heroInFlight`-style streaming shows on the new tip
  (`turnActive`), and after a short beat the assistant entry lands as its own checkpoint
  with the exact copy: `To try Astrolabe, checkout the project here.` A working `onStop`
  cancels the pending reply (timer cleared, in-flight removed) — the Stop control the
  composer renders while `turnActive` must not lie. Timers live in a ref and clean up on
  unmount.
- **The standing-earlier notice.** The composer's `banner` slot (the surface-owned slot,
  `PlanComposer.tsx` props) gets the product's own treatment when `viewingPast`: the
  `ViewingEarlierBanner` arrangement from `PlanningSpace.tsx:1378` — ClockIcon, verbatim
  text "Viewing an earlier point — sending starts a new branch from here", and a real
  `Button size="xs" variant="outline"` "Back to now" wired to `LATEST`. PlanningSpace does
  not export the banner, so the hero fills the slot with the same structure from real ui
  primitives — the ratified prop-slot pattern (the ArtifactPicker precedent), structure
  and copy kept verbatim so drift is grep-detectable.
- **The real model picker.** The `modelPicker` slot gets the product's actual
  `PlanModelPicker` (`apps/web/src/components/mercurian/PlanModelPicker.tsx`, exported),
  fed fixture `ServerProvider` data (reuse the shared fixture builders if
  `test/fixtures` provides them — M-141 — else a minimal literal list) and an
  island-state `selection`; `onChange` updates it, so the popover opens and a click
  visibly changes the chip. Disabled while a reply streams, as the product does.
- **The controls that cannot act.** The image-attach control
  (`aria-label="Attach images"`) and the Implement control are hidden by landing CSS
  scoped under `[data-hero-composer]` — the same brittle-by-design posture as the old
  pane-title quieting: if composer internals drift the controls quietly return, and the
  walk catches it. Rationale recorded: a control that cannot act in the demo is less
  honest present than absent (Venkat's ruling, amending the v7 "real chrome is the
  honesty" posture for these two controls).

Checks: the four gates; the walk sends at the tip (graph +2 nodes, reply text verbatim),
sends from an earlier point (banner appears with working Back to now, branch opens, camera
follows), stops a streaming reply, opens the picker and changes the model, verifies both
controls absent, reloads to fixture state; isolation unchanged.
