# Teams

A team is where people work together: a named group inside an [[Organizations|organization]] that holds a set of repositories and, when designated, a [[Memory|memory]], and the [[Threads|threads]] its members have published into it ([[Publishing]]). Your own threads stay on your computers until you publish them. _(2026-10-09: this note was Workspaces, and before 2026-09-24 Projects. The concept was renamed and split in two; see "Why teams, inside organizations" below.)_

A team's published threads, with the forks and transfers that relate them, form its shared [[DAG]]; a thread never branches inside itself ([[Threads]]).

Its contained concepts are [[Threads]].

## Why teams, inside organizations

_(2026-10-09, Venkat.)_ "Workspace" was carrying three meanings: T3 Code's word for the directory an agent works in, this container, and the arrangement of panes and tabs a person has open. T3 Code's meaning is upstream and stays. The product no longer uses the word: this container is a **team**, and the arrangement is a [[Spaces|space]]. The vocabulary rule that came with it: the vault owns product terms, T3 Code's glossary owns T3 Code's, and a product word never reuses a T3 Code word with a different meaning.

Linear serves small teams and enterprises of many teams with two levels, and Mercurian takes the same two. The **organization** is the company boundary: who belongs, their roles, and everything an administrator governs ([[Organizations]]). The **team** is where the work is: its repositories, its memory, and its published threads. A person's first team creates its organization silently, so a small team never has to see the second level until it grows. Given up: one level, and with it the simplicity of a single container that is both the people and the work.

A team is not a T3 Code project. A T3 Code project is one checkout of one repository on one machine, and a team holds repositories that each member checks out on their own machines ([[Strategy]]).

## What a team holds

A team holds **repositories**, not checkouts. A repository is recognized by its remote wherever it is checked out, so the same repository on your laptop, your desktop, and a teammate's machine is one member of the team. Each person's T3 Code projects match a team's repository by that remote. A published thread records the repository it works in, so continuing a teammate's thread offers your own checkout of the same repository first. A folder with no remote cannot be matched across machines and cannot be shared.

A thread lives in one T3 Code project, so it has one home repository: the checkout its agent stands in. The team's repository set is still the context the thread grounds in, and the rule "derived, never assigned" still holds: the set is a default, not a stamp on any thread (resolved below). Reaching another repository from inside a thread's turn is open, below.

A team's [[Memory|memory]] is its standing knowledge. Designating a memory is a team setting beside its repositories.

## Who sees a team

Every member of an organization sees every team in it, as in Linear's public teams, and can join one or leave it. A guest sees only the teams they were invited into. A team's published threads are visible to everyone who sees the team ([[Collaborative DAG]]). Private teams, visible only to their members, are not designed yet.

## Your own work

Your own threads need no account. They are every T3 Code project on the computers you are connected to, grouped by repository; nothing is stored for them and nothing names them (resolved below). Teams need an account and live in the control plane ([[Strategy]]). Signing in needs no computer: with none connected you can still read and review your teams' threads, and anything that runs an agent says a computer is needed (2026-10-09, Venkat). How the app shows your threads and your teams' together is on [[Sync]].

## In the sidebar

Your teams' published threads stand in the [[Left Sidebar]]'s **From your team** section, below your own threads, each naming its author, and a team's board shows all of them by family or by person ([[Collaborative DAG]]). Each row carries its repository as context. A team's management (people, repositories and memory) and **new team** are in [[Settings]]. There is no status rollup: a thread's status ([[Status Vocabulary]]) lives on its own row.

_(Amended 2026-10-10.)_ A team switcher at the top of the sidebar named exactly one team, or the personal workspace, and scoped the whole list to it. With the personal workspace retired and your own work needing no container, the list is always yours and teams join it as a section ([[Left Sidebar]]). Given up: a sidebar showing one team's threads in place of your own.

## Creating a team

The new-team action (in [[Settings]], and in the [[Search Palette]]) opens one dialog: name the team and choose its repositories in the same act. The picker offers the repositories this machine already knows ([[Repositories]]), and a **Manage Repos** button beside it takes you to the Repositories page, because adding repositories stays that page's job. With no repositories registered yet, the picker gives way to just that button. Choosing repositories at birth is offered, never required.

(Amended 2026-08-27: the first design embedded the Repositories page's add flow inline in the dialog; walked in the running app, the flow's mode rows and provider list dwarfed the name field. The add flow lives on the Repositories page only, and every dialog that touches a repository set links there with the same **Manage Repos** button instead of embedding or duplicating it. Given up: creation never leaving the dialog when the team is empty. The button is an honest door, not a detour hidden behind one.)

The new-team flow offers the same [[Memory|memory]] repository-and-directory control as team settings, and the saved choice remains visible and editable there.

Creation selected a scope until 2026-10-10: the new team became the [[Left Sidebar]]'s current scope. The list has no scope now, so a new team appears among your teams in [[Settings]], with its board ready for what its members publish.

## Creating a thread

A thread always starts as your own, from the sidebar's new-thread action, in one of your projects. It is born blank and stays a draft until its first message; see the first-commit rule on [[Threads]]. It reaches a team only when you publish it ([[Publishing]]). Continuing a teammate's thread also starts a thread of your own, offering your checkouts of the same repository first ([[Collaborative DAG]]).

_(Amended 2026-10-10.)_ A new thread used to start in the scoped team at its default home repository, offering to clone that repository when this machine had no checkout. With no team scope, threads start in your projects. Given up for now: cloning a team's repository from the new-thread action.

## History: projects were considered and rejected once

The retired repository-filter note recorded the earlier resolution, "no projects concept — the repository filter does the job". It was rejected then because issue↔repository was many-to-many and a project collapsed into a name for a repository selection. **Reversed** when plans, now threads, became the unit of work: the work needs a home once there is no Issues listing, and a container that _contains_ it is no longer merely a name for a filter. The upgrade path recorded there, "a project is a named saved filter", is roughly what shipped, plus containment. The cost accepted then still stands: a workspace taxonomy can drift from an external tracker's. That is mitigated because a workspace holds only threads someone chose to start, never a mirrored backlog.

**Moved up and renamed (2026-09-24): the Mercurian project became the workspace.** Mercurian now sits beside T3 Code without editing it ([[Strategy]]), and T3 Code's project is one directory. A multi-repository container can no longer be a project. It has to sit above T3 Code's projects. The team framing settled what it holds: repositories recognized across machines, not one machine's checkouts, so a team's members share one workspace while each works in their own checkouts. It also settled the sidebar's shape: the one-project scope becomes the one-workspace scope over a flat list. And it settled where workspaces live: a personal one on every machine, and shared ones in the control plane. This gives a name to the "shared workspace" [[Environments]] and [[Collaborative DAG]] already spoke of, and to the "personal workspaces beside shared workspaces" [[Settings]] deferred. Given up: a thread that changes code across every repository of its container as a matter of course; see the open decision below. Notes written before this date say "project" where they mean the workspace.

**Renamed and split (2026-10-09): the workspace became the team, inside an organization.** Venkat retired "workspace" from the product's vocabulary, since T3 Code already uses it for an agent's directory and the word was also drifting onto the arrangement of panes. The Linear research that night showed the container was two things at once, the people and the work, and enterprises need them apart; the people moved up into [[Organizations]]. Notes written before this date say "workspace" or "shared workspace" where they mean the team.

## What exists today

_(2026-10-09.)_ Built on Astrolabe's `collaboration` branch, not yet merged: signing in, creating teams and organizations, inviting, roles, joining and leaving teams, publishing threads, and reading teammates' threads, under Settings › Teams and in the sidebar. The team switcher, team repository sets and team memory described above are not built; T3 Code's own projects and project filter are what runs.

## Open Decisions

### Is the team's repository set a boundary or a default?

Grounding could be restricted to the team's repositories (a hard boundary, so the team's meaning stays crisp) or merely start from them (a default, so grounding may wander, preserving "derived, never assigned" all the way down). **Recommendation:** default. If grounding reaches outside the set, surface it and offer to add the repository to the team. The set stays honest without blocking the assistant mid-thought.

**Resolved (2026-07): a default, as recommended.** "Derived, never assigned" holds all the way down. Given up: a crisp guarantee that the set names everything its threads touch; the add-repository offer keeps the set honest instead. _(Decided for projects; carried to workspaces 2026-09-24 unchanged.)_

### How does a thread reach the team's other repositories?

_(Raised 2026-09-24.)_ A thread's turns run in its home checkout. The team's other repositories exist on the machine as other T3 Code projects' checkouts, but nothing places them in front of the agent. **Reading only:** the agent is told where the other checkouts are and may read them, while edits stay in the home repository. This costs nothing in T3 Code and keeps a thread's changes in one repository, but a change that spans repositories becomes several threads. **Reading and editing:** the turn may also change the other checkouts. That restores the multi-repository work the design once promised, but edits land outside the thread's checkpoints, which record only the home checkout. **Recommendation:** reading only, until the checkpoint record can cover more than one repository. Changes that span repositories are then sibling threads related in the [[DAG]].

### Where is the personal workspace kept?

_(Raised 2026-09-24.)_ The personal workspace needs no account, so it cannot live in the shared workspace service. **On each device:** the client stores it with the rest of its local copy. The browser and the desktop app on one machine would then keep two different personal workspaces, and a phone paired to your desktop would not see it. **Nowhere, derived:** the personal workspace is every T3 Code project on the machines you are connected to, grouped by repository. There is nothing to store, and every device paired to the same machines reads the same workspace. **Recommendation:** derived. Given up: choosing which repositories the personal workspace holds, and naming it; a person who wants a chosen set makes a shared workspace for it.

**Resolved (2026-10-09): derived, and unnamed.** With "workspace" retired, your own work needs no container word at all: it is your projects, on the computers you are connected to. Given up as recommended: choosing and naming a personal set; a chosen set of repositories is what a team is for.

_(Confirmed 2026-10-10, Venkat: "Keeping as is makes sense.")_ Working on your own needs no team and no account. A person who wants a chosen, named set of repositories with its own memory makes a team of one, which does need an account and the control plane, as in Linear, where a solo user is a workspace with one team. Given up: a grouping of your own repositories that lives on your computers without signing in. A local team was weighed and declined, because it would live on one device and each client paired to your computers would see a different one.
