import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isMemorySourceInvalidError,
  MercurianProjectId,
  MercurianRepositoryId,
} from "@t3tools/contracts";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import { ServerConfig } from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "memory-source-test-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServicesLayer),
);
const layer = it.layer(
  MemorySourceStore.layer.pipe(
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(gitLayer),
    Layer.provideMerge(NodeServicesLayer),
  ),
);
const now = DateTime.makeUnsafe("2026-08-27T00:00:00.000Z");

const addRepository = Effect.fn("test.addRepository")(function* (
  repositoryId: string,
  repositoryPath: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
    VALUES (${repositoryId}, ${repositoryId}, ${repositoryPath}, '2026-08-27', '2026-08-27')
  `;
});

const makeDirectory = Effect.fn("test.makeMemoryDirectory")(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "mercurian-memory-source-" });
});

const runGit = Effect.fn("test.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  return yield* git.execute({ operation: "MemorySourceStore.test.git", cwd, args });
});

layer("MemorySourceStore", (it) => {
  it.effect("designates, replaces, announces, and removes one source per project", () =>
    Effect.gen(function* () {
      const store = yield* MemorySourceStore.MemorySourceStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const first = yield* makeDirectory();
      const second = yield* makeDirectory();
      const nested = path.join(second, "notes");
      yield* fs.makeDirectory(nested);
      yield* addRepository("memory-source-first", first);
      yield* addRepository("memory-source-second", second);

      const changed = yield* Stream.runHead(store.changes).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* store.designate({
        projectId: MercurianProjectId.make("memory-project-main"),
        repositoryId: MercurianRepositoryId.make("memory-source-first"),
        now,
      });
      assert.strictEqual((yield* Fiber.join(changed))._tag, "Some");
      yield* store.designate({
        projectId: MercurianProjectId.make("memory-project-main"),
        repositoryId: MercurianRepositoryId.make("memory-source-second"),
        subpath: "/notes/",
        now,
      });

      const snapshot = yield* store.getSnapshot;
      const source = snapshot.find(({ projectId }) => projectId === "memory-project-main");
      assert.strictEqual(source?.repositoryId, "memory-source-second");
      assert.strictEqual(source?.subpath, "notes");
      const resolved = yield* store.getResolvedSource(
        MercurianProjectId.make("memory-project-main"),
      );
      assert.strictEqual(
        resolved._tag === "Some" ? resolved.value.rootPath : null,
        yield* fs.realPath(nested),
      );

      yield* store.remove(MercurianProjectId.make("memory-project-main"));
      assert.ok(
        !(yield* store.getSnapshot).some(({ projectId }) => projectId === "memory-project-main"),
      );
    }),
  );

  it.effect("refuses an unknown repository, missing root, and file root", () =>
    Effect.gen(function* () {
      const store = yield* MemorySourceStore.MemorySourceStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* makeDirectory();
      yield* fs.writeFileString(path.join(root, "note.md"), "note");
      yield* addRepository("memory-source-refusals", root);

      for (const [repositoryId, subpath, reason] of [
        ["memory-source-unknown", undefined, "repository-not-found"],
        ["memory-source-refusals", "missing", "missing"],
        ["memory-source-refusals", "note.md", "not-a-directory"],
      ] as const) {
        const error = yield* Effect.flip(
          store.designate({
            projectId: MercurianProjectId.make(`project-${reason}`),
            repositoryId: MercurianRepositoryId.make(repositoryId),
            ...(subpath === undefined ? {} : { subpath }),
            now,
          }),
        );
        assert.ok(isMemorySourceInvalidError(error));
        assert.strictEqual(error.reason, reason);
      }
    }),
  );

  it.effect("drops a designation through the repository cascade", () =>
    Effect.gen(function* () {
      const store = yield* MemorySourceStore.MemorySourceStore;
      const sql = yield* SqlClient.SqlClient;
      const root = yield* makeDirectory();
      yield* addRepository("memory-source-cascade", root);
      yield* store.designate({
        projectId: MercurianProjectId.make("memory-project-cascade"),
        repositoryId: MercurianRepositoryId.make("memory-source-cascade"),
        now,
      });
      yield* sql`DELETE FROM repositories WHERE repository_id = 'memory-source-cascade'`;
      assert.ok(
        !(yield* store.getSnapshot).some(({ projectId }) => projectId === "memory-project-cascade"),
      );
    }),
  );

  it.effect("accepts repository roots and subpaths but refuses a nested repository", () =>
    Effect.gen(function* () {
      const store = yield* MemorySourceStore.MemorySourceStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* makeDirectory();
      const notes = path.join(root, "notes");
      const nested = path.join(root, "nested");
      yield* fs.makeDirectory(notes);
      yield* fs.makeDirectory(nested);
      yield* runGit(root, ["init"]);
      yield* runGit(nested, ["init"]);
      yield* addRepository("memory-source-git-shapes", root);

      yield* store.designate({
        projectId: MercurianProjectId.make("memory-project-root"),
        repositoryId: MercurianRepositoryId.make("memory-source-git-shapes"),
        now,
      });
      yield* store.designate({
        projectId: MercurianProjectId.make("memory-project-subpath"),
        repositoryId: MercurianRepositoryId.make("memory-source-git-shapes"),
        subpath: "notes",
        now,
      });
      const error = yield* Effect.flip(
        store.designate({
          projectId: MercurianProjectId.make("memory-project-nested"),
          repositoryId: MercurianRepositoryId.make("memory-source-git-shapes"),
          subpath: "nested",
          now,
        }),
      );
      assert.ok(isMemorySourceInvalidError(error));
      assert.strictEqual(error.reason, "nested-repository");
    }),
  );
});
