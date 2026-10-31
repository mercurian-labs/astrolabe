import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type BackgroundPolicySnapshot,
  type CodeIndexState,
  type CodeLocalGraphInput,
  type OrchestrationProjectShell,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WikiService from "../wiki/WikiService.ts";
import * as CodeIndex from "./CodeIndex.ts";
import type { WorkerJob } from "./workerProtocol.ts";

const PROJECT = ProjectId.make("project-code-index");

const git = (cwd: string, args: ReadonlyArray<string>) =>
  ProcessRunner.ProcessRunner.pipe(
    Effect.flatMap((runner) =>
      runner.run({
        command: "git",
        args: [
          "-C",
          cwd,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          ...args,
        ],
      }),
    ),
    Effect.map((result) => result.stdout.trim()),
    Effect.provide(ProcessRunner.layer),
    Effect.orDie,
  );

const write = (root: string, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, content] of Object.entries(files)) {
      yield* fileSystem.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
      yield* fileSystem.writeFileString(path.join(root, file), content);
    }
  }).pipe(Effect.orDie);

const SOURCES = {
  "src/a.ts": 'import { beta } from "./b.ts";\nexport function alpha() {\n  return beta();\n}\n',
  "src/b.ts": "export function beta() {\n  return 1;\n}\n",
  "src/c.ts": 'import { alpha } from "./a.ts";\nexport const gamma = () => alpha();\n',
};

interface Harness {
  readonly index: CodeIndex.CodeIndex["Service"];
  readonly root: string;
  /** The project's folder: the repository's top level, or the subfolder it was given. */
  readonly project: string;
  /** A fresh folder beside the repository. */
  readonly folder: (name: string) => Effect.Effect<string>;
  /** Every job a worker ran, in order. */
  readonly jobs: Array<WorkerJob>;
  readonly setSettings: (settings: ServerSettings) => Effect.Effect<void>;
  readonly setPolicy: (run: boolean) => Effect.Effect<void>;
  /**
   * Stop the index and start another over the same state, as a server restart does; it registers
   * the repositories once `registering` completes.
   */
  readonly restart: (
    registering: Deferred.Deferred<void>,
  ) => Effect.Effect<CodeIndex.CodeIndex["Service"], never, NodeServices.NodeServices>;
  /** Hold the next delete job until `release` runs; `held` waits until it is held. */
  readonly holdNextDelete: Effect.Effect<{
    readonly held: Effect.Effect<void>;
    readonly release: Effect.Effect<void>;
  }>;
}

const policySnapshot = (run: boolean) =>
  ({ shouldRunOpportunisticWork: run }) as unknown as BackgroundPolicySnapshot;

/** The index over a real repository, real git and the real worker, with its data in a temp dir. */
const withIndex = <A, E>(
  options: {
    readonly files: Readonly<Record<string, string>>;
    readonly settings?: ServerSettings;
    readonly run?: boolean;
    /** The project's folder inside the repository; its top level by default. */
    readonly project?: string;
  },
  body: (harness: Harness) => Effect.Effect<A, E, Scope.Scope | NodeServices.NodeServices>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-code-index-base-" });
    const scratch = yield* fileSystem.realPath(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-code-index-repo-" }),
    );
    const folder = (name: string) => Effect.succeed(path.join(scratch, name));
    const root = path.join(scratch, "repo");
    const project = options.project === undefined ? root : path.join(root, options.project);
    yield* fileSystem.makeDirectory(root);
    yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
    yield* write(root, options.files);
    yield* git(root, ["add", "."]);
    yield* git(root, ["commit", "--quiet", "-m", "Sources"]);

    const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
    const settingsChanges = yield* PubSub.unbounded<ServerSettings>();
    const policyChanges = yield* PubSub.unbounded<BackgroundPolicySnapshot>();
    const jobs: Array<WorkerJob> = [];

    let hold: {
      readonly held: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    } | null = null;

    const services = (registering: Effect.Effect<void>) =>
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          listShells: () =>
            Effect.succeed([
              {
                id: PROJECT,
                title: "Repo",
                workspaceRoot: project,
              } as unknown as OrchestrationProjectShell,
            ]),
        }),
        Layer.mock(WikiService.WikiService)({
          list: Effect.succeed({ wikis: [] }),
          subscribe: Stream.never,
        }),
        Layer.mock(ServerSettingsService.ServerSettingsService)({
          getSettings: Ref.get(settings),
          subscribeChanges: Effect.succeed(Stream.fromPubSub(settingsChanges)),
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          subscribe: Effect.succeed({
            latest: policySnapshot(options.run ?? true),
            changes: Stream.fromPubSub(policyChanges),
          }),
        }),
        // The index registers its repositories after reading this.
        Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({
          latestApplicationSequence: registering.pipe(Effect.as(0)),
          streamProjectedApplicationEvents: () => Stream.never,
        }),
        GitVcsDriver.layer.pipe(
          Layer.provide(VcsProcess.layer),
          Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
        ),
      );
    const open = (registering: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const command = yield* CodeIndex.workerCommand();
        assert.isNotNull(command);
        const runWorker = yield* CodeIndex.makeWorkerRunner(command!);
        return yield* CodeIndex.make({
          runWorker: (job, onOutput) => {
            jobs.push(job);
            const gate = job.op === "delete" ? hold : null;
            if (gate !== null) hold = null;
            const waited =
              gate === null
                ? Effect.void
                : Deferred.succeed(gate.held, undefined).pipe(
                    Effect.andThen(Deferred.await(gate.release)),
                  );
            return waited.pipe(Effect.andThen(runWorker(job, onOutput)));
          },
        });
      }).pipe(Effect.provide(services(registering)));
    const outer = yield* Effect.scope;
    let running = yield* Scope.fork(outer);
    const index = yield* open(Effect.void).pipe(Scope.provide(running));
    return yield* body({
      index,
      root,
      project,
      folder,
      jobs,
      setSettings: (next) =>
        Ref.set(settings, next).pipe(Effect.andThen(PubSub.publish(settingsChanges, next))),
      setPolicy: (run) => PubSub.publish(policyChanges, policySnapshot(run)).pipe(Effect.asVoid),
      restart: (registering) =>
        Effect.gen(function* () {
          yield* Scope.close(running, Exit.void);
          running = yield* Scope.fork(outer);
          return yield* open(Deferred.await(registering)).pipe(Scope.provide(running));
        }).pipe(Effect.orDie),
      holdNextDelete: Effect.gen(function* () {
        const gate = { held: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
        hold = gate;
        return {
          held: Deferred.await(gate.held),
          release: Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid),
        };
      }),
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Wait for the project's index to reach a state, from the status stream. */
const reach = (index: CodeIndex.CodeIndex["Service"], state: CodeIndexState) =>
  index.subscribe.pipe(
    Stream.filter((status) => status.projectId === PROJECT && status.state === state),
    Stream.take(1),
    Stream.runHead,
    Effect.map((status) => {
      assert.isTrue(status._tag === "Some");
      return status._tag === "Some" ? status.value : null;
    }),
  );

const parsedPaths = (job: WorkerJob | undefined) =>
  job?.op === "parse" ? job.files.map((file) => file.path).toSorted() : [];

const graphInput = (
  cwd: string,
  path: string,
  overrides: Partial<CodeLocalGraphInput> = {},
): CodeLocalGraphInput => ({
  projectId: PROJECT,
  cwd,
  path,
  depth: 1,
  uses: true,
  usedBy: true,
  dependencies: false,
  expanded: [],
  ...overrides,
});

/** A worktree on a new branch `feature` with `b.ts` changed and `d.ts` added, both committed. */
const featureWorktree = (harness: Harness) =>
  Effect.gen(function* () {
    const worktree = yield* harness.folder("feature");
    yield* git(harness.root, ["worktree", "add", "--quiet", "-b", "feature", worktree]);
    yield* write(worktree, {
      "src/b.ts":
        "export function beta() {\n  return 2;\n}\nexport function onlyOnBranch() {\n  return 3;\n}\n",
      "src/d.ts": 'import { onlyOnBranch } from "./b.ts";\nexport const delta = onlyOnBranch();\n',
    });
    yield* git(worktree, ["add", "."]);
    yield* git(worktree, ["commit", "--quiet", "-m", "Feature"]);
    return worktree;
  });

it.effect("builds the repository once, then parses only the file versions a checkout adds", () =>
  withIndex({ files: SOURCES }, (harness) =>
    Effect.gen(function* () {
      const ready = yield* reach(harness.index, "ready");
      assert.strictEqual(ready?.files, 3);
      assert.strictEqual(ready?.totalFiles, 3);
      assert.deepStrictEqual(ready?.languages, ["TypeScript"]);
      assert.deepStrictEqual(parsedPaths(harness.jobs[0]), ["src/a.ts", "src/b.ts", "src/c.ts"]);

      const worktree = yield* featureWorktree(harness);
      // Uncommitted, so read from disk and keyed by its own hash.
      yield* write(worktree, { "src/c.ts": "export const gamma = 3;\n" });
      yield* harness.index.outline({ projectId: PROJECT, cwd: worktree, path: "src" });
      const topUp = harness.jobs[1];
      assert.deepStrictEqual(parsedPaths(topUp), ["src/b.ts", "src/c.ts", "src/d.ts"]);
      assert.isTrue(
        topUp?.op === "parse" &&
          topUp.files.every((file) => (file.path === "src/c.ts") === (file.disk !== null)),
      );

      // Asking again, or asking about the repository's own checkout, parses nothing.
      yield* harness.index.outline({ projectId: PROJECT, cwd: worktree, path: "src" });
      yield* harness.index.outline({ projectId: PROJECT, cwd: harness.root, path: "src" });
      assert.strictEqual(harness.jobs.length, 2);
    }),
  ),
);

it.effect("answers each checkout from the one shared store", () =>
  withIndex({ files: SOURCES }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const worktree = yield* featureWorktree(harness);

      const onBranch = yield* harness.index.find({
        projectId: PROJECT,
        cwd: worktree,
        name: "onlyOnBranch",
      });
      assert.deepStrictEqual(
        onBranch.definitions.map((definition) => [definition.path, definition.line]),
        [["src/b.ts", 4]],
      );
      assert.deepStrictEqual(
        onBranch.uses.map((use) => [use.path, use.line, use.kind, use.resolution]),
        [
          ["src/d.ts", 1, "imports", "exact"],
          ["src/d.ts", 2, "calls", "exact"],
        ],
      );
      const onMain = yield* harness.index
        .find({ projectId: PROJECT, cwd: harness.root, name: "onlyOnBranch" })
        .pipe(Effect.flip);
      assert.strictEqual(onMain.reason, "not-found");

      const beta = yield* harness.index.find({
        projectId: PROJECT,
        cwd: harness.root,
        name: "beta",
      });
      assert.deepStrictEqual(
        beta.uses.map((use) => [use.path, use.line, use.from, use.kind]),
        [
          ["src/a.ts", 1, null, "imports"],
          ["src/a.ts", 3, "alpha", "calls"],
        ],
      );
      const outline = yield* harness.index.outline({
        projectId: PROJECT,
        cwd: worktree,
        path: "src/b.ts",
      });
      assert.deepStrictEqual(
        outline.files[0]?.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.exported]),
        [
          ["beta", "function", true],
          ["onlyOnBranch", "function", true],
        ],
      );
    }),
  ),
);

it.effect("marks files changed on the branch and uncommitted ones", () =>
  withIndex({ files: SOURCES }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const worktree = yield* featureWorktree(harness);
      yield* write(worktree, {
        "src/c.ts": 'import { alpha } from "./a.ts";\nexport const gamma = () => alpha() + 1;\n',
      });
      const graph = yield* harness.index.localGraph(graphInput(worktree, "src/a.ts"));
      assert.deepStrictEqual(
        graph.nodes.map((node) => [node.id, node.depth, node.changed]),
        [
          ["src/a.ts", 0, null],
          ["src/b.ts", 1, "branch"],
          ["src/c.ts", 1, "uncommitted"],
        ],
      );
      assert.deepStrictEqual(
        graph.links.map((link) => [link.from, link.to, link.line, link.text]),
        [
          ["src/a.ts", "src/b.ts", 1, 'import { beta } from "./b.ts";'],
          ["src/c.ts", "src/a.ts", 1, 'import { alpha } from "./a.ts";'],
        ],
      );
      assert.isFalse(graph.usedByPending);
    }),
  ),
);

/** A monorepo whose project is `apps/server`, importing a package and imported from beside it. */
const MONOREPO = {
  "apps/server/package.json": '{ "name": "@fixture/server" }\n',
  "apps/server/src/main.ts":
    'import { helper } from "./helper.ts";\nimport { shared } from "@fixture/shared";\nexport const main = () => helper() + shared();\n',
  "apps/server/src/helper.ts": "export function helper() {\n  return 1;\n}\n",
  "apps/web/src/view.ts":
    'import { helper } from "../../server/src/helper.ts";\nexport const view = helper();\n',
  "packages/shared/package.json":
    '{ "name": "@fixture/shared", "exports": { ".": "./src/index.ts" } }\n',
  "packages/shared/src/index.ts": "export function shared() {\n  return 2;\n}\n",
};

it.effect("answers a project in a subfolder in paths relative to its folder", () =>
  withIndex({ files: MONOREPO, project: "apps/server" }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const cwd = harness.project;
      const sharedEntry = "../../packages/shared/src/index.ts";

      const usedBy = yield* harness.index.localGraph(graphInput(cwd, "src/helper.ts"));
      assert.strictEqual(usedBy.center, "src/helper.ts");
      assert.deepStrictEqual(
        usedBy.nodes.map((node) => [node.id, node.path, node.outsideProject ?? false]),
        [
          ["src/helper.ts", "src/helper.ts", false],
          ["../web/src/view.ts", "../web/src/view.ts", true],
          ["src/main.ts", "src/main.ts", false],
        ],
      );
      assert.deepStrictEqual(
        usedBy.links.map((link) => [link.from, link.to]),
        [
          ["../web/src/view.ts", "src/helper.ts"],
          ["src/main.ts", "src/helper.ts"],
        ],
      );
      const uses = yield* harness.index.localGraph(
        graphInput(cwd, "./src/main.ts", { usedBy: false }),
      );
      assert.deepStrictEqual(
        uses.nodes.map((node) => [node.id, node.kind, node.path, node.outsideProject ?? false]),
        [
          ["src/main.ts", "file", "src/main.ts", false],
          ["@fixture/shared", "package", sharedEntry, true],
          ["src/helper.ts", "file", "src/helper.ts", false],
        ],
      );

      const outline = yield* harness.index.outline({ projectId: PROJECT, cwd, path: "src" });
      assert.deepStrictEqual(
        outline.files.map((file) => [file.path, file.symbols.map((symbol) => symbol.path)]),
        [
          ["src/helper.ts", ["src/helper.ts"]],
          ["src/main.ts", ["src/main.ts"]],
        ],
      );
      const beside = yield* harness.index.outline({
        projectId: PROJECT,
        cwd,
        path: "../../packages/shared",
      });
      assert.deepStrictEqual(
        beside.files.map((file) => file.path),
        [sharedEntry],
      );

      const helper = yield* harness.index.find({ projectId: PROJECT, cwd, name: "helper" });
      assert.deepStrictEqual(
        helper.definitions.map((definition) => definition.path),
        ["src/helper.ts"],
      );
      assert.deepStrictEqual(helper.uses.map((use) => [use.path, use.line, use.kind]).toSorted(), [
        ["../web/src/view.ts", 1, "imports"],
        ["../web/src/view.ts", 2, "calls"],
        ["src/main.ts", 1, "imports"],
        ["src/main.ts", 3, "calls"],
      ]);
      const scoped = yield* harness.index.find({
        projectId: PROJECT,
        cwd,
        name: "shared",
        path: "../../packages",
      });
      assert.deepStrictEqual(
        scoped.definitions.map((definition) => definition.path),
        [sharedEntry],
      );

      const mapped = yield* harness.index.map({ projectId: PROJECT, cwd, paths: ["src"] });
      assert.deepStrictEqual(
        mapped.files.map((file) => file.path),
        ["src/helper.ts", "src/main.ts"],
      );
      assert.deepStrictEqual(
        mapped.links.map((link) => [link.from, link.to]),
        [["src/main.ts", "src/helper.ts"]],
      );
      assert.deepStrictEqual(
        mapped.outside.map((entry) => [entry.path, entry.direction]).toSorted(),
        [
          ["../../packages/shared/src/index.ts", "uses"],
          ["../web/src/view.ts", "usedBy"],
        ],
      );

      yield* write(harness.root, {
        "apps/server/src/helper.ts":
          'import { shared } from "@fixture/shared";\nexport function helper() {\n  return shared();\n}\n',
      });
      const changed = yield* harness.index.changes({ projectId: PROJECT, cwd, from: "HEAD" });
      assert.deepStrictEqual(changed.files, [{ path: "src/helper.ts", change: "modified" }]);
      assert.deepStrictEqual(
        changed.symbols.map((entry) => [entry.change, entry.symbol.path, entry.symbol.name]),
        [["changed", "src/helper.ts", "helper"]],
      );
      assert.deepStrictEqual(
        changed.links.map((link) => [link.change, link.from, link.to]),
        [["made", "src/helper.ts#helper", `${sharedEntry}#shared`]],
      );

      // From the repository's top level, the same checkout answers in repository paths.
      const control = yield* harness.index.localGraph(
        graphInput(harness.root, "apps/server/src/helper.ts"),
      );
      assert.deepStrictEqual(
        control.nodes.map((node) => [node.id, node.outsideProject ?? false]),
        [
          ["apps/server/src/helper.ts", false],
          ["@fixture/shared", false],
          ["apps/server/src/main.ts", false],
          ["apps/web/src/view.ts", false],
        ],
      );
      const rootOutline = yield* harness.index.outline({
        projectId: PROJECT,
        cwd: harness.root,
        path: "packages",
      });
      assert.deepStrictEqual(
        rootOutline.files.map((file) => file.path),
        ["packages/shared/src/index.ts"],
      );
    }),
  ),
);

it.effect("reads a vendored package.json as vendored code, not a package of the repository", () =>
  withIndex(
    {
      files: {
        "src/app.ts": 'import * as Effect from "effect/Effect";\nexport const app = Effect;\n',
        ".repos/effect-smol/packages/effect/package.json":
          '{ "name": "effect", "exports": { "./*": "./src/*.ts" } }\n',
        ".repos/effect-smol/packages/effect/src/Effect.ts": "export const succeed = 1;\n",
      },
    },
    (harness) =>
      Effect.gen(function* () {
        yield* reach(harness.index, "ready");
        const graph = yield* harness.index.localGraph(
          graphInput(harness.root, "src/app.ts", { dependencies: true }),
        );
        assert.deepStrictEqual(
          graph.nodes.map((node) => [node.id, node.kind]),
          [
            ["src/app.ts", "file"],
            ["dependency:effect", "dependency"],
          ],
        );
      }),
  ),
);

/**
 * A web app importing through its tsconfig `paths` and its package.json `imports`, and a CLI whose
 * tsconfig takes its `paths` from the repository's base config.
 */
const ALIASED = {
  "tsconfig.base.json":
    '{\n  // Every app extends this.\n  "compilerOptions": { "paths": { "@shared/*": ["./packages/shared/src/*"] }, },\n}\n',
  "apps/web/tsconfig.json":
    '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }\n',
  "apps/web/package.json":
    '{ "name": "@fixture/web", "imports": { "#lib/*": "./src/lib/*.ts" } }\n',
  "apps/web/src/main.ts":
    'import { arrange } from "~/panes/arrangement";\nimport { tree } from "~/panes/tree.js";\nimport { util } from "#lib/util";\nimport "~/app.css";\nexport const main = () => arrange() + tree() + util();\n',
  "apps/web/src/panes/arrangement.ts": "export function arrange() {\n  return 1;\n}\n",
  "apps/web/src/panes/tree.ts": "export function tree() {\n  return 2;\n}\n",
  "apps/web/src/lib/util.ts": "export function util() {\n  return 3;\n}\n",
  "apps/cli/tsconfig.json": '{ "extends": "../../tsconfig.base.json" }\n',
  "apps/cli/src/run.ts":
    'import { words } from "@shared/strings";\nexport const run = () => words();\n',
  "packages/shared/src/strings.ts": "export function words() {\n  return 4;\n}\n",
};

it.effect("resolves imports through tsconfig paths and package.json imports", () =>
  withIndex({ files: ALIASED }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const uses = yield* harness.index.localGraph(
        graphInput(harness.root, "apps/web/src/main.ts", { usedBy: false, dependencies: true }),
      );
      assert.deepStrictEqual(
        uses.nodes.map((node) => [node.id, node.kind]),
        [
          ["apps/web/src/main.ts", "file"],
          ["apps/web/src/lib/util.ts", "file"],
          ["apps/web/src/panes/arrangement.ts", "file"],
          ["apps/web/src/panes/tree.ts", "file"],
        ],
      );
      assert.isTrue(uses.links.every((link) => link.resolution === "exact"));

      const usedBy = yield* harness.index.localGraph(
        graphInput(harness.root, "apps/web/src/panes/arrangement.ts", { uses: false }),
      );
      assert.deepStrictEqual(
        usedBy.links.map((link) => [link.from, link.to, link.line]),
        [["apps/web/src/main.ts", "apps/web/src/panes/arrangement.ts", 1]],
      );

      const words = yield* harness.index.find({
        projectId: PROJECT,
        cwd: harness.root,
        name: "words",
      });
      assert.deepStrictEqual(
        words.uses.map((use) => [use.path, use.line, use.kind, use.resolution]),
        [
          ["apps/cli/src/run.ts", 1, "imports", "exact"],
          ["apps/cli/src/run.ts", 2, "calls", "exact"],
        ],
      );
    }),
  ),
);

const crowd = (() => {
  const files: Record<string, string> = {
    "lib/target.ts": 'import { other } from "./other.ts";\nexport const target = other;\n',
    "lib/other.ts": "export const other = 1;\n",
    "lib/target.test.ts": 'import { target } from "./target.ts";\nexport const checked = target;\n',
  };
  for (let index = 0; index < 45; index += 1) {
    files[`users/u${index}.ts`] =
      `import { target } from "../lib/target.ts";\nexport const u${index} = target;\n`;
  }
  return files;
})();

it.effect("folds a crowded ring by folder, keeps tests, and opens the folders asked for", () =>
  withIndex({ files: crowd }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const folded = yield* harness.index.localGraph(graphInput(harness.root, "lib/target.ts"));
      assert.deepStrictEqual(
        folded.nodes.map((node) => [node.id, node.kind, node.test, node.files]),
        [
          ["lib/target.ts", "file", false, null],
          ["lib/other.ts", "file", false, null],
          ["lib/target.test.ts", "file", true, null],
          ["users", "folder", false, 45],
        ],
      );
      assert.deepStrictEqual(
        folded.links.find((link) => link.from === "users"),
        { from: "users", to: "lib/target.ts", line: null, text: null, resolution: "exact" },
      );

      const opened = yield* harness.index.localGraph(
        graphInput(harness.root, "lib/target.ts", { expanded: ["users"] }),
      );
      assert.strictEqual(opened.nodes.filter((node) => node.id.startsWith("users/")).length, 45);
      assert.isFalse(opened.nodes.some((node) => node.kind === "folder"));
    }),
  ),
);

/**
 * 269 importers of `lib/target.ts` over nested folders, one alone in its folder, three at the top;
 * 45 more import `apps/desktop/src/d0.ts` from a folder below it.
 */
const sprawl = (() => {
  const files: Record<string, string> = { "lib/target.ts": "export const target = 1;\n" };
  const add = (folder: string, prefix: string, count: number, imported = "lib/target.ts") => {
    const up = folder === "" ? "./" : "../".repeat(folder.split("/").length);
    for (let index = 0; index < count; index += 1) {
      const file = `${folder === "" ? "" : `${folder}/`}${prefix}${index}.ts`;
      files[file] = `import * as imported from "${up}${imported}";\nexport const v = imported;\n`;
    }
  };
  add("apps/desktop/src", "d", 10);
  add("apps/desktop/src/app", "e", 10);
  add("apps/web/src", "w", 5);
  add("apps/web/src/components", "c", 30);
  add("apps/web/src/hooks", "h", 10);
  for (let index = 0; index < 10; index += 1) add(`packages/p${index}/src`, "f", 20);
  add("packages/solo/src", "s", 1);
  add("", "r", 3);
  add("apps/desktop/src/app/deep", "x", 45, "apps/desktop/src/d0.ts");
  return files;
})();

/** Folder groups drawn inside another drawn folder group. */
const nestedFolders = (nodes: ReadonlyArray<{ readonly id: string; readonly kind: string }>) => {
  const folders = nodes.filter((node) => node.kind === "folder").map((node) => node.id);
  return folders.filter((inner) => folders.some((outer) => inner.startsWith(`${outer}/`)));
};

it.effect("folds a crowded side at the one finest folder level that fits", () =>
  withIndex({ files: sprawl }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const folded = yield* harness.index.localGraph(graphInput(harness.root, "lib/target.ts"));
      const ring = folded.nodes.filter((node) => node.depth === 1);
      assert.deepStrictEqual(nestedFolders(ring), []);
      assert.deepStrictEqual(
        ring.map((node) => [node.id, node.kind, node.files]),
        [
          ["apps/desktop/src", "folder", 20],
          ["apps/web/src", "folder", 45],
          ...Array.from({ length: 10 }, (_, index) => [`packages/p${index}/src`, "folder", 20]),
          ["packages/solo/src/s0.ts", "file", null],
          ["r0.ts", "file", null],
          ["r1.ts", "file", null],
          ["r2.ts", "file", null],
        ],
      );
      assert.deepStrictEqual(
        folded.links.find((link) => link.from === "apps/desktop/src"),
        {
          from: "apps/desktop/src",
          to: "lib/target.ts",
          line: null,
          text: null,
          resolution: "exact",
        },
      );

      // An opened folder past the limit folds again below itself.
      const web = yield* harness.index.localGraph(
        graphInput(harness.root, "lib/target.ts", { expanded: ["apps/web/src"] }),
      );
      const inWeb = web.nodes.filter((node) => node.id.startsWith("apps/web/src/"));
      assert.deepStrictEqual(
        inWeb.map((node) => [node.id, node.kind, node.files]),
        [
          ["apps/web/src/components", "folder", 30],
          ["apps/web/src/hooks", "folder", 10],
          ...Array.from({ length: 5 }, (_, index) => [`apps/web/src/w${index}.ts`, "file", null]),
        ],
      );
      assert.isFalse(web.nodes.some((node) => node.id === "apps/web/src"));
      assert.deepStrictEqual(nestedFolders(web.nodes), []);

      const components = yield* harness.index.localGraph(
        graphInput(harness.root, "lib/target.ts", {
          expanded: ["apps/web/src", "apps/web/src/components"],
        }),
      );
      const shown = components.nodes.filter((node) =>
        node.id.startsWith("apps/web/src/components/"),
      );
      assert.strictEqual(shown.length, 30);
      assert.isTrue(shown.every((node) => node.kind === "file"));

      // The second ring folds its own way, but a folder inside one the first ring drew joins it.
      const deeper = yield* harness.index.localGraph(
        graphInput(harness.root, "lib/target.ts", { depth: 2 }),
      );
      assert.deepStrictEqual(nestedFolders(deeper.nodes), []);
      assert.deepStrictEqual(
        deeper.nodes
          .filter((node) => node.id.startsWith("apps/desktop/"))
          .map((node) => [node.id, node.depth, node.files]),
        [["apps/desktop/src", 1, 65]],
      );
    }),
  ),
);

it.effect("cleanup keeps what a branch, worktree or checkpoint reaches and removes the rest", () =>
  withIndex({ files: SOURCES }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      const worktree = yield* featureWorktree(harness);
      yield* write(worktree, { "src/c.ts": "export const gamma = 3;\n" });
      yield* harness.index.outline({ projectId: PROJECT, cwd: worktree, path: "src" });
      yield* git(harness.root, ["update-ref", "refs/t3/checkpoints/turn-1", "feature"]);

      const stored = yield* harness.index.storage;
      assert.strictEqual(stored.fileVersions, 6);
      assert.strictEqual(stored.unusedFileVersions, 0);

      // The worktree and branch go; the checkpoint still holds b.ts and d.ts, nothing holds c.ts.
      yield* git(harness.root, ["worktree", "remove", "--force", worktree]);
      yield* git(harness.root, ["branch", "-D", "--quiet", "feature"]);
      assert.strictEqual((yield* harness.index.storage).unusedFileVersions, 1);

      yield* git(harness.root, ["update-ref", "-d", "refs/t3/checkpoints/turn-1"]);
      assert.strictEqual((yield* harness.index.storage).unusedFileVersions, 3);
      const pruned = yield* harness.index.prune;
      assert.strictEqual(pruned.fileVersions, 3);
      const after = yield* harness.index.storage;
      assert.deepStrictEqual([after.fileVersions, after.unusedFileVersions], [3, 0]);

      // The repository's own checkout still answers.
      const outline = yield* harness.index.outline({
        projectId: PROJECT,
        cwd: harness.root,
        path: "src",
      });
      assert.strictEqual(outline.files.length, 3);
    }),
  ),
);

it.effect(
  "keeps the index when cleanup runs before a restarted server registers repositories",
  () =>
    withIndex({ files: SOURCES }, (harness) =>
      Effect.gen(function* () {
        yield* reach(harness.index, "ready");
        const registering = yield* Deferred.make<void>();
        const restarted = yield* harness.restart(registering);
        const pruned = yield* restarted.prune;
        assert.strictEqual(pruned.fileVersions, 0);

        yield* Deferred.succeed(registering, undefined);
        const ready = yield* reach(restarted, "ready");
        assert.strictEqual(ready?.files, 3);
        // Built from what was stored: nothing parsed again.
        assert.strictEqual(harness.jobs.filter((job) => job.op === "parse").length, 1);
      }),
    ),
);

it.effect("builds a repository again when cleanup deletes its index after it was turned on", () =>
  withIndex({ files: SOURCES }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "ready");
      yield* harness.setSettings({
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: {
          [PROJECT]: { codeIndex: { enabled: false, skippedPaths: [] } },
        },
      });
      yield* reach(harness.index, "off");
      // Cleanup decides to drop the turned-off index; it is turned back on before the delete runs.
      const gate = yield* harness.holdNextDelete;
      const pruning = yield* Effect.forkChild(harness.index.prune);
      yield* gate.held;
      yield* harness.setSettings(DEFAULT_SERVER_SETTINGS);
      yield* reach(harness.index, "ready");
      yield* gate.release;
      assert.strictEqual((yield* Fiber.join(pruning)).fileVersions, 3);

      const rebuilt = yield* reach(harness.index, "ready");
      assert.strictEqual(rebuilt?.files, 3);
      assert.deepStrictEqual(parsedPaths(harness.jobs.at(-1)), [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
      ]);
      const outline = yield* harness.index.outline({
        projectId: PROJECT,
        cwd: harness.root,
        path: "src",
      });
      assert.strictEqual(outline.files.length, 3);
    }),
  ),
);

it.effect("reports a turned-off repository as off and builds it when turned back on", () =>
  withIndex(
    {
      files: SOURCES,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: {
          [PROJECT]: { codeIndex: { enabled: false, skippedPaths: [] } },
        },
      },
    },
    (harness) =>
      Effect.gen(function* () {
        const off = yield* reach(harness.index, "off");
        assert.strictEqual(off?.files, 0);
        const refused = yield* harness.index
          .outline({ projectId: PROJECT, cwd: harness.root, path: "src" })
          .pipe(Effect.flip);
        assert.strictEqual(refused.reason, "off");
        assert.strictEqual(harness.jobs.length, 0);

        yield* harness.setSettings({
          ...DEFAULT_SERVER_SETTINGS,
          projectSettingsOverrides: {
            [PROJECT]: { codeIndex: { enabled: true, skippedPaths: ["src/c.ts"] } },
          },
        });
        const ready = yield* reach(harness.index, "ready");
        assert.strictEqual(ready?.totalFiles, 2);
      }),
  ),
);

it.effect("waits while background work is paused, answering a file's own imports meanwhile", () =>
  withIndex({ files: SOURCES, run: false }, (harness) =>
    Effect.gen(function* () {
      yield* reach(harness.index, "waiting");
      const early = yield* harness.index.localGraph(
        graphInput(harness.root, "src/a.ts", { depth: 3 }),
      );
      assert.isTrue(early.usedByPending);
      assert.deepStrictEqual(
        early.nodes.map((node) => node.id),
        ["src/a.ts", "src/b.ts"],
      );
      assert.deepStrictEqual(parsedPaths(harness.jobs[0]), ["src/a.ts"]);
      const notYet = yield* harness.index
        .find({ projectId: PROJECT, cwd: harness.root, name: "beta" })
        .pipe(Effect.flip);
      assert.strictEqual(notYet.reason, "not-indexed");

      yield* harness.setPolicy(true);
      const ready = yield* reach(harness.index, "ready");
      assert.strictEqual(ready?.files, 3);
      // a.ts was already parsed for the question; the build parsed only the rest.
      assert.deepStrictEqual(parsedPaths(harness.jobs[1]), ["src/b.ts", "src/c.ts"]);
    }),
  ),
);
