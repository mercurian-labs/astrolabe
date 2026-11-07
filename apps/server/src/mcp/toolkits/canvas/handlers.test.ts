import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type Project,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
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

const harness = (options: { readonly files?: ReadonlyArray<string>; readonly noGit?: boolean }) => {
  const asked: string[] = [];
  const kept: Array<{
    readonly input: WikiKeepCanvasInput;
    readonly author: WikiService.WikiAuthor;
  }> = [];
  const layer = McpHttpServer.layerCanvasToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
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
        Layer.mock(CanvasKeep.CanvasKeep)({
          keep: (input, author) => {
            kept.push({ input, author });
            return Effect.succeed({ file: `${input.name}`, notes: [] } as never);
          },
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome(project),
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
  return { asked, kept, call };
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
      expect(result.structuredContent).toEqual({ message: expect.any(String) });
      expect(tools.asked).toEqual([]);
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
      expect(result.structuredContent).toEqual({ message: expect.any(String) });
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
