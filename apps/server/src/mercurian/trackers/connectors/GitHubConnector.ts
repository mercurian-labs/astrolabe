/**
 * GitHub Issues' pull-only REST connector.
 *
 * Search is owner-qualified to the authenticating account and its
 * organizations. That keeps a browse inside the account's natural scope while
 * one API call spans repositories, and `is:issue` keeps pull requests out.
 *
 * @module GitHubConnector
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

const GITHUB_API_ORIGIN = "https://api.github.com";
const ISSUE_PAGE_SIZE = 50;
const SEARCH_RESULT_WINDOW = 1_000;

/** Every request this connector can send. The pull-only test reads this. */
export const GITHUB_REQUESTS = {
  user: { name: "user", method: "GET", pathPattern: "/user" },
  userOrganizations: {
    name: "userOrganizations",
    method: "GET",
    pathPattern: "/user/orgs",
  },
  searchIssues: {
    name: "searchIssues",
    method: "GET",
    pathPattern: "/search/issues",
  },
  issue: {
    name: "issue",
    method: "GET",
    pathPattern: "/repos/{owner}/{repo}/issues/{number}",
  },
} as const;

type GitHubRequest = (typeof GITHUB_REQUESTS)[keyof typeof GITHUB_REQUESTS];

export interface GitHubRepositoryReference {
  readonly owner: string;
  readonly repo: string;
}

export interface GitHubIssueReference extends GitHubRepositoryReference {
  readonly number: number;
}

/** Turns an API repository URL into the owner and repository it names. */
export function parseGitHubRepositoryUrl(input: string): GitHubRepositoryReference | null {
  try {
    const url = new URL(input);
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    if (url.origin !== GITHUB_API_ORIGIN || segments.length !== 3 || segments[0] !== "repos") {
      return null;
    }
    const owner = decodeURIComponent(segments[1] ?? "");
    const repo = decodeURIComponent(segments[2] ?? "");
    return owner.length === 0 || repo.length === 0 ? null : { owner, repo };
  } catch {
    return null;
  }
}

/** Formats the repository-qualified identity that crosses Mercurian's wire. */
export const formatGitHubIssueReference = (reference: GitHubIssueReference): string =>
  `${reference.owner}/${reference.repo}#${reference.number}`;

/** Parses only identities this connector could have minted. */
export function parseGitHubIssueReference(input: string): GitHubIssueReference | null {
  const match = /^([^/#\s]+)\/([^/#\s]+)#([1-9]\d*)$/u.exec(input);
  if (match === null) return null;
  const number = Number(match[3]);
  return Number.isSafeInteger(number)
    ? { owner: match[1] ?? "", repo: match[2] ?? "", number }
    : null;
}

const GitHubUserResponse = Schema.Struct({
  login: Schema.String,
});

const GitHubOrganizationResponse = Schema.Struct({
  login: Schema.String,
});

const GitHubOrganizationsResponse = Schema.Array(GitHubOrganizationResponse);

const GitHubIssueResponse = Schema.Struct({
  repository_url: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  html_url: Schema.String,
  pull_request: Schema.optional(Schema.Unknown),
});

const GitHubSearchResponse = Schema.Struct({
  total_count: Schema.Number,
  items: Schema.Array(GitHubIssueResponse),
});

type GitHubIssueResponse = typeof GitHubIssueResponse.Type;

const mapIssue = (issue: GitHubIssueResponse) => {
  if (Object.hasOwn(issue, "pull_request")) return null;
  const repository = parseGitHubRepositoryUrl(issue.repository_url);
  if (repository === null || !Number.isSafeInteger(issue.number) || issue.number < 1) return null;
  return {
    id: formatGitHubIssueReference({ ...repository, number: issue.number }),
    title: issue.title,
    description: issue.body ?? "",
    status: issue.state,
    url: issue.html_url,
  };
};

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const isRateLimitResponse = Effect.fn("GitHubConnector.isRateLimitResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.headers["x-ratelimit-remaining"] === "0") return true;
  const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
  return /rate.?limit/iu.test(body);
});

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const packCredential: TrackerConnector<"github">["packCredential"] = (input) => input.token;

  const requestBuilders = { GET: HttpClientRequest.get } as const;

  /**
   * One GitHub round trip. The token rides only in the Authorization header;
   * neither the URL nor either payload-free refusal can echo it.
   */
  const send = Effect.fn("GitHubConnector.send")(function* (
    credential: string,
    requestDefinition: GitHubRequest,
    options: {
      readonly path?: string;
      readonly urlParams?: Readonly<Record<string, string>>;
    } = {},
  ) {
    const url = new URL(`${GITHUB_API_ORIGIN}${options.path ?? requestDefinition.pathPattern}`);
    for (const [key, value] of Object.entries(options.urlParams ?? {})) {
      url.searchParams.set(key, value);
    }
    const request = requestBuilders[requestDefinition.method](url.toString()).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${credential}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mercurian",
      }),
    );
    const response = yield* httpClient
      .execute(request)
      .pipe(Effect.mapError(() => trackerUnreachableRefusal));
    if (response.status === 401) return yield* Effect.fail(trackerAuthRefusal);
    if (response.status === 403) {
      const rateLimited = yield* isRateLimitResponse(response);
      return yield* Effect.fail(rateLimited ? trackerUnreachableRefusal : trackerAuthRefusal);
    }
    return response;
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

  const readUser = Effect.fn("GitHubConnector.readUser")(function* (credential: string) {
    const response = yield* send(credential, GITHUB_REQUESTS.user);
    yield* requireSuccess(response);
    return yield* decodeJson(response, GitHubUserResponse);
  });

  const probe: TrackerConnector<"github">["probe"] = Effect.fn("GitHubConnector.probe")(function* (
    credential: string,
  ) {
    const user = yield* readUser(credential);
    return { label: user.login.trim() };
  });

  const listIssues: TrackerConnector<"github">["listIssues"] = Effect.fn(
    "GitHubConnector.listIssues",
  )(function* (credential: string, query) {
    const user = yield* readUser(credential);
    const organizationsResponse = yield* send(credential, GITHUB_REQUESTS.userOrganizations);
    yield* requireSuccess(organizationsResponse);
    const organizations = yield* decodeJson(organizationsResponse, GitHubOrganizationsResponse);

    const ownerQualifiers = [
      `user:${user.login}`,
      ...organizations.map((organization) => `org:${organization.login}`),
    ];
    const baseQuery = ["is:issue", "archived:false", ...ownerQualifiers].join(" ");
    const search = query.search;
    const searchQuery =
      search === undefined || search.trim().length === 0 ? baseQuery : `${baseQuery} ${search}`;
    const parsedCursor = query.cursor === undefined ? 1 : Number.parseInt(query.cursor, 10);
    const page = Number.isSafeInteger(parsedCursor) && parsedCursor >= 1 ? parsedCursor : 1;
    const searchResponse = yield* send(credential, GITHUB_REQUESTS.searchIssues, {
      urlParams: {
        q: searchQuery,
        sort: "updated",
        order: "desc",
        per_page: String(ISSUE_PAGE_SIZE),
        page: String(page),
      },
    });
    yield* requireSuccess(searchResponse);
    const result = yield* decodeJson(searchResponse, GitHubSearchResponse);
    const resultOffset = page * ISSUE_PAGE_SIZE;
    return {
      issues: result.items.flatMap((issue) => {
        const mapped = mapIssue(issue);
        return mapped === null ? [] : [mapped];
      }),
      ...(resultOffset < result.total_count && resultOffset < SEARCH_RESULT_WINDOW
        ? { nextCursor: String(page + 1) }
        : {}),
    };
  });

  const getIssue: TrackerConnector<"github">["getIssue"] = Effect.fn("GitHubConnector.getIssue")(
    function* (credential: string, issueId: string) {
      const reference = parseGitHubIssueReference(issueId);
      if (reference === null) return null;
      const path = GITHUB_REQUESTS.issue.pathPattern
        .replace("{owner}", encodeURIComponent(reference.owner))
        .replace("{repo}", encodeURIComponent(reference.repo))
        .replace("{number}", String(reference.number));
      const response = yield* send(credential, GITHUB_REQUESTS.issue, { path });
      if (response.status === 404 || response.status === 410) return null;
      yield* requireSuccess(response);
      const issue = yield* decodeJson(response, GitHubIssueResponse);
      return mapIssue(issue);
    },
  );

  return {
    kind: "github",
    packCredential,
    probe,
    listIssues,
    getIssue,
  } satisfies TrackerConnector<"github">;
});
