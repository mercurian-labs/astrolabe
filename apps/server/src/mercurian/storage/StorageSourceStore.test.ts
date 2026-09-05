import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as StorageSourceStore from "./StorageSourceStore.ts";

it.layer(
  StorageSourceStore.layer.pipe(
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(NodeServicesLayer),
  ),
)("Project storage", (it) => {
  it.effect("configures each kind independently without creating or moving files", () =>
    Effect.gen(function* () {
      const store = yield* StorageSourceStore.StorageSourceStore;
      const fs = yield* FileSystem.FileSystem;
      const sql = yield* SqlClient.SqlClient;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "storage-test-" });
      const repositoryId = MercurianRepositoryId.make("storage-test");
      const projectId = MercurianProjectId.make("storage-project");
      const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
      yield* sql`INSERT INTO repositories(repository_id, name, path, created_at, updated_at) VALUES (${repositoryId}, 'Storage', ${root}, '2026-09-05', '2026-09-05')`;
      yield* store.designate({ projectId, repositoryId, kind: "plan", subpath: "plans", now });
      assert.strictEqual((yield* store.getSource(projectId, "spec"))._tag, "None");
      assert.strictEqual((yield* store.getSource(projectId, "memory"))._tag, "None");
      assert.strictEqual(yield* fs.exists(`${root}/plans`), false);
      yield* fs.makeDirectory(`${root}/plans`);
      yield* fs.writeFileString(`${root}/plans/existing.md`, "# Existing");
      yield* store.designate({ projectId, repositoryId, kind: "spec", subpath: "specs", now });
      yield* store.designate({ projectId, repositoryId, kind: "plan", subpath: "new-plans", now });
      yield* store.remove(projectId, "spec");
      assert.strictEqual(yield* fs.readFileString(`${root}/plans/existing.md`), "# Existing");
      assert.strictEqual((yield* store.getSource(projectId, "plan"))._tag, "Some");
      assert.strictEqual((yield* store.getSource(projectId, "spec"))._tag, "None");
      const escaped = yield* Effect.flip(
        store.designate({
          projectId,
          repositoryId,
          kind: "plan",
          subpath: "../outside/missing",
          now,
        }),
      );
      assert.strictEqual(escaped._tag, "MemorySourceInvalidError");
    }),
  );
});
