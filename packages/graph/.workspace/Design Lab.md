# Design Lab

Astrolabe's instrument for evolving its own [[Visual Language]]: a development-build surface where every axis of the product's appearance can be adjusted on the running app — globally, per axis, and per component — and where a promising direction becomes a reviewable change to the product's shipped defaults. It absorbs the design-system catalog: reference and workbench are one surface. Like [[Visual Language]], it sits outside the containment spine — it is an instrument for making the product, not a place in it.

## One surface, dressed as Astrolabe

The Lab fills the main pane, with its own right-hand navigation column. Its pages are of two kinds: **reference** — the catalog's foundations, each component's states shown side by side in both appearances, and the audit of what escapes the system — and **editing** — one page per design axis, and one workbench per component. The whole surface wears Astrolabe's own layout and appearance grammar, taking the [[Settings]] Appearance page as its model; it must read as part of the product, never as a separate documentation site that happens to share an address. It is reached directly, or from the Appearance page in development builds; production builds do not carry it.

## Painting the live app

Every adjustment applies to the whole running app the moment it is made — and stays applied while you leave the Lab, because judging a direction means seeing your real threads wearing it. A quick flip returns you to the Lab exactly where you left it. The inspector completes the loop in the other direction: point at any element anywhere in the app and land on the page that governs it. This is what makes the Lab usable by someone who knows no component names — you design by pointing at the thing.

## The axes

Identity comes from a few decisive, product-wide commitments applied without exception ([[Visual Language]]). The Lab makes each one an adjustable axis:

- **Color** — the semantic roles, in both appearance halves. This axis is the one users already have, as the theme system.
- **Shape** — the corner-rounding stance, one commitment the whole product follows.
- **Typography** — the interface, code, and prompt voices; sizes and scale.
- **Elevation and glass** — how surfaces separate: shadow, border, translucency.
- **Density** — how tightly the interface packs.
- **Line and stroke** — rule weights and the node-and-line grammar of the [[Checkpoint Graph]]; the most Mercurian-specific axis, because the graph is the brand.
- **Motion** — pace, easing, and which working indicators animate at all.
- **Focus and selection** — how attention and choice are drawn.

Layout structure — which panes exist and where things sit — is product design, not appearance, and stays out of the Lab. So do words.

## The component workbench

A component's page shows every state it can be in, side by side, in both appearances, and offers the knobs that component declares. An untouched knob follows the global axes; an adjusted one moves only that component — and moves it in the real app, not just the preview. A knob never offers a variant the product cannot actually render; structural alternatives appear as knobs only while a genuine design question is open, and the losing variant is removed once the question resolves — the Lab must not become a museum of dead options.

## Profiles

Everything adjusted accumulates into a named **profile** — a candidate direction. Profiles switch instantly, so comparing two directions against your real work is one click; a profile travels as a file, so proposing a direction to someone else is sending one. A profile leaves the Lab as a **reviewable change to the product's shipped defaults**, going through normal review like any other change — the product itself never reads a profile at runtime, so the shipped design stays the only source of truth. The lost light-direction exploration ([[Visual Language]]) is exactly what profiles make recoverable: rebuilt in an afternoon and kept, instead of surviving only as a remembered description.

## Guardrails

The Lab is opinionated: it warns — never blocks — when an adjustment breaks the visual language's own rules. Status must stay distinguishable without relying on hue alone ([[Status Vocabulary]]); text must stay readable on its surfaces in both appearances; chrome must not grow louder than the reading surface; reduced-motion preferences must preserve every meaning; focus must stay visible wherever it lands. Each warning cites the rule it protects, so the Lab teaches the visual language while it is being used.

## Theme interoperability

The color axis meets people at the themes they already love. Importing a VS Code theme exists today, deriving a complete palette from what the theme specifies and filling the rest coherently. The planned second door is the Base16/Base24 scheme family — the shared palette format much of the Neovim world speaks, which covers "my Neovim theme" without the Lab needing to understand Neovim itself. The flagship community themes people name — Catppuccin, Tokyo Night, Gruvbox and kin — arrive through their VS Code editions already.

## What exists today

The catalog is a surface of the app (2026-08): it fills the main pane with its own right-hand navigation — reference pages with both appearances and condition toggles, and the audit — reached from the Appearance page, in development builds only; the separate address and chrome are gone. The floating theme editor remains the one adjustable axis, with the Lab's two hardest behaviors already in it: it paints the live app while you browse, and its inspector answers "what paints this element?" by pointing. No other axis is adjustable; profiles do not exist.

## Open Decisions

### Is the Lab a floating panel or a place?

**Resolved (2026-08): a place.** The Lab fills the main pane with its own navigation, absorbing the catalog; the floating shell survives only as the user-facing color editor, a thin face over the same machinery. Given up: editing and browsing side by side — compensated by adjustments persisting across the whole app and a quick flip back to where you left the Lab. A full redesign of the absorbed catalog to Astrolabe's own grammar is part of the resolution, not an afterthought.

### Does the Lab ship to users?

**Resolved (2026-08): development builds only — the whole surface.** Users keep exactly today's theming: themes, the floating editor, imports. The catalog half would be cheap to leave public as a living style guide, but publishing one is a deliberate decision for later, not a side effect of a merge.

### How does a direction become shipped design?

**Resolved (2026-08): as a reviewable change to the defaults.** The alternative — the product reading a chosen profile at runtime — would create a second source of truth that drifts from the first. Given up: promoting a direction without a review step; that step is the point.

### Do the non-color axes ever reach users?

This is [[Visual Language]]'s flagship-versus-grammar fork extended beyond color: if users someday adjust shape or density, themes grow into full appearance profiles and the compatibility surface grows with them. **Recommendation:** defer until a flagship direction has shipped, and let the Lab inform the answer — the profile shape is designed so promoting an axis later is a gate to open, not a rebuild.
