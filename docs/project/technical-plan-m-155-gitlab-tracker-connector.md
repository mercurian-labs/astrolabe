# Technical Plan — M-155: GitLab tracker connector

_Generated from the Goal/AC of Linear issue [M-155](https://linear.app/mercurian/issue/M-155/gitlab-tracker-connector) (see the issue for the full AC). Third of the stack M-153 → M-154 → M-155 → M-156, based on the M-154 branch: M-153's seam (connect-input union, `packCredential`, per-kind dialog fields, GET-only request-table tests) and M-154's repo-qualified-id convention are **planned underneath, assumed landed** — verify at implementation time and conform to what actually landed. Design sources: the vault's Trackers / Issue Import / Settings notes; the shipped seam from M-98/M-101/M-109._

**Goal, in one sentence:** make GitLab a connectable tracker — a personal access token plus an optional self-hosted host to connect (empty means gitlab.com), a label that tells two GitLab connections apart, a browse of the projects the token reaches that never shows a merge request, and project-qualified issue identity so same-numbered issues in different projects are distinct origins.

**Scope fences, restated from the issue:** nothing of GitLab's beyond the narrow shape; merge requests are not issues here; write-back stays resolved-deferred. Like M-154, this issue touches no seam code: one literal, one union member (this one two-field, exercising the optional-field case M-153's dialog metadata must already support), one connector, one registry entry, one presentation entry, docs.

## Conventions Detected

| Convention                                                                                                                                                                                         | Evidence                                                                                    | Confidence                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| M-153's conventions table binds (seam, one-string packed credential, live standing, five-field shape, header-only credential, pull-only at three layers, `.logic.ts` presentation, tests, commits) | `docs/project/technical-plan-m-153-jira-tracker-connector.md`; underlying files re-verified | High                          |
| The seam ridden here — union members, `packCredential` (JSON envelope precedent: Jira), dialog `fields` metadata (needs an `optional` flag — see Design), GET-only request-table test              | M-153's plan (planned, not landed at authoring — verify at impl)                            | High (design), verify at impl |
| Repo-qualified crossing ids parsed only by their own connector; `plan_origins` `UNIQUE (connection_id, issue_id)` makes them distinct origins for free                                             | M-154's plan; `Migrations/008_PlanOrigins.ts`                                               | High                          |
| The connection `label` is the display fact minted at probe time — "what a person recognizes the connection by when they have two"                                                                  | `TrackersSettings.logic.ts:74–78`, `LinearConnector.probe`                                  | High                          |

## Design

### Connect input: the first optional field

`GitLabConnectTrackerInput` = `{kind: "gitlab", token, host?}` — `host` optional on the wire (`Schema.optional(TrimmedNonEmptyString)`); absent means `https://gitlab.com`. This is the first optional connect field, so M-153's dialog `fields` metadata gains an `optional` flag (default required): `buildConnectInput` yields a value when every _required_ field is filled, and omits blank optionals rather than sending them empty (the `buildIssuesRequest` temperament: "an empty search is not a search for nothing"). If M-153 landed the metadata without an `optional` flag, adding it here is a two-line widening, not a redesign.

**Host normalization** (pure, exported, unit-tested — the Jira site-normalization shape): accepts `gitlab.example.com` or `https://gitlab.example.com`, yields the canonical `https://<host>` base; garbage refuses as auth. `packCredential` = JSON `{host: <normalized, always present — gitlab.com resolved at pack time>, token}`, so every later call reads one self-contained credential and never re-answers the default question.

### Label: tellable apart, by construction

`probe` → `GET <host>/api/v4/user` → the account's `username`. Label = `username` when the host is gitlab.com, **`username · <host>`** for a self-hosted instance — two GitLab connections (say gitlab.com and a self-hosted one) read differently in Settings by construction, which is the AC's clause. (Two gitlab.com connections are already told apart by their usernames, same as two Linear workspaces by their names.) 401/403 → `TrackerAuthRefusal`; transport → `TrackerUnreachableRefusal`.

### The GitLab connector

`apps/server/src/mercurian/trackers/connectors/GitLabConnector.ts` **(new)** — REST `.../api/v4`, `HttpClient`, token in the `PRIVATE-TOKEN` header (GitLab's own PAT header) and nowhere else.

- **`listIssues`** → `GET /api/v4/issues?scope=all&order_by=updated_at&sort=desc&per_page=50&page=N` (+`&search=<terms>` when present — GitLab searches title and description itself). This endpoint answers with exactly "the issues the authenticated user has access to across projects" — no qualifier assembly, no collaborator gap, and merge requests structurally cannot appear (they live on `/merge_requests`). Cursor = next page number as a string (from the `x-next-page` header when present, else absent — GitLab says "no more" with an empty header).
- **Mapping**: `id` = `references.full` — GitLab's own qualified reference, `group/project#31`: what a person says out loud, unique within the connection (the M-154 identity convention, using the tracker's own rendering rather than assembling one); `title`; `description` = `description ?? ""`; `status` = `state` (`opened`/`closed`, GitLab's own words); `url` = `web_url`.
- **`getIssue`** → parse `path#iid` (pure exported parser; unparseable → `null`), then `GET /api/v4/projects/<urlencode(path)>/issues/<iid>` (GitLab addresses projects by URL-encoded full path — the parser's project half is exactly that); `404` → `null`; same mapping.
- **Pull-only, structurally:** `GITLAB_REQUESTS` table (`/user`, `/issues`, `/projects/:path/issues/:iid`) + the GET-only unit test.

Registry: `"gitlab"` on `TrackerKind`; the union member; `gitlab: yield* GitLabConnector.make` — totality does the rest.

### Presentation and docs

- `TrackersSettings.logic.ts`: `gitlab` presentation — name **GitLab**; fields: `token` ("Personal access token", secret, `glpat-…`, hint: GitLab → Preferences → Access tokens, `read_api` scope) and `host` ("GitLab host", optional, placeholder `gitlab.com`, hint "leave empty for gitlab.com; set for a self-hosted instance"); `buildConnectInput` gitlab arm omits a blank host.
- `docs/user/trackers.md`: **Connecting GitLab** — token scope, the optional host, that two connections are told apart by name and host, ids read `group/project#31`, merge requests never appear.

### Gaps and findings carried out of discovery

- The `optional` field flag is the one seam-adjacent addition; it lives entirely in web presentation metadata + `buildConnectInput`, not in contracts or the store.
- `scope=all` on `/issues` returns issues the user can see, including public projects' issues they interact with only via that visibility — the honest reading of "projects the token can see"; the AC walk confirms the practical shape.
- Self-hosted instances pin their own API version; v4 has been GitLab's stable API since 9.0 — no version negotiation, documented in the connector header.

## Implementation Checklist

- [ ] `contracts/src/mercurianTrackers.ts`: `"gitlab"` literal; `GitLabConnectTrackerInput` `{kind, token, host?}` joins the union.
- [ ] `connectors/GitLabConnector.ts` **(new)**: host normalization (pure, exported); `packCredential` → JSON `{host (always resolved), token}`; `GITLAB_REQUESTS` table; `probe` (label = username, `· host` suffix when self-hosted); `listIssues` (`/issues?scope=all`, search passthrough, 50/page, `x-next-page` cursor); `getIssue` (reference parser → URL-encoded project path read, 404 → null); mapping with `id = references.full`; PRIVATE-TOKEN header only.
- [ ] `connectors/registry.ts`: `gitlab` entry.
- [ ] `TrackersSettings.logic.ts`: GitLab presentation; `fields` metadata gains the `optional` flag; `buildConnectInput` gitlab arm (blank host omitted). `ConnectTrackerDialog.tsx`: optional fields render as such (no required gating on them).
- [ ] Do not touch: `TrackerStore.ts`, `ws.ts`, `RpcAuthorization.ts`, `client-runtime`, `plan_origins`, refresh, mobile. Do not add: any migration, any write method, any echo of the token or host in errors/logs.
- [ ] Docs: `docs/user/trackers.md` Connecting GitLab.
- [ ] Commit: `feat(server): GitLab connector (M-155)` (+ `feat(web): optional connect fields (M-155)` if separable).

## Test Plan

- [ ] `GitLabConnector.test.ts` **(new)**, stubbed `HttpClient`:
  - [ ] Pull-only: every `GITLAB_REQUESTS` entry is `GET`.
  - [ ] Host normalization: bare host, https URL → canonical; blank → gitlab.com at pack time; garbage refuses as auth.
  - [ ] `packCredential`: always carries a resolved host.
  - [ ] `probe`: label = username on gitlab.com; `username · host` self-hosted; 401 → auth; transport → unreachable.
  - [ ] `listIssues`: request carries `scope=all`, search passthrough; mapping (`references.full` → id, null description → `""`, `state` → status, `web_url` → url); extra fields dropped; `x-next-page` → cursor, empty header → end.
  - [ ] `getIssue`: parser round-trips `group/sub/project#31` (nested groups — the path half may itself contain `/` and `#` splits on the **last** `#`); URL-encoding of the project path in the request; 404 → null.
  - [ ] PRIVATE-TOKEN header carries the token; nothing logs it.
- [ ] `TrackersSettings.logic.test.ts`: gitlab presentation; `buildConnectInput` with and without host; optional-field gating (Connect enabled with host blank).
- [ ] Existing suites green (no seam files touched).
- [ ] AC walk in a real client (test-t3-app): connect gitlab.com with a real PAT (host blank) → row labeled with the username, connected; connect a second GitLab (or the same with host set) → rows tellable apart; bad token refused, nothing created; browse lists issues across projects, search narrows, Load more pages, no MR appears, url opens the instance; import `group/a#5` and `group/b#5` → two plans; re-import → no duplicate; edit upstream → Refresh lands a spec revision; revoke the token → Key rejected within a minute; disconnect → row and secret gone.
- [ ] Targeted typecheck + lint: contracts, server, web.

---

_Review note: the significant calls — `references.full` as the crossing id (the tracker's own rendering, `#` split on the last occurrence for nested groups); host folded into the packed credential and resolved at pack time; the label's `· host` suffix as the tellable-apart mechanism; `/issues?scope=all` over per-project enumeration; the `optional` field flag living in presentation metadata only — can be pressure-tested with `technical-plan-decision-review`._
