# Settings

Configuration; a section of the [[Left Sidebar]]. Settings holds your connections and preferences — the things configured once and rarely revisited, kept out of the way of the work itself — plus the Archived page, where archived threads come back.

Its contained concepts are [[Environments]], [[Providers]].

## What Settings holds

- **Environments.** Connections to the machines where work runs. Per the resolution on [[Environments]], environments are plumbing, not navigation: they surface here and nowhere else. Repositories themselves are managed in [[Repositories]] — its own sidebar section — where each repository says which environment it's reachable from; Settings is where those environments are connected.
- **Providers.** Connections to the model [[Providers]] that power the [[Assistant]] — accounts, instances, and which models are on offer. Instances are machine-scoped (the resolution on [[Providers]]); Settings is where a machine's instances are managed. No model is chosen here: each branch of a thread carries its choice in its history, seeded by your last use, from its [[Composer]] (the 2026-08 resolutions, as amended, on [[Assistant]]).
- **Teams.** Your Mercurian account, and the [[Organizations|organizations]] and [[Teams|teams]] you belong to: their people and roles, invitations, new teams and new organizations, and each organization's name and policies for who may invite and who may create teams. Signing in is needed only here; everything else in Settings works without an account.
- **Working-state preferences.** _(2026-08-31: renamed from coding-session preferences with the [[Threads]] unification.)_ A [[Threads|thread]]'s working trees are a pooled slot per repository; the **pool size** (default three) lives here, alongside the base-ref preference — whether a new line starts from the repository's latest branch on origin or from your local one (the [[T3code Thread]] pattern) — and the background fetch interval that keeps remote status fresh, zero-able, so credential prompts only follow explicit actions ([[Repositories]]).
- **Vim keybindings.** A device preference, off by default, that gives the [[Composer]] Vim's modes. Turning it on asks you to type `:q` in a small editor first: the one Vim skill that cannot be discovered from inside Vim is leaving it, so the setting proves you have it before it takes your keys. Turning it off is one click. _(2026-09-27, Venkat.)_
- **Confirm-gates.** Optional second-click gates on the disappearance verbs: confirming before a thread is archived, and before a private thread is deleted. What those verbs mean is the lifecycle resolution on [[Threads]].
- **The Archived page.** Archived threads, grouped by project, each restorable — the reversible half of archiving. Delete is not offered here for published threads: once anything is published, a thread's history is shared ([[Publishing]], and the resolution on [[Threads]]).
- **Experiments** (development builds only). Behavior's counterpart to the Appearance page's [[Design Lab]] link — the same development-build gating, applied to parked surfaces rather than appearance. Toggles here re-enable what the shipped product currently withholds; the first is the parked Thread and Columns views of the [[Checkpoint Graph]]. Production builds do not carry the page. A toggle here is never permanent: each exists pending its surface's return or retirement — the page must not become a museum of dead options.

_(2026-09-16: tracker connections retired with issue import under the plan-first ruling on [[Mercurian]]; if a thread ever starts from an issue again, the connection returns here.)_

## Reconciling against t3code's settings

The reference pattern is documented as built in [[T3code Settings]].

- **Transfers:** settings as a place you go rather than a dialog (the sidebar yields to settings navigation); the Archived page as the reversibility surface; provider instances with model curation; the worktree start-from-origin preference; confirm-gates on the disappearance verbs.
- **Inverts:** t3code's Connections page makes environments first-class — pairing flows, tunnels, remote machines as visible objects. Mercurian resolved the opposite ([[Environments]]): environments are plumbing, surfaced only here.
- **Doesn't transfer yet:** keybindings beyond the Vim toggle, and Git-glue settings (text-generation model, source-control discovery) belong to surfaces Mercurian hasn't designed. They can accrete here when those surfaces exist rather than being designed in advance.
- **Appearance — reconciling now:** users keep the inherited theming (built-in themes, the floating theme editor, theme import), and in development builds the Appearance page links into the [[Design Lab]] — the dev-only surface where the rest of the appearance system is designed. The Appearance page is also the Lab's model for layout and appearance: the Lab dresses as this page does, not as a separate site.

## What exists today

The `apps/mercurian/web` playground's General page carries the Vim keybindings switch (2026-09-27), the single-key leader switch, and an **Appearance** choice of System, Light or Dark, remembered per device and following the system live while System is chosen _(2026-09-30, Venkat: "Add a light + dark + system theme toggle in the settings")_; the rest is a placeholder.

## Open Decisions

### Is archiving personal or team-wide?

The lifecycle resolution on [[Threads]] made archive the only disappearance for published threads — which raises who a thread disappears _for_. A fully private thread lives only on your machine ([[Environments]]), so archiving it is inherently personal. A published thread sits in the shared list: archiving it **team-wide** tidies the tree for everyone — reversible from this page, so low-stakes — while a **personal** archive lets your tree and a teammate's quietly diverge. **Recommendation:** team-wide. The project tree is a shared surface, and anyone can restore from the Archived page; per-person trees would make "what's in this project?" answer differently per viewer without buying much.

**Resolved (2026-07): workspace-wide — with the workspace question deferred.** _(Recorded before "workspace" was retired; it meant what is now a team.)_ Archiving tidies the tree for everyone in the workspace; anyone restores from this page. The successor concept this decision surfaced — **personal workspaces beside shared workspaces, with role-based permissions** ([[Teams]]) — is deliberately deferred until cloud features begin: Astrolabe is local-first, cloud is an optional add-on, and until it arrives the local workspace is effectively personal and the distinction has no surface. _(2026-09-16: teams are now the first audience ([[Mercurian]]); this deferral is the first thing the collaboration pass must revisit.)_

_(Reopened 2026-10-10.)_ Publishing now sends a copy of the thread to its team, and the thread itself stays on your computer ([[Publishing]], [[Sync]]). There is no shared tree for an archive to tidy: your list is yours, and a team's threads are on its board. **Archive stays yours, and taking a thread private is how it leaves the team:** archiving tidies only your own list, and the share dialog's take-private stops a published thread for everyone, though what was already shared stays shared. **Archive also takes it private:** one action leaves both lists. **Recommendation:** archive stays yours. Tidying your list and withdrawing work from a team are different acts, and only the second should reach other people. Given up: one action that clears a thread everywhere.
