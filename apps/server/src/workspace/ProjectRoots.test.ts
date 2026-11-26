import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  type ProjectRootCheckout,
  type ProjectTrackedFolder,
  RootKey,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import type * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ProjectRoots from "./ProjectRoots.ts";
import * as TaskFolderStore from "./TaskFolderStore.ts";

const projectId = ProjectId.make("project:project-roots");

const layerFor = (project: {
  readonly workspaceRoot: string;
  readonly trackedFolders: ReadonlyArray<ProjectTrackedFolder>;
  readonly hosted?: ReadonlyArray<string>;
}) =>
  ProjectRoots.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeedSome({
            projectId,
            title: "Project",
            hasCustomTitle: false,
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            pinnedAt: null,
            archivedAt: null,
            createdAt: "2026-11-25T00:00:00.000Z",
            updatedAt: "2026-11-25T00:00:00.000Z",
            deletedAt: null,
            workspaceRoot: project.workspaceRoot,
            trackedFolders: project.trackedFolders,
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
        resolveLink: () => undefined,
        resolveHandle: ({ cwd }) =>
          Effect.succeed({
            provider: {} as SourceControlProvider.SourceControlProvider["Service"],
            context: (project.hosted ?? []).includes(cwd)
              ? {
                  provider: {
                    kind: SourceControlProviderKind.make("github"),
                    name: "GitHub",
                    baseUrl: "https://github.com",
                  },
                  remoteName: "origin",
                  remoteUrl: "https://github.com/acme/repo.git",
                }
              : null,
          }),
      }),
    ),
    Layer.provideMerge(TaskFolderStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
  );

// Root keys are branded; the expectations spell them as plain strings.
const unbranded = (value: unknown) => value;
const checkouts = (roots: ReadonlyArray<ProjectRootCheckout>) =>
  unbranded(roots.map(({ key, checkout, writable }) => ({ key, checkout, writable })));

const makeDirectories = Effect.fn(function* (directories: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const directory of directories) {
    yield* fileSystem.makeDirectory(directory, { recursive: true });
  }
});

/**
 * `ctx` is a Git project folder with a repository found inside it (`vendor/lib`), and tracks
 * `app` beside it, another folder also named `app`, a plain `notes` folder and one that is gone.
 * The temp directory is used through a symlink, as macOS hands out `/var` for `/private/var`.
 */
const makeProject = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const real = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-project-roots-" }),
  );
  const tmp = path.join(path.dirname(real), `${path.basename(real)}-link`);
  yield* fileSystem.symlink(real, tmp);
  yield* Effect.addFinalizer(() => fileSystem.remove(tmp).pipe(Effect.ignore));
  const ctx = path.join(tmp, "x", "ctx");
  const lib = path.join(ctx, "vendor", "lib");
  const app = path.join(tmp, "x", "app");
  const otherApp = path.join(tmp, "y", "app");
  const notes = path.join(tmp, "x", "notes");
  const gone = path.join(tmp, "x", "gone");
  yield* makeDirectories([
    path.join(ctx, ".git"),
    path.join(lib, ".git"),
    path.join(app, ".git"),
    path.join(otherApp, ".git"),
    notes,
  ]);
  const trackedFolders = [
    { name: "app", path: app },
    { name: "App", path: otherApp },
    { name: "notes", path: notes },
    { name: "gone", path: gone },
  ];
  return { tmp, real, ctx, lib, app, otherApp, notes, gone, trackedFolders };
});

it.layer(NodeServices.layer)("ProjectRoots", (it) => {
  it.effect("keys every root and gives a thread on the live checkouts all of them", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { tmp, real, ctx, lib, app, otherApp, notes, gone, trackedFolders } =
        yield* makeProject;

      yield* Effect.gen(function* () {
        const roots = yield* ProjectRoots.ProjectRoots;
        assert.deepEqual(unbranded(yield* roots.list(projectId)), [
          { key: "ctx", name: "ctx", path: ctx, kind: "workspace", state: "git", hostBacked: true },
          { key: "lib", name: "lib", path: lib, kind: "tracked", state: "git", hostBacked: false },
          { key: "app", name: "app", path: app, kind: "tracked", state: "git", hostBacked: true },
          {
            key: "app-2",
            name: "App",
            path: otherApp,
            kind: "tracked",
            state: "git",
            hostBacked: false,
          },
          {
            key: "notes",
            name: "notes",
            path: notes,
            kind: "tracked",
            state: "plain",
            hostBacked: false,
          },
          {
            key: "gone",
            name: "gone",
            path: gone,
            kind: "tracked",
            state: "missing",
            hostBacked: false,
          },
        ]);

        const thread = { projectId, worktreePath: null };
        assert.deepEqual(checkouts(yield* roots.forThread(thread)), [
          { key: "ctx", checkout: ctx, writable: true },
          { key: "lib", checkout: lib, writable: true },
          { key: "app", checkout: app, writable: true },
          { key: "app-2", checkout: otherApp, writable: true },
          { key: "notes", checkout: notes, writable: true },
          { key: "gone", checkout: null, writable: false },
        ]);

        // The repository inside the project folder holds its own files, under either spelling.
        const located = (target: string) =>
          roots
            .locate({ ...thread, path: target })
            .pipe(Effect.map((found) => found && { key: found.root.key, path: found.path }));
        assert.deepEqual(yield* located(path.join(lib, "src", "a.ts")), {
          key: "lib",
          path: "src/a.ts",
        });
        assert.deepEqual(
          yield* located(path.join(real, "x", "ctx", "vendor", "lib", "src", "a.ts")),
          { key: "lib", path: "src/a.ts" },
        );
        assert.deepEqual(yield* located(path.join(ctx, "vendor", "other.md")), {
          key: "ctx",
          path: "vendor/other.md",
        });
        assert.deepEqual(yield* located(lib), { key: "lib", path: "" });
        assert.equal(yield* located(path.join(tmp, "elsewhere")), null);
        assert.equal(yield* located("relative/path"), null);

        const resolved = yield* roots.resolve({ ...thread, address: "app-2:docs/Plan.md#Goal" });
        assert.deepEqual(
          { key: resolved.root.key, path: resolved.path, anchor: resolved.anchor },
          { key: "app-2", path: "docs/Plan.md", anchor: "Goal" },
        );
        assert.equal(resolved.absolutePath, path.join(otherApp, "docs", "Plan.md"));
        // A path the project folder spells out belongs to the repository that holds it.
        const nested = yield* roots.resolve({ ...thread, address: "ctx:vendor/lib/README.md" });
        assert.deepEqual([nested.root.key, nested.path], ["lib", "README.md"]);
        const bare = yield* roots.resolve({
          ...thread,
          address: "Plan.md",
          fromRoot: nested.root.key,
        });
        assert.deepEqual([bare.root.key, bare.path, bare.anchor], ["lib", "Plan.md", null]);
        const absolute = yield* roots.resolve({ ...thread, address: path.join(notes, "a.md") });
        assert.deepEqual([absolute.root.key, absolute.path], ["notes", "a.md"]);
        // `Note` is no root, so this is a bare path in the project folder.
        const note = yield* roots.resolve({ ...thread, address: "Note: subtitle" });
        assert.deepEqual([note.root.key, note.path], ["ctx", "Note: subtitle"]);
        for (const address of ["app:../ctx/secret", "nope", `${path.join(tmp, "elsewhere")}`]) {
          const exit = yield* roots
            .resolve({
              ...thread,
              address,
              ...(address === "nope" ? { fromRoot: RootKey.make("zzz") } : {}),
            })
            .pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(exit), address);
        }
      }).pipe(Effect.provide(layerFor({ workspaceRoot: ctx, trackedFolders, hosted: [ctx, app] })));
    }),
  );

  it.effect("gives a task folder thread its worktrees and leaves the other roots out", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { tmp, real, ctx, lib, app, trackedFolders } = yield* makeProject;
      const taskRoot = path.join(tmp, "worktrees", "x", "feature");
      yield* makeDirectories([
        path.join(taskRoot, "ctx", "vendor", "lib"),
        path.join(taskRoot, "app"),
      ]);

      yield* Effect.gen(function* () {
        const taskFolders = yield* TaskFolderStore.TaskFolderStore;
        const roots = yield* ProjectRoots.ProjectRoots;
        yield* taskFolders.put({
          root: taskRoot,
          projectId,
          projectRoot: ctx,
          anchor: path.join(tmp, "x"),
          projectPath: path.join(taskRoot, "ctx"),
          projectIsWorktree: true,
          repositories: [
            { repositoryPath: app, worktreePath: path.join(taskRoot, "app"), name: "app" },
            {
              repositoryPath: lib,
              worktreePath: path.join(taskRoot, "ctx", "vendor", "lib"),
              name: "lib",
            },
          ],
        });
        const expected = [
          { key: "ctx", checkout: path.join(taskRoot, "ctx"), writable: true },
          { key: "lib", checkout: path.join(taskRoot, "ctx", "vendor", "lib"), writable: true },
          { key: "app", checkout: path.join(taskRoot, "app"), writable: true },
          { key: "app-2", checkout: null, writable: false },
          { key: "notes", checkout: null, writable: false },
          { key: "gone", checkout: null, writable: false },
        ];
        // The thread stores its path as named; a sandbox or Git may hand back the resolved one.
        for (const worktreePath of [
          path.join(taskRoot, "ctx"),
          path.join(real, "worktrees", "x", "feature", "ctx"),
        ]) {
          assert.deepEqual(
            checkouts(yield* roots.forThread({ projectId, worktreePath })),
            expected,
          );
        }

        const thread = { projectId, worktreePath: path.join(taskRoot, "ctx") };
        const found = yield* roots.locate({
          ...thread,
          path: path.join(taskRoot, "ctx", "vendor", "lib", "docs", "a.md"),
        });
        assert.deepEqual(found && [found.root.key, found.path], ["lib", "docs/a.md"]);
        const resolved = yield* roots.resolve({ ...thread, address: "app:Plan.md" });
        assert.equal(resolved.absolutePath, path.join(taskRoot, "app", "Plan.md"));
        const omitted = yield* roots.resolve({ ...thread, address: "notes:a.md" });
        assert.equal(omitted.absolutePath, null);

        // A new file never lands in the live checkout of a root the thread left out.
        const refused = yield* roots
          .writeTarget({ ...thread, address: "notes:New.md" })
          .pipe(Effect.flip);
        assert.equal(refused._tag, "ProjectRootWriteTargetError");
        assert.deepEqual(
          unbranded(refused._tag === "ProjectRootWriteTargetError" ? refused.candidates : []),
          ["ctx", "lib", "app"],
        );
      }).pipe(Effect.provide(layerFor({ workspaceRoot: ctx, trackedFolders })));
    }),
  );

  it.effect("gives a single worktree the project folder and reads the rest in place", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { tmp, ctx, lib, app, otherApp, notes, trackedFolders } = yield* makeProject;
      const worktreePath = path.join(tmp, "worktrees", "x", "single");
      yield* makeDirectories([worktreePath]);

      yield* Effect.gen(function* () {
        const roots = yield* ProjectRoots.ProjectRoots;
        assert.deepEqual(checkouts(yield* roots.forThread({ projectId, worktreePath })), [
          { key: "ctx", checkout: worktreePath, writable: true },
          { key: "lib", checkout: lib, writable: false },
          { key: "app", checkout: app, writable: false },
          { key: "app-2", checkout: otherApp, writable: false },
          { key: "notes", checkout: notes, writable: false },
          { key: "gone", checkout: null, writable: false },
        ]);
        // The only writable root takes a new file nobody placed.
        const target = yield* roots.writeTarget({ projectId, worktreePath, address: "Plan.md" });
        assert.deepEqual([target.root.key, target.path], ["ctx", "Plan.md"]);
        const fromFile = yield* roots
          .writeTarget({ projectId, worktreePath, currentFile: path.join(app, "README.md") })
          .pipe(Effect.flip);
        assert.equal(fromFile._tag, "ProjectRootWriteTargetError");
      }).pipe(Effect.provide(layerFor({ workspaceRoot: ctx, trackedFolders })));
    }),
  );

  it.effect("picks a write target in order and asks when nothing decides", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { ctx, lib, app, notes, trackedFolders } = yield* makeProject;

      yield* Effect.gen(function* () {
        const roots = yield* ProjectRoots.ProjectRoots;
        const thread = { projectId, worktreePath: null };
        const keyOf = (input: Parameters<typeof roots.writeTarget>[0]) =>
          roots.writeTarget(input).pipe(Effect.map((target) => [target.root.key, target.path]));

        assert.deepEqual(yield* keyOf({ ...thread, repository: "app-2", address: "New.md" }), [
          "app-2",
          "New.md",
        ]);
        assert.deepEqual(yield* keyOf({ ...thread, repository: app }), ["app", null]);
        // The address's root beats the selected folder and the open file.
        assert.deepEqual(
          yield* keyOf({
            ...thread,
            address: "notes:New.md",
            selectedPath: app,
            currentFile: path.join(lib, "a.md"),
          }),
          ["notes", "New.md"],
        );
        // The selected folder beats the open file.
        assert.deepEqual(
          yield* keyOf({ ...thread, selectedPath: app, currentFile: path.join(lib, "a.md") }),
          ["app", null],
        );
        assert.deepEqual(yield* keyOf({ ...thread, currentFile: path.join(lib, "a.md") }), [
          "lib",
          null,
        ]);
        // A selected folder outside the project decides nothing.
        assert.deepEqual(
          yield* keyOf({
            ...thread,
            selectedPath: path.join(path.dirname(ctx), "..", "elsewhere"),
            currentFile: path.join(notes, "a.md"),
          }),
          ["notes", null],
        );

        const failures = yield* Effect.forEach(
          [
            {},
            { repository: "nope" },
            { repository: "app", address: "notes:New.md" },
            { repository: "gone" },
            { selectedPath: path.join(path.dirname(ctx), "elsewhere") },
          ],
          (input) => roots.writeTarget({ ...thread, ...input }).pipe(Effect.flip),
        );
        for (const failure of failures) {
          assert.equal(failure._tag, "ProjectRootWriteTargetError");
          assert.deepEqual(
            unbranded(failure._tag === "ProjectRootWriteTargetError" ? failure.candidates : []),
            ["ctx", "lib", "app", "app-2", "notes"],
          );
        }
      }).pipe(Effect.provide(layerFor({ workspaceRoot: ctx, trackedFolders })));
    }),
  );

  it.effect("keys a plain project folder and reaches no host for it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tmp = yield* fileSystem.realPath(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-project-roots-plain-" }),
      );
      const workspaceRoot = path.join(tmp, "My Notes");
      yield* makeDirectories([workspaceRoot]);

      yield* Effect.gen(function* () {
        const roots = yield* ProjectRoots.ProjectRoots;
        assert.deepEqual(unbranded(yield* roots.forThread({ projectId, worktreePath: null })), [
          {
            key: "my-notes",
            name: "My Notes",
            path: workspaceRoot,
            kind: "workspace",
            state: "plain",
            // Asked only of Git folders, so the host listed here is never consulted.
            hostBacked: false,
            checkout: workspaceRoot,
            writable: true,
          },
        ]);
        const target = yield* roots.writeTarget({
          projectId,
          worktreePath: null,
          address: "Plan.md",
        });
        assert.equal(target.root.key, "my-notes");
      }).pipe(
        Effect.provide(layerFor({ workspaceRoot, trackedFolders: [], hosted: [workspaceRoot] })),
      );
    }),
  );
});
