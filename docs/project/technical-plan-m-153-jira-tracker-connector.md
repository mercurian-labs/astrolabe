# Technical Plan — M-153: Jira tracker connector

_Generated from the Goal/AC of Linear issue [M-153](https://linear.app/mercurian/issue/M-153/jira-tracker-connector) (see the issue for the full AC). First of the four-connector stack M-153 → M-154 → M-155 → M-156, on main as of `5034b3f65`. Design sources are the almagest vault notes the issue cites: Trackers (resolved: write-back deferred), Issue Import, Settings — and the shipped seam from M-98 (connections), M-101 (import), M-109 (specs/refresh), all verified in source._

**Goal, in one sentence:** make Jira Cloud a connectable tracker — connecting asks for the Atlassian site, the account email, and an API token; the connection is labeled with the site it reaches; Jira's issues cross in exactly the five-field shape; and everything generic (standing, browse, import, refresh) is inherited from the seam untouched.

**Scope fences, restated from the issue:** nothing of Jira's beyond the narrow shape crosses; write-back stays resolved-deferred; Jira Cloud only — Server/Data Center has different auth and different API surface and waits for demand. This issue also owns the one seam widening the whole stack needs: **per-kind connect inputs** (M-98 deferred "per-kind connect-input variance" until a second connector forced it; this is that connector). M-154/M-155/M-156 inherit the widened seam and add only their own connector, presentation, and docs.

## Conventions Detected

| Convention                                                                                                                                                                                                                                 | Evidence                                                                       | Confidence |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- |
| The connector seam: `TrackerConnector` (probe/listIssues/getIssue, **no write methods**), refusals as `TrackerAuthRefusal`/`TrackerUnreachableRefusal` values, registry total over `TrackerKind` so a missing connector is a compile error | `mercurian/trackers/connector.ts`, `connectors/registry.ts`                    | High       |
| The credential is one opaque string: stored as one secret file per connection (`mercurian-tracker-<id>`, `ServerSecretStore`, 0600), read back only at the moment a connector call needs it, never echoed                                  | `trackers/schema.ts:39`, `TrackerStore.ts` (readToken, connect)                | High       |
| Standing is derived live behind a 1-min `Cache`, never stored; probe at connect seeds the cache                                                                                                                                            | `TrackerStore.ts:271–307,346`                                                  | High       |
| The five-field `TrackerIssue` is the only issue shape; `status` is the tracker's own word uninterpreted; `""` is a real description                                                                                                        | `contracts/src/mercurianTrackers.ts:77–89`                                     | High       |
| Connector HTTP rides Effect's `HttpClient`; the credential lives in one header and is never logged, attached to a span, or part of a failure payload (refusals are payload-free values)                                                    | `connectors/LinearConnector.ts:195–237`                                        | High       |
| Pull-only holds at three layers: interface (no write method), per-connector structural test (Linear: every exported GraphQL document parses as `query`), wire (no tracker-ward RPC)                                                        | `LinearConnector.ts` header + `LinearConnector.test.ts`                        | High       |
| Wire surface: `MERCURIAN_TRACKER_WS_METHODS` in its own contracts module; scopes in `RpcAuthorization.ts:76–79` (reads → ReadScope, mutations → OperateScope); handlers in `ws.ts` under `observeRpcEffect`, aggregate `"mercurian"`       | `contracts/src/mercurianTrackers.ts`, `auth/RpcAuthorization.ts`, `ws.ts:462+` | High       |
| Client: tracker atoms in `client-runtime/src/state/mercurianTrackers.ts` (commands on one write scheduler), instantiated in `apps/web/src/state/mercurianTrackers.ts`; UI logic in pure `.logic.ts` with co-located tests                  | `createMercurianTrackerAtoms`, `TrackersSettings.logic.ts`                     | High       |
| The connect dialog's tracker list renders from `TRACKER_KIND_PRESENTATION` — "a new tracker becomes visible in the UI by being added here — there is no second list to keep in step"                                                       | `TrackersSettings.logic.ts:10–19`, `ConnectTrackerDialog.tsx`                  | High       |
| Migrations 001–010 landed; **next free number is 011** — but see Design: this plan adds none                                                                                                                                               | `mercurian/persistence/Migrations/`                                            | High       |
| Refresh resolves origin → `trackerStore.getIssue({connectionId, issueId})`; `plan_origins` keys origin as `(connection_id, issue_id)`                                                                                                      | `ws.ts:1862–1980`, `Migrations/008_PlanOrigins.ts`                             | High       |
| Tests: co-located `*.test.ts`, `@effect/vitest` `it.layer(...)`, stubbed connector registry via `TrackerConnectors.layerWith`, streams drained; `vp test run <files>`, targeted typecheck/lint                                             | `TrackerStore.test.ts`, `LinearConnector.test.ts`, AGENTS.md §Verifying        | High       |
| Conventional commits `feat(scope): … (M-153)`; docs ride the PR (`docs/user/trackers.md`, glossary when vocabulary grows)                                                                                                                  | `git log`, AGENTS.md §Hit every surface                                        | High       |

## Design

### The seam widening: per-kind connect inputs, connector-owned credential packing

M-98 deferred exactly one variance: what a person supplies to connect. Linear is one key; Jira is a triple (site, email, API token). The widening keeps two invariants fixed:

- **The wire names the fields per kind, structurally.** `MercurianConnectTrackerInput` stops being `{kind, token}` and becomes a discriminated union — one member per shipped connector, each carrying exactly its kind's fields. A Jira connect without an email is a schema error, not a runtime surprise. (`contracts/src/mercurianTrackers.ts`; the union members export individually — `LinearConnectTrackerInput`, `JiraConnectTrackerInput` — so the dialog can type its builders.)
- **The stored credential stays one opaque string per connection.** No config column, no second secret file. Each connector owns a pure `packCredential(input) → string` that folds _everything its calls need_ into the one stored string: Linear's is the identity on `token` (which is byte-for-byte what existing connections' secret files already hold — back-compat is automatic, no migration of secrets); Jira's is JSON `{site, email, token}`. `probe`/`listIssues`/`getIssue` keep their `(credential: string, …)` signatures and each connector decodes its own format. The store, the standing cache, and the wire never learn what is inside the string.

Deliberate call, worth recording: migration 005's header reserved the _option_ of per-kind config columns ("Jira's site URL arrives with the Jira connector"). This plan chooses **no config column** — the site rides inside the packed credential. Rationale: every connector call needs the site anyway, so splitting it out of the secret buys nothing but a second read path; nothing in the UI needs to display it (the _label_ is the display fact, minted at probe time); and `tracker_connections` keeps its "a durable act of configuration and that is all" shape. If a future surface must show per-connection config, that is the day the column arrives — with the feature that reads it. **No new migration in this stack.**

Typing the seam: `TrackerConnector` becomes generic over its kind — `TrackerConnector<K extends TrackerKind>` with `kind: K` and `packCredential: (input: ConnectTrackerInputFor<K>) => string` — and the registry type becomes `{ readonly [K in TrackerKind]: TrackerConnector<K> }`, preserving "a new literal without a connector is a compile error" and adding "…or without its pack function". `TrackerStore.connect` takes the union (plus `createdAt`), calls `connectors[input.kind].packCredential(input)` through a small kind-correlating helper (no `any`, no cast wider than the correlation needs), stores the packed string, and everything downstream is unchanged. `readToken` is renamed `readCredential` for honesty; same behavior.

### The Jira connector

`apps/server/src/mercurian/trackers/connectors/JiraConnector.ts` **(new)** — Jira Cloud REST, `HttpClient`, Basic auth (`base64(email + ":" + token)`) in the `Authorization` header and nowhere else.

- **Site normalization** (pure, exported, unit-tested): accepts `acme.atlassian.net`, `https://acme.atlassian.net`, or a full URL with path junk; yields the canonical `https://<host>` base. A site that does not parse refuses as auth (the person's input is wrong, and they can fix it).
- **`probe`** → `GET <site>/rest/api/2/serverInfo` (carries `serverTitle` — the site's own name) with `GET /rest/api/2/myself` as the auth check; label = `serverTitle`, falling back to the site host when blank. 401/403 → `TrackerAuthRefusal`; transport/anything else → `TrackerUnreachableRefusal` (the Linear status-mapping temperament, minus GraphQL's 200-with-errors wrinkle — REST says it with the status line).
- **`listIssues`** → `GET /rest/api/2/search/jql` with `fields=summary,description,status`, `maxResults=50`, JQL = `ORDER BY updated DESC` when search is empty, else `text ~ "<escaped>" ORDER BY updated DESC` (JQL string escaping is a pure exported function — quotes and backslashes doubled — with tests; searching is the tracker's job, and JQL text-search is Jira's own). Cursor = the endpoint's `nextPageToken`, opaque to Mercurian. **API v2, deliberately**: v3 returns descriptions as ADF JSON, whose faithful text rendering is a project of its own; v2 returns the raw text form, which is what a five-string shape can carry honestly.
- **Mapping** is the narrow shape and nothing else: `id` = the issue key (`PROJ-123` — what a person says out loud, and what `plan_origins` will store), `title` = `summary`, `description` = the v2 description string or `""`, `status` = `fields.status.name` uninterpreted, `url` = `<site>/browse/<key>` (Jira's canonical issue link).
- **`getIssue`** → `GET /rest/api/2/issue/<key>?fields=summary,description,status`; 404 → `null` (the tracker removed it — refresh's "issue-not-found" answer); same mapping.
- **Pull-only, structurally, the REST way:** the module exports its request table as `JIRA_REQUESTS` — `{name, method, pathPattern}` constants that the `send` helper is built from — and a unit test asserts every entry's method is `GET`. The Linear suite proves documents are queries; the REST equivalent proves methods are reads. (This convention is what M-156 will lean on when Azure's one query-shaped POST needs an explicit allowlist.)

Registry: `jira` joins `TrackerKind` (`Schema.Literals(["linear", "jira"])`), `JiraConnector.make` joins `connectors/registry.ts`. Totality does the rest.

### The wire and the store

- `contracts/src/mercurianTrackers.ts`: the input union (above). `TrackerKind` gains `"jira"`. Everything else — `TrackerConnection`, `TrackerIssue`, refusals — is deliberately untouched: the seam's whole point is that a new kind changes no shapes.
- `TrackerStore.ts`: `ConnectTrackerInput` becomes the union + `createdAt`; `connect` packs via the connector (above). No other method changes.
- `ws.ts` `connectTracker` handler: passes the union through; already never logs the payload (`MercurianTrackerError` carries no payload echo — that comment exists because of exactly this input).
- Client runtime: `connectTracker` command is shape-agnostic (`createEnvironmentRpcCommand` passes the input through) — **no change** in `client-runtime`; `apps/web/src/state/mercurianTrackers.ts` unchanged.

### The connect dialog grows per-kind fields

`TrackersSettings.logic.ts`:

- `TRACKER_KIND_PRESENTATION.jira` = name **Jira**, credentialHint pointing at Atlassian API tokens (id.atlassian.com → Security → API tokens).
- The presentation record grows a `fields` list per kind — `{key, label, placeholder, secret}` — Linear: one secret field (`token`, "Linear API key", `lin_api_…`); Jira: `site` ("Atlassian site", `acme.atlassian.net`), `email` ("Account email"), `token` ("API token", secret). The dialog renders from this list, so the third connector is still "added here, no second list".
- A per-kind input builder, pure and exported: `buildConnectInput(kind, values: Record<string, string>) → MercurianConnectTrackerInput | null` (null while any field is blank — what disables Connect). Unit-tested per kind.

`ConnectTrackerDialog.tsx`: the single hardcoded key input becomes a map over the kind's `fields` (secret fields render `type="password"`; all state still dies with the dialog); Connect disabled until `buildConnectInput` yields a value. The kind picker already renders when `TRACKER_KINDS.length > 1` — this issue is what makes that branch real.

### Docs (AGENTS.md §Hit every surface)

`docs/user/trackers.md`: a **Connecting Jira** section beside Connecting Linear (where the API token comes from, the three fields, Jira Cloud only), and the "What crosses over" example row stays true as written. `docs/internals/overview.md` and glossary: unchanged — no new vocabulary, which is the seam working as designed.

### Gaps and findings carried out of discovery

- The AC's refresh clause ("upstream edits landing as a spec revision") is inherited behavior: `refreshSpec` resolves the origin's connection and calls `getIssue` with the stored issue id — a Jira-imported plan refreshes the day this lands, with zero refresh-path changes. Demonstrated in the AC walk, not re-implemented.
- Jira Cloud's deprecation churn around search endpoints is real; the plan pins `/rest/api/2/search/jql` (the token-paged replacement Atlassian migrated search to). If the implementing session finds the endpoint absent on a given site, the fallback is `/rest/api/2/search` with `startAt` paging — same mapping, cursor = stringified `startAt`. Decide once, in code, with a comment.
- The `readToken` → `readCredential` rename touches `TrackerStore.test.ts` only in names, not in behavior.
- The vault's Trackers note names Jira in the family; no vault edit rides this PR (the stale "what exists today" refresh is tracked separately).

## Implementation Checklist

- [ ] `contracts/src/mercurianTrackers.ts`: `TrackerKind` gains `"jira"`; `MercurianConnectTrackerInput` becomes the per-kind union (`LinearConnectTrackerInput` `{kind:"linear", token}`, `JiraConnectTrackerInput` `{kind:"jira", site, email, token}` — all `TrimmedNonEmptyString`), members exported.
- [ ] `trackers/connector.ts`: `TrackerConnector<K>` generic (`kind: K`, `packCredential(input: ConnectTrackerInputFor<K>) → string`); `TrackerConnectorRegistry` becomes the kind-correlated mapped type.
- [ ] `connectors/LinearConnector.ts`: `packCredential = (input) => input.token`; satisfies `TrackerConnector<"linear">`.
- [ ] `connectors/JiraConnector.ts` **(new)**: site normalization + JQL escaping (pure, exported); `JIRA_REQUESTS` table + `send` over `HttpClient` with Basic auth; `probe` (serverInfo + myself → label), `listIssues` (`/rest/api/2/search/jql`, 50/page, nextPageToken cursor), `getIssue` (404 → null); mapping to the five fields exactly (key, summary, description-or-`""`, status.name, `<site>/browse/<key>`); `packCredential` = JSON of the triple with its decode helper.
- [ ] `connectors/registry.ts`: `jira: yield* JiraConnector.make`.
- [ ] `TrackerStore.ts`: `ConnectTrackerInput` = union + `createdAt`; `connect` packs through the connector (kind-correlated helper, no `any`); `readToken` → `readCredential`.
- [ ] `ws.ts`: `connectTracker` handler passes the union input through unchanged in shape discipline (no payload in errors/logs — already the rule).
- [ ] `TrackersSettings.logic.ts`: Jira presentation + per-kind `fields` metadata + `buildConnectInput`; `ConnectTrackerDialog.tsx` renders fields from metadata (secret → password input, state dies on close, Connect gated on a complete input).
- [ ] Do not add: a migration; a config column; any connector write method; any echo of any credential field in responses, errors, logs, or sqlite; any per-kind branch outside contracts/connector/presentation (the store and wire stay kind-blind). Do not touch: `plan_origins`, the refresh path, `client-runtime`, mobile.
- [ ] Docs: `docs/user/trackers.md` Connecting Jira section.
- [ ] Commits: `feat(server): per-kind connect inputs and the Jira connector (M-153)`, `feat(web): connect dialog renders per-kind credential fields (M-153)`.

## Test Plan

Runner: `vp test run <files>`; server tests over `MercurianSqlite.layerMemory` with `TrackerConnectors.layerWith` stubs; streams drained.

- [ ] `JiraConnector.test.ts` **(new)**, stubbed `HttpClient`:
  - [ ] Pull-only: every `JIRA_REQUESTS` entry is a `GET`.
  - [ ] Site normalization: bare host, https URL, trailing-path input → canonical base; garbage refuses as auth.
  - [ ] JQL escaping: quotes/backslashes; empty search → no `text ~` clause.
  - [ ] `probe`: label = serverTitle, host fallback; 401/403 → auth refusal; transport → unreachable.
  - [ ] `listIssues` mapping: key → id, summary → title, null description → `""`, status.name → status, browse URL; extra response fields do not survive; nextPageToken → cursor round-trip.
  - [ ] `getIssue`: found maps; 404 → null.
  - [ ] Basic auth header carries `base64(email:token)`; nothing logs it.
- [ ] `TrackerStore.test.ts`: connect with a Jira-kind stub — packed credential (stub's packCredential output) is what lands in the secret file and what later calls receive; Linear stub still receives the raw token (back-compat); refused Jira probe → no row, no secret.
- [ ] `TrackersSettings.logic.test.ts` / dialog logic: `buildConnectInput` per kind (complete/incomplete); Jira fields metadata renders three inputs, token secret; kind picker appears at two kinds.
- [ ] Existing suites green: `LinearConnector.test.ts`, `TrackerStore.test.ts`, wire suites (`server.test.ts` mock untouched — no new ws method).
- [ ] AC walk in a real client (test-t3-app, per AGENTS.md): connect Jira with a real site/email/token → row labeled with the site name, connected standing; wrong token refused in-dialog with nothing created; browse lists real Jira issues in the five-field shape, search narrows, Load more pages, url opens Jira; import one → plan born with the issue's spec; edit the issue in Jira → Refresh from issue lands the revision; revoke the token → standing decays to Key rejected within a minute; disconnect → row and secret gone; grep logs/DB for token and email → absent.
- [ ] Targeted typecheck + lint: contracts, server, web.

---

_Review note: the significant calls — the connect-input union rather than a generic field bag; credential packing owned by the connector with no config column and no migration; Jira API v2 over v3 for plain-text descriptions; `/rest/api/2/search/jql` with token paging (startAt fallback named); label from `serverTitle`; issue key as `id`; the `JIRA_REQUESTS` GET-only structural test as the REST pull-only fence — can be pressure-tested with `technical-plan-decision-review`._
