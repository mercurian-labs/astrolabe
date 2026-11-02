# Mobile App

Mercurian's native phone and tablet client — built for **following and steering on the go**: watching [[Threads|threads]] evolve, answering the [[Assistant|assistant]], approving what a turn asks, and reviewing its work from wherever you are. It is consumer-only, the posture inherited from the shell it adapts ([[T3code Settings]]'s environment publishing): the phone never hosts work, it pairs to the machines that do, and every client watches the same live state at once.

The mobile client is a window onto the same product, not a second product: it renders the concepts the rest of this vault defines — the thread list of the [[Left Sidebar]], the thread space of [[Threads]], the [[Checkpoint Graph]] — and where a concept's note says how something behaves, that behavior holds on the phone unless this note records a deliberate divergence.

## The focused subset

**Resolved (2026-08): the mobile client is a focused subset, not full parity.** The shell's own mobile philosophy — a deliberately focused surface for following and steering agents — is adopted for Mercurian. What mobile is for: seeing what's in flight, reading and answering a thread's conversation, walking its history and continuing from a checkpoint, steering building turns (approvals, review comments, follow-ups, finishing git acts), and being told when something needs you. What mobile deliberately lacks, staying desktop-first: creating threads, the Columns history view at phone width, browser preview, and hosting or exposing work. Given up: the guarantee that anything doable at the desk is doable on the phone; the subset can grow later, and growing it is cheaper than shrinking it would have been.

_(2026-09-24: the desktop and web app hold views in [[Panes|panes]] within [[Tabs|tabs]]; the phone shows one view at a time, with no tabs or splits.)_

## Touch divergences

Two recorded departures from resolutions made for the pointer-driven client. Both exist because touch has one pointing act where a pointer has hover and click:

1. **On the history map, tap inspects; acts navigate.** Desktop resolved that clicking a node picks it ([[Checkpoint Graph]], 2026-08-19). On touch, tapping a node instead summons its detail — the node popover's content as a sheet — and the popover's act (_go here_) is how the thread space moves. The desktop fallback (where a node has no continuation act, click summons the popover) is promoted to the rule. Reason: picking navigates the thread space, and on a dense map under a thumb, accidental navigation is expensive in a way an accidental click is not.
2. **The history map is its own screen.** On the phone every [[Thread Tabs|thread tab]] opens as its own screen, since the phone shows one view at a time, and the map is one of them. _(2026-09-24: formerly the right sidebar's phone-width ruling stacked its pane above the conversation, and the map alone departed to full screen.)_ Reason: a pannable, zoomable map inside a vertically scrolling stack makes every drag ambiguous between moving the map and moving the page.

Everything else transfers: the calm camera's easing, the glyph-and-status-dot node grammar, the minimap (joined by a fit-to-view control), and the Thread view as the default history reading. A remembered Columns choice falls back to Thread at phone width the same way it falls back on a linear history, returning on a tablet.

## Awareness

Push notifications are why the client exists with the app closed: a thread's turn ending, a thread entering awaiting-input ([[Status Vocabulary]]). Opening a notification lands on the thing it concerns. Notifications follow pairing — a phone hears only from the machines it is paired to.

## What exists today

The client exists but is entirely the adapted shell's experience — threads, terminal, diff review, pairing — with no Mercurian surface on it. Nothing this note describes is built for mobile yet; the thread experience it adapts is built on desktop and web.

## Open Decisions

### What is the app's identity while Mercurian grows inside it?

The client today carries the adapted shell's name and store identity. Three readings: **rebrand now** (the product's name from the first Mercurian surface; costs store re-listing and re-pairing while the surfaces are still landing), **Mercurian surfaces inside the existing shell** (ship the subset under the current identity, rebrand once the surfaces stand), or **a second app** (clean identity, permanent cost of two clients). **Recommendation:** Mercurian surfaces inside the existing shell now, rebrand as a deliberate release moment once the subset is walkable end to end — identity is a launch decision, not a build decision.

### How do the shell's mobile improvements keep arriving once the client diverges?

The shell Mercurian adapts keeps evolving, and its mobile improvements have flowed in continuously while the client sat unchanged. Once Mercurian surfaces land, every arrival can collide with them. The web client already lives with this trade. **Recommendation:** keep the flow, accept the collision surface — the same posture the rest of the product takes — and revisit only if reconciliation cost starts crowding out feature work.
