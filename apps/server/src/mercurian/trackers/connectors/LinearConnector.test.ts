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
import * as LinearConnector from "./LinearConnector.ts";

interface StubOptions {
  readonly respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly failTransport?: boolean;
}

const seen: { request: HttpClientRequest.HttpClientRequest | null } = { request: null };

const stubHttpClient = (options: StubOptions) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.request = request;
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
  body: (connector: TrackerConnector<"linear">) => Effect.Effect<A, E, never>,
) =>
  LinearConnector.make.pipe(
    Effect.flatMap(body),
    Effect.provide(stubHttpClient(options)),
    Effect.scoped,
  );

/** The JSON a request carried, as the stub saw it. */
const sentBody = (request: HttpClientRequest.HttpClientRequest | null) => {
  assert.isNotNull(request);
  const body = request?.body;
  assert.strictEqual(body?._tag, "Uint8Array");
  return JSON.parse(new TextDecoder().decode((body as { readonly body: Uint8Array }).body)) as {
    readonly query: string;
    readonly variables: Record<string, unknown>;
  };
};

const issuesBody = (nodes: ReadonlyArray<unknown>, pageInfo: unknown) =>
  Response.json({ data: { issues: { nodes, pageInfo } } });

const issueBody = (issue: unknown) => Response.json({ data: { issue } });

it.effect("sends only query documents — a mutation cannot enter this file", () =>
  Effect.sync(() => {
    for (const document of LinearConnector.LINEAR_GRAPHQL_DOCUMENTS) {
      const operations = LinearConnector.graphqlOperationTypes(document);
      assert.isAbove(operations.length, 0, "document declares no operation");
      assert.deepStrictEqual(
        [...new Set(operations)],
        ["query"],
        `document declares a non-query operation: ${operations.join(", ")}`,
      );
    }
  }),
);

it.effect("reads a mutation for what it is, so the fence cannot be fooled", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      LinearConnector.graphqlOperationTypes("mutation Nope { issueCreate { success } }"),
      ["mutation"],
    );
    // Shorthand: an anonymous operation is a query by GraphQL's own rule.
    assert.deepStrictEqual(LinearConnector.graphqlOperationTypes("{ viewer { id } }"), ["query"]);
  }),
);

it.effect("names the workspace a live key reaches", () =>
  runWith(
    { respond: () => Response.json({ data: { organization: { name: "Mercurian" } } }) },
    (connector) =>
      connector.probe("lin_api_test").pipe(
        Effect.map((probed) => {
          assert.strictEqual(probed.label, "Mercurian");
        }),
      ),
  ),
);

it.effect("carries the key in the Authorization header and nowhere else", () =>
  runWith(
    { respond: () => Response.json({ data: { organization: { name: "Mercurian" } } }) },
    (connector) =>
      connector.probe("lin_api_secret").pipe(
        Effect.map(() => {
          const request = seen.request;
          assert.isNotNull(request);
          assert.strictEqual(request?.headers["authorization"], "lin_api_secret");
          assert.strictEqual(request?.url, LinearConnector.LINEAR_GRAPHQL_ENDPOINT);
        }),
      ),
  ),
);

it.effect("refuses a rejected key as an auth refusal", () =>
  runWith({ respond: () => new Response("unauthorized", { status: 401 }) }, (connector) =>
    connector.probe("wrong").pipe(
      Effect.flip,
      Effect.map((refusal) => {
        assert.strictEqual(refusal._tag, "TrackerAuthRefusal");
      }),
    ),
  ),
);

it.effect("reads a 400 body, which is how Linear says a key is bad", () =>
  runWith(
    {
      respond: () =>
        Response.json(
          { errors: [{ message: "Authentication required, not authenticated" }] },
          { status: 400 },
        ),
    },
    (connector) =>
      connector.probe("wrong").pipe(
        Effect.flip,
        Effect.map((refusal) => {
          assert.strictEqual(refusal._tag, "TrackerAuthRefusal");
        }),
      ),
  ),
);

it.effect("refuses a transport failure as unreachable", () =>
  runWith({ failTransport: true }, (connector) =>
    connector.probe("lin_api_test").pipe(
      Effect.flip,
      Effect.map((refusal) => {
        assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal");
      }),
    ),
  ),
);

it.effect("maps a response into exactly the five-field shape", () =>
  runWith(
    {
      respond: () =>
        issuesBody(
          [
            {
              identifier: "M-98",
              title: "Tracker connections",
              description: "Connect a tracker from Settings.",
              url: "https://linear.app/mercurian/issue/M-98/tracker-connections",
              state: { name: "In Progress" },
              // Everything the tracker keeps: none of it has a field to land in.
              priority: 1,
              assignee: { name: "Venk" },
              labels: { nodes: [{ name: "phase-5" }] },
              estimate: 3,
            },
          ],
          { hasNextPage: true, endCursor: "cursor-2" },
        ),
    },
    (connector) =>
      connector.listIssues("lin_api_test", {}).pipe(
        Effect.map((page) => {
          assert.deepStrictEqual(
            [...page.issues],
            [
              {
                id: "M-98",
                title: "Tracker connections",
                description: "Connect a tracker from Settings.",
                url: "https://linear.app/mercurian/issue/M-98/tracker-connections",
                status: "In Progress",
              },
            ],
          );
          assert.strictEqual(page.nextCursor, "cursor-2");
        }),
      ),
  ),
);

it.effect("treats an absent description and an absent state as empty, not missing", () =>
  runWith(
    {
      respond: () =>
        issuesBody(
          [
            {
              identifier: "M-1",
              title: "No body",
              description: null,
              url: "https://linear.app/mercurian/issue/M-1/no-body",
              state: null,
            },
          ],
          { hasNextPage: false, endCursor: null },
        ),
    },
    (connector) =>
      connector.listIssues("lin_api_test", {}).pipe(
        Effect.map((page) => {
          assert.strictEqual(page.issues[0]?.description, "");
          assert.strictEqual(page.issues[0]?.status, "");
          // The last page names no cursor rather than an empty one.
          assert.strictEqual(page.nextCursor, undefined);
        }),
      ),
  ),
);

it.effect("hands the tracker its own search and its own cursor", () =>
  runWith({ respond: () => issuesBody([], { hasNextPage: false, endCursor: null }) }, (connector) =>
    connector.listIssues("lin_api_test", { search: "trackers", cursor: "cursor-2" }).pipe(
      Effect.map(() => {
        const body = sentBody(seen.request);
        assert.strictEqual(body.query, LinearConnector.LINEAR_ISSUES_DOCUMENT);
        assert.strictEqual(body.variables.after, "cursor-2");
        assert.isNotNull(body.variables.filter);
      }),
    ),
  ),
);

it.effect("reads one issue by its tracker identifier", () =>
  runWith(
    {
      respond: () =>
        issueBody({
          identifier: "M-109",
          title: "Specs",
          description: "A first-class contract.",
          url: "https://linear.app/mercurian/issue/M-109/specs",
          state: { name: "In Progress" },
        }),
    },
    (connector) =>
      connector.getIssue("lin_api_test", "M-109").pipe(
        Effect.map((issue) => {
          const body = sentBody(seen.request);
          assert.strictEqual(body.query, LinearConnector.LINEAR_ISSUE_DOCUMENT);
          assert.strictEqual(body.variables.id, "M-109");
          assert.strictEqual(issue?.title, "Specs");
        }),
      ),
  ),
);
