import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  IsoDateTime,
  ProviderInstanceId,
  ThreadId,
  WikiError,
  WikiId,
  type WikiListResult,
  type WikiQueryResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as WikiService from "../../../wiki/WikiService.ts";
import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import { WikiToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread-wiki-tools");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-wiki-tools"),
  requestNamespace: "wiki-tools-session",
  thread: {
    threadId,
    providerSessionId: "wiki-tools-session",
    providerInstanceId: ProviderInstanceId.make("claude"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "wiki-tools", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wiki-tools", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const rows: WikiQueryResult = {
  commit: "4f1c2a9",
  view: { name: "Open", type: "table" },
  views: ["Open"],
  columns: [
    { id: "file.name", label: "Name" },
    { id: "status", label: "Status" },
  ],
  groupBy: null,
  rows: [{ name: "Alpha", file: "Alpha.md", values: { "file.name": "Alpha.md", status: "open" } }],
  total: 1,
  truncated: false,
};

const harness = (
  answer: Effect.Effect<WikiQueryResult, WikiError>,
  listed: WikiListResult = { wikis: [] },
) => {
  const calls: unknown[] = [];
  const layer = McpHttpServer.layerWikiToolkit.pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(
      Layer.mergeAll(
        McpToolAccessTestkit.liveThreadsLayer,
        Layer.mock(WikiService.WikiService)({
          list: Effect.succeed(listed),
          listFolder: (input) => {
            calls.push(input);
            return Effect.succeed({
              commit: "4f1c2a9",
              folder: "ops",
              folders: [],
              documents: ["ops/Retry policy.md"],
              files: [],
              truncated: false,
            });
          },
          query: (input) => {
            calls.push(input);
            return answer;
          },
        }),
      ),
    ),
  );
  const call = (args: Record<string, unknown>, name = "astrolabe_wiki_query") =>
    McpServer.McpServer.pipe(
      Effect.flatMap((server) => server.callTool({ name, arguments: args })),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(layer),
    );
  return { calls, call };
};

describe("astrolabe_wiki_list", () => {
  it.effect("leaves out map backgrounds, whose addresses can hold access tokens", () =>
    Effect.gen(function* () {
      const tools = harness(Effect.succeed(rows), {
        wikis: [
          {
            wikiId: WikiId.make("plans"),
            name: "Plans",
            root: "/wikis/plans",
            mainBranch: "main",
            projectIds: [],
            mirror: null,
            mapBackgrounds: [
              { name: "Paid", lightTiles: "https://tiles.test/?key=secret", darkTiles: null },
            ],
            openChangeRequests: 0,
            createdAt: IsoDateTime.make("2026-11-04T00:00:00.000Z"),
          },
        ],
      });
      const result = yield* tools.call({}, "astrolabe_wiki_list");
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain("Plans");
      expect(JSON.stringify(result)).not.toContain("secret");
    }),
  );

  it.effect("lists one folder of a named wiki from the calling thread's view of it", () =>
    Effect.gen(function* () {
      const tools = harness(Effect.succeed(rows));
      const result = yield* tools.call({ wiki: " Plans ", folder: "ops" }, "astrolabe_wiki_list");
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        contents: { documents: ["ops/Retry policy.md"] },
      });
      expect(tools.calls).toEqual([{ wikiId: "Plans", folder: "ops", threadId }]);
    }),
  );
});

describe("astrolabe_wiki_query", () => {
  it.effect("runs the named base from the calling thread's view of the wiki", () =>
    Effect.gen(function* () {
      const tools = harness(Effect.succeed(rows));
      const result = yield* tools.call({ wiki: " Plans ", base: "Open decisions ", view: "Open" });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(rows);
      expect(tools.calls).toEqual([
        { wikiId: "Plans", base: "Open decisions", view: "Open", threadId },
      ]);
    }),
  );

  it.effect("passes a base's own error through, so the agent sees what is unsupported", () =>
    Effect.gen(function* () {
      const message =
        "Not supported: formula.ppu (formulas) in the base's filters `formula.ppu > 5`.";
      const tools = harness(Effect.fail(new WikiError({ reason: "invalid", message })));
      const result = yield* tools.call({ wiki: "Plans", base: "Prices.base" });
      const text = result.content[0];
      expect(result.isError).toBe(true);
      expect(text?.type === "text" ? JSON.parse(text.text) : undefined).toMatchObject({
        code: "invalid_request",
        message,
      });
    }),
  );

  it("tells the agent what each parameter is", () => {
    const schema = advertisedJsonSchema(WikiToolkit.tools.astrolabe_wiki_query) as {
      properties: Record<string, { description?: string }>;
    };
    expect(
      Object.fromEntries(
        Object.entries(schema.properties).map(([name, property]) => [
          name,
          Boolean(property.description),
        ]),
      ),
    ).toEqual({ wiki: true, base: true, view: true, changeRequestId: true });
  });
});
