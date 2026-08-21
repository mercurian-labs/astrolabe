# Technical Plan — M-154: GitHub Issues tracker connector

_Generated from the Goal/AC of Linear issue [M-154](https://linear.app/mercurian/issue/M-154/github-issues-tracker-connector) (see the issue for the full AC). Second of the stack M-153 → M-154 → M-155 → M-156, based on the M-153 branch: the per-kind connect-input union, connector-owned `packCredential`, generic `TrackerConnector<K>`, and the per-kind connect-dialog fields are **M-153's plan, assumed landed underneath** — verify at implementation time and conform to what actually landed, not to this restatement. Design sources: the vault's Trackers / Issue Import / Settings notes; the shipped seam from M-98/M-101/M-109, verified in source._

**Goal, in one sentence:** make GitHub Issues a connectable tracker — one personal access token to connect, the connection labeled with the account it authenticates as, a browse that spans the repositories the token reaches and never shows a pull request, and issue identity that carries its repository so same-numbered issues in different repositories are distinct origins.

**Scope fences, restated from the issue:** nothing of GitHub's beyond the narrow shape; pull requests are not issues here; write-back stays resolved-deferred. GitHub needs only a single token, so this issue touches **no seam code at all**: one `TrackerKind` literal, one connect-input union member, one connector file, one registry entry, one presentation entry, docs. That thinness is the M-153 seam doing its job — if implementation finds itself editing `TrackerStore` or the wire beyond the two literal additions, something is wrong.

## Conventions Detected

| Convention                                                                                                                                                                                                                                 | Evidence                                                                                               | Confidence                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Everything in M-153's conventions table still binds (seam, one-string credential, live standing, five-field shape, HttpClient with the credential in one header, pull-only at three layers, `.logic.ts` presentation, test shape, commits) | `docs/project/technical-plan-m-153-jira-tracker-connector.md`; underlying files re-verified            | High                          |
| The seam this plan rides — connect-input union members, `packCredential`, per-kind dialog `fields` metadata, `JIRA_REQUESTS`-style GET-only structural test                                                                                | M-153's plan (planned, not landed at authoring time — the M-98/M-96 precedent for stacked planning)    | High (design), verify at impl |
| Origin identity is `(connection_id, issue_id)` with `issue_id` = `TrackerIssue.id` verbatim; `plan_origins.UNIQUE` is the idempotency fence, so a repo-qualified id is automatically a distinct origin per repository                      | `Migrations/008_PlanOrigins.ts`, `PlanningStore.importPlan`, `ws.ts` refreshSpec → `getIssue(issueId)` | High                          |
| `TrackerIssue.id` is "the tracker's own human-facing key — what a person would say out loud"                                                                                                                                               | `contracts/src/mercurianTrackers.ts:78–79`                                                             | High                          |

## Design

### Identity: `owner/repo#number`, because GitHub has no workspace-wide key

Linear and Jira issue keys are workspace-unique; GitHub issue numbers are only repository-unique. The id that crosses is therefore GitHub's own qualified reference — **`owner/repo#123`** — which is simultaneously what a person says out loud, unambiguous within the connection, and parseable back to API coordinates by the connector alone. Nothing outside the connector ever parses it: `plan_origins` stores it verbatim, `getIssue` receives it back verbatim, and the import browse just displays it. Two issues numbered 123 in two repositories are two origins by construction of `UNIQUE (connection_id, issue_id)` — the AC's distinctness clause costs zero code outside the connector.

### The GitHub connector

`apps/server/src/mercurian/trackers/connectors/GitHubConnector.ts` **(new)** — REST against `https://api.github.com`, `HttpClient`, headers on every request: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and a `User-Agent` (GitHub refuses without one; use `mercurian`).

- **`packCredential`** = identity on `token` (the Linear shape — one secret, no envelope).
- **`probe`** → `GET /user`; label = `login` (the account the token authenticates as — the AC's "account or organization it reaches" is the authenticating identity; organizations it can also see are reach, not identity, and the browse is where reach shows). 401/403 → `TrackerAuthRefusal`; transport/5xx → `TrackerUnreachableRefusal`.
- **`listIssues`** → the search API, `GET /search/issues`, because it is the one read that spans repositories and speaks free-text at once:
  - Scope: `q` always carries `is:issue archived:false` plus **owner qualifiers for the token's own account and each organization it belongs to** — `user:<login>` + one `org:<org>` per `GET /user/orgs` entry. Without owner qualifiers GitHub search answers from all of public GitHub, which is not "the repositories the token can see". The login and org list are fetched per browse call (two cheap reads before the search — the connector is stateless by design, and the browse is human-paced). Known, accepted edge: a repository reached only as an outside collaborator is not covered by these qualifiers; noted in docs as "your repositories and your organizations'".
  - Search: the user's terms appended verbatim to `q`; empty search browses the scope newest-updated-first (`sort=updated`, `order=desc`).
  - Paging: `per_page=50`, cursor = the **next page number as a string** (opaque to everything but this connector); `nextCursor` present while `page*50 < total_count` (capped by GitHub's 1000-result search window — when the window ends, the cursor ends; search narrows, which the docs say).
  - PRs: `is:issue` excludes them at the source; the mapper additionally drops any item carrying a `pull_request` field — the AC's "never appear" held at two layers.
- **Mapping** to the five fields: `id` = `owner/repo#number` derived from each item's `repository_url` + `number`; `title`; `description` = `body ?? ""`; `status` = `state` (GitHub's own words: `open`/`closed` — uninterpreted); `url` = `html_url`.
- **`getIssue`** → parse `owner/repo#number` (a pure exported parser, unit-tested; unparseable → `null`, an origin this connector never minted), then `GET /repos/{owner}/{repo}/issues/{number}`; `404`/`410` → `null`; a body carrying `pull_request` → `null` (a PR is not an issue this connector ever offered); same mapping.
- **Pull-only, structurally:** `GITHUB_REQUESTS` table (`/user`, `/user/orgs`, `/search/issues`, `/repos/…/issues/…`) with the M-153-convention unit test asserting every method is `GET`.

Registry: `"github"` joins `TrackerKind`; `GitHubConnectorInput` member `{kind: "github", token}` joins the connect-input union; `github: yield* GitHubConnector.make` joins `connectors/registry.ts` — totality enforces the rest.

### Presentation and docs

- `TrackersSettings.logic.ts`: `github` presentation — name **GitHub Issues**, one secret `token` field ("Personal access token", `ghp_…`/`github_pat_…`), credentialHint pointing at GitHub → Settings → Developer settings → Personal access tokens (classic `repo` scope or fine-grained with Issues read + repo read on the repositories to browse).
- `buildConnectInput` gains the `github` arm (one-field, the Linear shape).
- `docs/user/trackers.md`: **Connecting GitHub** section — where tokens come from, what the browse covers ("your repositories and your organizations'"), that PRs never appear, that issue ids read `owner/repo#123`.

### Gaps and findings carried out of discovery

- The search API's owner-qualifier scoping is the one place "repositories the token can see" is approximated (outside-collaborator repos missed) — recorded above and in user docs rather than silently.
- GitHub search rate limit is 30 req/min authenticated — human-paced browsing with a debounced search input sits well inside it; a 403 rate-limit response maps to `TrackerUnreachableRefusal` (the service saying not-now, not the person's key being wrong) — one test pins this, since 403 is otherwise an auth status.
- No `TrackerStore`, wire, client-runtime, or import/refresh changes anywhere in this issue — asserted by the checklist's negative constraints.

## Implementation Checklist

- [ ] `contracts/src/mercurianTrackers.ts`: `"github"` literal on `TrackerKind`; `GitHubConnectTrackerInput` `{kind: "github", token}` joins the union.
- [ ] `connectors/GitHubConnector.ts` **(new)**: headers incl. api-version + user-agent; `GITHUB_REQUESTS` table; `probe` (label = login); `listIssues` (owner-qualified `is:issue archived:false` search, `sort=updated`, 50/page, page-number cursor, 1000-window end, `pull_request` items dropped); `getIssue` (reference parser → by-repo read, 404/410/PR → null); mapping exactly five fields with `id = owner/repo#number`; `packCredential` identity; 403-rate-limit → unreachable, 401/403-auth → auth refusal (body-sniffing only where GitHub's status is ambiguous — keep it minimal and tested).
- [ ] `connectors/registry.ts`: `github` entry.
- [ ] `TrackersSettings.logic.ts`: GitHub presentation + one-field metadata; `buildConnectInput` github arm.
- [ ] Do not touch: `TrackerStore.ts`, `ws.ts`, `RpcAuthorization.ts`, `client-runtime`, `plan_origins`, refresh, mobile. Do not add: any migration, any write method, any qualifier-less search, any echo of the token anywhere.
- [ ] Docs: `docs/user/trackers.md` Connecting GitHub.
- [ ] Commit: `feat(server): GitHub Issues connector (M-154)` (+ `feat(web): …` if the dialog work is separable).

## Test Plan

- [ ] `GitHubConnector.test.ts` **(new)**, stubbed `HttpClient`:
  - [ ] Pull-only: every `GITHUB_REQUESTS` entry is `GET`.
  - [ ] `probe`: label = login; 401 → auth; transport → unreachable.
  - [ ] `listIssues`: `q` carries `is:issue archived:false user:<login> org:<each>` + search terms; mapping (`repository_url`+`number` → `owner/repo#n`, `body` null → `""`, `state` → status, `html_url` → url); an item with `pull_request` never survives; extra fields never survive; cursor advances by page and ends at `total_count` and at the 1000 window; 403 rate-limit body → unreachable.
  - [ ] `getIssue`: round-trips the reference parser; 404 → null; 410 → null; a PR body → null.
  - [ ] Reference parser: `owner/repo#123` ↔ parts; garbage → null.
- [ ] `TrackersSettings.logic.test.ts`: github presentation + `buildConnectInput("github", …)`.
- [ ] Existing suites green (no seam files touched — the suites prove it).
- [ ] AC walk in a real client (test-t3-app): connect with a real PAT → row labeled with the login, connected; bad token refused, nothing created; browse lists issues across the account's repos, search narrows, Load more pages, no PR appears, each url opens GitHub; import `owner/a#5`, then import `owner/b#5` → two plans; re-import either → no duplicate; edit the issue on GitHub → Refresh from issue lands a spec revision; revoke the token → Key rejected within a minute; disconnect → row and secret gone.
- [ ] Targeted typecheck + lint: contracts, server, web.

---

_Review note: the significant calls — `owner/repo#number` as the crossing id with parsing confined to the connector; label = the authenticating login; the search API with explicit owner qualifiers (accepting the outside-collaborator gap, documented); page-number cursor within GitHub's 1000-result search window; PR exclusion at two layers; 403 disambiguation (rate limit → unreachable) — can be pressure-tested with `technical-plan-decision-review`._
