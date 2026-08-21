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
import * as JiraConnector from "./JiraConnector.ts";

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
  body: (connector: TrackerConnector<"jira">) => Effect.Effect<A, E, never>,
) => {
  seen.requests = [];
  return JiraConnector.make.pipe(
    Effect.flatMap(body),
    Effect.provide(stubHttpClient(options)),
    Effect.scoped,
  );
};

const credential = (
  connector: TrackerConnector<"jira">,
  overrides: Partial<{
    readonly site: string;
    readonly email: string;
    readonly token: string;
  }> = {},
) =>
  connector.packCredential({
    kind: "jira",
    site: "acme.atlassian.net",
    email: "dev@acme.com",
    token: "jira-secret",
    ...overrides,
  });

const responseForProbe =
  (serverTitle: string | null) => (request: HttpClientRequest.HttpClientRequest) =>
    new URL(request.url).pathname.endsWith("/serverInfo")
      ? Response.json({ serverTitle })
      : Response.json({ accountId: "account-1" });

const issueResponse = (overrides: Record<string, unknown> = {}) => ({
  key: "ACME-42",
  fields: {
    summary: "Ship Jira support",
    description: null,
    status: { name: "In Review", id: "3" },
    priority: { name: "High" },
  },
  changelog: { histories: [] },
  ...overrides,
});

it.effect("sends only GET requests — a write cannot enter this file", () =>
  Effect.sync(() => {
    for (const request of Object.values(JiraConnector.JIRA_REQUESTS)) {
      assert.strictEqual(request.method, "GET", `${request.name} is not pull-only`);
    }
  }),
);

it.effect("normalizes bare hosts and URLs to one HTTPS site", () =>
  Effect.sync(() => {
    assert.strictEqual(
      JiraConnector.normalizeJiraSite("acme.atlassian.net"),
      "https://acme.atlassian.net",
    );
    assert.strictEqual(
      JiraConnector.normalizeJiraSite("https://acme.atlassian.net"),
      "https://acme.atlassian.net",
    );
    assert.strictEqual(
      JiraConnector.normalizeJiraSite("http://acme.atlassian.net/jira/projects?ignored=yes"),
      "https://acme.atlassian.net",
    );
    assert.strictEqual(JiraConnector.normalizeJiraSite("garbage"), null);
    assert.strictEqual(JiraConnector.normalizeJiraSite("not a site"), null);
  }),
);

it.effect("refuses an invalid stored site as authentication input", () =>
  runWith({}, (connector) =>
    connector.probe(credential(connector, { site: "garbage" })).pipe(
      Effect.flip,
      Effect.map((refusal) => {
        assert.strictEqual(refusal._tag, "TrackerAuthRefusal");
        assert.strictEqual(seen.requests.length, 0);
      }),
    ),
  ),
);

it.effect("escapes quotes and backslashes in JQL and omits empty search", () =>
  Effect.sync(() => {
    assert.strictEqual(
      JiraConnector.escapeJiraJqlString('say "hi" at C:\\work'),
      'say \\"hi\\" at C:\\\\work',
    );
    assert.strictEqual(JiraConnector.buildJiraJql("  "), "ORDER BY updated DESC");
    assert.strictEqual(
      JiraConnector.buildJiraJql('jira "cloud"'),
      'text ~ "jira \\"cloud\\"" ORDER BY updated DESC',
    );
  }),
);

it.effect("names the Jira site and falls back to its host", () =>
  Effect.gen(function* () {
    yield* runWith({ respond: responseForProbe("Acme Jira") }, (connector) =>
      connector
        .probe(credential(connector))
        .pipe(Effect.map((result) => assert.strictEqual(result.label, "Acme Jira"))),
    );
    yield* runWith({ respond: responseForProbe("  ") }, (connector) =>
      connector
        .probe(credential(connector))
        .pipe(Effect.map((result) => assert.strictEqual(result.label, "acme.atlassian.net"))),
    );
  }),
);

it.effect("maps 401 and 403 probes to authentication refusals", () =>
  Effect.forEach([401, 403], (status) =>
    runWith(
      {
        respond: (request) =>
          new URL(request.url).pathname.endsWith("/serverInfo")
            ? Response.json({ serverTitle: "Acme Jira" })
            : new Response("refused", { status }),
      },
      (connector) =>
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

it.effect("maps a search page into exactly five fields and preserves its cursor", () =>
  runWith(
    {
      respond: () =>
        Response.json({
          issues: [issueResponse()],
          nextPageToken: "page-token-2",
          total: 999,
        }),
    },
    (connector) =>
      connector
        .listIssues(credential(connector), {
          search: 'jira "cloud"',
          cursor: "page-token-1",
        })
        .pipe(
          Effect.map((page) => {
            assert.deepStrictEqual(
              [...page.issues],
              [
                {
                  id: "ACME-42",
                  title: "Ship Jira support",
                  description: "",
                  status: "In Review",
                  url: "https://acme.atlassian.net/browse/ACME-42",
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
            assert.strictEqual(page.nextCursor, "page-token-2");

            const requestUrl = new URL(seen.requests[0]?.url ?? "");
            assert.strictEqual(requestUrl.pathname, "/rest/api/2/search/jql");
            assert.strictEqual(requestUrl.searchParams.get("fields"), "summary,description,status");
            assert.strictEqual(requestUrl.searchParams.get("maxResults"), "50");
            assert.strictEqual(requestUrl.searchParams.get("nextPageToken"), "page-token-1");
            assert.strictEqual(
              requestUrl.searchParams.get("jql"),
              'text ~ "jira \\"cloud\\"" ORDER BY updated DESC',
            );
          }),
        ),
  ),
);

it.effect("falls back once only when the token-paged search endpoint is absent", () =>
  runWith(
    {
      respond: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/rest/api/2/search/jql") {
          return new Response(null, { status: 404 });
        }
        const startAt = Number(url.searchParams.get("startAt") ?? "0");
        return Response.json({
          startAt,
          total: 2,
          issues: [issueResponse({ key: `ACME-${startAt + 1}` })],
        });
      },
    },
    (connector) =>
      Effect.gen(function* () {
        const packed = credential(connector);
        const first = yield* connector.listIssues(packed, {});
        assert.strictEqual(first.nextCursor, "1");

        const second = yield* connector.listIssues(packed, { cursor: first.nextCursor });
        assert.strictEqual(second.nextCursor, undefined);
        assert.deepStrictEqual(
          seen.requests.map((request) => new URL(request.url).pathname),
          ["/rest/api/2/search/jql", "/rest/api/2/search", "/rest/api/2/search"],
        );
      }),
  ),
);

it.effect("does not fall back for an ordinary search failure", () =>
  runWith({ respond: () => new Response(null, { status: 500 }) }, (connector) =>
    connector.listIssues(credential(connector), {}).pipe(
      Effect.flip,
      Effect.map((refusal) => {
        assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal");
        assert.strictEqual(seen.requests.length, 1);
        assert.strictEqual(new URL(seen.requests[0]?.url ?? "").pathname, "/rest/api/2/search/jql");
      }),
    ),
  ),
);

it.effect("reads one issue and treats a 404 as removed", () =>
  Effect.gen(function* () {
    yield* runWith({ respond: () => Response.json(issueResponse()) }, (connector) =>
      connector.getIssue(credential(connector), "ACME-42").pipe(
        Effect.map((issue) => {
          assert.deepStrictEqual(issue, {
            id: "ACME-42",
            title: "Ship Jira support",
            description: "",
            status: "In Review",
            url: "https://acme.atlassian.net/browse/ACME-42",
          });
          const requestUrl = new URL(seen.requests[0]?.url ?? "");
          assert.strictEqual(requestUrl.pathname, "/rest/api/2/issue/ACME-42");
          assert.strictEqual(requestUrl.searchParams.get("fields"), "summary,description,status");
        }),
      ),
    );
    yield* runWith({ respond: () => new Response(null, { status: 404 }) }, (connector) =>
      connector
        .getIssue(credential(connector), "ACME-404")
        .pipe(Effect.map((issue) => assert.isNull(issue))),
    );
  }),
);

it.effect("carries Basic auth in the Authorization header and nowhere else", () =>
  runWith({ respond: responseForProbe("Acme Jira") }, (connector) =>
    connector.probe(credential(connector)).pipe(
      Effect.map(() => {
        assert.strictEqual(seen.requests.length, 2);
        for (const request of seen.requests) {
          assert.strictEqual(
            request.headers["authorization"],
            "Basic ZGV2QGFjbWUuY29tOmppcmEtc2VjcmV0",
          );
          assert.notInclude(request.url, "dev@acme.com");
          assert.notInclude(request.url, "jira-secret");
        }
      }),
    ),
  ),
);
