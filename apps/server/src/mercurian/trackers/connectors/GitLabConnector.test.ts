import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import type { TrackerConnector } from "../connector.ts";
import * as GitLabConnector from "./GitLabConnector.ts";

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
  body: (connector: TrackerConnector<"gitlab">) => Effect.Effect<A, E, never>,
) => {
  seen.requests = [];
  return GitLabConnector.make.pipe(
    Effect.flatMap(body),
    Effect.provide(stubHttpClient(options)),
    Effect.scoped,
  );
};

const credential = (
  connector: TrackerConnector<"gitlab">,
  overrides: {
    readonly host?: string;
    readonly token?: string;
  } = {},
) =>
  connector.packCredential({
    kind: "gitlab",
    token: overrides.token ?? "gitlab-secret",
    ...(overrides.host === undefined ? {} : { host: overrides.host }),
  });

const decodePackedCredential = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      host: Schema.String,
      token: Schema.String,
    }),
  ),
);

const issueResponse = (overrides: Record<string, unknown> = {}) => ({
  references: { short: "#31", relative: "#31", full: "group/project#31" },
  title: "Ship GitLab support",
  description: null,
  state: "opened",
  web_url: "https://gitlab.com/group/project/-/issues/31",
  labels: ["connector"],
  assignees: [{ username: "alex" }],
  ...overrides,
});

it.effect("sends only GET requests — a write cannot enter this file", () =>
  Effect.sync(() => {
    for (const request of Object.values(GitLabConnector.GITLAB_REQUESTS)) {
      assert.strictEqual(request.method, "GET", `${request.name} is not pull-only`);
    }
  }),
);

it.effect("normalizes bare hosts and URLs to one HTTPS host", () =>
  Effect.sync(() => {
    assert.strictEqual(
      GitLabConnector.normalizeGitLabHost("gitlab.example.com"),
      "https://gitlab.example.com",
    );
    assert.strictEqual(
      GitLabConnector.normalizeGitLabHost("https://gitlab.example.com"),
      "https://gitlab.example.com",
    );
    assert.strictEqual(
      GitLabConnector.normalizeGitLabHost("http://gitlab.example.com/groups?ignored=yes"),
      "https://gitlab.example.com",
    );
    assert.strictEqual(GitLabConnector.normalizeGitLabHost(""), null);
    assert.strictEqual(GitLabConnector.normalizeGitLabHost("garbage"), null);
    assert.strictEqual(GitLabConnector.normalizeGitLabHost("not a host"), null);
  }),
);

it.effect("packs a resolved host even when the input host is absent or blank", () =>
  runWith({}, (connector) =>
    Effect.sync(() => {
      assert.deepStrictEqual(decodePackedCredential(credential(connector)), {
        host: "https://gitlab.com",
        token: "gitlab-secret",
      });
      assert.deepStrictEqual(decodePackedCredential(credential(connector, { host: "   " })), {
        host: "https://gitlab.com",
        token: "gitlab-secret",
      });
      assert.deepStrictEqual(
        decodePackedCredential(credential(connector, { host: "gitlab.example.com" })),
        {
          host: "https://gitlab.example.com",
          token: "gitlab-secret",
        },
      );
    }),
  ),
);

it.effect("refuses an invalid stored host as authentication input", () =>
  runWith({}, (connector) =>
    connector.probe(credential(connector, { host: "garbage" })).pipe(
      Effect.flip,
      Effect.map((refusal) => {
        assert.strictEqual(refusal._tag, "TrackerAuthRefusal");
        assert.strictEqual(seen.requests.length, 0);
      }),
    ),
  ),
);

it.effect("names gitlab.com by username and self-hosted connections by username and host", () =>
  Effect.gen(function* () {
    yield* runWith({ respond: () => Response.json({ username: "alex", id: 1 }) }, (connector) =>
      connector
        .probe(credential(connector))
        .pipe(Effect.map((result) => assert.strictEqual(result.label, "alex"))),
    );
    yield* runWith({ respond: () => Response.json({ username: "alex", id: 1 }) }, (connector) =>
      connector
        .probe(credential(connector, { host: "gitlab.example.com" }))
        .pipe(
          Effect.map((result) => assert.strictEqual(result.label, "alex · gitlab.example.com")),
        ),
    );
  }),
);

it.effect("maps 401 and 403 probes to authentication refusals", () =>
  Effect.forEach([401, 403], (status) =>
    runWith({ respond: () => new Response("credential refused", { status }) }, (connector) =>
      connector.probe(credential(connector)).pipe(
        Effect.flip,
        Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerAuthRefusal")),
      ),
    ),
  ),
);

it.effect("maps transport failures to unreachable refusals", () =>
  runWith({ failTransport: true }, (connector) =>
    connector.probe(credential(connector)).pipe(
      Effect.flip,
      Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
    ),
  ),
);

it.effect("requests all visible issues, passes search through, and maps exactly five fields", () =>
  runWith(
    {
      respond: () =>
        Response.json([issueResponse()], {
          headers: { "x-next-page": "3" },
        }),
    },
    (connector) =>
      connector
        .listIssues(credential(connector), {
          search: "renderer crash",
          cursor: "2",
        })
        .pipe(
          Effect.map((page) => {
            assert.deepStrictEqual(
              [...page.issues],
              [
                {
                  id: "group/project#31",
                  title: "Ship GitLab support",
                  description: "",
                  status: "opened",
                  url: "https://gitlab.com/group/project/-/issues/31",
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
            assert.strictEqual(page.nextCursor, "3");

            const requestUrl = new URL(seen.requests[0]?.url ?? "");
            assert.strictEqual(requestUrl.pathname, "/api/v4/issues");
            assert.strictEqual(requestUrl.searchParams.get("scope"), "all");
            assert.strictEqual(requestUrl.searchParams.get("order_by"), "updated_at");
            assert.strictEqual(requestUrl.searchParams.get("sort"), "desc");
            assert.strictEqual(requestUrl.searchParams.get("per_page"), "50");
            assert.strictEqual(requestUrl.searchParams.get("page"), "2");
            assert.strictEqual(requestUrl.searchParams.get("search"), "renderer crash");
          }),
        ),
  ),
);

it.effect("ends pagination when x-next-page is empty or absent", () =>
  Effect.gen(function* () {
    yield* runWith(
      { respond: () => Response.json([], { headers: { "x-next-page": "" } }) },
      (connector) =>
        connector
          .listIssues(credential(connector), {})
          .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, undefined))),
    );
    yield* runWith({ respond: () => Response.json([]) }, (connector) =>
      connector
        .listIssues(credential(connector), {})
        .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, undefined))),
    );
  }),
);

it.effect("parses nested project references and URL-encodes the full path when reading", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(GitLabConnector.parseGitLabIssueReference("group/sub/project#31"), {
      projectPath: "group/sub/project",
      iid: 31,
    });
    assert.deepStrictEqual(GitLabConnector.parseGitLabIssueReference("group#sub/project#31"), {
      projectPath: "group#sub/project",
      iid: 31,
    });
    for (const garbage of ["31", "group/project", "group/project#0", "group/project#nope"]) {
      assert.isNull(GitLabConnector.parseGitLabIssueReference(garbage));
    }
  }).pipe(
    Effect.andThen(
      runWith(
        {
          respond: () =>
            Response.json(issueResponse({ references: { full: "group/sub/project#31" } })),
        },
        (connector) =>
          connector.getIssue(credential(connector), "group/sub/project#31").pipe(
            Effect.map((issue) => {
              assert.strictEqual(issue?.id, "group/sub/project#31");
              assert.strictEqual(
                new URL(seen.requests[0]?.url ?? "").pathname,
                "/api/v4/projects/group%2Fsub%2Fproject/issues/31",
              );
            }),
          ),
      ),
    ),
  ),
);

it.effect("returns null for invalid and removed references", () =>
  Effect.gen(function* () {
    yield* runWith({}, (connector) =>
      connector.getIssue(credential(connector), "not-an-issue").pipe(
        Effect.map((issue) => {
          assert.isNull(issue);
          assert.strictEqual(seen.requests.length, 0);
        }),
      ),
    );
    yield* runWith({ respond: () => new Response(null, { status: 404 }) }, (connector) =>
      connector
        .getIssue(credential(connector), "group/project#404")
        .pipe(Effect.map((issue) => assert.isNull(issue))),
    );
  }),
);

it.effect("carries the token in PRIVATE-TOKEN and nowhere in the request URL", () =>
  runWith({ respond: () => Response.json({ username: "alex" }) }, (connector) =>
    connector.probe(credential(connector)).pipe(
      Effect.map(() => {
        assert.strictEqual(seen.requests.length, 1);
        const request = seen.requests[0];
        assert.strictEqual(request?.headers["private-token"], "gitlab-secret");
        assert.notInclude(request?.url ?? "", "gitlab-secret");
      }),
    ),
  ),
);
