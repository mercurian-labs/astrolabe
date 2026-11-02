# Repositories

The Repositories section of the [[Left Sidebar]]: where the codebases Mercurian can reach are added, seen, and managed. A repository is what a thread grounds in ([[Teams]], "derived, never assigned") and where its turns edit ([[Threads]]) — one surface answers "what code can Mercurian reach, and how." The built pattern this reconciles against is [[T3code Source Control]].

## How repositories enter

The three t3code add paths transfer: pick a **local folder**, **clone a git URL**, or **clone via a hosting provider** by short path — the provider paths offered only when that provider is detected and authenticated. A repository lives on the [[Environments|environment]] where its files are (local-first: your machine), and its row says so. _(2026-09-24: a checkout on a machine is what lives here. A [[Teams|team]] holds the repository itself, recognized by its remote on every machine, and each checkout joins the team by that match; a repository in a team with no checkout on this machine is offered for cloning.)_ This page is the only place a repository enters: dialogs that touch a team's repository set ([[Teams]], "Creating a team") link here with a **Manage Repos** button rather than embedding the add flow. (Amended 2026-08-27 — an earlier design surfaced the flow inline in project creation; it overwhelmed the dialog.)

Git is expected but not demanded at add time: grounding reads files regardless, while everything working-tree-shaped — worktrees, diffs, building — lights up only when the repository actually is one. Adopted from t3code, where any directory can be a project.

## The repository row

A repository shows its name, path, and environment; its **hosting provider and authentication standing**, derived from its remotes; and its **scripts**. Removing a repository disconnects it — grounding references already in thread histories are record, not links, and stay — but removal is refused while live worktrees exist, per the teardown floor on [[Threads]].

## Hosting providers: detected, never configured

The t3code pattern transfers whole ([[T3code Source Control]]): providers are **detected** — presence by probing the tool, identity by asking it who's signed in — with a status and an exact remedy when something's missing, and never a login flow of Mercurian's own (the [[Providers]] temperament, applied to hosting). There are no enable toggles; availability is a fact about the machine.

Which provider serves a repository is **derived from its remotes** — "derived, never assigned," applied to hosting. An authenticated provider lights up: create-PR from the thread's git actions ([[Threads]]), PR status on the thread's record, and publish-repository for a repository with no remote yet. The background fetch interval that keeps remote status fresh lives in [[Settings]], zero-able so credential prompts only follow explicit actions.

## Scripts

Scripts travel with the repository, as the thread's header already assumes ([[Threads]]): a primary action plus a menu, run in the line's slot with output in the terminal tab; a script can declare a preview address (opening the browser preview) or be flagged **setup**, running automatically when a worktree is created. Scripts are declared and edited here, on the repository.

## What exists today

An empty placeholder page. Nothing can be added, and no discovery runs.

## Open Decisions

### Where does hosting-provider discovery live — here, or in Settings?

t3code puts discovery in settings; Mercurian elevated repositories to a sidebar section. On the **Repositories page**, one surface answers "what code can Mercurian reach and how it talks to its hosts," and [[Settings]] stays preferences-only. In **Settings**, hosting providers sit parallel to agent [[Providers]] — configure-once things in the configure-once place. **Recommendation:** here, on the Repositories page — discovery status is about the repositories' world, and the parallel with agent providers is looser than it looks: agent instances are curated and labeled, hosting providers are only observed.

**Resolved (2026-07): here, as recommended.** One surface answers "what code can Mercurian reach and how it talks to its hosts"; [[Settings]] stays preferences-only. Given up: the configure-once symmetry with agent [[Providers]].

### Are scripts app-owned or repo-owned?

App-owned scripts (declared in Mercurian, per machine) keep repositories unpolluted but don't travel; a checked-in file (repo-owned) travels with the clone and would be shared with a team for free. **Recommendation:** app-owned for the local-first phase — no format to design, no repo pollution — with repo-owned import as the later path if shared scripts are wanted once [[Teams]] exist.

**Resolved (2026-07): app-owned, as recommended.** Given up: scripts that travel with a clone; revisit alongside [[Teams]] if shared scripts are wanted.

### Does provider-clone ship in the local-first phase?

Folder-pick and URL-clone cover every local-first need; provider-clone adds lookup-by-short-path convenience at the cost of building against N provider tools early. **Recommendation:** design it in, ship it last — the add flow shows the path gated on detection (exactly t3code's gating), and the phase can ship with only folder and URL enabled.

**Resolved (2026-07): designed in, shipped last, as recommended.** The add flow's provider paths are part of the design and gate on detection; the local-first phase is complete with folder and URL alone.
