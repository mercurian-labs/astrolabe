# Technical Plan — M-174: Below the fold — live surfaces paired with canonical claims

Generated from the Goal/AC of Linear issue M-174. Goal in one sentence: below the hero and graph
story, the landing page shows the product's other real surfaces — plan artifact, composer, status
vocabulary — each paired with one claim quoted from the design, static page between demos, closing
on positioning with no call to action.

Baseline: `docs/project/technical-plan-m-171-marketing-site-foundation.md` holds — `apps/landing`
on `main` (PR #76), `~` alias into `apps/web/src`, shared tokens, island pattern proven. Design
sources: almagest **Marketing Site** ("a short sequence of sections, each pairing one live surface
with one claim … Static page between demonstrations; no ambient motion anywhere" and the resolved
"What does the site ask a visitor to do?" — close on positioning, no signup) and **Visual Language**
(the claims quoted below).

## Conventions Detected

- **Each demo surface has a catalog-proven standalone mount** (all in
  `apps/web/src/components/mercurian/`): High.
  - `PlanArtifact.catalog.tsx` — `PlanArtifact` renders from `{ planId, parentCommitId, planText,
timeline }` + `readOnly`; fixture helpers `PlanId.make`, `commitId`, `planRevision`, `timeline`.
  - `PlanComposer.catalog.tsx` — `PlanComposer` renders from placeholder/text/attachments +
    `gateNotice` (`planningModelGateNotice` from `PlanComposer.logic`), a `modelPicker` ReactNode,
    and inert handlers. Lexical-based: heaviest island on the page, but proven.
  - `PlanStatusDot.catalog.tsx` — `PlanStatusDot` takes `status` (`"awaiting-input" | "working" |
"unseen"` seen in catalog; read the component's exported status type and render **every**
    member, labeled).
- **Islands mount `client:only="react"`** with the graph demo precedent
  (`src/islands/CheckpointGraphDemo.tsx`). High.
- **The zero-JS guard must be re-scoped by this issue** — identical situation and **identical
  pinned replacement** as in `technical-plan-m-173-graph-story.md` (whichever branch lands first
  carries it; the other merges clean): every `<script` in `dist/index.html` must be an Astro island
  hydration module (`type="module"` with `src` starting `/_astro/`, or Astro's generated hydration
  inline); anything else fails the build with the offending tag printed. High.
- **Merge order** — 172 (hero rewrites `index.astro`) → 173 (story section) → 174 (this). This
  branch bases on main's placeholder index; its index edit is section imports + elements + the
  close, so the rebase conflict is small and mechanical. Medium (order set by this series, not
  discovered).

## Design

### Three demo islands (new, in `src/islands/`)

- `PlanArtifactDemo.tsx` — `PlanArtifact` `readOnly` with a realistic short plan text (a plan about
  the marketing site itself, consistent with the graph story's fixture narrative), mirroring the
  catalog's `baseProps` shape.
- `PlanComposerDemo.tsx` — `PlanComposer` in the "ready to send" state: resolved `gateNotice`, a
  static model-picker button (catalog precedent), prefilled text `Ask the assistant to refine this
plan`-style prompt, inert handlers. It renders; the visitor can type; nothing sends.
- `StatusVocabularyDemo.tsx` — a labeled row: one `PlanStatusDot` per status the component's type
  exports, each with its product name beneath (e.g. Awaiting input / Working / Unseen updates).
  If the full set is just visual dots, this island is tiny — that is fine.

### Sections and the close (`src/components/` + `index.astro`)

A `Section.astro` (or three explicit sections — implementer's choice, whichever reads simpler) each
pairing claim + demo, appended to `index.astro` below the existing content, in this order, with the
**pinned claims quoted verbatim from the vault** (do not paraphrase, do not invent):

1. Plan artifact (readOnly island): claim — `The current plan artifact is authoritative and
visually stable.`
2. Composer island: claim — `Suggestions are offers, not actions.`
3. Status vocabulary island: claim — `Status is economical — one strongest signal per plan.`
4. **The close** (static, no island, no form, no button): the positioning line
   `Mercurian turns engineering issues into plans.` followed by the quoted invariant
   `"All issues can form plans, but not all plans are formed by issues."` Nothing else — no
   signup, no mailto, no "get started".

Also in this issue: remove the M-171 placeholder "Checkpoint Graph demo" link from the landing page
if it is still present after rebase (the page must read hero → story → sections → close; the
`/demo/checkpoint-graph` page itself stays). Between demonstrations everything is static Astro
markup — no ambient motion, no scroll effects, no CSS animations.

## Implementation Checklist

- [ ] The three islands per the design, mirroring their catalog entries' props (adapt if a prop
      shape changed — the catalog entry is the source of truth).
- [ ] Sections + close appended to `index.astro`, claims verbatim; placeholder demo link removed.
- [ ] Re-scope `scripts/assert-static.mjs` exactly as pinned in the M-173 plan (skip if already
      landed via M-173 — check the file first).
- [ ] No new dependencies; no changes to `astro.config.mjs`, CI, root scripts, or anything under
      `apps/web/` / `apps/marketing/`. No animations or scroll listeners anywhere in new code.

## Test Plan

- [ ] `node_modules/.bin/vp run build:landing` passes with the re-scoped guard; built
      `dist/index.html` carries only `/_astro/` island scripts.
- [ ] `node_modules/.bin/vp run --filter @t3tools/landing typecheck`, `vp lint`, `vp fmt --check`
      pass.
- [ ] Browser walk: all three surfaces render styled and live (artifact scrolls/reads; composer
      accepts typing; status dots match the app's rendering); the three claims appear verbatim;
      the page ends on the positioning close with no interactive CTA; no motion anywhere between
      demos.
- [ ] Grep built HTML for `waitlist`, `T3`, signup vocabulary — none present.
