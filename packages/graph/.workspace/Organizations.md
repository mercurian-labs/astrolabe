# Organizations

An organization is the company boundary around [[Teams|teams]]: who belongs, what each person may do, and everything an administrator governs. The work itself lives in teams; the organization holds the people. A person's first team creates its organization silently and names it after the team, so a small team meets the second level only when it opens Settings to invite someone. _(Written 2026-10-09, from the decision to take Linear's two levels; see [[Teams]].)_

## Roles

Roles follow Linear's, and they are two separate axes.

- **Across the organization.** An **owner** governs everything, including who else is an owner. An **admin** manages members and invitations, but never touches an owner or grants ownership. A **member** works in every team. A **guest** works only in the teams they were invited into and cannot create teams or join others.
- **Inside one team.** A **team owner** governs that team, such as renaming it, and nothing above it. Whoever creates a team owns it.

Two rules hold at every step: an organization never loses its last owner, and anyone may leave. Who may invite people and who may create teams are the organization's policies, set by its owners and admins (resolved below). Enterprise controls that Linear adds as a company grows (single sign-on, provisioning from an identity provider, audit logs, approval of outside apps) are not designed; they belong here when they are.

## Joining and leaving

People join by invitation, to the organization and optionally straight into one team, with the role the invitation names. An invitation waits for whoever signs in with its address and accepts it; owners and admins can revoke it until then. A member joins and leaves teams on their own. Someone removed from an organization, or who leaves it, loses access at once; the threads they published stay with their teams, because what was shared stays shared ([[Publishing]]).

## What exists today

_(2026-10-09.)_ Built on Astrolabe's `collaboration` branch, not yet merged: the roles above, invitations with revoke, changing roles, removing members and leaving, under Settings › Teams. A person can create another organization from Settings › Teams, and owners and admins set the organization's name and its two policies there.

## Open Decisions

### Can one person create more than one organization?

_(Raised 2026-10-09.)_ Linear lets one account belong to several workspaces and switch between them. **Several, by choice:** a consultant or a person with a side project keeps their organizations apart. **One until asked:** a first team makes the only organization a person creates; more arrive only by invitation. **Recommendation:** one until asked, since nothing in the first audience needs a second boundary. Given up for now: creating a separate organization yourself.

**Resolved (2026-10-09, Venkat: "figure out what Linear does and do that"): several, by choice.** Linear lets one account create and join several workspaces and switch between them, so a person can create another organization of their own, starting with its first team, and belongs to each organization they create or are invited into. Given up, against the recommendation: the simplicity of one boundary per person.

### Should admins be able to restrict who invites and who creates teams?

_(Raised 2026-10-09.)_ Linear's workspace settings restrict invitations and team creation to admins, and on paid plans invitations default to admins only. Today only owners and admins invite, and every member may create a team. **Recommendation:** keep these defaults and add the switches when an organization asks for them. Given up for now: per-organization policy.

**Resolved (2026-10-09, Venkat: "figure out what Linear does and do that"): two switches, with Linear's defaults.** Linear's Security settings carry both as workspace policies, each either all members or only admins: new user invitations, which paid workspaces default to admins only, and team creation, all members in the workspace inspected. Each organization carries the same two, with the same defaults, set by its owners and admins beside its name. A member allowed to invite may invite members and guests, never admins or owners. Given up: the per-organization policy deferred above arrives now; Linear's other workspace policies (labels, templates, API keys and the rest) have no counterpart yet.
