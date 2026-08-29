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

## Amendment (2026-08-27): the hero carousel

The single positioning statement is superseded (Marketing Site note, "Does the hero make one claim
or several?" — resolved: a three-slide manual carousel; vault commit 8ee8f09). The M-172 Linear AC
was updated to match. Design:

- **The text block becomes the carousel.** The globe, eyebrow `MERCURIAN` h1, layout, and
  responsive behavior all stand. The big positioning line + supporting paragraph are replaced by
  the sliding pair (slide header + slide copy). The positioning line moves to the page close
  (M-174's scope) and the "supporting line" of the original design is retired.
- **Zero JS: CSS scroll-snap.** The carousel is a horizontal `overflow-x-auto` `snap-x snap-mandatory`
  container with three full-width `snap-center` panels, `scroll-behavior: smooth` (falling back to
  auto under `prefers-reduced-motion`). Controls are plain anchor links: three dot links (one per
  slide, `href="#hero-slide-N"`) and prev/next chevron links; `:target`-free — dots indicate the
  current slide via `scroll-snap` position observed with CSS only where possible; if a
  pure-CSS current-slide indicator proves impractical, static dots (no highlight) are acceptable
  for this issue rather than adding JS. The `assert-static.mjs` guard stays untouched and must
  keep passing — that is the point of this construction.
- **No autoplay, no transition-on-load.** Nothing moves until the visitor scrolls the strip,
  clicks a dot, or tabs into the panel and uses arrow keys (native scroll container behavior).
- **Copy pinned verbatim** from the Marketing Site note's "The hero slides (pinned copy)" section —
  three headers, three paragraphs, no edits, including the em dashes.
- **Accessibility:** the strip is a `region` labeled "Product highlights"; each panel labeled
  "Slide N of 3"; dot links carry aria-labels naming their slide.
- Scope unchanged otherwise: no new dependencies, no config edits, nothing outside `apps/landing/`.

## Amendment 2 (2026-08-27): the interactive hero — visuals on every slide, autoplay, globe to background

Supersedes Amendment 1's zero-JS construction (vault commit 0a6f522; Linear AC updated). The
carousel now embeds a live product component, so the hero becomes a React island and this branch
takes the guard re-scope that M-173/M-174 pinned (island hydration scripts only — same spec as
`technical-plan-m-173-graph-story.md` §"The guard, re-scoped"; M-172 now lands it first).

- **`src/islands/HeroCarousel.tsx` (new), `client:only="react"`.** A transform-track carousel —
  an overflow-hidden viewport over a `translateX` track, NOT a scroll container: no native
  scrollbar (the Amendment-1 wart), no snap/fragment quirks, controls naturally external.
  Transition on transform ~500ms ease; under `prefers-reduced-motion` the transition is removed
  (instant cuts) and autoplay never starts.
- **Autoplay:** advance every ~8s, wrapping. Paused while the pointer is over the carousel or
  focus is within it; a manual navigation resets the timer. No autoplay under reduced motion.
- **Controls outside the sliding content:** one fixed nav below the viewport (prev/next chevrons +
  three dots, current dot filled from React state), aria-labels as before.
- **Slide visuals** (each slide = copy block + visual panel, bordered like the M-174 section
  cards, on a `bg-background/80`-style surface so it reads over the globe):
  1. Branching — the real `DagExplorer` from `~/components/mercurian/DagExplorer`, fixture history
     with a fork and a merge (reuse/adapt `CheckpointGraphDemo`'s). Seed
     `EXPLORER_VIEW_STORAGE_KEY` to the graph view **only if the key is unset**, before first
     render, so the diamond shows spatially without clobbering a returning visitor's choice.
  2. Memory — a quiet placeholder panel, semantic tokens only, no fake screenshots and no motion:
     a subtle node-and-line sketch (inline SVG, `currentColor`/token colors) with one muted line
     of text: `Memory's graph view arrives with the memory system.`
  3. Ownership — the five provider marks from `public/harnesses/` (hand-placed:
     claude-ai-icon, openai_dark, cursor_light, grok-dark, opencode-dark) in a labeled row
     (alt/aria: Claude Code, Codex, Cursor, Grok, OpenCode), sized consistently.
- **Globe to background:** the poster `<img>` becomes an absolutely-positioned, `aria-hidden`
  background layer (right-weighted, clipped by the hero, behind everything), with a soft
  background-token gradient over it where text sits so copy stays legible in both light/dark.
- **Copy change (slide 3, per the amended vault pin):** "…with no sign up required." replaces
  "…with no signup and no cloud in the loop."
- Everything else stands: pinned copy verbatim, Mercurian naming, no waitlist/T3 strings, no new
  dependencies, nothing outside `apps/landing/`.

## Amendment 3 (2026-08-27): progress-segment indicators

The three dots become three horizontal line segments that make the autoplay timer visible (vault
7ad4084; Linear AC updated). Design and sync contract:

- Each indicator is still a button (same aria-labels, `aria-current`, larger padded hit area) whose
  visible face is a thin horizontal segment (e.g. `h-1 w-8 rounded-full`) — a muted track
  (`bg-muted-foreground/25`-class) holding an inner `origin-left` fill bar (`bg-foreground`).
- **The current slide's fill IS the timer**: it scales 0→1 linearly over exactly the autoplay
  interval, as a CSS animation (no rAF, no per-frame JS). The animation is keyed to restart
  whenever the interval restarts — slide change, manual-navigation reset, or resume after a pause —
  and carries `animation-play-state: paused` while the interval is off (hover / focus-within).
  Pause semantics follow the existing interval code: pausing freezes the fill; resuming restarts
  both interval and fill from zero (re-key on a resume counter).
- Non-current segments show the empty track. Under reduced motion (autoplay off) no animation
  exists: the current segment renders fully filled, others empty.

## Amendment 4 (2026-08-27): full-strength globe, conversation beside the graph, unboxed marks

Vault 4766e83; Linear AC updated. Four changes, all confined to `apps/landing/`:

- **Full-color poster.** The background layer drops `opacity-70` and the two full-viewport
  dimming gradients. The poster renders at full strength. Contrast moves to the text: the copy
  column (h1 eyebrow + each slide's heading/paragraph block) gets its own translucent backdrop —
  something like a rounded panel of `bg-background/60 backdrop-blur-md` fading toward the
  transparent side (`bg-gradient-to-r from-background/85 via-background/55 to-transparent` is
  the starting idea; better is welcome) — applied so text stays legible at every width where it
  overlaps the globe, and unobtrusive where it doesn't.
- **Slide 1 becomes the planning surface in miniature: conversation + graph.** The real
  `PlanTimeline` (`~/components/mercurian/PlanTimeline`, proven standalone in
  `apps/web/src/components/mercurian/PlanTimeline.catalog.tsx` — props `timeline`,
  `codingSessions`, optional `inFlight` with streamed text/grounding, `onAnswerQuestion`) renders
  to the LEFT of the DagExplorer pane, fed from the same fixture history (or its checked-out
  path), reading as messages-beside-sidebar the way the app composes them. An `inFlight` replying
  state (short static text + one grounding chip) is welcome for life. On narrow viewports the
  conversation pane may hide, leaving the graph.
- **The graph pane's own "Checkpoint Graph" title chrome is hidden on the landing page only** —
  the page's copy already names it. Do this from the landing side (a wrapper attribute on the
  island's pane plus a scoped CSS rule in the island or `src/styles/global.css` that hides the
  pane-header element inside that wrapper). NOTHING under `apps/web/` changes; accept that the
  selector is coupling to app internals (if it drifts, the header quietly returns — acceptable).
- **Slide 3 marks unboxed.** The bordered visual panel and per-icon dark tiles go away; the five
  marks + labels sit directly over the poster. Fills audited: claude `#D97757` (orange),
  cursor `#EDECEC`, grok `#F5F5F5`, openai `#fff` (all three near-white — invisible on the light
  poster), opencode `#131010` (near-black). Render every mark as a uniform ink silhouette
  (CSS `filter: brightness(0)` plus slight opacity, or per-file equivalent) so all five read
  quietly and legibly on the poster; labels `text-foreground`/muted. Keep alt/aria names.

## Amendment 5 (2026-08-27): feathered scrims, solid panels, fitted graph, the wordmark

Vault: wordmark clause added. Four changes, all in `apps/landing/`:

- **Feathered text scrims.** The hard-edged `rounded-2xl bg-background/70 backdrop-blur-md`
  panels (SlideCopy and the eyebrow pill) are replaced by scrims with no visible boundary: an
  absolutely-positioned backdrop layer extending well past the text, carrying the translucent
  background tint AND `backdrop-filter` blur, faded out with a soft `mask-image` alpha gradient
  (radial or composited per-side linear) so both tint and blur dissolve smoothly into the poster.
  No border, no visible corner at any width.
- **Solid demo panels.** The slide-1 planning panel and slide-2 placeholder panel go from
  `bg-background/80` to solid `bg-background` (slide 2 included for coherence).
- **The hero graph fits its pane; no minimap.** Investigate `DagExplorer`'s Graph view for the
  presentational mechanism that controls zoom/fit (display settings persisted in localStorage
  beside the view key are the expected shape — seed like the view is seeded, only if unset or via
  a landing-held wrapper approach) so the whole fixture diamond is visible in the hero pane
  without panning. Whatever the fit outcome, hide the minimap and the zoom/fit corner controls
  inside `[data-landing-dag-explorer]` via the existing landing-scoped style block. NOTHING under
  `apps/web/` changes.
- **The wordmark.** `public/fonts/fraunces-variable.woff2` is hand-placed (36KB, weight range
  300–700). Register it landing-side in `src/styles/global.css` (after the shared import):
  `@font-face { font-family: "Fraunces"; src: url("/fonts/fraunces-variable.woff2")
format("woff2-variations"); font-weight: 300 700; font-style: normal; font-display: swap; }`.
  The eyebrow h1 becomes the wordmark from the prototype's Logo component: `Mercurian` in
  Fraunces semi-bold (weight 600), normal case (drop the uppercase tracking treatment), sized up
  (~text-2xl/3xl), followed by a period in the prototype's rust `#A0492A` inside an
  `aria-hidden` span so the accessible name stays "Mercurian". The h1 keeps a feathered scrim.

### Amendment 5 addendum: the scrim is atmosphere, not a box

Boxed scrims — even mask-feathered — always end somewhere, and a backdrop-blur boundary is
glaring against the poster's texture. Replaced with **one continuous hero-level scrim**: a single
full-height layer between the poster and the content, anchored to the hero's left, fading
rightward over a very long run (roughly `linear-gradient(to right, background, background 20%,
55% alpha around 45%, transparent by ~78%)`), with **no backdrop-filter anywhere**. The right
majority of the globe stays untouched full color; the text sits on the dissolve with no
detectable region boundary. The per-block `.hero-feathered-scrim` layers are removed.

## Amendment 6 — the carousel retires: the product open on its desk (2026-08-28)

Vault ruling (Marketing Site, commit 283cf68): the hero becomes a chrome-less **desktop** whose
wallpaper is the Mercury poster, with an **Astrolabe window** open on it — the real planning
space in self-referential mock state. The three claims stop rotating: claim 1 is the hero's
headline block, claim 3 the provider band under the desk, claim 2 moves below the fold (M-174's
branch). No autoplay exists anymore; the motion-rule exception retires. No CTA; positioning stays
in the close.

Reference pattern measured from cursor.com/home at 1440×900 (2026-08-28), for proportions only —
palette, radius language, and type stay ours:

- Page frame: container side margins ~70px at 1440 (~5%); calm single-color page background;
  headline understated (their h1: 26px / 32.5px line-height / weight 400 / −0.325px tracking) —
  the showpiece below carries the page, not display type.
- Desk: full-container-width panel, 1300×725 at 1440 (≈1.79:1 ratio), `overflow: hidden`,
  `position: relative`; wallpaper as an `<img>` filling the panel (`object-cover`). No OS chrome
  of any kind. Desk top sits low enough that the fold crops the desk's lower reach (scroll cue).
- Window: centered in the desk, width ≈83% of desk (1080/1300), height ≈85% (620/725) with
  ~50px top inset; `border-radius: 10px`; layered soft shadow
  (`0 28px 70px rgba(0,0,0,.14), 0 14px 32px rgba(0,0,0,.10)`); 28px title bar carrying
  window dots and the window's name; interior UI type at 11–13px. (Their windows are drag/resize
  DOM — vault records window-play as an Open Decision, NOT v1 scope.)

### What changes on this branch

- **`HeroCarousel.tsx` retires.** Replaced by a `HeroDesk` island (`client:only="react"`) whose
  only job is the window interior; the desk panel, wallpaper img, headline block, and provider
  band are static Astro markup in `index.astro` (claims visible in built HTML — no sr-only
  fallback needed anymore; the guard's job gets easier, not harder).
- **The desk** (static): full-container-width, aspect ~16/9 (≈1.79:1), rounded per OUR shape
  language (match the app's panel radius rather than Cursor's square), overflow-hidden,
  `mercury-globe-poster.png` as the wallpaper via `object-cover` positioned so the globe reads
  (northern-terrain crop acceptable; verify visually). The page body drops the poster and every
  scrim layer — clean `bg-background` everywhere. The v6 atmospheric scrim dies with no
  replacement (nothing overlaps the globe anymore).
- **The window** (island): frame styled to the metrics above (83% desk width, 10px radius,
  layered shadow, 28px title bar with three dots and the name "Astrolabe" — dots are inert
  decoration, `aria-hidden`). Interior = the real planning space, reusing this branch's fixture
  history and `heroInFlight`: `PlanTimeline` left, `PlanComposer` beneath it (M-174's demo
  pattern: prefilled, typable, inert handlers), `DagExplorer` right in Graph view (seed-if-unset
  key, fit-guard MutationObserver both carry over). **The app's own chrome now renders as the
  product renders it** — the `[data-landing-dag-explorer]` title-hiding and corner-control-hiding
  CSS retires (inside a real app window, the real pane chrome is the honesty; the old quieting
  was ruled for a naked surface). Nothing under `apps/web/` changes, as always.
- **Headline block** (static, above the desk): wordmark unchanged; claim 1 header + paragraph in
  quiet type — header around `text-2xl`/`font-medium` (not display size), paragraph
  `text-muted-foreground`, both left-aligned on the container edge.
- **Provider band** (static, directly below the desk): the five existing tiles + labels in one
  row (wrap on small), with claim 3's header + copy beside or above them in the same quiet type.
  The band sits on the page background — no globe behind it anymore.
- **Memory placeholder extraction:** the ghost-diamond SVG moves out of the dying island into a
  static Astro partial (`src/components/MemoryPlaceholder.astro`) so M-174's branch can mount it
  in the new memory section (claim 2). This branch only creates the partial; the section itself
  is M-174's edit.
- **Mobile (<lg):** headline block full-width; the desk keeps its ratio but the window fills
  ~94% of it showing the conversation pane only (graph hidden below lg, existing pattern);
  provider band wraps to two rows. Reduced motion: nothing to do — the hero no longer moves.

### Checks

- Existing gates (build + guard, typecheck, lint, fmt). Guard note: claims 1 and 3 must appear in
  the static HTML (they are Astro markup now — grep the built page for both headers).
- Walk: window interior live (graph pans/hovers, composer types, Send inert); no autoplay
  anywhere; poster absent from page background, present as wallpaper; 375-width via the
  fixed-width-iframe instrument (headless narrow windows lie — see memory).

## Amendment 7 — topbar, warm-light ground, real shell, click-to-engage (2026-08-28)

Vault ruling (Marketing Site, commit bfae9e2) + Venkat's four calls on v7: (1) a Cursor-rhythm
topbar; (2) the window shows as much of the REAL app shell as mounts honestly; (3) the site wears
a fixed warm off-white ground `#F7F7F3`, light appearance always; (4) the live window takes
scroll only after a click.

- **Topbar (static):** a slim bar at the container's top — wordmark left (Fraunces h1, sized down
  from the current block to bar scale), and right: the page's ONLY outward link, a quiet
  `GitHub` link to `https://github.com/mercurian-labs/astrolabe` (repo verified public;
  `rel="noopener"`, muted text style, optional small mark). Then Cursor-scale air (~8–10rem)
  before the headline block. This replaces the current stacked-wordmark opening.
- **Warm-light ground:** the landing pins the LIGHT token set permanently and paints the page
  `#F7F7F3`. Find the mechanism the shared `index.css` uses to pick dark (media query or class)
  and pin light landing-side (e.g. `color-scheme: light` + whatever class/data attribute the
  tokens key on, set on the landing `<html>`/`<body>` via `Base.astro`) — NOTHING under
  `apps/web/` changes. Page-level backgrounds use `#F7F7F3`; the window interior keeps product
  tokens (now resolving light). Verify text/panel contrast on `#F7F7F3` — tokens paint panels
  near-white, which reads correctly against the warm ground (Cursor does exactly this).
- **Real shell — the sidebar mount attempt:** `PlanListSidebar` (default export, zero props,
  `apps/web/src/components/mercurian/PlanListSidebar.tsx`) self-wires: TanStack Router
  (`Link`/`useNavigate`/`useLocation`), `useAtomValue(primaryServerKeybindingsAtom)`, and a
  plan-tree data source found lower in its imports (investigate). The approach is a
  **real-context harness** in the island: a memory-history TanStack router with a stub route tree
  mounted around the window interior, an `@effect/atom-react` registry (keybindings atom must
  resolve to its default without a server), and the plan-tree source seeded with fixture rows
  (this page's plan among a few others, statuses from the real vocabulary). HARD RULE — no
  lookalikes: if any dependency bottoms out in the live server connection and cannot be satisfied
  by registry/props seeding, the sidebar STAYS OUT of v1 and the report says exactly which
  dependency blocked it. Never stub-render fragments of it by hand. If the sidebar mounts, window
  layout becomes [sidebar | conversation+composer | graph], sidebar hidden below lg.
- **Click-to-engage scroll gate:** the window interior starts disengaged — a transparent overlay
  above it lets wheel/touch bubble to the page (the graph and panes receive nothing), with a
  quiet affordance on hover (e.g. a faint "Click to explore" chip). A click engages: overlay
  lifts, interior interactivity (graph zoom/pan, pane scrolling, composer) is direct. `Escape` or
  a click/scroll-start outside the window disengages. No focus trap; keyboard users can Tab into
  the window content regardless of the gate.

Checks: existing four gates; built HTML still carries claims 1 and 3; page background is
`#F7F7F3` and does not change under `prefers-color-scheme: dark`; wheel over the window scrolls
the page before click and zooms the graph after; the sidebar (if mounted) renders the real
component with fixture rows.

## Amendment 8 — the planning header and checkpoint rollback (2026-08-28)

Vault ruling (Marketing Site, commit 67f32c1) + Venkat's two calls: (1) the window interior shows
the planning space's own top bar — the plan's title with the pane toggles in its corner; (2)
picking a checkpoint in the graph rolls the conversation back to that point, the product's own
time travel demonstrated live.

- **Header (real components):** `WorkspacePageHeader` (`~/components/WorkspacePageHeader.tsx`)
  with the plan title in the product's own `h1` treatment, and the exported `PlanPaneToggle`
  (`~/components/mercurian/PlanningSpace.tsx`) in the corner. Pane state is island-local React
  state shaped like the product's `RightPaneState` (`{open, view, artifact}`), defaulting to
  `{open: true, view: "explorer", artifact: "plan"}` — the graph stays the hero's opening view
  per the vault, contra the product's artifact-first default. No localStorage persistence.
- **Right pane, all three states:** `view: "explorer"` renders the existing `DagExplorer`;
  `view: "artifact"` renders the real `PlanArtifact` or `SpecArtifact` on fixture text/spec;
  deselecting closes the pane and the conversation goes full-width (the toggle reappearing in
  the header corner, exactly the product's `paneCornerControl` dance). The artifact title
  control fills the components' `titleControl` prop slot with a small Plan/Spec picker built
  from the real `ui/menu` primitives — a prop slot filled landing-side, not a rebuilt surface.
- **Rollback (the product's own mechanism):** island-local `position: PlanPosition` state;
  `DagExplorer.onSelect` → `positionAfterPick(graph, commitId)`; `head = resolveHead`;
  `visibleTimeline = timeline` filtered by `ancestorClosure(graph, head)` — all imported from
  `PlanPosition.logic` / `PlanGraph.logic`, zero landing-side reimplementation. The graph's
  `anchoredCommitId` becomes `head`. The in-flight reply shows only while its `parentCommitId`
  is in the visible closure (the product's `visibleInFlight` rule). Artifacts read as of the
  visible path: fixture plan texts keyed by the path's last plan revision
  (`lastPlanRevision(visibleTimeline)`), spec fixtures likewise, `readOnly` while
  `isViewingPast`, `turnActive` at the live tip (the streaming fixture reply suppresses Edit —
  the product's own reason). Back to now: pick a tip in the graph (`positionAfterPick` returns
  a live position on leaves).
- **Mount-safety note:** `PlanArtifact`/`SpecArtifact` call `useSavePlanRevision`-family hooks →
  `useEnvironmentBoundCommand` → primary-environment chain that reads empty-but-harmless in the
  landing (the M-187 finding's benign half). Compile-green is not proof: the browser walk must
  show the artifact pane rendering and the toggles cycling.

Checks: existing four gates; clicking a mid-history checkpoint slices the conversation and the
artifact to that path and the composer stays; clicking a leaf returns to live; toggles swap
graph ↔ plan/spec ↔ closed; header title renders in the window at 12px scale without wrapping.

### Amendment 8 addendum — the header stands beside the pane bar, and shorter (2026-08-28)

Venkat's correction on the first cut: the hero stacked the workspace header above the split,
but the product's shipped arrangement (M-139) is ONE header row — the `WorkspacePageHeader`
lives inside the conversation column and the right pane's title bar stands beside it at the
same height, the column border providing the vertical separation. The hero mirrors that
exactly: header moves into the left column above the timeline; the pane column runs full
height. Both bars share the `--workspace-topbar-height` token (52px), which is proportionally
oversized inside the 12px-scale window — the landing overrides that one token scoped to
`[data-hero-window]` (≈36px) in its own global.css, shrinking both bars together while the
shared token keeps them aligned. A scoped variable override is landing-side theming of real
chrome, not a fork of it.

## Amendment 9 — scroll is never captured, and the air tightens (2026-08-28)

Vault ruling (Marketing Site, commit 7dbf045) + Venkat's two calls: (1) the topbar → headline
gap is too generous; (2) the click-to-engage gate was the wrong idea — the desk can stand
taller than a short viewport, and a window that captures the wheel strands the visitor.

- **Air:** the headline section's `mt-32 lg:mt-40` halves to `mt-16 lg:mt-20`
  (index.astro). Nothing else in the page rhythm moves.
- **Gate removal (HeroDesk.tsx):** the click-to-engage machinery goes entirely — overlay,
  `engaged` state, Escape/outside-pointerdown listeners, hover chip. The interior is directly
  live at all times.
- **Wheel suppression on the graph only:** DagExplorer attaches a native non-passive wheel
  listener on its SVG that always `preventDefault()`s (plain wheel pans, ctrl/meta zooms) —
  the one scroll thief. The hero's graph-pane wrapper adds a capture-phase wheel listener
  that calls `stopPropagation()` (never `preventDefault()`): capture halts the event before
  it reaches the SVG's own listener, no one cancels the default, the page scrolls. Drag-pan,
  hover, node picks, and the fit control are untouched. Trade recorded in the vault: the demo
  forgoes wheel pan/zoom of the graph.
- **Panes stay native:** the timeline and artifact panes have no overscroll containment —
  they scroll natively and chain the wheel to the page at their ends, standard embedded-list
  behavior. No landing-side changes there.

Checks: the four gates; wheel over the graph scrolls the page while drag still pans the map;
wheel over the conversation scrolls it and chains to the page at its ends; no overlay or
"Click to explore" affordance anywhere; the headline sits at the tightened offset.

## Amendment 10 — the fixture history loses its merge (2026-08-28)

Vault ruling (Marketing Site, commit e47cd7f) + Venkat's call: merging is being redesigned, so
the site demonstrates NO merge until the redesign lands — every live history is a tree of open
branches. The hero fixture reshapes:

- **History:** the trunk (query → plan draft → spec → reply) and the fork into the two
  branches (interface / workflow, each query → plan revision → reply) stay; the merge tail —
  merge-query, merge-plan, merge-spec, merge-response — is REMOVED. Ten commits, two open
  tips, no commit with two parents.
- **In-flight reply:** re-anchors on the newest branch tip (workflow-response) with copy that
  compares without merging — the assistant weighing the two open paths, not preparing a
  merged plan.
- **Artifacts:** the "Merged hero plan" plan text and the merge-spec document die with their
  revisions. Three plan texts remain (draft / interface / workflow), keyed as before; the one
  spec document (plan-spec, on the trunk) reads on every path. The workflow branch's text
  becomes the tip reading.
- **Composer placeholder text and slash commands unchanged;** claim 1's pinned copy still
  promises merging — the vault records that the copy may promise what the graphs do not yet
  picture.

Checks: the four gates; the graph renders two tips and no diamond; no timeline row or graph
node mentions merging; rollback across both branches still reads path-specific plan texts.

## Amendment 11 — a realistic tree, and the camera stands where you stand (2026-08-28)

Venkat's two calls: (1) the fixture becomes a realistic planning session — a large tree where
the fork's two branches each continue linearly and each sprouts a tangent; (2) stop forcing
fit-to-view — the graph should focus the selected node.

- **Camera:** DagExplorer already centers the current/anchored commit whenever the position
  moves ("Where you stand comes to the middle when the position moves", DagExplorer.tsx
  ~1450-1460) — the hero's fit-clicking MutationObserver has been fighting that native
  behavior. It is REMOVED, nothing replaces it: the camera centers the tip on mount and
  re-centers on every pick; with the larger tree overflowing the pane, the product's minimap
  appears on its own, which is fine.
- **The tree (20 commits; sequence = at(sequence), one commit per id):**
  trunk: m1 user query (1) → plan-draft revision (2) → plan-spec revision (3) → m2 assistant
  reply (4). Fork at m2 into two working branches: A "quieter interface" — query (5) →
  revision (7) → reply (9), then a linear continuation query (15) → revision (16) → reply
  (17); B "faster workflow" — query (6) → revision (8) → reply (10), then continuation query
  (18) → revision (19) → reply (20). Each branch sprouts a short two-commit TANGENT off its
  first reply: A's (11 query, 12 reply — an idea considered and parked), B's (13 query, 14
  reply — a question answered in place). Four open tips (both tangent replies, both
  continuation replies), b-continuation reply (20) is the newest — the anchored tip, carrying
  the in-flight turn. No commit has two parents.
- **Artifacts:** five plan texts now (draft, interface, interface-continued, workflow,
  workflow-continued) keyed by revision createdAt as before; the single trunk spec document
  stays the spec on every path. Fixture copy stays self-referential (the plan for this page),
  quiet in tone, merge-free.

Checks: the four gates; the graph shows one fork, two continuing branches, two tangents, no
merge; the camera arrives centered on the anchored tip without any fit click; picking any
node re-centers on it; rollback reads the right plan text on every path.

### Amendment 11 addendum — the minimap shrinks to window scale, and the walk proves isolation (2026-08-28)

Venkat's two calls on the v11 walk: (1) the minimap is too big for the hero pane — its JS
sizing clamps to a 140px minimum (`minimapSize`, DagExplorer.logic.ts:198-213), over half the
hero's narrow graph pane; (2) every walk must prove the landing work cannot touch the main
application.

- **Minimap:** landing-scoped visual scale in global.css —
  `[data-hero-window] svg[aria-label="Map overview"] { transform: scale(0.6);
transform-origin: bottom right; }`. Click/drag mapping survives scaling because
  `clientToMinimap` normalizes through `getBoundingClientRect()`. Same posture as the topbar
  token: landing-side theming of real chrome, nothing under apps/web changes.
- **Isolation proof (standing walk step):** `git diff main...HEAD --name-only` filtered to
  everything outside `apps/landing/` and `docs/` must be empty, and
  `vp run --filter @t3tools/web typecheck` must pass untouched — recorded as an AC bullet so
  every future round walks it.

## Amendment 12 — the page speaks the name, and the pane is the narrow stage (2026-08-28)

Vault rulings (Marketing Site, commit 6733558) from Venkat's naming/CTA/responsive calls:

- **Combined button (index.astro, static):** the topbar's quiet GitHub link becomes the page's
  one outward control — an anchor styled as a quiet button: the GitHub mark + "Try Astrolabe",
  href to the public repository (rel/target as before). When a download page exists it points
  there instead (recorded in the vault; not this branch's concern). One control, not two.
- **Eyebrow (index.astro, static):** above the claim-1 header, a small muted line naming the
  product, copy pinned by the vault: _Astrolabe — Mercurian's planning studio for coding
  agents_. Quiet type (small, muted-foreground); the headline block otherwise unchanged.
- **The narrow stage (HeroDesk.tsx):** below lg, the window shows the RIGHT PANE alone —
  graph by default, artifacts a toggle away, the conversation reachable by closing the pane —
  because the pane's portrait proportions fit a phone and the future demonstration loop
  inherits the stage unchanged. Mirroring the product's own two-render-site pattern
  (PlanningSpace renders its header outside the columns below sm, inside the conversation
  column at sm+): the hero renders the header at the window top below lg (title + toggles),
  and keeps the current inside-the-conversation-column arrangement at lg+. Below lg with the
  pane open (the default), the pane fills the window and the conversation column hides; with
  the pane closed, the conversation (timeline + composer) fills it. The pane toggles become
  visible and working at ALL widths (the hidden-below-lg wrappers go away).

Checks: the four gates; at 375 width the window shows the graph with working toggles
(artifact swap, close → conversation, reopen); at desktop nothing changes from the previous
round; the built HTML carries the eyebrow copy and the Try Astrolabe control with the repo
href; the isolation walk step passes.
