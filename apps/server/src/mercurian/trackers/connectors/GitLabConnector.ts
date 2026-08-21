/**
 * GitLab's pull-only REST connector.
 *
 * GitLab API v4 is assumed for both gitlab.com and self-hosted instances. The
 * instance owns its API version; Mercurian does not negotiate one.
 *
 * @module GitLabConnector
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

const DEFAULT_GITLAB_HOST = "https://gitlab.com";
const ISSUE_PAGE_SIZE = 50;
/**
 * How many member projects the browse spans, most recently active first.
 * A stated cap, not a silent one: the user docs say the browse covers your
 * most active projects and that search narrows within them.
 */
const MEMBER_PROJECT_LIMIT = 20;

/** Every request this connector can send. The pull-only test reads this. */
export const GITLAB_REQUESTS = {
  user: { name: "user", method: "GET", pathPattern: "/user" },
  /**
   * The browse is scoped to projects the user is a member of. GitLab's global
   * `/issues?scope=all` reaches every issue the token can *see* — on
   * gitlab.com that is the public firehose, which is not anyone's backlog —
   * and the global endpoint has no membership filter, so the connector spans
   * the member projects itself.
   */
  projects: { name: "projects", method: "GET", pathPattern: "/projects" },
  projectIssues: {
    name: "projectIssues",
    method: "GET",
    pathPattern: "/projects/{id}/issues",
  },
  issue: {
    name: "issue",
    method: "GET",
    pathPattern: "/projects/{path}/issues/{iid}",
  },
} as const;

type GitLabRequest = (typeof GITLAB_REQUESTS)[keyof typeof GITLAB_REQUESTS];

/** Bare hosts and URLs both become the one HTTPS origin used for GitLab calls. */
export function normalizeGitLabHost(input: string): string | null {
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

export interface GitLabIssueReference {
  readonly projectPath: string;
  readonly iid: number;
}

/** Parses the project-qualified identity GitLab itself rendered for an issue. */
export function parseGitLabIssueReference(input: string): GitLabIssueReference | null {
  const separator = input.lastIndexOf("#");
  if (separator <= 0) return null;
  const projectPath = input.slice(0, separator);
  const iidText = input.slice(separator + 1);
  if (
    projectPath.trim() !== projectPath ||
    projectPath.startsWith("/") ||
    projectPath.endsWith("/") ||
    projectPath.split("/").some((segment) => segment.length === 0) ||
    !/^[1-9]\d*$/u.test(iidText)
  ) {
    return null;
  }
  const iid = Number(iidText);
  return Number.isSafeInteger(iid) ? { projectPath, iid } : null;
}

const GitLabStoredCredential = Schema.Struct({
  host: Schema.String,
  token: Schema.String,
});

const decodeStoredCredential = Schema.decodeUnknownEffect(
  Schema.fromJsonString(GitLabStoredCredential),
);

interface GitLabCredential {
  readonly host: string;
  readonly token: string;
}

const unpackCredential = (
  credential: string,
): Effect.Effect<GitLabCredential, TrackerConnectorRefusal> =>
  decodeStoredCredential(credential).pipe(
    Effect.flatMap((decoded) => {
      const host = normalizeGitLabHost(decoded.host);
      return host === null
        ? Effect.fail(trackerAuthRefusal)
        : Effect.succeed({ host, token: decoded.token });
    }),
    Effect.mapError(() => trackerAuthRefusal),
  );

const GitLabUserResponse = Schema.Struct({
  username: Schema.String,
});

const GitLabIssueResponse = Schema.Struct({
  references: Schema.Struct({ full: Schema.String }),
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  web_url: Schema.String,
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitLabIssuesResponse = Schema.Array(GitLabIssueResponse);

const GitLabProjectResponse = Schema.Struct({ id: Schema.Number });

const GitLabProjectsResponse = Schema.Array(GitLabProjectResponse);

type GitLabIssueResponse = typeof GitLabIssueResponse.Type;

const mapIssue = (issue: GitLabIssueResponse) => ({
  id: issue.references.full,
  title: issue.title,
  description: issue.description ?? "",
  status: issue.state,
  url: issue.web_url,
});

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const packCredential: TrackerConnector<"gitlab">["packCredential"] = (input) => {
    const inputHost = input.host?.trim();
    const host =
      inputHost === undefined || inputHost.length === 0
        ? DEFAULT_GITLAB_HOST
        : (normalizeGitLabHost(inputHost) ?? inputHost);
    return JSON.stringify({ host, token: input.token });
  };

  const requestBuilders = { GET: HttpClientRequest.get } as const;

  /**
   * One GitLab round trip. The token rides only in the PRIVATE-TOKEN header;
   * neither the URL nor either payload-free refusal can echo it.
   */
  const send = Effect.fn("GitLabConnector.send")(function* (
    credential: string,
    requestDefinition: GitLabRequest,
    options: {
      readonly path?: string;
      readonly urlParams?: Readonly<Record<string, string>>;
    } = {},
  ) {
    const decoded = yield* unpackCredential(credential);
    const url = new URL(`${decoded.host}/api/v4${options.path ?? requestDefinition.pathPattern}`);
    for (const [key, value] of Object.entries(options.urlParams ?? {})) {
      url.searchParams.set(key, value);
    }
    const request = requestBuilders[requestDefinition.method](url.toString()).pipe(
      HttpClientRequest.setHeaders({
        Accept: "application/json",
        "PRIVATE-TOKEN": decoded.token,
      }),
    );
    const response = yield* httpClient
      .execute(request)
      .pipe(Effect.mapError(() => trackerUnreachableRefusal));
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(trackerAuthRefusal);
    }
    return { response, host: decoded.host };
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

  const probe: TrackerConnector<"gitlab">["probe"] = Effect.fn("GitLabConnector.probe")(function* (
    credential: string,
  ) {
    const result = yield* send(credential, GITLAB_REQUESTS.user);
    yield* requireSuccess(result.response);
    const user = yield* decodeJson(result.response, GitLabUserResponse);
    const username = user.username.trim();
    return {
      label:
        result.host === DEFAULT_GITLAB_HOST
          ? username
          : `${username} · ${new URL(result.host).host}`,
    };
  });

  /**
   * The browse: the newest-updated issues across the member projects, merged.
   * The cursor is an `updated_at` watermark — page N+1 asks each project for
   * issues updated strictly before the last issue page N showed. Upstream
   * churn between pages can shift a boundary issue, the same tolerance every
   * page-numbered browse in this family accepts.
   */
  const listIssues: TrackerConnector<"gitlab">["listIssues"] = Effect.fn(
    "GitLabConnector.listIssues",
  )(function* (credential: string, query) {
    const watermark =
      query.cursor !== undefined && !Number.isNaN(Date.parse(query.cursor))
        ? query.cursor
        : undefined;
    const search = query.search?.trim();

    // Deliberately spare parameters: gitlab.com has answered 500 to
    // `membership=true` combined with ordering/filter params, so the request
    // asks only for membership and lets the cap do the bounding.
    const projectsResult = yield* send(credential, GITLAB_REQUESTS.projects, {
      urlParams: {
        membership: "true",
        simple: "true",
        per_page: String(MEMBER_PROJECT_LIMIT),
      },
    });
    yield* requireSuccess(projectsResult.response);
    const projects = yield* decodeJson(projectsResult.response, GitLabProjectsResponse);
    if (projects.length === 0) return { issues: [] };

    const pages = yield* Effect.forEach(
      projects,
      (project) =>
        Effect.gen(function* () {
          const result = yield* send(credential, GITLAB_REQUESTS.projectIssues, {
            path: GITLAB_REQUESTS.projectIssues.pathPattern.replace("{id}", String(project.id)),
            urlParams: {
              order_by: "updated_at",
              sort: "desc",
              per_page: String(ISSUE_PAGE_SIZE),
              ...(search === undefined || search.length === 0 ? {} : { search }),
              ...(watermark === undefined ? {} : { updated_before: watermark }),
            },
          });
          yield* requireSuccess(result.response);
          return yield* decodeJson(result.response, GitLabIssuesResponse);
        }),
      { concurrency: 5 },
    );

    const merged = pages
      .flat()
      .sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? ""));
    const seen = new Set<string>();
    const distinct = merged.filter((issue) =>
      seen.has(issue.references.full) ? false : (seen.add(issue.references.full), true),
    );
    const taken = distinct.slice(0, ISSUE_PAGE_SIZE);
    const lastUpdatedAt = taken.at(-1)?.updated_at ?? undefined;
    const mayHaveMore =
      distinct.length > ISSUE_PAGE_SIZE || pages.some((page) => page.length === ISSUE_PAGE_SIZE);
    return {
      issues: taken.map(mapIssue),
      ...(mayHaveMore && lastUpdatedAt !== undefined && lastUpdatedAt !== null
        ? { nextCursor: lastUpdatedAt }
        : {}),
    };
  });

  const getIssue: TrackerConnector<"gitlab">["getIssue"] = Effect.fn("GitLabConnector.getIssue")(
    function* (credential: string, issueId: string) {
      const reference = parseGitLabIssueReference(issueId);
      if (reference === null) return null;
      const path = GITLAB_REQUESTS.issue.pathPattern
        .replace("{path}", encodeURIComponent(reference.projectPath))
        .replace("{iid}", String(reference.iid));
      const result = yield* send(credential, GITLAB_REQUESTS.issue, { path });
      if (result.response.status === 404) return null;
      yield* requireSuccess(result.response);
      const issue = yield* decodeJson(result.response, GitLabIssueResponse);
      return mapIssue(issue);
    },
  );

  return {
    kind: "gitlab",
    packCredential,
    probe,
    listIssues,
    getIssue,
  } satisfies TrackerConnector<"gitlab">;
});
