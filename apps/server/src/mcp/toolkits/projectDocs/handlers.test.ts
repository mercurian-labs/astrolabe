import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { McpSchema, McpServer } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../../../orchestration-v2/runtimeLayer.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../../processRunner.ts";
import * as ProjectEnrichmentService from "../../../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../../../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as SourceControlProviderRegistry from "../../../sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import * as WikiService from "../../../wiki/WikiService.ts";
import * as ProjectRoots from "../../../workspace/ProjectRoots.ts";
import * as TaskFolderStore from "../../../workspace/TaskFolderStore.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import { ProjectDocsToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread-project-docs");
const projectId = ProjectId.make("project-docs-tools");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-project-docs"),
  requestNamespace: "project-docs-session",
  thread: {
    threadId,
    providerSessionId: "project-docs-session",
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
  clientInfo: { name: "project-docs", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "project-docs", version: "1" },
  },
  getClient: Effect.die("unused"),
});

// No folder here has a pull request host.
const layerHosts = Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
  resolveLink: () => undefined,
  resolveHandle: () =>
    Effect.succeed({
      provider: {} as SourceControlProvider.SourceControlProvider["Service"],
      context: null,
    }),
});

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        resolvePath: () => Effect.succeed(null),
        invalidate: () => Effect.void,
      }),
    ),
  ),
);

/** The tools over real git, project roots and wiki engine; the calling thread is `thread`. */
const layer = (baseDir: string, thread: { worktreePath: string | null }) =>
  McpHttpServer.layerProjectDocsToolkit.pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed({
            ...McpToolAccessTestkit.liveThreadShell(id),
            projectId,
            worktreePath: thread.worktreePath,
          }),
      }),
    ),
    Layer.provideMerge(WikiService.layer),
    Layer.provideMerge(
      ProjectRoots.layer.pipe(
        Layer.provide(Layer.mergeAll(ProjectStore.layer, TaskFolderStore.layer, layerHosts)),
      ),
    ),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const git = (cwd: string, args: ReadonlyArray<string>) =>
  ProcessRunner.ProcessRunner.pipe(
    Effect.flatMap((runner) =>
      runner.run({
        command: "git",
        args: ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=f@example.com", ...args],
      }),
    ),
    Effect.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
    Effect.orDie,
  );

interface Harness {
  /** A Git repository holding `files` on main. */
  readonly repository: (
    name: string,
    files: Readonly<Record<string, string>>,
  ) => Effect.Effect<string, never, FileSystem.FileSystem | Path.Path>;
  readonly thread: { worktreePath: string | null };
}

/** A project over `app` that tracks `docs`, with the tools' layer for one thread in it. */
const withProject = <A, E>(
  body: (
    harness: Harness,
  ) => Effect.Effect<
    A,
    E,
    | McpServer.McpServer
    | ProjectService.ProjectService
    | FileSystem.FileSystem
    | Path.Path
    | ServerConfig.ServerConfig
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-docs-base-" });
    const scratch = yield* fileSystem.realPath(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-docs-" }),
    );
    const repository: Harness["repository"] = (name, files) =>
      Effect.gen(function* () {
        const root = path.join(scratch, name);
        for (const [file, content] of Object.entries(files)) {
          yield* fileSystem.makeDirectory(path.dirname(path.join(root, file)), {
            recursive: true,
          });
          yield* fileSystem.writeFileString(path.join(root, file), content);
        }
        yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
        yield* git(root, ["add", "."]);
        yield* git(root, ["commit", "--quiet", "-m", "Notes"]);
        return root;
      }).pipe(Effect.orDie);
    const thread = { worktreePath: null as string | null };
    return yield* body({ repository, thread }).pipe(Effect.provide(layer(baseDir, thread)));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const createProject = (workspaceRoot: string, docs: string) =>
  ProjectService.ProjectService.pipe(
    Effect.flatMap((projects) =>
      projects.create({
        commandId: CommandId.make("cmd-project-docs"),
        projectId,
        title: "App",
        workspaceRoot,
        trackedFolders: [{ name: "docs", path: docs }],
      }),
    ),
    Effect.orDie,
  );

const call = (name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

const succeeded = (name: string, args: Record<string, unknown>) =>
  call(name, args).pipe(
    Effect.map((result) => {
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result.structuredContent as Record<string, unknown>;
    }),
  );

const failedWith = (name: string, args: Record<string, unknown>) =>
  call(name, args).pipe(
    Effect.map((result) => {
      expect(result.isError).toBe(true);
      const text = result.content[0];
      return (text?.type === "text" ? JSON.parse(text.text) : {}) as { message?: string };
    }),
  );

const read = (folder: string, file: string) =>
  Effect.flatMap(Path.Path, (path) =>
    Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
      fileSystem.readFileString(path.join(folder, file)).pipe(Effect.orDie),
    ),
  );

const exists = (folder: string, file: string) =>
  Effect.flatMap(Path.Path, (path) =>
    Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
      fileSystem.exists(path.join(folder, file)).pipe(Effect.orDie),
    ),
  );

const APP = {
  "Alpha.md": "# Alpha\n\nAlpha follows [[docs:Guide]], [[Plan]] and [[Missing]].\n",
  "Notes.md": "# Notes\n",
};
const DOCS = {
  "Guide.md": "# Guide\n\nBack to [[app:Alpha|alpha @depends_on]].\n",
  "Plan.md": "---\nstatus: open\n---\n# Plan\n",
  "Done.md": "---\nstatus: done\n---\n# Done\n",
  "Notes.md": "# Notes\n",
  "Open.base":
    "filters: 'status == \"open\"'\nviews:\n  - type: table\n    name: Open\n    order: [file.basename]\n",
};

describe("ProjectDocsToolkit", () => {
  it("names the four project tools, and tells the agent what each parameter is", () => {
    expect(Object.keys(ProjectDocsToolkit.tools).toSorted()).toEqual([
      "astrolabe_project_links",
      "astrolabe_project_orient",
      "astrolabe_project_query",
      "astrolabe_project_transform",
    ]);
    for (const tool of Object.values(ProjectDocsToolkit.tools)) {
      const schema = advertisedJsonSchema(tool) as {
        properties: Record<string, { description?: string }>;
      };
      for (const [name, property] of Object.entries(schema.properties)) {
        if (name !== "transform") expect(property.description, `${tool.name}.${name}`).toBeTruthy();
      }
    }
  });

  it.effect("follows links and backlinks across the project's folders", () =>
    withProject((harness) =>
      Effect.gen(function* () {
        yield* createProject(
          yield* harness.repository("app", APP),
          yield* harness.repository("docs", DOCS),
        );

        const guide = yield* succeeded("astrolabe_project_links", { name: "docs:Guide" });
        expect(guide).toMatchObject({
          repository: "docs",
          name: "docs:Guide.md",
          exists: true,
          outgoing: [
            { target: "app:Alpha", to: "app:Alpha.md", unresolved: false, types: ["depends_on"] },
          ],
          backlinks: ["app:Alpha.md"],
        });

        const alpha = yield* succeeded("astrolabe_project_links", { name: "Alpha" });
        expect(alpha.outgoing).toEqual([
          { target: "docs:Guide", to: "docs:Guide.md", unresolved: false, types: [] },
          { target: "Plan", to: "docs:Plan.md", unresolved: false, types: [] },
          { target: "Missing", to: null, unresolved: true, types: [] },
        ]);
        expect(alpha.backlinks).toEqual(["docs:Guide.md"]);
        expect(alpha.typedBacklinks).toEqual([{ source: "docs:Guide.md", types: ["depends_on"] }]);
        expect(alpha.unresolved).toEqual([{ name: "Missing", sources: ["app:Alpha.md"] }]);

        const ambiguous = yield* failedWith("astrolabe_project_links", { name: "Notes" });
        expect(ambiguous.message).toContain("app:Notes.md, docs:Notes.md");
        const named = yield* succeeded("astrolabe_project_links", {
          name: "Notes",
          repository: "docs",
        });
        expect(named.name).toBe("docs:Notes.md");
      }),
    ),
  );

  it.effect("runs a base from whichever folder holds it, and never guesses between two", () =>
    withProject((harness) =>
      Effect.gen(function* () {
        const docs = yield* harness.repository("docs", DOCS);
        yield* createProject(yield* harness.repository("app", APP), docs);

        const open = yield* succeeded("astrolabe_project_query", { base: "Open" });
        expect(open.repository).toBe("docs");
        expect((open.rows as ReadonlyArray<{ name: string }>).map((row) => row.name)).toEqual([
          "Plan",
        ]);
        expect(open).not.toHaveProperty("properties");
        const byPath = yield* succeeded("astrolabe_project_query", { base: `${docs}/Open.base` });
        expect(byPath.repository).toBe("docs");

        const elsewhere = yield* failedWith("astrolabe_project_query", {
          base: "Open",
          repository: "app",
        });
        expect(elsewhere.message).toBe("No base or note is named Open.");
        const missing = yield* failedWith("astrolabe_project_query", { base: "Nowhere" });
        expect(missing.message).toBe("No folder of the project has Nowhere.");
      }),
    ),
  );

  it.effect(
    "writes a rename into the thread's worktree, and lists a folder it can't write whose links still point there",
    () =>
      withProject((harness) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const app = yield* harness.repository("app", APP);
          const docs = yield* harness.repository("docs", DOCS);
          yield* createProject(app, docs);
          const worktree = path.join(path.dirname(app), "app-thread");
          yield* git(app, ["worktree", "add", "--quiet", "-b", "thread", worktree]);
          harness.thread.worktreePath = worktree;

          const moved = yield* succeeded("astrolabe_project_transform", {
            transform: { kind: "rename", from: "Alpha", to: "ops/Start" },
          });
          expect(moved).toMatchObject({
            repository: "app",
            written: ["app:ops/Start.md"],
            removed: ["app:Alpha.md"],
            unchanged: [{ repository: "docs", files: ["Guide.md"] }],
          });
          expect(yield* exists(worktree, "ops/Start.md")).toBe(true);
          expect(yield* exists(app, "Alpha.md")).toBe(true);
          expect(yield* read(docs, "Guide.md")).toBe(DOCS["Guide.md"]);

          const refused = yield* failedWith("astrolabe_project_transform", {
            transform: { kind: "rename", from: "Plan", to: "archive/Plan" },
            repository: "docs",
          });
          expect(refused.message).toBe(
            "Your thread can't write docs. Folders your thread can write: app.",
          );
          const across = yield* failedWith("astrolabe_project_transform", {
            transform: { kind: "rename", from: "app:Notes", to: "docs:Notes" },
          });
          expect(across.message).toContain("A rename stays in its folder");
        }),
      ),
  );

  it.effect("rewrites links in every folder a live thread can write", () =>
    withProject((harness) =>
      Effect.gen(function* () {
        const app = yield* harness.repository("app", APP);
        const docs = yield* harness.repository("docs", DOCS);
        yield* createProject(app, docs);

        const moved = yield* succeeded("astrolabe_project_transform", {
          transform: { kind: "rename", from: "docs:Plan", to: "archive/Plan" },
        });
        expect(moved).toMatchObject({
          repository: "docs",
          written: ["docs:archive/Plan.md", "app:Alpha.md"],
          removed: ["docs:Plan.md"],
        });
        expect(moved).not.toHaveProperty("unchanged");
        expect(yield* exists(docs, "archive/Plan.md")).toBe(true);
        expect(yield* read(app, "Alpha.md")).toContain("[[docs:Plan]]");
        expect(yield* git(app, ["status", "--porcelain"])).toMatchObject({
          stdout: " M Alpha.md\n",
        });
      }),
    ),
  );
});
