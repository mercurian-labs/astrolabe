# T3code Source Control

How t3code handles repositories, version control, and hosting providers — documented as built, verified against the t3code repository, in product terms. Nothing here is settled Mercurian design; the reconciliation lives on [[Repositories]]. The settings page this describes is one page of [[T3code Settings]]; the git actions it powers live on [[T3code Thread View]].

## How repositories enter

Three add paths, none of them a "connect" flow: pick a **local folder** from a filesystem browser; **clone a bare git URL**; or **clone via a hosting provider** by short path (`owner/repo` and its equivalents), resolved through that provider's tooling. Provider-clone paths are offered only when the provider is detected and authenticated; folder and URL always work.

**Git is not required to add a project.** Any directory becomes a project; version control only gates the features that need it — worktrees, diffs, git actions, pull requests.

## Discovery you review, not configuration you author

The Source Control settings page probes the machine and reports, with a rescan button:

- **Version control** — git is probed by running it; the row shows the detected version and expands to the page's one real setting: the **background fetch interval** (how often remote branch status refreshes; zero turns background fetching off so credential prompts only ever follow explicit actions). A second VCS (Jujutsu) is advertised as coming soon regardless of what's installed.
- **Hosting providers** — GitHub, GitLab, and Azure DevOps are detected through their CLIs: presence by running the tool, identity by asking it who's signed in ("Authenticated as X"). Bitbucket has no CLI and is detected through server-side credential variables. Each row shows a status dot and the exact remedy when something's missing — an install command, or "sign in with the provider's tool."
- **The toggles gate nothing.** Every row's switch is permanently disabled — a read-only indicator of installed-plus-authenticated. There is no enable/disable act anywhere on the page; availability is purely a fact about the machine.

Signing in is never t3code's job — the same temperament as [[T3code Providers]]: status surfaced, remedies named, no login flow of its own.

## The provider is derived from the repository

Which hosting provider actually serves a repository is never chosen in settings: it is **detected from the repository's git remotes**, preferring origin. Credentials are global to the environment; the provider that applies is a per-repository fact, resolved live. Even vocabulary follows the detection — GitLab repositories say "merge request" where the others say "pull request."

## What an authenticated provider lights up

Create a pull request from a thread's git actions (title and body on generated offer); PR status icons on sidebar thread rows ([[T3code Sidebar]]); review-a-PR threads — paste a PR URL or number, and a thread opens on a checkout of it, in the main checkout or a dedicated worktree; and publish-repository for a project that has no remote yet. All of it is gated by the same discovery readiness the settings page displays, with the same remedy messages when it isn't.
