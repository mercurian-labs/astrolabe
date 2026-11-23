import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  type Project,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type WikiKeepCanvasInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as CanvasKeep from "../../../wiki/CanvasKeep.ts";
import * as WikiService from "../../../wiki/WikiService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as CanvasHandlers from "./handlers.ts";
import { CanvasToolkit } from "./tools.ts";

const projectId = ProjectId.make("project:mcp-test");
const projectRoot = "/home/user/acme-app";
const worktree = "/home/user/.t3/worktrees/acme-app/t3-1a2b3c4d";

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-canvas-tools"),
  requestNamespace: "canvas-tools-session",
  thread: {
    threadId: ThreadId.make("thread-canvas-tools"),
    providerSessionId: "canvas-tools-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "canvas-tools", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "canvas-tools", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const project: Project = {
  id: projectId,
  title: "acme/app",
  workspaceRoot: projectRoot,
  repositoryIdentity: {
    canonicalKey: "github.com/acme/app",
    locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@github.com:acme/app" },
    webUrl: "https://github.com/acme/app",
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const harness = (options: {
  readonly files?: ReadonlyArray<string>;
  readonly noGit?: boolean;
  readonly recordedTitle?: string;
  readonly recordedUpdated?: boolean;
  readonly recordError?: OrchestratorMcpFailure;
}) => {
  const asked: string[] = [];
  const recorded: Array<{
    readonly title: string;
    readonly update?: string | undefined;
    readonly document: unknown;
  }> = [];
  const kept: Array<{
    readonly input: WikiKeepCanvasInput;
    readonly author: WikiService.WikiAuthor;
  }> = [];
  const layer = McpHttpServer.toolkitRegistration(CanvasToolkit, CanvasHandlers.layer).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) =>
            Effect.succeed({
              ...McpToolAccessTestkit.liveThreadShell(id),
              projectId,
              worktreePath: worktree,
            }),
          getProjectThreadRecords: (input) =>
            Effect.succeed({ thread: { id: input.threadId } } as never),
        }),
        Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
          recordCanvas: (_scope, input) => {
            recorded.push(input);
            if (options.recordError !== undefined) return Effect.fail(options.recordError);
            return Effect.succeed({
              turnItemId: TurnItemId.make("turn-item:canvas:1"),
              title: options.recordedTitle ?? input.title,
              ...(options.recordedUpdated === undefined
                ? {}
                : { updated: options.recordedUpdated }),
            });
          },
        }),
        Layer.mock(CanvasKeep.CanvasKeep)({
          keep: (input, author) => {
            kept.push({ input, author });
            return Effect.succeed({ file: `${input.name}`, notes: [] } as never);
          },
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome(project),
          readRepositoryIdentity: ({ repositoryIdentity }) =>
            Effect.succeed(repositoryIdentity ?? null),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          execute: (input) => {
            asked.push(input.cwd);
            return options.noGit
              ? Effect.fail({ _tag: "GitCommandError" } as never)
              : Effect.succeed({ stdout: "9f2c1ab\n" } as never);
          },
        }),
        FileSystem.layerNoop({
          exists: (path) => Effect.succeed((options.files ?? []).includes(path)),
        }),
        NodePath.layer,
      ),
    ),
  );
  const call = (args: Record<string, unknown>, name = "astrolabe_canvas_show") =>
    McpServer.McpServer.pipe(
      Effect.flatMap((server) => server.callTool({ name, arguments: args })),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(layer),
    );
  return { asked, recorded, kept, call };
};

const failureMessage = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text"
    ? (JSON.parse(text.text) as { readonly message: string }).message
    : undefined;
};

describe("canvas toolkit handlers", () => {
  it.effect("draws without touching the checkout when no card cites code", () =>
    Effect.gen(function* () {
      const tools = harness({});
      const result = yield* tools.call({
        title: "Flow",
        cards: [
          { id: "a", text: "Client" },
          { id: "b", text: "Server" },
        ],
        arrows: [{ from: "a", to: "b", label: "calls" }],
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        message: expect.stringContaining("![[Flow.canvas]]"),
        canvasItemId: "turn-item:canvas:1",
        file: "Flow.canvas",
        embeds: ["![[Flow.canvas]]"],
      });
      expect(tools.asked).toEqual([]);
      // The board is laid out here, once, for the thread to keep; the agent gets only its id.
      expect(tools.recorded).toMatchObject([
        {
          title: "Flow",
          document: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ label: "calls" }] },
        },
      ]);
    }),
  );

  it.effect(
    "forwards update targets, reports in-place updates, and surfaces missing-target errors",
    () =>
      Effect.gen(function* () {
        const updatedTools = harness({ recordedUpdated: true });
        const updated = yield* updatedTools.call({
          title: "Flow",
          update: "Flow.canvas",
          cards: [{ id: "a", text: "Client" }],
        });
        expect(updated.isError).not.toBe(true);
        expect(updatedTools.recorded).toMatchObject([{ title: "Flow", update: "Flow.canvas" }]);
        expect(updated.structuredContent).toMatchObject({
          file: "Flow.canvas",
          message: expect.stringContaining("Updated Flow.canvas in place"),
        });

        const missingTools = harness({
          recordError: new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              'No canvas named "Missing.canvas" exists in this thread. Existing canvases: Flow.canvas.',
          }),
        });
        const missing = yield* missingTools.call({
          title: "Flow",
          update: "Missing.canvas",
          cards: [{ id: "a", text: "Client" }],
        });
        expect(failureMessage(missing)).toContain('No canvas named "Missing.canvas"');
      }),
  );

  it.effect("records the commit and repository a kept code card should pin", () =>
    Effect.gen(function* () {
      const tools = harness({ files: [`${worktree}/src/a.ts`] });
      const result = yield* tools.call({
        title: "Code",
        cards: [{ id: "a", path: "src/a.ts", line: 3 }],
      });
      expect(result.structuredContent).toMatchObject({
        code: {
          commit: "9f2c1ab",
          repository: "github.com/acme/app",
          webUrl: "https://github.com/acme/app",
        },
      });
      expect(tools.asked).toEqual([worktree]);
    }),
  );

  it.effect("still draws code cards in a folder that isn't a git repository", () =>
    Effect.gen(function* () {
      const result = yield* harness({ files: [`${worktree}/a.ts`], noGit: true }).call({
        title: "Code",
        cards: [{ id: "a", path: "a.ts" }],
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ canvasItemId: "turn-item:canvas:1" });
    }),
  );

  it.effect(
    "names the board by the title it was recorded under, with an embed for each frame",
    () =>
      Effect.gen(function* () {
        // An earlier canvas in the thread took "Checkout", so this one was recorded as "Checkout 2".
        const tools = harness({ recordedTitle: "Checkout 2" });
        const result = yield* tools.call({
          title: "Checkout",
          cards: [
            { id: "cart", text: "Cart", group: "shop" },
            { id: "charge", text: "Charge", group: "pay" },
            { id: "receipt", text: "Receipt" },
          ],
          groups: [
            { id: "shop", label: "Storefront" },
            { id: "pay", label: "Payments" },
            { id: "bare" },
          ],
          arrows: [
            { from: "cart", to: "charge" },
            { from: "charge", to: "receipt" },
          ],
        });
        expect(result.structuredContent).toMatchObject({
          file: "Checkout 2.canvas",
          embeds: [
            "![[Checkout 2.canvas]]",
            "![[Checkout 2.canvas#Storefront]]",
            "![[Checkout 2.canvas#Payments]]",
          ],
        });
        expect(tools.recorded).toMatchObject([{ title: "Checkout" }]);
      }),
  );

  it.effect("lays out lanes from its arrows, with no stories to ask for", () =>
    Effect.gen(function* () {
      const tools = harness({});
      const result = yield* tools.call({
        title: "Login",
        cards: [
          { id: "form", text: "Form", group: "browser" },
          { id: "check", text: "Check", group: "server" },
        ],
        groups: [
          { id: "browser", label: "Browser" },
          { id: "server", label: "Server" },
        ],
        arrows: [{ from: "form", to: "check" }],
        layout: { kind: "lanes" },
      });
      expect(result.isError).not.toBe(true);
      const document = tools.recorded[0]?.document as {
        nodes: ReadonlyArray<{ id: string; x: number }>;
        astrolabe?: unknown;
      };
      const x = (id: string) => document.nodes.find((node) => node.id === id)?.x ?? NaN;
      expect(x("check")).toBeGreaterThan(x("form"));
      expect(document.astrolabe).toBeUndefined();
    }),
  );

  it.effect("tells the agent which files it cited aren't there", () =>
    Effect.gen(function* () {
      const result = yield* harness({ files: [`${worktree}/src/a.ts`] }).call({
        title: "Code",
        cards: [
          { id: "a", path: "src/a.ts" },
          { id: "b", path: "src/gone.ts" },
        ],
      });
      expect(failureMessage(result)).toBe("These files aren't in this checkout: src/gone.ts");
    }),
  );

  it.effect("refuses a drawing it can't draw, saying what to fix", () =>
    Effect.gen(function* () {
      const result = yield* harness({}).call({
        title: "Broken",
        cards: [{ id: "a", text: "A" }],
        arrows: [{ from: "a", to: "nowhere" }],
      });
      expect(failureMessage(result)).toContain('"nowhere"');
    }),
  );

  it.effect.each([
    ["this thread", undefined, scope.thread!.threadId],
    ["the thread that drew it", "thread-other", ThreadId.make("thread-other")],
  ])("keeps a board from %s for the calling thread", ([, threadId, drawnIn]) =>
    Effect.gen(function* () {
      const { call, kept } = harness({});
      yield* call(
        {
          wiki: " Team ",
          name: "Flow.canvas",
          itemId: "item-1",
          comment: "For the review",
          ...(threadId === undefined ? {} : { threadId }),
        },
        "astrolabe_canvas_keep",
      );
      expect(kept).toHaveLength(1);
      expect(kept[0]?.input).toEqual({
        wikiId: "Team",
        threadId: drawnIn,
        itemId: "item-1",
        name: "Flow.canvas",
        comment: "For the review",
      });
      expect(kept[0]?.author.threadId).toBe(scope.thread!.threadId);
      expect(kept[0]?.author.actor).not.toBe(WikiService.person.actor);
    }),
  );
});
