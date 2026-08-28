import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("010_CodingSessions", (it) => {
  it.effect("adds the keyed session table without changing commit kinds", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const columns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(coding_sessions)`;
      assert.deepStrictEqual(
        columns.map(({ name }) => name),
        [
          "commit_id",
          "plan_id",
          "repository_id",
          "thread_id",
          "branch",
          "worktree_path",
          "base_ref",
          "started_at",
          "ended_at",
          "outcome",
          "pr_url",
        ],
      );

      const indexes = yield* sql<{ readonly name: string }>`PRAGMA index_list(coding_sessions)`;
      assert.ok(indexes.some(({ name }) => name === "idx_coding_sessions_plan"));
      assert.ok(indexes.some(({ name }) => name === "idx_coding_sessions_thread"));

      const tables = yield* sql<{ readonly name: string; readonly sql: string }>`
        SELECT name, sql FROM sqlite_master
        WHERE type = 'table' AND name IN ('commits', 'coding_sessions')
      `;
      const sessions = tables.find(({ name }) => name === "coding_sessions")?.sql ?? "";
      assert.match(
        sessions,
        /outcome\s+TEXT\s+CHECK \(outcome IN \('completed', 'stopped', 'failed'\)\)/u,
      );
      assert.notMatch(sessions, /repository_id[^,]*REFERENCES/u);

      const commits = tables.find(({ name }) => name === "commits")?.sql ?? "";
      assert.match(
        commits,
        /kind IN \('message', 'plan-revision', 'issue-revision', 'coding-session'\)/u,
      );
    }),
  );
});
