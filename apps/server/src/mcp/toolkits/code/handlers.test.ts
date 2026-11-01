import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointRef,
  CheckpointScopeId,
  type CodeChanges,
  CodeIndexError,
  type CodeIndexErrorReason,
  type CodeOutline,
  EnvironmentId,
  type Project,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as CodeIndex from "../../../codeIndex/CodeIndex.ts";
import { checkpointRefForScopeOrdinal } from "../../../orchestration-v2/CheckpointService.ts";
import type { ProjectionCheckpointContext } from "../../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";

const threadId = ThreadId.make("thread-code-tools");
const projectId = ProjectId.make("project:mcp-test");
const projectRoot = "/home/user/acme-app";
const worktree = "/home/user/.t3/worktrees/acme-app/t3-1a2b3c4d";
const rootScope = CheckpointScopeId.make("scope-root");
const runId = RunId.make("run-1");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-code-tools"),
  requestNamespace: "code-tools-session",
  thread: {
    threadId,
    providerSessionId: "code-tools-session",
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
  clientInfo: { name: "code-tools", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "code-tools", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const project: Project = {
  id: projectId,
  title: "acme/app",
  workspaceRoot: projectRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const outline: CodeOutline = {
  files: [
    {
      path: "src/session.ts",
      lines: 120,
      symbols: [
        {
          id: "src/session.ts#resolveSession",
          name: "resolveSession",
          kind: "function",
          path: "src/session.ts",
          line: 14,
          endLine: 40,
          parent: null,
          signature: "export function resolveSession(token: string): Session",
          exported: true,
        },
      ],
    },
  ],
  truncated: false,
};

const changes: CodeChanges = {
  files: [{ path: "src/session.ts", change: "modified" }],
  symbols: [{ change: "added", symbol: outline.files[0]!.symbols[0]! }],
  links: [
    {
      change: "made",
      from: "src/api/login.ts",
      to: "src/session.ts",
      kind: "calls",
      resolution: "exact",
    },
  ],
  truncated: true,
};

const checkpoint = (
  ordinalWithinScope: number,
  appRunOrdinal: number | null,
  status: ProjectionCheckpointContext["checkpoints"][number]["status"] = "ready",
) => ({
  scopeId: rootScope,
  runId,
  ordinalWithinScope,
  appRunOrdinal,
  status,
  ref: CheckpointRef.make(`refs/t3/checkpoints/test/ordinal/${ordinalWithinScope}`),
});

const rootScopeOnly: ProjectionCheckpointContext = {
  runs: [{ id: runId, ordinal: 1, status: "running" }],
  checkpointScopes: [{ id: rootScope, runId, kind: "root_run", cwd: projectRoot }],
  checkpoints: [],
};

interface Fakes {
  readonly worktreePath?: string | null;
  readonly checkpoints?: ProjectionCheckpointContext;
  readonly failure?: CodeIndexErrorReason;
}

const harness = (fakes: Fakes = {}) => {
  const calls: Array<{ readonly method: string; readonly input: unknown }> = [];
  const answer =
    <A>(method: string, result: A) =>
    (input: unknown) => {
      calls.push({ method, input });
      return fakes.failure === undefined
        ? Effect.succeed(result)
        : Effect.fail(
            new CodeIndexError({ reason: fakes.failure, message: `Index said ${fakes.failure}.` }),
          );
    };
  const layer = McpHttpServer.layerCodeToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) =>
            Effect.succeed({
              ...McpToolAccessTestkit.liveThreadShell(id),
              worktreePath: fakes.worktreePath ?? null,
            }),
          getCheckpointContext: () => Effect.succeed(fakes.checkpoints ?? rootScopeOnly),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome(project),
        }),
        Layer.mock(CodeIndex.CodeIndex)({
          outline: answer("outline", outline),
          find: answer("find", { definitions: [], uses: [], truncated: false }),
          changes: answer("changes", changes),
          map: answer("map", { files: [], links: [], outside: [], truncated: false }),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolveBranchMergeBase: (cwd) => {
            calls.push({ method: "resolveBranchMergeBase", input: cwd });
            return Effect.succeed({ baseRef: "origin/main", mergeBase: "9f2c1ab" });
          },
        }),
        NodeCrypto.layer,
      ),
    ),
  );
  const call = (
    name: string,
    args: Record<string, unknown>,
    invocation: McpInvocationContext.McpInvocationScope = scope,
  ) =>
    McpServer.McpServer.pipe(
      Effect.flatMap((server) => server.callTool({ name, arguments: args })),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(layer),
    );
  return { calls, call };
};

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const checkpointRef = (ordinalWithinScope: number) =>
  checkpointRefForScopeOrdinal({ scopeId: rootScope, ordinalWithinScope }).pipe(
    Effect.provide(NodeCrypto.layer),
  );

describe("code toolkit handlers", () => {
  it.effect("reads the thread's worktree, or the project folder when it has none", () =>
    Effect.gen(function* () {
      const inWorktree = harness({ worktreePath: worktree });
      const result = yield* inWorktree.call("astrolabe_code_outline", { path: "src" });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(outline);
      expect(inWorktree.calls).toEqual([
        { method: "outline", input: { projectId, cwd: worktree, path: "src" } },
      ]);

      const atRoot = harness();
      yield* atRoot.call("astrolabe_code_find", { name: "resolveSession", path: null });
      expect(atRoot.calls).toEqual([
        { method: "find", input: { projectId, cwd: projectRoot, name: "resolveSession" } },
      ]);
    }),
  );

  it.effect("compares from the start of the last finished turn to the checkout now", () =>
    Effect.gen(function* () {
      const tools = harness({
        worktreePath: worktree,
        checkpoints: {
          ...rootScopeOnly,
          checkpoints: [checkpoint(1, 1), checkpoint(3, 3, "stale"), checkpoint(2, 2)],
        },
      });
      const result = yield* tools.call("astrolabe_code_changes", {});
      const from = yield* checkpointRef(1);
      expect(tools.calls).toEqual([
        { method: "changes", input: { projectId, cwd: worktree, from } },
      ]);
      expect(result.structuredContent).toEqual({ from, ...changes });
    }),
  );

  it.effect("compares from the thread's start before any turn has finished", () =>
    Effect.gen(function* () {
      const tools = harness();
      yield* tools.call("astrolabe_code_changes", { since: "turn" });
      expect(tools.calls).toEqual([
        {
          method: "changes",
          input: { projectId, cwd: projectRoot, from: yield* checkpointRef(0) },
        },
      ]);

      const neverRan = harness({
        checkpoints: { runs: [], checkpointScopes: [], checkpoints: [] },
      });
      const result = yield* neverRan.call("astrolabe_code_changes", {});
      expect(declaredFailure(result)).toMatchObject({ code: "invalid_request" });
      expect(neverRan.calls).toEqual([]);
    }),
  );

  it.effect("compares a branch from where it left its base, and passes other refs through", () =>
    Effect.gen(function* () {
      const tools = harness({ worktreePath: worktree });
      const branch = yield* tools.call("astrolabe_code_changes", { since: "branch" });
      yield* tools.call("astrolabe_code_changes", { since: "v1.4.0" });
      expect(tools.calls).toEqual([
        { method: "resolveBranchMergeBase", input: worktree },
        { method: "changes", input: { projectId, cwd: worktree, from: "9f2c1ab" } },
        { method: "changes", input: { projectId, cwd: worktree, from: "v1.4.0" } },
      ]);
      expect(branch.structuredContent).toMatchObject({ from: "9f2c1ab", truncated: true });
    }),
  );

  it.effect("tells the agent why the index cannot answer, and never answers for it", () =>
    Effect.gen(function* () {
      const expected: ReadonlyArray<readonly [CodeIndexErrorReason, string, RegExp]> = [
        ["off", "invalid_request", /turned off for this repository in Settings/],
        ["not-indexed", "orchestration_error", /still building\. Retry/],
        ["unsupported", "invalid_request", /has no code index/],
        ["not-found", "invalid_request", /^Index said not-found\.$/],
      ];
      for (const [reason, code, message] of expected) {
        const result = yield* harness({ failure: reason }).call("astrolabe_code_map", {
          paths: ["src/billing"],
        });
        expect(result.structuredContent).toBeUndefined();
        expect(declaredFailure(result)).toMatchObject({
          code,
          message: expect.stringMatching(message),
        });
      }
    }),
  );

  it.effect("needs a calling thread to know which checkout to read", () =>
    Effect.gen(function* () {
      const tools = harness();
      const result = yield* tools.call(
        "astrolabe_code_outline",
        { path: "src" },
        { ...scope, thread: undefined },
      );
      expect(declaredFailure(result)).toMatchObject({ code: "thread_credential_required" });
      expect(tools.calls).toEqual([]);
    }),
  );
});
