# Technical Plan — M-173: The graph tells the story — scrolling advances a real plan history

Generated from the Goal/AC of Linear issue M-173. Goal in one sentence: scrolling the landing page
advances one plan's history through five beats — thread, fork, divergence, merge, implementation
leaves — inside the real `DagExplorer`, interactive at every point, with reduced-motion and mobile
falling back to readable static states.

Baseline: `docs/project/technical-plan-m-171-marketing-site-foundation.md` holds — `apps/landing`
exists on `main` (PR #76) with the `~` alias into `apps/web/src`, shared tokens, and the island
pattern proven by `src/islands/CheckpointGraphDemo.tsx`. Design sources: almagest **Marketing Site**
("a visitor watches a plan's history grow — a fork opening, branches diverging, a merge,
coding-session leaves — inside the real graph surface, and can touch it") and **Visual Language**
("Nothing moves merely to look alive. Motion explains a change in position, hierarchy, or state").
The prototype's canvas scroll engine is discarded, not fixed — its jank came from per-frame canvas
resizes, layout thrash, and lerp-lagged scrubbing; this design has none of those by construction.

## Conventions Detected

- **Island precedent** — `apps/landing/src/islands/CheckpointGraphDemo.tsx`: fixture history via
  `~/test/fixtures/timeline` (`timeline`/`message`/`planRevision`/`specRevision`), `buildPlanGraph`
  from `~/components/mercurian/PlanGraph.logic`, inert callbacks, `client:only="react"`. High.
- **Coding-session leaves have a fixture builder** —
  `apps/web/src/test/fixtures/sessionsAndSplits.ts` exports `planCodingSessionRecord(name,
overrides)` (Schema-validated `PlanCodingSessionRecord`); `DagExplorer` takes `codingSessions:
ReadonlyArray<PlanCodingSessionRecord>` and renders session leaves (`DagExplorer.tsx:181`). High.
- **`DagExplorer` re-renders from props** — it is presentational; a changed `graph` /
  `anchoredCommitId` / `codingSessions` prop set is just a React re-render. Its view choice persists
  in localStorage, so a visitor's view switch survives beat changes for free. High.
- **The zero-JS guard must be re-scoped by this issue** — `apps/landing/scripts/assert-static.mjs`
  currently fails the build if `dist/index.html` contains any `<script`; putting the story island on
  the index page makes that impossible. M-174 has the same need, so **both plans pin the identical
  replacement** (below) — identical content merges cleanly whichever lands first. High.
- **Merge order with siblings** — M-172 rewrites `index.astro` (hero); this branch bases on main's
  placeholder index. Documented order: 172 → 173 → 174; this issue's index edit is one import + one
  section element, so the rebase conflict is a two-line resolution. Medium (order is a team
  convention being set here, not discovered).

## Design

### The story island

`src/islands/GraphStoryIsland.tsx` **(new)**:

- **One fixture history, five prefixes.** Build a single `timeline(...)` at module scope telling one
  story with sequence numbers: (1) a linear thread — user message, plan revision, spec revision,
  assistant response; (2) a fork — two sibling user messages off the same parent; (3) divergence —
  each branch advances (plan revision on one, response on the other); (4) a merge — one message with
  both branch tips as parents, then a plan+spec revision; (5) implementation — the merged tip gains
  coding-session leaves (`planCodingSessionRecord`, two repositories) and a `readyCommits` entry.
  Each beat's graph is the prefix of the history up to that beat's last sequence:
  `BEATS.map(lastSeq => buildPlanGraph(history.filter(c => c.sequence <= lastSeq)))`, computed once
  at module scope (the fixtures are tiny). `anchoredCommitId` per beat = that beat's tip;
  `codingSessions`/`readyCommits` are non-empty only at beat 5.
- **Discrete beats, no scrubbing.** Component state is `beatIndex`. An `IntersectionObserver` over
  the five caption waypoints sets it — there is no scroll listener, no rAF loop, no interpolation.
  "Keeps pace with the scrollbar" is satisfied by construction: nothing lags because nothing
  animates on scroll; a beat swap is one React render of a small graph.
- **Layout (wide viewports)**: a two-column section — a narrow caption rail whose five caption
  blocks each occupy ~70vh of scroll, and a `sticky top-0 h-screen` stage holding one `DagExplorer`
  that stays put while captions scroll past. The explorer keeps its own chrome (view switcher, node
  interaction) — the visitor can switch Thread/Columns/Graph or inspect nodes at any beat (AC-2).
- **Stacked fallback (one code path for two ACs)**: when `(prefers-reduced-motion: reduce)` matches
  OR the viewport is narrower than 768px, render instead a static stacked sequence: five figures,
  each its own `DagExplorer` (that beat's graph) under its caption, no sticky, no observer. Every
  beat visible, readable, interactive; no meaning carried by motion (AC-4, AC-5). Media query read
  once at mount (`matchMedia`), with a resize/change listener.
- **Captions (pinned; canonical register, one line each):**
  1. `Planning starts as one thread of history.`
  2. `Return to any earlier point and take a different direction — that's a fork.`
  3. `Both directions stay first-class. Nothing is overwritten.`
  4. `Forks and merges are human-driven; a merge brings the directions back together.`
  5. `From a coherent checkpoint, the plan is implemented through coding sessions.`

### Page wiring

`src/components/GraphStory.astro` **(new)** wraps the island (`client:only="react"`) with the
section shell; `src/pages/index.astro` gains one import and one `<GraphStory />` below the existing
main block. `/demo/checkpoint-graph` is untouched.

### The guard, re-scoped (identical text in the M-174 plan)

`scripts/assert-static.mjs` changes from "no `<script` at all" to: every `<script` tag in
`dist/index.html` must be an Astro island hydration module (`type="module"` and `src` beginning with
`/_astro/`, or the Astro-generated inline hydration script); any other script — third-party `src`,
analytics, inline application code — fails the build. The check parses script tags with a regex over
the built HTML and prints which tag offended. This preserves the property the guard protected (the
page ships nothing but its declared demos) now that the index legitimately carries islands.

## Implementation Checklist

- [ ] `src/islands/GraphStoryIsland.tsx` per the design: module-scope history + per-beat graphs,
      `IntersectionObserver` beat switching, sticky stage, stacked fallback, pinned captions
      verbatim.
- [ ] `src/components/GraphStory.astro` + the two-line `index.astro` integration.
- [ ] Re-scope `scripts/assert-static.mjs` exactly as specified (keep the file name and postbuild
      wiring).
- [ ] No new dependencies; no changes to `astro.config.mjs`, CI, root scripts, or anything under
      `apps/web/` / `apps/marketing/`. No scroll listeners, no rAF loops, no CSS scroll-linked
      animations anywhere in the new code.

## Test Plan

- [ ] `node_modules/.bin/vp run build:landing` passes; the re-scoped guard passes and demonstrably
      still fails on a planted non-island script (walk it once locally, then revert the plant).
- [ ] `node_modules/.bin/vp run --filter @t3tools/landing typecheck`, `vp lint`, `vp fmt --check`
      pass.
- [ ] Browser walk (dev server): scrolling advances beats 1→5 in order — thread, fork badge,
      divergence, merge, session leaves visible in the graph; switching to Graph view mid-story and
      continuing to scroll keeps working; node click works at any beat.
- [ ] Scroll responsiveness: no visible lag between scrollbar and content on an ordinary laptop
      (the stage is sticky and beats are discrete — verify no continuous repaint via a quick
      DevTools performance check if in doubt).
- [ ] Emulate `prefers-reduced-motion: reduce` (browser tool supports colorScheme; use DevTools
      rendering emulation or the media-query listener path directly): all five beats render stacked
      and readable.
- [ ] Mobile preset (375px): stacked layout renders, nothing blank or clipped.
