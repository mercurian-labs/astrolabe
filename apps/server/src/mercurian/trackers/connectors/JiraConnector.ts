/**
 * Jira Cloud's pull-only REST connector.
 *
 * API v2 is deliberate: it returns issue descriptions as plain text, which is
 * the honest representation for Mercurian's five-string issue shape. API v3
 * returns Atlassian Document Format and would require a separate renderer.
 *
 * @module JiraConnector
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  trackerAuthRefusal,
  trackerUnreachableRefusal,
  type TrackerConnector,
  type TrackerConnectorRefusal,
} from "../connector.ts";

const ISSUE_PAGE_SIZE = "50";
const ISSUE_FIELDS = "summary,description,status";

/** Every request this connector can send. The pull-only test reads this. */
export const JIRA_REQUESTS = {
  serverInfo: { name: "serverInfo", method: "GET", pathPattern: "/rest/api/2/serverInfo" },
  myself: { name: "myself", method: "GET", pathPattern: "/rest/api/2/myself" },
  searchJql: { name: "searchJql", method: "GET", pathPattern: "/rest/api/2/search/jql" },
  legacySearch: { name: "legacySearch", method: "GET", pathPattern: "/rest/api/2/search" },
  issue: { name: "issue", method: "GET", pathPattern: "/rest/api/2/issue/{key}" },
} as const;

type JiraRequest = (typeof JIRA_REQUESTS)[keyof typeof JIRA_REQUESTS];

/** Bare hosts and URLs both become the one HTTPS origin used for Jira calls. */
export function normalizeJiraSite(input: string): string | null {
  const value = input.trim();
  if (value.length === 0 || /\s/u.test(value)) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.hostname.length === 0 ||
      !parsed.hostname.includes(".") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return `https://${parsed.host}`;
  } catch {
    return null;
  }
}

/** Escapes one value for a quoted JQL string literal. */
export const escapeJiraJqlString = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');

export function buildJiraJql(search?: string): string {
  const trimmed = search?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? "ORDER BY updated DESC"
    : `text ~ "${escapeJiraJqlString(trimmed)}" ORDER BY updated DESC`;
}

const JiraStoredCredential = Schema.Struct({
  site: Schema.String,
  email: Schema.String,
  token: Schema.String,
});

const decodeStoredCredential = Schema.decodeUnknownEffect(
  Schema.fromJsonString(JiraStoredCredential),
);

interface JiraCredential {
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

const unpackCredential = (
  credential: string,
): Effect.Effect<JiraCredential, TrackerConnectorRefusal> =>
  decodeStoredCredential(credential).pipe(
    Effect.flatMap((decoded) => {
      const site = normalizeJiraSite(decoded.site);
      return site === null
        ? Effect.fail(trackerAuthRefusal)
        : Effect.succeed({ site, email: decoded.email, token: decoded.token });
    }),
    Effect.mapError(() => trackerAuthRefusal),
  );

const JiraServerInfoResponse = Schema.Struct({
  serverTitle: Schema.optional(Schema.NullOr(Schema.String)),
});

const JiraIssueResponse = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.Struct({ name: Schema.String }),
  }),
});

const JiraSearchResponse = Schema.Struct({
  issues: Schema.Array(JiraIssueResponse),
  nextPageToken: Schema.optional(Schema.NullOr(Schema.String)),
});

const JiraLegacySearchResponse = Schema.Struct({
  startAt: Schema.Number,
  total: Schema.Number,
  issues: Schema.Array(JiraIssueResponse),
});

type JiraIssueResponse = typeof JiraIssueResponse.Type;

const mapIssue = (site: string, issue: JiraIssueResponse) => ({
  id: issue.key.trim(),
  title: issue.fields.summary,
  description: issue.fields.description ?? "",
  status: issue.fields.status.name,
  url: `${site}/browse/${issue.key.trim()}`,
});

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const packCredential: TrackerConnector<"jira">["packCredential"] = (input) =>
    JSON.stringify({
      site: normalizeJiraSite(input.site) ?? input.site,
      email: input.email,
      token: input.token,
    });

  const requestBuilders = { GET: HttpClientRequest.get } as const;

  /**
   * One Jira round trip. Basic auth is attached only as an Authorization
   * header; neither the URL nor a refusal carries the email or token.
   */
  const send = Effect.fn("JiraConnector.send")(function* (
    credential: string,
    requestDefinition: JiraRequest,
    options: {
      readonly path?: string;
      readonly urlParams?: Readonly<Record<string, string>>;
    } = {},
  ) {
    const decoded = yield* unpackCredential(credential);
    const url = new URL(`${decoded.site}${options.path ?? requestDefinition.pathPattern}`);
    for (const [key, value] of Object.entries(options.urlParams ?? {})) {
      url.searchParams.set(key, value);
    }
    const request = requestBuilders[requestDefinition.method](url.toString()).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.basicAuth(decoded.email, decoded.token),
    );
    const response = yield* httpClient
      .execute(request)
      .pipe(Effect.mapError(() => trackerUnreachableRefusal));
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(trackerAuthRefusal);
    }
    return { response, site: decoded.site };
  });

  const decodeJson = <S extends Schema.Top>(
    response: HttpClientResponse.HttpClientResponse,
    schema: S,
  ): Effect.Effect<S["Type"], TrackerConnectorRefusal, S["DecodingServices"]> =>
    HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(() => trackerUnreachableRefusal),
    );

  const requireSuccess = (
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<void, TrackerConnectorRefusal> =>
    isSuccess(response.status) ? Effect.void : Effect.fail(trackerUnreachableRefusal);

  const probe: TrackerConnector<"jira">["probe"] = Effect.fn("JiraConnector.probe")(function* (
    credential: string,
  ) {
    const myselfResult = yield* send(credential, JIRA_REQUESTS.myself);
    yield* requireSuccess(myselfResult.response);

    const serverInfoResult = yield* send(credential, JIRA_REQUESTS.serverInfo);
    yield* requireSuccess(serverInfoResult.response);
    const serverInfo = yield* decodeJson(serverInfoResult.response, JiraServerInfoResponse);

    const serverTitle = serverInfo.serverTitle?.trim();
    return {
      label:
        serverTitle === undefined || serverTitle.length === 0
          ? new URL(serverInfoResult.site).host
          : serverTitle,
    };
  });

  const listViaLegacySearch = Effect.fn("JiraConnector.listViaLegacySearch")(function* (
    credential: string,
    query: Parameters<TrackerConnector<"jira">["listIssues"]>[1],
  ) {
    const parsedCursor = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
    const startAt = Number.isSafeInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
    const result = yield* send(credential, JIRA_REQUESTS.legacySearch, {
      urlParams: {
        fields: ISSUE_FIELDS,
        maxResults: ISSUE_PAGE_SIZE,
        jql: buildJiraJql(query.search),
        startAt: String(startAt),
      },
    });
    yield* requireSuccess(result.response);
    const page = yield* decodeJson(result.response, JiraLegacySearchResponse);
    const nextStartAt = page.startAt + page.issues.length;
    return {
      issues: page.issues.map((issue) => mapIssue(result.site, issue)),
      ...(nextStartAt < page.total ? { nextCursor: String(nextStartAt) } : {}),
    };
  });

  let useLegacySearch = false;

  const listIssues: TrackerConnector<"jira">["listIssues"] = Effect.fn("JiraConnector.listIssues")(
    function* (credential: string, query) {
      if (useLegacySearch) return yield* listViaLegacySearch(credential, query);

      const result = yield* send(credential, JIRA_REQUESTS.searchJql, {
        urlParams: {
          fields: ISSUE_FIELDS,
          maxResults: ISSUE_PAGE_SIZE,
          jql: buildJiraJql(query.search),
          ...(query.cursor === undefined ? {} : { nextPageToken: query.cursor }),
        },
      });

      if (result.response.status === 404) {
        // A 404 means the replacement endpoint is genuinely absent on this site.
        // Decide once for this connector instance; other failures never downgrade.
        useLegacySearch = true;
        return yield* listViaLegacySearch(credential, query);
      }
      yield* requireSuccess(result.response);
      const page = yield* decodeJson(result.response, JiraSearchResponse);
      const nextCursor = page.nextPageToken?.trim();
      return {
        issues: page.issues.map((issue) => mapIssue(result.site, issue)),
        ...(nextCursor === undefined || nextCursor.length === 0 ? {} : { nextCursor }),
      };
    },
  );

  const getIssue: TrackerConnector<"jira">["getIssue"] = Effect.fn("JiraConnector.getIssue")(
    function* (credential: string, issueId: string) {
      const path = JIRA_REQUESTS.issue.pathPattern.replace("{key}", encodeURIComponent(issueId));
      const result = yield* send(credential, JIRA_REQUESTS.issue, {
        path,
        urlParams: { fields: ISSUE_FIELDS },
      });
      if (result.response.status === 404) return null;
      yield* requireSuccess(result.response);
      const issue = yield* decodeJson(result.response, JiraIssueResponse);
      return mapIssue(result.site, issue);
    },
  );

  return {
    kind: "jira",
    packCredential,
    probe,
    listIssues,
    getIssue,
  } satisfies TrackerConnector<"jira">;
});
