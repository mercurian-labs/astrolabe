# Technical Plan — M-156: Azure DevOps tracker connector

_Generated from the Goal/AC of Linear issue [M-156](https://linear.app/mercurian/issue/M-156/azure-devops-tracker-connector) (see the issue for the full AC). Top of the stack M-153 → M-154 → M-155 → M-156, based on the M-155 branch: M-153's seam (connect-input union, `packCredential` JSON envelopes, per-kind dialog fields, request-table pull-only tests) is **planned underneath, assumed landed** — verify at implementation time and conform to what actually landed. Design sources: the vault's Trackers / Issue Import / Settings notes; the shipped seam from M-98/M-101/M-109._

**Goal, in one sentence:** make Azure DevOps a connectable tracker — an organization plus a personal access token to connect, the connection labeled with the organization, and the things that cross are work items mapped into the five-field shape with the work item's own state word as status, browsed live across the projects the credential reaches.

**Scope fences, restated from the issue:** work items only — pipelines, repos, boards-as-boards, and every other Azure DevOps service stay out; nothing beyond the narrow shape; write-back stays resolved-deferred. Like M-154/M-155: no seam code, one literal, one union member, one connector, one registry entry, one presentation entry, docs — plus the one convention this connector must extend: the pull-only request-table test learns an **explicit read-POST allowlist**, because Azure's query language travels as a POST.

## Conventions Detected

| Convention                                                                                                                                                                                       | Evidence                                                                                    | Confidence                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------- |
| M-153's conventions table binds (seam, one-string packed credential, live standing, five-field shape, header-only credential, `.logic.ts` presentation, tests, commits)                          | `docs/project/technical-plan-m-153-jira-tracker-connector.md`; underlying files re-verified | High                          |
| The seam ridden here — union members, JSON `packCredential` envelope (Jira/GitLab precedent), multi-field dialog metadata, request-table pull-only test                                          | M-153/M-155 plans (planned, not landed at authoring — verify at impl)                       | High (design), verify at impl |
| Pull-only is enforced structurally per connector, in the connector's own idiom (Linear: queries-only documents; REST: GET-only tables) — the _mechanism_ varies, the _test's existence_ does not | `LinearConnector.ts` header + test; M-153's `JIRA_REQUESTS` convention                      | High                          |
| `TrackerIssue.status` is "the tracker's own status word, uninterpreted"; work item **State** is Azure's word                                                                                     | `contracts/src/mercurianTrackers.ts:85–87`                                                  | High                          |

## Design

### Connect input and credential

`AzureDevOpsConnectTrackerInput` = `{kind: "azure-devops", organization, token}` — both required. `organization` accepts the bare name (`acme`) or the URL form (`https://dev.azure.com/acme`); a pure exported normalizer yields the bare name, and the base URL is always `https://dev.azure.com/<org>` (dev.azure.com only — the legacy `<org>.visualstudio.com` form redirects there, and on-premises Azure DevOps Server waits for demand, the Jira Server precedent). `packCredential` = JSON `{organization, token}`. Auth on every request: `Authorization: Basic base64(":" + token)` — Azure's PAT convention (empty username) — in that header and nowhere else.

### Label

`probe` → `GET https://dev.azure.com/<org>/_apis/projects?api-version=7.1&$top=1` — succeeding proves the PAT reaches the organization; label = **the organization name** (the AC's clause; it is also what a person says out loud). 401/403 and Azure's non-JSON sign-in-page answer for a dead PAT (a 203 with HTML — a documented Azure wart) → `TrackerAuthRefusal`; transport/5xx → `TrackerUnreachableRefusal`. The 203-HTML case gets its own test: it is the one way Azure says "bad key" that does not look like an error.

### The connector: WIQL to find, batch read to shape

`apps/server/src/mercurian/trackers/connectors/AzureDevOpsConnector.ts` **(new)**. Work items are found and read in Azure's own two-step idiom:

- **Find** — `POST /_apis/wit/wiql?api-version=7.1&$top=<N>` with a WIQL body: `Select [System.Id] From WorkItems Where … Order By [System.ChangedDate] Desc`. Empty search browses everything the credential reaches (WIQL without a project scope spans the organization's projects the PAT can see); a search adds `Where [System.Title] Contains '<escaped>' Or [System.Description] Contains '<escaped>'`. WIQL string escaping (single quotes doubled) is a pure exported function with tests. **This POST is a read** — WIQL is Azure's query language and travels only as a request body — so the request-table test's convention widens: `AZURE_DEVOPS_REQUESTS` entries carry `{method, readOnly: true}` and the test asserts every entry is a `GET` **except** entries on an explicit allowlist naming exactly the WIQL endpoint, with a comment saying why it is still a read. The allowlist is the fence's honesty, not its exception swallowing a mutation: any second POST fails the suite.
- **Shape** — WIQL answers bare ids; the page's slice goes to `GET /_apis/wit/workitems?ids=<50 ids>&fields=System.Title,System.Description,System.State,System.TeamProject&api-version=7.1` — one batch read per page.
- **Paging**: WIQL has `$top` but no offset, so the cursor is a **numeric offset into the query's id order**, stringified: each `listIssues` call runs WIQL with `$top = offset + 51`, slices `[offset, offset+50)`, and offers `nextCursor` while the WIQL answer overran the slice. Re-running the query per page can shift under upstream churn — the same acceptance page-number cursors already made for GitHub/GitLab, and human-paced browsing tolerates it. `$top` is capped at 1000 (Azure's WIQL comfort zone; the browse pages the most recent 1000 matches and the cursor ends there — search narrows, and the user docs say so; no silent cap).
- **Mapping**: `id` = the work item id as a string (**organization-unique** — Azure numbers work items per organization, so no qualification is needed; the simplest identity in the family); `title` = `System.Title`; `description` = `System.Description` **stripped from HTML to text** (Azure stores rich-text HTML; a small pure `htmlToText` — tags dropped, block elements to newlines, entities decoded — exported and tested; a five-string shape carries text, not markup) or `""`; `status` = `System.State` uninterpreted (`New`, `Active`, `Done`, whatever the org's process says); `url` = `https://dev.azure.com/<org>/<System.TeamProject>/_workitems/edit/<id>` (the canonical editor link; the project segment comes from the fetched field, URL-encoded).
- **`getIssue`** → `GET /_apis/wit/workitems/<id>?fields=…` (non-numeric id → `null`); `404` → `null`; same mapping.

Registry: `"azure-devops"` on `TrackerKind`; the union member; `"azure-devops": yield* AzureDevOpsConnector.make`. (The literal is kebab-case; it reads acceptably in the shared error copy — "The azure-devops credential was not accepted" — and the UI always speaks through the presentation name.)

### Presentation and docs

- `TrackersSettings.logic.ts`: presentation — name **Azure DevOps**; fields: `organization` ("Organization", placeholder `acme`, hint "the name in dev.azure.com/…"), `token` ("Personal access token", secret, hint: User settings → Personal access tokens, **Work Items (Read)** scope). `buildConnectInput` arm.
- `docs/user/trackers.md`: **Connecting Azure DevOps** — PAT scope, the organization field, that work items are what cross ("issue" in Mercurian's sense), ids are the work item numbers, the browse covers the organization's projects and pages its most recent 1000 matches.

### Gaps and findings carried out of discovery

- The read-POST allowlist is the one convention extension this issue owns; it lands beside the test so M-15x successors inherit it stated, not implied.
- HTML-to-text is the one lossy mapping in the family (Jira v2 and the git forges hand over text-ish bodies; Azure hands over HTML). The AC says "its description as text" — stripping is the honest reading; images/tables degrade to their text content, accepted and test-pinned.
- The spec derived at import splits title/description into Goal/AC exactly as for every tracker (`specDocumentFromIssue` in `ws.ts` — inherited, untouched).
- Stack-wide, noted for the walk: after all four land, the connect dialog's kind list reads Linear · Jira · GitHub Issues · GitLab · Azure DevOps — five entries from one record, which is M-98's "the second connector is cheap" promise, kept thrice.

## Implementation Checklist

- [ ] `contracts/src/mercurianTrackers.ts`: `"azure-devops"` literal; `AzureDevOpsConnectTrackerInput` `{kind, organization, token}` joins the union.
- [ ] `connectors/AzureDevOpsConnector.ts` **(new)**: organization normalizer + WIQL escaping + `htmlToText` (pure, exported, tested); `AZURE_DEVOPS_REQUESTS` table with `readOnly` WIQL allowlist entry; Basic `:`+PAT auth header only; `probe` (projects ping, 203-HTML → auth refusal, label = org); `listIssues` (WIQL find + batch-GET shape, offset cursor, 1000 cap, 50/page); `getIssue` (numeric guard, 404 → null); mapping exactly five fields (`System.State` → status, editor URL with encoded project).
- [ ] `connectors/registry.ts`: `"azure-devops"` entry.
- [ ] `TrackersSettings.logic.ts`: presentation + two-field metadata; `buildConnectInput` arm.
- [ ] Do not touch: `TrackerStore.ts`, `ws.ts`, `RpcAuthorization.ts`, `client-runtime`, `plan_origins`, refresh, mobile. Do not add: any migration; any write method; any second POST (the allowlist test enforces it); any echo of the token or organization pairing in errors/logs.
- [ ] Docs: `docs/user/trackers.md` Connecting Azure DevOps.
- [ ] Commit: `feat(server): Azure DevOps connector (M-156)`.

## Test Plan

- [ ] `AzureDevOpsConnector.test.ts` **(new)**, stubbed `HttpClient`:
  - [ ] Pull-only: every `AZURE_DEVOPS_REQUESTS` entry is `GET` except the allowlisted WIQL query POST; the allowlist has exactly one entry.
  - [ ] Organization normalizer: bare name, URL form → name; garbage refuses as auth.
  - [ ] WIQL escaping: quotes doubled; empty search → no `Where` clause.
  - [ ] `htmlToText`: tags stripped, `<br>`/`<p>`/`<div>` → newlines, entities decoded, plain text unchanged, `null` → `""`.
  - [ ] `probe`: label = organization; 401 → auth; **203 with an HTML body → auth**; transport → unreachable.
  - [ ] `listIssues`: WIQL body shape (order by ChangedDate desc, `$top` = offset window, 1000 cap); batch read carries the four fields; mapping (id stringified, state → status, editor URL with URL-encoded project); extra fields never survive; offset cursor advances and ends both at the result end and at the cap.
  - [ ] `getIssue`: numeric guard (non-numeric → null, no request); 404 → null.
  - [ ] Auth header is `Basic base64(":"+token)`; nothing logs it.
- [ ] `TrackersSettings.logic.test.ts`: presentation + `buildConnectInput("azure-devops", …)`.
- [ ] Existing suites green (no seam files touched).
- [ ] AC walk in a real client (test-t3-app): connect with a real org + PAT → row labeled with the org, connected; bad PAT refused (including the revoked-PAT 203 shape), nothing created; browse lists work items across the org's projects, search narrows, Load more pages, each url opens the work item; an HTML-rich description arrives as readable text; import → plan with the work item's spec; edit the work item → Refresh lands a spec revision; revoke the PAT → Key rejected within a minute; disconnect → row and secret gone. Then the stack-wide walk: all five kinds listed in the connect dialog, each connector's issues in the same five-field shape.
- [ ] Targeted typecheck + lint: contracts, server, web.

---

_Review note: the significant calls — the WIQL POST admitted through an explicit single-entry read allowlist rather than loosening the GET rule; offset-cursor paging over re-run WIQL with a stated 1000 cap; the work item id unqualified because Azure numbers per organization; HTML descriptions stripped to text; the 203-HTML auth wart handled explicitly; `"azure-devops"` as the kind literal; dev.azure.com only — can be pressure-tested with `technical-plan-decision-review`._
