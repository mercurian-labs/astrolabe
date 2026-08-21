import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import type { TrackerConnector } from "../connector.ts";
import * as GitHubConnector from "./GitHubConnector.ts";

interface StubOptions {
  readonly respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly failTransport?: boolean;
}

const seen: { requests: Array<HttpClientRequest.HttpClientRequest> } = { requests: [] };

const stubHttpClient = (options: StubOptions) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.requests.push(request);
      if (options.failTransport === true) {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("network is down"),
            }),
          }),
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          options.respond?.(request) ?? new Response(null, { status: 500 }),
        ),
      );
    }),
  );

const runWith = <A, E>(
  options: StubOptions,
  body: (connector: TrackerConnector<"github">) => Effect.Effect<A, E, never>,
) => {
  seen.requests = [];
  return GitHubConnector.make.pipe(
    Effect.flatMap(body),
    Effect.provide(stubHttpClient(options)),
    Effect.scoped,
  );
};

const issueResponse = (overrides: Record<string, unknown> = {}) => ({
  repository_url: "https://api.github.com/repos/mercurian/astrolabe",
  number: 154,
  title: "GitHub Issues connector",
  body: null,
  state: "open",
  html_url: "https://github.com/mercurian/astrolabe/issues/154",
  labels: [{ name: "connector" }],
  assignees: [{ login: "octocat" }],
  ...overrides,
});

const listResponse =
  (search: { readonly total_count?: number; readonly items?: ReadonlyArray<unknown> } = {}) =>
  (request: HttpClientRequest.HttpClientRequest) => {
    switch (new URL(request.url).pathname) {
      case "/user":
        return Response.json({ login: "octocat", id: 1 });
      case "/user/orgs":
        return Response.json([{ login: "acme" }, { login: "mercurian" }]);
      case "/search/issues":
        return Response.json({
          total_count: search.total_count ?? 1,
          items: search.items ?? [issueResponse()],
        });
      default:
        return new Response(null, { status: 500 });
    }
  };

it.effect("sends only GET requests — a write cannot enter this file", () =>
  Effect.sync(() => {
    for (const request of Object.values(GitHubConnector.GITHUB_REQUESTS)) {
      assert.strictEqual(request.method, "GET", `${request.name} is not pull-only`);
    }
  }),
);

it.effect("parses repository URLs and round-trips repository-qualified issue references", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      GitHubConnector.parseGitHubRepositoryUrl("https://api.github.com/repos/mercurian/astrolabe"),
      { owner: "mercurian", repo: "astrolabe" },
    );
    assert.isNull(
      GitHubConnector.parseGitHubRepositoryUrl("https://github.com/mercurian/astrolabe"),
    );

    const reference = { owner: "mercurian", repo: "astrolabe", number: 154 };
    const formatted = GitHubConnector.formatGitHubIssueReference(reference);
    assert.strictEqual(formatted, "mercurian/astrolabe#154");
    assert.deepStrictEqual(GitHubConnector.parseGitHubIssueReference(formatted), reference);
    for (const garbage of ["154", "astrolabe#154", "owner/repo", "owner/repo#0", "a/b#nope"]) {
      assert.isNull(GitHubConnector.parseGitHubIssueReference(garbage));
    }
  }),
);

it.effect("names a connection after the authenticating login", () =>
  runWith(
    { respond: () => Response.json({ login: "octocat", name: "The Octocat" }) },
    (connector) =>
      connector.probe("github-secret").pipe(
        Effect.map((result) => {
          assert.strictEqual(result.label, "octocat");
          assert.strictEqual(
            connector.packCredential({ kind: "github", token: "packed-token" }),
            "packed-token",
          );
        }),
      ),
  ),
);

it.effect("maps ordinary 401 and 403 probes to authentication refusals", () =>
  Effect.forEach([401, 403], (status) =>
    runWith({ respond: () => new Response("credential refused", { status }) }, (connector) =>
      connector.probe("github-secret").pipe(
        Effect.flip,
        Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerAuthRefusal")),
      ),
    ),
  ),
);

it.effect("maps transport and server failures to unreachable refusals", () =>
  Effect.gen(function* () {
    yield* runWith({ failTransport: true }, (connector) =>
      connector.probe("github-secret").pipe(
        Effect.flip,
        Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
      ),
    );
    yield* runWith({ respond: () => new Response(null, { status: 500 }) }, (connector) =>
      connector.probe("github-secret").pipe(
        Effect.flip,
        Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
      ),
    );
  }),
);

it.effect("owner-qualifies issue search and appends the person's terms verbatim", () =>
  runWith({ respond: listResponse() }, (connector) =>
    connector
      .listIssues("github-secret", {
        search: 'bug label:"help wanted"',
        cursor: "2",
      })
      .pipe(
        Effect.map(() => {
          assert.deepStrictEqual(
            seen.requests.map((request) => new URL(request.url).pathname),
            ["/user", "/user/orgs", "/search/issues"],
          );
          const requestUrl = new URL(seen.requests[2]?.url ?? "");
          assert.strictEqual(
            requestUrl.searchParams.get("q"),
            'is:issue archived:false user:octocat org:acme org:mercurian bug label:"help wanted"',
          );
          assert.strictEqual(requestUrl.searchParams.get("sort"), "updated");
          assert.strictEqual(requestUrl.searchParams.get("order"), "desc");
          assert.strictEqual(requestUrl.searchParams.get("per_page"), "50");
          assert.strictEqual(requestUrl.searchParams.get("page"), "2");
        }),
      ),
  ),
);

it.effect("maps issues into exactly five fields and drops pull requests", () =>
  runWith(
    {
      respond: listResponse({
        total_count: 2,
        items: [
          issueResponse(),
          issueResponse({
            number: 155,
            title: "A pull request",
            pull_request: { url: "https://api.github.com/repos/mercurian/astrolabe/pulls/155" },
          }),
        ],
      }),
    },
    (connector) =>
      connector.listIssues("github-secret", {}).pipe(
        Effect.map((page) => {
          assert.deepStrictEqual(
            [...page.issues],
            [
              {
                id: "mercurian/astrolabe#154",
                title: "GitHub Issues connector",
                description: "",
                status: "open",
                url: "https://github.com/mercurian/astrolabe/issues/154",
              },
            ],
          );
          assert.deepStrictEqual(Object.keys(page.issues[0] ?? {}).toSorted(), [
            "description",
            "id",
            "status",
            "title",
            "url",
          ]);
        }),
      ),
  ),
);

it.effect("advances and ends cursors at the result count and the 1000-result window", () =>
  Effect.gen(function* () {
    yield* runWith({ respond: listResponse({ total_count: 101 }) }, (connector) =>
      connector
        .listIssues("github-secret", { cursor: "2" })
        .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, "3"))),
    );
    yield* runWith({ respond: listResponse({ total_count: 100 }) }, (connector) =>
      connector
        .listIssues("github-secret", { cursor: "2" })
        .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, undefined))),
    );
    yield* runWith({ respond: listResponse({ total_count: 1_200 }) }, (connector) =>
      connector
        .listIssues("github-secret", { cursor: "19" })
        .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, "20"))),
    );
    yield* runWith({ respond: listResponse({ total_count: 1_200 }) }, (connector) =>
      connector
        .listIssues("github-secret", { cursor: "20" })
        .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, undefined))),
    );
  }),
);

it.effect("treats rate-limited 403 responses as unreachable", () =>
  Effect.gen(function* () {
    yield* runWith(
      {
        respond: () =>
          Response.json({ message: "API rate limit exceeded for this account" }, { status: 403 }),
      },
      (connector) =>
        connector.probe("github-secret").pipe(
          Effect.flip,
          Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
        ),
    );
    yield* runWith(
      {
        respond: () =>
          new Response("temporarily refused", {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          }),
      },
      (connector) =>
        connector.probe("github-secret").pipe(
          Effect.flip,
          Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
        ),
    );
  }),
);

it.effect("reads one issue by its qualified reference", () =>
  runWith(
    { respond: () => Response.json(issueResponse({ body: "Connector details" })) },
    (connector) =>
      connector.getIssue("github-secret", "mercurian/astrolabe#154").pipe(
        Effect.map((issue) => {
          assert.deepStrictEqual(issue, {
            id: "mercurian/astrolabe#154",
            title: "GitHub Issues connector",
            description: "Connector details",
            status: "open",
            url: "https://github.com/mercurian/astrolabe/issues/154",
          });
          assert.strictEqual(
            new URL(seen.requests[0]?.url ?? "").pathname,
            "/repos/mercurian/astrolabe/issues/154",
          );
        }),
      ),
  ),
);

it.effect("returns null for invalid, removed, gone, and pull-request references", () =>
  Effect.gen(function* () {
    yield* runWith({}, (connector) =>
      connector.getIssue("github-secret", "not-an-issue").pipe(
        Effect.map((issue) => {
          assert.isNull(issue);
          assert.strictEqual(seen.requests.length, 0);
        }),
      ),
    );
    for (const status of [404, 410]) {
      yield* runWith({ respond: () => new Response(null, { status }) }, (connector) =>
        connector
          .getIssue("github-secret", "mercurian/astrolabe#154")
          .pipe(Effect.map((issue) => assert.isNull(issue))),
      );
    }
    yield* runWith(
      { respond: () => Response.json(issueResponse({ pull_request: { url: "pulls/154" } })) },
      (connector) =>
        connector
          .getIssue("github-secret", "mercurian/astrolabe#154")
          .pipe(Effect.map((issue) => assert.isNull(issue))),
    );
  }),
);

it.effect("carries Bearer auth and GitHub's required headers on every request", () =>
  runWith({ respond: listResponse() }, (connector) =>
    connector.listIssues("github-secret", {}).pipe(
      Effect.map(() => {
        assert.strictEqual(seen.requests.length, 3);
        for (const request of seen.requests) {
          assert.strictEqual(request.headers.authorization, "Bearer github-secret");
          assert.strictEqual(request.headers.accept, "application/vnd.github+json");
          assert.strictEqual(request.headers["x-github-api-version"], "2022-11-28");
          assert.strictEqual(request.headers["user-agent"], "mercurian");
          assert.notInclude(request.url, "github-secret");
        }
      }),
    ),
  ),
);
