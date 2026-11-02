# Environments

An environment is a place where Mercurian's work runs. There are two kinds: the **Mercurian cloud** — hosted, where your [[Organizations|organizations]], their [[Teams|teams]], and all published history live — and **local environments** — your own machine, where repositories on disk are reachable and single-player work happens. Mercurian runs as a desktop app or in the browser, and a local environment can serve the app to your browser directly — the desktop shell and the browser open the same product.

Anything multiplayer belongs to the cloud; anything bound to your machine — above all, the repositories that ground research — belongs to a local environment. A repository's environment is where its files are read from when the [[Assistant|assistant]] grounds a reply.

## Open Decisions

### How visible are environments to the user?

The shell this design adapts (t3code) makes environments first-class: connect flows, per-environment icons in navigation, threads scoped to an environment (how far that goes is documented in [[T3code Settings]]). The alternative is plumbing: a repository simply says where it lives, and environments never appear as a navigational concept. **Resolved: plumbing.** A repository's location surfaces in [[Repositories]] and connections are managed in [[Settings]]; Mercurian's unit of work is the thread, not the machine. This also answers containment: environments live inside [[Settings]], not the [[Left Sidebar]]. Given up: environment awareness in navigation — if that's ever missed, it's a surface inside [[Settings]], not a sidebar concept.

### Where does unpublished planning live?

Private work — planning you haven't published — could live in a local environment (single-player work stays on your machine) or hosted-but-private in the cloud (private work follows you across machines). **Recommendation:** local, per the current direction that single-player work happens locally. The cost accepted: private work is machine-bound until published. The benefit: [[Publishing]] becomes the one deliberate moment work crosses into the cloud — a publish is an act, not a replication, which keeps the design's "refresh, not sync" temperament consistent here too.

**Resolved (2026-07): local — reinforced by the local-first architecture.** Astrolabe is local-first; cloud features, including the hosted side, are optional add-ons layered later. One carve-out was decided with it — a thread born from tracker import started published — and retired with issue import on 2026-09-16 ([[Publishing]]). _(The hosted side this note describes, called the shared workspace when this was written, is the seam the teams-first direction on [[Mercurian]] must now design through. 2026-10-09: it is the Mercurian cloud, and it runs no agents; it holds teams and what is published to them ([[Strategy]]).)_
