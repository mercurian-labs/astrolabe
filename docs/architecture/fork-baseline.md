# ADR 004: Fork baseline — what of t3code Astrolabe keeps

**Status:** Proposed — drafted 2026-07-17 from decisions taken at backlog review (Venkat); review and acceptance tracked on M-120.

## Context

The step-by-step port of t3code patterns onto the scaffold was abandoned on 2026-07-17. The scaffold was retired to `astrolabe-scaffold` (reference only) and astrolabe was reborn as a git fork of t3code: `origin` → `mercurian-labs/astrolabe`, `upstream` → `https://github.com/pingdotgg/t3code.git`, full upstream history preserved (1,947 commits), zero divergence at fork time.

Facts that shape the decision:

- **Upstream is active.** Roughly 300 commits in the 30 days before the fork, with bursts above 10/day. Recent work concentrates on the mobile app and terminal/preview surfaces — code Astrolabe reuses (phases 4 and 6 of the backlog are largely adaptation of these surfaces).
- **The vault has resolved against some of what the fork ships.** Environments as first-class navigation ("Environments", resolved: plumbing — "environments never appear as a navigational concept") and the plan/default interaction mode ("Assistant", resolved: "planning stays mode-free; coding sessions carry the three-tier t3code runtime modes"). These surfaces exist in our codebase now; their removal must be deliberate and citable.
- **License.** Upstream is MIT, Copyright (c) 2026 T3 Tools Inc.

What was given up in choosing the fork over the port: the scaffold's working prototype of the conversation tree and publish-with-ancestors walk. It returns as new code on the fork's substrate (backlog 010); the scaffold remains the reference for those semantics.

## Decision

### 1. Upstream relationship: bounded tracking

Keep the `upstream` remote and merge `upstream/main` on a regular cadence — weekly, and additionally before starting work on any surface the backlog adapts (providers, session runtime, thread view, worktree lifecycle, settings). Rationale: the backlog's phases 4 and 6 are mostly adaptation of actively-developed upstream code; inherited fixes are worth real money exactly while those surfaces are still recognizably t3code's.

Discipline while tracking:

- Mercurian code is **additive where practical** — new packages and modules beside upstream's (e.g., the commit store lands beside the thread model, per backlog 010), minimal edits inside upstream-owned files.
- **No tree-wide renames or rebranding** while tracking — they are merge-conflict factories (see §3).
- Invasive restructuring is scheduled after high-churn adaptation work where the ordering is free.

**Cut-over trigger** (whichever comes first): the app-shell reshaping (backlog 020) lands on `main`, or a routine upstream merge costs more than a working day to resolve. At the trigger, reassess; the expected outcome is a cut to hard fork. The cut is recorded by amending this section with the date and the state merged last — after it, upstream fixes arrive only by deliberate cherry-pick.

Given up: the freedom to restructure and rebrand immediately, and some ongoing merge tax. Alternatives declined: *hard fork now* (forfeits ~300 commits/month of fixes to a runtime we are actively reusing) and *indefinite tracking* (permanently constrains how invasively the sidebar, thread view, and settings can be reshaped — incompatible with the app-shell phase).

### 2. Dispositions for out-of-design surfaces

*Parked* means: stays in the tree, excluded from CI, builds, and releases, unmaintained and unshipped. Parked code merges cleanly from upstream and costs nothing but tree weight; stripping before cut-over buys recurring conflicts. Parked surfaces are deleted or revived by a later amendment to this ADR, not silently.

| Surface | Disposition | Rationale / governing note |
|---|---|---|
| `apps/mobile` | **Parked** | No Mercurian mobile design exists in the vault; upstream churns here most, so parking keeps merges clean. Revival requires a vault design first. |
| `apps/marketing` | **Parked** | Upstream branding; never ships under Mercurian. Delete at cut-over. |
| `packages/ssh`, `packages/tailscale` | **Parked** | Remote-environment plumbing; candidates for the cloud phase ("Environments" defers the shared workspace). Revisit then. |
| Plan/default interaction mode | **Stripped at backlog 062** | "Assistant" (resolved): planning is mode-free; sessions carry runtime modes only. Until 062 it remains as shipped-by-upstream behavior in unreshaped surfaces. |
| Environments-as-navigation (connect flows, per-environment icons) | **Stripped at backlog 020/040** | "Environments" (resolved: plumbing). A repository's row says where it lives; nothing navigational remains. |
| `.repos/` vendored references, `experiments/` | **Kept** | Read-only reference material, synced with dependency versions per upstream convention. |

### 3. Branding, design, and license *(amended 2026-07-17, second review)*

Split three ways:

- **Now (backlog 024):** the user-visible identity — product name, wordmark, icons, window/tab titles — switches to Astrolabe/Mercurian while t3code's design system stays untouched. The swap rides the fork's centralized branding seam (`apps/web/src/branding.ts` and the asset files), keeping the diff small and upstream merges cheap.
- **At cut-over:** internal renames (package names `@t3tools/*`, app identifiers, release artifacts) — tree-wide renames would poison every upstream merge — **and the Mercurian design-system rework**. The light-theme rework and dark derivation are deliberately reserved for the hard fork; until then the product wears t3code's design under Mercurian's name. Exploration to date is parked in the `astrolabe-light-rework` artifact (sketch series: Spline Sans chrome, oat/cream flat elevations, functional palette, status vocabulary, DAG shape grammar) as the starting point for that work.
- **Always:** MIT obligations — the `LICENSE` file and the T3 Tools Inc. copyright and permission notice are retained in the repository and in any distributed artifact. Mercurian's own additions may carry their own notices alongside; nothing removes upstream's.

Given up, deliberately: the app keeps t3code's look — including its dark theme — until cut-over.

## Deferred to later decisions

- Packaging and release identity under the Mercurian name (lands at cut-over, per §3).
- Contribution posture: whether generic fixes made while tracking are offered upstream (upstream is currently "not accepting contributions").
- Revival criteria for parked surfaces (mobile: vault design first; ssh/tailscale: cloud phase).
- Keep-or-strip of t3code's appearance, keybinding, and Git-glue settings — owned by the vault as backlog 071's gating open decision, referenced here but not decided here.

## Open questions

- Does bounded tracking survive contact with the first big merge after phase-2 work begins? The cut-over trigger is deliberately cheap to pull.
- Where upstream's direction and Mercurian's design conflict inside a kept surface (e.g., upstream reworks the thread view we are reshaping), which side yields is a per-merge judgment until cut-over; no rule is pinned.
