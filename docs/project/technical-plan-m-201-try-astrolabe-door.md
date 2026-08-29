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
