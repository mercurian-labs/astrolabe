# Technical Plan — M-200: The landing page stops polling for an environment that isn't there

**Issue:** M-200 · **Branch:** `venk/m-200-the-landing-page-stops-polling-for-an-environment-that-isnt` · **2026-08-29**

## The defect, traced

The hero island mounts real product components; their hook chain reads atoms built on
`apps/web/src/connection/runtime.ts`'s `Atom.runtime(connectionLayer)`, and the first read
constructs `connectionPlatformLayer` (`apps/web/src/connection/platform.ts:613`). That layer's
`platformConnectionSourceLayer` provides a `PlatformConnectionSource` whose `registrations`
stream is `Stream.tick(PLATFORM_POLL_INTERVAL)` — three seconds, `platform.ts:366/:572` — and
every tick runs `buildPlatformRegistrations`, which resolves the primary environment target
and, when one exists, fetches the discovery descriptor
(`loadPrimaryConnectionRegistration`, `platform.ts:504` → `fetchRemoteEnvironmentDescriptor`,
`packages/client-runtime/src/environment/descriptor.ts` → `GET /.well-known/t3/environment`,
10s timeout).

The reason a static marketing page has a "primary environment" at all:
`readPrimaryEnvironmentTarget()` (`apps/web/src/environments/primary/target.ts:292`) falls
back unconditionally to **window-origin** — the single-origin design that makes the real app
work anywhere. On `mercurian.ai` that origin serves no environment, the fetch 404s, the
failed entry is "skipped and retried on the next poll" (`platform.ts:472`), and the loop runs
for the life of the tab: an endless 404 stream in production and a red console for anyone
who opens devtools.

## Design: a quiet platform source, substituted at the landing build boundary

The fix stops the loop at its root — the landing build swaps in a
`PlatformConnectionSource` that reports **no environments, once, and never ticks** — while
every other export of the platform module stays the real thing. Nothing under `apps/web/`
changes; the substitution is the landing's own build configuration, the same posture as its
scoped CSS overrides of real chrome.

- **`apps/landing/src/runtime/connectionPlatform.stub.ts`** (new) re-exports the real module
  and shadows one name:
  - `export * from` the real `apps/web/src/connection/platform` (imported by a path that
    the substitution plugin exempts, so the stub reaches the genuine file);
  - `export const connectionPlatformLayer = Layer.mergeAll(<real layer>, quietSourceLayer)`
    where `quietSourceLayer` provides `PlatformConnectionSource.of({ registrations:
Stream.make([]) |> Stream.concat(Stream.never) })` — one empty registration list so
    dependent atoms settle into the recorded "no environments" state (the benign state the
    M-187 investigation documented), then silence. Context merge order makes the quiet
    source win; the real tick stream is lazy and, unconsumed, never runs.
- **`astro.config.mjs`** gains a small inline Vite plugin: `resolveId` re-resolves the
  requested specifier and, when the resolution lands on
  `apps/web/src/connection/platform.ts` from any importer other than the stub itself,
  returns the stub's path instead. Interception happens post-resolution because the
  module's importers use relative specifiers — a plain alias keyed on a path string would
  miss them.
- **Rejected alternatives.** Intercepting `window.fetch` for the discovery path would
  silence the network but leave the 3-second timer ticking (and Effect warning) forever —
  a hidden metronome on a page from a team that audits idle cost. Serving a stub descriptor
  would _satisfy_ discovery and escalate into WebSocket connection attempts — explicitly
  worse, per the issue. Seeding atoms was already proven lossy (stream emissions clobber
  seeds — the M-187 finding).
- **Drift posture.** The stub compiles against the real module's types on every landing
  typecheck/build; if `platform.ts`'s surface moves, the landing build breaks loudly rather
  than silently re-polling. Effect code follows `.repos/effect-smol/LLMS.md` conventions.

## Implementation checklist

- [ ] Add `apps/landing/src/runtime/connectionPlatform.stub.ts` (re-export + quiet
      `connectionPlatformLayer`).
- [ ] Add the `resolveId` substitution plugin to `apps/landing/astro.config.mjs`, exempting
      the stub's own import of the real file.
- [ ] Verify against the served build that the network goes quiet and the hero still lives.

## Verification

- The four gates: `vp run build:landing`, `vp run --filter @t3tools/landing typecheck`,
  `vp lint --report-unused-disable-directives`, `vp fmt --check`.
- Served walk (`astro preview`): over a ≥30-second window after load,
  `performance.getEntriesByType("resource")` shows **zero** entries for
  `/.well-known/t3/environment` (today: one every ~3–4s) and zero entries for any other
  API path; no WebSocket attempts in the network log; console free of failed-resource
  errors and discovery warnings.
- Hero regression: island mounts, conversation renders, composer accepts typing with Send
  inert, a checkpoint pick rolls back and "Back to now" returns, pane toggles work.
- Isolation: `git diff main...HEAD --name-only` outside `apps/landing/` + `docs/` is empty;
  `vp run --filter @t3tools/web typecheck` passes untouched.

## Conventions detected

- The landing themes and constrains real product internals from its own side only —
  scoped CSS var overrides, landing-side wrapper hooks (`[data-hero-window]`,
  `[data-hero-composer]`); this plan extends the same boundary to module resolution.
- The landing build already owns Vite configuration through `astro.config.mjs`
  (`~` alias into `apps/web/src`, tailwind plugin) — the substitution plugin lives beside
  them.
- Effect-heavy code follows the vendored `.repos/effect-smol/LLMS.md` reference
  (`AGENTS.md` instruction for `apps/server`, equally applicable to Effect in shared code).
- Plans live in `docs/project/technical-plan-*.md`; verification includes the standing
  isolation step (every landing plan since M-172 v11).
