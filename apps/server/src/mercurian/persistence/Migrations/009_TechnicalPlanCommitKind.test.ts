import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

interface CommitRow {
  readonly sequence: number;
  readonly commitId: string;
  readonly historyId: string;
  readonly kind: string;
  readonly authorKind: string;
  readonly published: number;
  readonly createdAt: string;
  readonly payloadJson: string;
}

interface ParentRow {
  readonly commitId: string;
  readonly parentId: string;
  readonly parentOrder: number;
}

const readCommits = (sql: SqlClient.SqlClient) => sql<CommitRow>`
  SELECT
    sequence AS "sequence",
    commit_id AS "commitId",
    history_id AS "historyId",
    kind AS "kind",
    author_kind AS "authorKind",
    published AS "published",
    created_at AS "createdAt",
    payload_json AS "payloadJson"
  FROM commits
  ORDER BY sequence
`;

const readParents = (sql: SqlClient.SqlClient) => sql<ParentRow>`
  SELECT
    commit_id AS "commitId",
    parent_id AS "parentId",
    parent_order AS "parentOrder"
  FROM commit_parents
  ORDER BY commit_id, parent_order
`;

layer("009_TechnicalPlanCommitKind", (it) => {
  it.effect("rebuilds the DAG faithfully and widens only the kind check", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 8 });

      yield* sql`
        INSERT INTO commit_histories (history_id, created_at)
        VALUES ('history', '2026-08-10T00:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO commits (
          sequence, commit_id, history_id, kind, author_kind, published, created_at, payload_json
        ) VALUES
          (4, 'root', 'history', 'message', 'human', 1, '2026-08-10T00:00:00.000Z', '{"text":"root"}'),
          (7, 'left', 'history', 'plan-revision', 'assistant', 0, '2026-08-10T00:01:00.000Z', '{"text":"left"}'),
          (9, 'right', 'history', 'issue-revision', 'human', 1, '2026-08-10T00:02:00.000Z', '{"title":"Issue","description":"Body"}'),
          (12, 'leaf', 'history', 'coding-session', 'human', 0, '2026-08-10T00:03:00.000Z', '{"session":"one"}'),
          (15, 'merge', 'history', 'message', 'human', 0, '2026-08-10T00:04:00.000Z', '{"text":"merge"}')
      `;
      yield* sql`
        INSERT INTO commit_parents (commit_id, parent_id, parent_order) VALUES
          ('left', 'root', 0),
          ('right', 'root', 0),
          ('leaf', 'left', 0),
          ('merge', 'right', 0),
          ('merge', 'left', 1)
      `;

      const commitsBefore = yield* readCommits(sql);
      const parentsBefore = yield* readParents(sql);
      yield* runMigrations();

      assert.deepStrictEqual(yield* readCommits(sql), commitsBefore);
      assert.deepStrictEqual(yield* readParents(sql), parentsBefore);

      const indexes = yield* sql<{ readonly name: string }>`PRAGMA index_list('commits')`;
      assert.ok(indexes.some((index) => index.name === "idx_commits_history"));
      const parentIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list('commit_parents')
      `;
      assert.ok(parentIndexes.some((index) => index.name === "idx_commit_parents_parent"));
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);

      yield* sql`
        INSERT INTO commits (
          commit_id, history_id, kind, author_kind, published, created_at, payload_json
        ) VALUES (
          'technical', 'history', 'technical-plan', 'human', 0,
          '2026-08-10T00:05:00.000Z', '{"text":"Technical"}'
        )
      `;
      const technical = (yield* readCommits(sql)).at(-1);
      assert.strictEqual(technical?.kind, "technical-plan");
      assert.strictEqual(technical?.sequence, 16);

      const unknown = yield* Effect.result(sql`
        INSERT INTO commits (
          commit_id, history_id, kind, author_kind, published, created_at, payload_json
        ) VALUES (
          'unknown', 'history', 'unknown-kind', 'human', 0,
          '2026-08-10T00:06:00.000Z', '{}'
        )
      `);
      assert.strictEqual(unknown._tag, "Failure");
    }),
  );
});
