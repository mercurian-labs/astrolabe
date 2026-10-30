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
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
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
  /** A fresh folder beside the repository. */
  readonly folder: (name: string) => Effect.Effect<string>;
  /** Every job a worker ran, in order. */
  readonly jobs: Array<WorkerJob>;
  readonly setSettings: (settings: ServerSettings) => Effect.Effect<void>;
  readonly setPolicy: (run: boolean) => Effect.Effect<void>;
}

const policySnapshot = (run: boolean) =>
  ({ shouldRunOpportunisticWork: run }) as unknown as BackgroundPolicySnapshot;

/** The index over a real repository, real git and the real worker, with its data in a temp dir. */
const withIndex = <A, E>(
  options: {
    readonly files: Readonly<Record<string, string>>;
    readonly settings?: ServerSettings;
    readonly run?: boolean;
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
    yield* fileSystem.makeDirectory(root);
    yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
    yield* write(root, options.files);
    yield* git(root, ["add", "."]);
    yield* git(root, ["commit", "--quiet", "-m", "Sources"]);

    const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
    const settingsChanges = yield* PubSub.unbounded<ServerSettings>();
    const policyChanges = yield* PubSub.unbounded<BackgroundPolicySnapshot>();
    const jobs: Array<WorkerJob> = [];

    const services = Layer.mergeAll(
      Layer.mock(ProjectService.ProjectService)({
        listShells: () =>
          Effect.succeed([
            {
              id: PROJECT,
              title: "Repo",
              workspaceRoot: root,
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
      Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({
        latestApplicationSequence: Effect.succeed(0),
        streamProjectedApplicationEvents: () => Stream.never,
      }),
      GitVcsDriver.layer.pipe(
        Layer.provide(VcsProcess.layer),
        Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
      ),
    );
    const index = yield* Effect.gen(function* () {
      const command = yield* CodeIndex.workerCommand();
      assert.isNotNull(command);
      const runWorker = yield* CodeIndex.makeWorkerRunner(command!);
      return yield* CodeIndex.make({
        runWorker: (job, onOutput) => {
          jobs.push(job);
          return runWorker(job, onOutput);
        },
      });
    }).pipe(Effect.provide(services));
    return yield* body({
      index,
      root,
      folder,
      jobs,
      setSettings: (next) =>
        Ref.set(settings, next).pipe(Effect.andThen(PubSub.publish(settingsChanges, next))),
      setPolicy: (run) => PubSub.publish(policyChanges, policySnapshot(run)).pipe(Effect.asVoid),
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
