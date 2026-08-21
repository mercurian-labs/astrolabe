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
import * as AzureDevOpsConnector from "./AzureDevOpsConnector.ts";

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
  body: (connector: TrackerConnector<"azure-devops">) => Effect.Effect<A, E, never>,
) => {
  seen.requests = [];
  return AzureDevOpsConnector.make.pipe(
    Effect.flatMap(body),
    Effect.provide(stubHttpClient(options)),
    Effect.scoped,
  );
};

const credential = (
  connector: TrackerConnector<"azure-devops">,
  overrides: Partial<{ readonly organization: string; readonly token: string }> = {},
) =>
  connector.packCredential({
    kind: "azure-devops",
    organization: "acme",
    token: "azure-secret",
    ...overrides,
  });

const sentBody = (request: HttpClientRequest.HttpClientRequest | undefined) => {
  assert.isDefined(request);
  const body = request?.body;
  assert.strictEqual(body?._tag, "Uint8Array");
  return JSON.parse(new TextDecoder().decode((body as { readonly body: Uint8Array }).body)) as {
    readonly query: string;
  };
};

const bodyText = (request: HttpClientRequest.HttpClientRequest): string =>
  request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

const workItemResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  fields: {
    "System.Title": "Ship Azure DevOps support",
    "System.Description": "<p>Readable &amp; useful</p><div>Second line</div>",
    "System.State": "Active",
    "System.TeamProject": "Platform & Tools",
    "System.AssignedTo": { displayName: "Alex" },
  },
  relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse" }],
  ...overrides,
});

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: index + 1, url: `ignored-${index + 1}` }));

it.effect("allows exactly WIQL's read POST and otherwise sends only GET requests", () =>
  Effect.sync(() => {
    // WIQL is Azure's query language and travels only in a POST request body.
    const readPostAllowlist: ReadonlyArray<string> = [
      AzureDevOpsConnector.AZURE_DEVOPS_REQUESTS.wiql.name,
    ];
    assert.deepStrictEqual(readPostAllowlist, ["wiql"]);
    assert.strictEqual(readPostAllowlist.length, 1);
    for (const request of Object.values(AzureDevOpsConnector.AZURE_DEVOPS_REQUESTS)) {
      assert.isTrue(request.readOnly, `${request.name} is not marked read-only`);
      if (readPostAllowlist.includes(request.name)) {
        assert.strictEqual(request.method, "POST");
      } else {
        assert.strictEqual(request.method, "GET", `${request.name} is not pull-only`);
      }
    }
  }),
);

it.effect("normalizes bare names and dev.azure.com URLs to one organization name", () =>
  Effect.sync(() => {
    assert.strictEqual(AzureDevOpsConnector.normalizeAzureDevOpsOrganization("acme"), "acme");
    assert.strictEqual(
      AzureDevOpsConnector.normalizeAzureDevOpsOrganization("https://dev.azure.com/acme"),
      "acme",
    );
    assert.strictEqual(
      AzureDevOpsConnector.normalizeAzureDevOpsOrganization("https://dev.azure.com/acme/"),
      "acme",
    );
    for (const garbage of [
      "",
      "not an organization",
      "http://dev.azure.com/acme",
      "https://example.com/acme",
      "https://dev.azure.com/acme/project",
      "https://acme.visualstudio.com",
    ]) {
      assert.isNull(AzureDevOpsConnector.normalizeAzureDevOpsOrganization(garbage));
    }
  }),
);

it.effect("packs the normalized organization and refuses invalid stored credentials", () =>
  runWith({}, (connector) =>
    Effect.gen(function* () {
      assert.strictEqual(
        credential(connector, { organization: "https://dev.azure.com/acme" }),
        '{"organization":"acme","token":"azure-secret"}',
      );
      const refusal = yield* connector
        .probe(credential(connector, { organization: "https://example.com/acme" }))
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "TrackerAuthRefusal");
      assert.strictEqual(seen.requests.length, 0);
    }),
  ),
);

it.effect("escapes WIQL quotes and sends the ordered query body", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      AzureDevOpsConnector.escapeAzureDevOpsWiqlString("it's 'ready'"),
      "it''s ''ready''",
    );
    yield* runWith({ respond: () => Response.json({ workItems: [] }) }, (connector) =>
      connector.listIssues(credential(connector), {}).pipe(
        Effect.map((page) => {
          assert.deepStrictEqual(page, { issues: [] });
          const request = seen.requests[0];
          assert.strictEqual(request?.method, "POST");
          assert.strictEqual(
            sentBody(request).query,
            "Select [System.Id] From WorkItems Order By [System.ChangedDate] Desc",
          );
          const url = new URL(request?.url ?? "");
          assert.strictEqual(url.pathname, "/acme/_apis/wit/wiql");
          assert.strictEqual(url.searchParams.get("api-version"), "7.1");
          assert.strictEqual(url.searchParams.get("$top"), "51");
        }),
      ),
    );
    yield* runWith({ respond: () => Response.json({ workItems: [] }) }, (connector) =>
      connector
        .listIssues(credential(connector), { search: " owner’s 'fix' " })
        .pipe(
          Effect.map(() =>
            assert.strictEqual(
              sentBody(seen.requests[0]).query,
              "Select [System.Id] From WorkItems Where [System.Title] Contains 'owner’s ''fix''' Or [System.Description] Contains 'owner’s ''fix''' Order By [System.ChangedDate] Desc",
            ),
          ),
        ),
    );
  }),
);

it.effect("turns Azure rich text into readable plain text", () =>
  Effect.sync(() => {
    assert.strictEqual(AzureDevOpsConnector.htmlToText(undefined), "");
    assert.strictEqual(AzureDevOpsConnector.htmlToText(null), "");
    assert.strictEqual(AzureDevOpsConnector.htmlToText("Plain text"), "Plain text");
    assert.strictEqual(
      AzureDevOpsConnector.htmlToText(
        "<h2>Goal &amp; scope</h2><p>One<br>Two</p><div>&lt;done&gt; &quot;yes&quot; &#39;now&#39;&nbsp;</div>",
      ),
      "Goal & scope\n\nOne\nTwo\n\n<done> \"yes\" 'now'",
    );
    assert.strictEqual(
      AzureDevOpsConnector.htmlToText("<table><tr><td>A</td></tr><tr><td>B</td></tr></table>"),
      "A\n\nB",
    );
  }),
);

it.effect("names the organization and probes the documented projects endpoint", () =>
  runWith(
    { respond: () => Response.json({ count: 1, value: [{ name: "Platform" }] }) },
    (connector) =>
      connector.probe(credential(connector)).pipe(
        Effect.map((result) => {
          assert.strictEqual(result.label, "acme");
          const url = new URL(seen.requests[0]?.url ?? "");
          assert.strictEqual(url.pathname, "/acme/_apis/projects");
          assert.strictEqual(url.searchParams.get("api-version"), "7.1");
          assert.strictEqual(url.searchParams.get("$top"), "1");
        }),
      ),
  ),
);

it.effect("maps 401, 403, and Azure's 203 HTML sign-in response to authentication refusals", () =>
  Effect.gen(function* () {
    for (const status of [401, 403]) {
      yield* runWith(
        { respond: () => new Response("credential refused", { status }) },
        (connector) =>
          connector.probe(credential(connector)).pipe(
            Effect.flip,
            Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerAuthRefusal")),
          ),
      );
    }
    yield* runWith(
      {
        respond: () =>
          new Response("<!doctype html><html><title>Sign in</title></html>", {
            status: 203,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      },
      (connector) =>
        connector.probe(credential(connector)).pipe(
          Effect.flip,
          Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerAuthRefusal")),
        ),
    );
  }),
);

it.effect("maps transport failures to unreachable refusals", () =>
  runWith({ failTransport: true }, (connector) =>
    connector.probe(credential(connector)).pipe(
      Effect.flip,
      Effect.map((refusal) => assert.strictEqual(refusal._tag, "TrackerUnreachableRefusal")),
    ),
  ),
);

it.effect("maps a page into exactly five fields and requests only its 50-id slice", () =>
  runWith(
    {
      respond: (request) =>
        new URL(request.url).pathname.endsWith("/wiql")
          ? Response.json({ workItems: ids(51), columns: [{ referenceName: "System.Id" }] })
          : Response.json({ value: [workItemResponse()], count: 1 }),
    },
    (connector) =>
      connector.listIssues(credential(connector), {}).pipe(
        Effect.map((page) => {
          assert.deepStrictEqual(
            [...page.issues],
            [
              {
                id: "42",
                title: "Ship Azure DevOps support",
                description: "Readable & useful\n\nSecond line",
                status: "Active",
                url: "https://dev.azure.com/acme/Platform%20%26%20Tools/_workitems/edit/42",
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
          assert.strictEqual(page.nextCursor, "50");
          const batchUrl = new URL(seen.requests[1]?.url ?? "");
          assert.strictEqual(batchUrl.pathname, "/acme/_apis/wit/workitems");
          assert.strictEqual(
            batchUrl.searchParams.get("ids"),
            ids(50)
              .map(({ id }) => id)
              .join(","),
          );
          assert.strictEqual(
            batchUrl.searchParams.get("fields"),
            "System.Title,System.Description,System.State,System.TeamProject",
          );
          assert.strictEqual(batchUrl.searchParams.get("api-version"), "7.1");
        }),
      ),
  ),
);

it.effect("advances and ends offset cursors at the result end and the 1000-item cap", () =>
  Effect.gen(function* () {
    const runPage = (count: number, cursor: string, expectedCursor?: string) =>
      runWith(
        {
          respond: (request) =>
            new URL(request.url).pathname.endsWith("/wiql")
              ? Response.json({ workItems: ids(count) })
              : Response.json({ value: [] }),
        },
        (connector) =>
          connector
            .listIssues(credential(connector), { cursor })
            .pipe(Effect.map((page) => assert.strictEqual(page.nextCursor, expectedCursor))),
      );

    yield* runPage(101, "50", "100");
    assert.strictEqual(new URL(seen.requests[0]?.url ?? "").searchParams.get("$top"), "101");
    yield* runPage(100, "50");
    yield* runPage(1_000, "950");
    assert.strictEqual(new URL(seen.requests[0]?.url ?? "").searchParams.get("$top"), "1000");
    yield* runPage(51, "invalid", "50");
    assert.strictEqual(new URL(seen.requests[0]?.url ?? "").searchParams.get("$top"), "51");
  }),
);

it.effect("returns an empty page without a batch request when the offset has no ids", () =>
  runWith({ respond: () => Response.json({ workItems: ids(10) }) }, (connector) =>
    connector.listIssues(credential(connector), { cursor: "50" }).pipe(
      Effect.map((page) => {
        assert.deepStrictEqual(page, { issues: [] });
        assert.strictEqual(seen.requests.length, 1);
      }),
    ),
  ),
);

it.effect("guards numeric issue ids without a request and treats 404 as removed", () =>
  Effect.gen(function* () {
    yield* runWith({}, (connector) =>
      connector.getIssue(credential(connector), "ACME-42").pipe(
        Effect.map((issue) => {
          assert.isNull(issue);
          assert.strictEqual(seen.requests.length, 0);
        }),
      ),
    );
    yield* runWith({ respond: () => new Response(null, { status: 404 }) }, (connector) =>
      connector
        .getIssue(credential(connector), "404")
        .pipe(Effect.map((issue) => assert.isNull(issue))),
    );
  }),
);

it.effect("reads one work item with the same fields and mapping", () =>
  runWith({ respond: () => Response.json(workItemResponse()) }, (connector) =>
    connector.getIssue(credential(connector), "42").pipe(
      Effect.map((issue) => {
        assert.strictEqual(issue?.id, "42");
        assert.strictEqual(issue?.description, "Readable & useful\n\nSecond line");
        const url = new URL(seen.requests[0]?.url ?? "");
        assert.strictEqual(url.pathname, "/acme/_apis/wit/workitems/42");
        assert.strictEqual(
          url.searchParams.get("fields"),
          "System.Title,System.Description,System.State,System.TeamProject",
        );
      }),
    ),
  ),
);

it.effect("carries Basic PAT auth in the header and nowhere else", () =>
  runWith(
    {
      respond: (request) =>
        new URL(request.url).pathname.endsWith("/wiql")
          ? Response.json({ workItems: [{ id: 42 }] })
          : Response.json({ value: [workItemResponse()] }),
    },
    (connector) =>
      connector.listIssues(credential(connector), { search: "connector" }).pipe(
        Effect.map(() => {
          assert.strictEqual(seen.requests.length, 2);
          for (const request of seen.requests) {
            assert.strictEqual(request.headers.authorization, "Basic OmF6dXJlLXNlY3JldA==");
            assert.notInclude(request.url, "azure-secret");
            assert.notInclude(bodyText(request), "azure-secret");
          }
        }),
      ),
  ),
);
