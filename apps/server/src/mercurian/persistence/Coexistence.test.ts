import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import * as CodingSessionStore from "../codingSessions/CodingSessionStore.ts";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as MercurianSqlite from "./Sqlite.ts";

const historyId = Schema.decodeUnknownSync(HistoryId)("coexist");
const rootCommitId = Schema.decodeUnknownSync(CommitId)("coexist-root");

// The Mercurian `SqlClient` is provided privately; the ambient one is still
// t3code's store.
const layer = it.layer(
  PlanningStore.layer.pipe(
    Layer.provideMerge(CodingSessionStore.layer),
    Layer.provide(
      Layer.mock(RepositoryStore.RepositoryStore)({
        getSnapshot: Effect.succeed({ repositories: [], projectRepositories: [] }),
      }),
    ),
    Layer.provide(PlanTurnRegistry.layer),
    Layer.provideMerge(CommitStore.layer),
    Layer.provide(MercurianSqlite.layerMemory),
    Layer.provide(NodeServicesLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("Mercurian store coexistence", (it) => {
  it.effect("keeps the two stores apart", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* CommitStore.CommitStore;

      const tables = new Set(
        (yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `).map((row) => row.name),
      );

      // The ambient client is upstream's store, untouched by this issue.
      assert.ok(tables.has("orchestration_events"));
      assert.ok(tables.has("projection_threads"));
      assert.ok(!tables.has("commits"));
      assert.ok(!tables.has("commit_histories"));
      assert.ok(!tables.has("commit_parents"));
      assert.ok(!tables.has("projects"));
      assert.ok(!tables.has("plans"));

      // The commit store nonetheless works, out of its own database.
      yield* store.createHistory({
        historyId,
        rootCommit: {
          commitId: rootCommitId,
          kind: "message",
          authorKind: "human",
          createdAt: DateTime.makeUnsafe("2026-08-02T00:00:00.000Z"),
          payload: {},
        },
        rootPublished: false,
      });
      const commits = yield* store.listCommits({ historyId, visibility: "all" });
      assert.deepStrictEqual(
        commits.map((commit) => commit.commitId),
        ["coexist-root"],
      );

      // Same for planning: its rows live in the Mercurian file only.
      const planning = yield* PlanningStore.PlanningStore;
      const project = yield* planning.createProject({
        name: "Coexistence",
        createdAt: DateTime.makeUnsafe("2026-08-02T00:00:00.000Z"),
      });
      const snapshot = yield* planning.getTreeSnapshot;
      assert.ok(snapshot.projects.some((entry) => entry.projectId === project.projectId));
    }),
  );
});
