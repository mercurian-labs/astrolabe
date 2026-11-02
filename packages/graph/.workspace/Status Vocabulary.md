# Status Vocabulary

The product-wide vocabulary of states Astrolabe communicates about work — a finite set, each state with one meaning everywhere it appears. The vocabulary is the contract between the surfaces that show state and the [[Visual Language]] that renders it: a surface chooses how a state looks in its own context, but never invents a new state or reuses one to mean something else. Like [[Visual Language]], it applies across surfaces rather than living in any one place, so it sits outside the containment spine.

Each state's semantics live with the note that owns it; this note names the families and points home.

## The families

- **Attention** — work signaling it needs you. Owned by the thread row ([[Left Sidebar]]): awaiting your input, assistant working, unseen updates. On a row one shows at a time — "the most urgent wins" — and the [[Search Palette]] ranks by the same urgency.
- **Lifecycle** — where work stands, not what it needs: a draft not yet born as a thread ([[Threads]], [[Left Sidebar]]), private versus published ([[Publishing]]), and pinned, settled, snoozed, or archived ([[Left Sidebar]]).
- **Gates** — the [[Composer]]'s four can't-reply states: no model chosen yet, the provider isn't on this machine, signed out, the model isn't available on this instance ([[Providers]]). Information about where to fix it, never a refusal.
- **Interruption** — a stopped turn's interrupted response and a query honestly marked unanswered ([[Checkpoint Graph]]); a partial checkpoint, and a departed turn ([[Threads]]).
- **Interaction** — selection and focus. Not facts about the work, but part of the same rendering contract: always visible, consistent across surfaces, never carried by hue alone.

_(2026-09-16: two families retired with the plan-first ruling on [[Mercurian]]: **Honesty** — the stale-spec and stale-plan position warnings — and **Readiness** — ready to implement. The [[Checkpoint Graph]]'s corner status dots, which carried them, stand empty until a state earns the place.)_

## Rules

- **One meaning per state.** A treatment that means "awaiting your input" on a sidebar row means the same in the palette; nothing borrows a state's look for a different fact.
- **Never hue alone.** Per [[Visual Language]], every state "remains distinguishable without relying on hue alone" — shape, position, text, or assistive naming always accompanies color.
- **Co-occurrence is the surface's rule.** When several states are true at once, the surface's own composition decides: a thread row shows the most urgent ([[Left Sidebar]]), graph nodes stack their corner status dots ([[Checkpoint Graph]]).
- **A new state is a design decision.** If a surface needs to say something this vocabulary can't, that's an addition here — with an owning note — not a local invention.
