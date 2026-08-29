# Technical Plan — M-175: Cut-over: the new marketing site goes public, the prototype retires

**Issue:** M-175 · **Branch:** `venk/m-175-cut-over-the-new-marketing-site-goes-public-the-prototype` · **Plan v2, 2026-08-29**

This plan supersedes the version that lived on the retired stacked branch (plan `8535ba9c8`,
machinery `febc6e2a4` — preserved at the origin branch's old tip until this branch is pushed
over it). Two things changed since v1: the stack dissolved into sequential merges and the desk
hero (M-172, PR #83) is now **merged to main** (`a5003b25c`), and the vault's **Address ruling**
landed — the canonical URL is `mercurian.ai/astrolabe`, with the bare root redirecting
permanently. v2 rebuilds the same cut-over machinery from current main and adds the address
move.

**Launch scope (Venkat's call, 2026-08-29):** the site goes public hero-first. M-173 (graph
story) and M-174 (below the fold) no longer block M-175 — the deploy workflow publishes every
main push, so those land post-launch as ordinary merges. Their Linear blocked-by relations on
M-175 are removed.

## Design

### 1. The cut-over is a same-name Worker deploy (carried from v1)

The prototype (`~/dev/mercurian/landing`) deploys a Cloudflare Worker named `landing` — Astro
SSR entrypoint plus the `mercurian_waitlist` D1 binding — and the `mercurian.ai` Custom Domain
is attached to that Worker. This repo declares a Worker with the **same name** in the same
account, static assets only. The first `wrangler deploy` replaces the prototype Worker in
place: the Custom Domain never moves, the SSR entrypoint and D1 binding vanish by absence
(so `POST /api/waitlist` stops existing), and the D1 database survives unbound for a later
decision. No DNS or dashboard work beyond the one-time credential provisioning.

### 2. The address: the page lives at exactly `/astrolabe` (new in v2)

Per the vault's Address ruling, the canonical shareable URL carries the product's name and the
root stays reserved for a future company page.

- **The page moves, the assets don't.** `apps/landing/src/pages/index.astro` becomes
  `src/pages/astrolabe.astro`, content unchanged. We deliberately do **not** use Astro's
  `base` config: the page and `src/styles/global.css` reference public assets by root-absolute
  paths (`/mercury-globe-poster.png`, `/fonts/*.woff2`, `/favicon.svg`), and `base` rewrites
  only Astro-managed asset URLs, not hand-written ones — a whole class of quiet 404s the
  rename avoids. Root-level assets on a product page's domain are ordinary.
- **`build: { format: "file" }`** in `astro.config.mjs` emits `dist/astrolabe.html` rather
  than `dist/astrolabe/index.html`. Cloudflare Workers assets' default `auto-trailing-slash`
  handling then serves `/astrolabe` directly (200) and redirects `/astrolabe/` down to the
  canonical slashless URL. (With the directory form it would be the reverse — the canonical
  URL would grow a slash.) The config also gains `site: "https://mercurian.ai"`.
- **The root redirect rides the assets.** `apps/landing/public/_redirects` (copied verbatim
  into `dist/` by Astro) carries one line: `/ /astrolabe 308`. Workers static assets honor
  Pages-style `_redirects` from the assets directory; the file itself is treated as special
  and never served. Local `astro preview` does not evaluate `_redirects` — the root redirect
  is a platform behavior, verified by the runbook's post-deploy checklist rather than a local
  walk.
- **The postbuild guard follows the page.** `scripts/assert-static.mjs` reads
  `../dist/index.html` today and would fail the build after the rename; it reads
  `../dist/astrolabe.html` instead. Guard logic unchanged.

### 3. The machinery, rebuilt on main (ported from v1)

Three files return from the old branch, amended for the address:

- **`apps/landing/wrangler.jsonc`** — Worker `landing`, `assets.directory: "./dist"`, no
  `main`, no bindings, fresh `compatibility_date`.
- **`.github/workflows/deploy-landing.yml`** — on every push to `main`, no paths filter
  (shared web components can change the landing site — no-drift made operational):
  fail-fast credential check, sparse checkout excluding `.repos/`, setup-vp with the two
  landing/web install filters, `vp run build:landing`, `wrangler@4.104.0 deploy` from
  `apps/landing` under `CLOUDFLARE_API_TOKEN` (secret) + `CLOUDFLARE_ACCOUNT_ID` (repo
  variable), `environment: production`, concurrency group `landing-production`.
- **`docs/operations/landing-deploy.md`** — provisioning, publish/preview/rollback commands,
  and the cut-over checklist, with the address checks added:
  - `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://mercurian.ai/` →
    `308 https://mercurian.ai/astrolabe`
  - `curl -fsS https://mercurian.ai/astrolabe | grep -F '<title>Mercurian</title>'`
  - the waitlist endpoint returns 404/405 and accepts nothing
  - archive the prototype repo; record the unbound D1 decision.

### 4. What this deliberately does not do

No paths filter on the workflow (see above). No waitlist, no analytics, no extra routes. The
inherited upstream `apps/marketing` app is untouched — it dies separately per the fork
baseline. No pushes: PR #87 exists as a draft from this branch name (base = M-174's branch);
at push time it retargets to `main` and undrafts, on Venkat's call.

## Implementation checklist

- [ ] Rename `apps/landing/src/pages/index.astro` → `src/pages/astrolabe.astro` (content
      byte-identical).
- [ ] `astro.config.mjs`: add `site: "https://mercurian.ai"` and `build: { format: "file" }`.
- [ ] `scripts/assert-static.mjs`: guard reads `../dist/astrolabe.html`.
- [ ] Add `apps/landing/public/_redirects` with exactly `/ /astrolabe 308`.
- [ ] Add `apps/landing/wrangler.jsonc` (assets-only, Worker name `landing`).
- [ ] Add `.github/workflows/deploy-landing.yml` (main-push deploy, credential fail-fast).
- [ ] Add `docs/operations/landing-deploy.md` with the v2 cut-over checklist.

## Verification

- The four gates from the worktree root: `vp run build:landing` (includes the postbuild
  guard), `vp run --filter @t3tools/landing typecheck`, `vp lint
--report-unused-disable-directives`, `vp fmt --check`.
- Dist shape: `dist/astrolabe.html` exists; `dist/index.html` does not; `dist/_redirects`
  contains the one redirect line; the poster/fonts/favicon sit at dist root.
- `pnpm dlx wrangler@4.104.0 deploy --dry-run` from `apps/landing` — the credential-free
  proxy: asset manifest uploads, no bindings, no entrypoint.
- Served walk (`astro preview`): `GET /astrolabe` returns the hero page and the island
  hydrates; `/` is expected to 404 locally (the redirect is platform behavior — runbook
  checklist covers it live).
- Isolation: the branch touches only `apps/landing/`, `.github/workflows/deploy-landing.yml`,
  and `docs/` — and the web app's typecheck passes untouched. (The workflow file is this
  issue's deliverable, the one sanctioned step outside `apps/landing`.)

## Conventions detected

- Deploy workflows live in `.github/workflows/` on blacksmith runners with `setup-vp`
  (evidence: `ci.yml`'s landing step, the v1 workflow).
- Operator runbooks live in `docs/operations/` in shipped-product voice (evidence:
  `landing-deploy.md` v1; the docs-audience split in `AGENTS.md`).
- The landing app is static-only, enforced by a postbuild guard (`assert-static.mjs`,
  wired as `postbuild` in `apps/landing/package.json`).
- Plans live in `docs/project/technical-plan-*.md` and record amendments in place (every
  M-17x plan on this project).
