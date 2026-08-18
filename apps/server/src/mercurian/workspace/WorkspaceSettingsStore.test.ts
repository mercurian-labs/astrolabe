import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { type PlanningModelSelection, ProviderDriverKind } from "@t3tools/contracts";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as WorkspaceSettingsStore from "./WorkspaceSettingsStore.ts";

const layer = it.layer(
  WorkspaceSettingsStore.layer.pipe(
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provide(NodeServicesLayer),
  ),
);

const planningModel = (provider: string, model: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model,
});

const decodeStoredValue = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

layer("WorkspaceSettingsStore", (it) => {
  it.effect("has no last-used planning model until a turn records one", () =>
    Effect.gen(function* () {
      const store = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;

      assert.deepStrictEqual(yield* store.getSnapshot, { planningModel: null });
    }),
  );

  it.effect("round-trips the provider and model, and nothing else", () =>
    Effect.gen(function* () {
      const store = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const sql = yield* SqlClient.SqlClient;

      yield* store.recordLastUsedPlanningModel(planningModel("claudeAgent", "opus"));

      const snapshot = yield* store.getSnapshot;
      assert.deepStrictEqual(snapshot.planningModel, planningModel("claudeAgent", "opus"));

      // The stored value names a provider and a model. An instance id has no
      // field to occupy here, and that is the point.
      const rows = yield* sql<{
        readonly value: string;
      }>`SELECT value FROM workspace_settings WHERE key = 'planningModel'`;
      assert.deepStrictEqual(decodeStoredValue(rows[0]!.value), {
        provider: "claudeAgent",
        model: "opus",
      });
    }),
  );

  it.effect("replaces the previously used pair rather than accumulating rows", () =>
    Effect.gen(function* () {
      const store = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;

      yield* store.recordLastUsedPlanningModel(planningModel("claudeAgent", "opus"));
      yield* store.recordLastUsedPlanningModel(planningModel("codex", "gpt-5"));

      assert.deepStrictEqual(
        (yield* store.getSnapshot).planningModel,
        planningModel("codex", "gpt-5"),
      );
    }),
  );

  it.effect("signals once per mutation", () =>
    Effect.gen(function* () {
      const store = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 2)), {
        startImmediately: true,
      });

      yield* store.recordLastUsedPlanningModel(planningModel("claudeAgent", "opus"));
      yield* store.recordLastUsedPlanningModel(planningModel("codex", "gpt-5"));

      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 2);
    }),
  );

  it.effect("refuses a corrupted stored value instead of reading it as unset", () =>
    Effect.gen(function* () {
      const store = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const sql = yield* SqlClient.SqlClient;

      const store_ = (value: string) => sql`
        INSERT INTO workspace_settings (key, value, updated_at)
        VALUES ('planningModel', ${value}, '2026-08-06T00:00:00.000Z')
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `;

      // A shape from some other world — one that names an instance, which this
      // setting never does — and a value that is not JSON at all. Neither may
      // read as "no planning model chosen".
      for (const corrupted of ['{"instanceId":"claude_work"}', "not json"]) {
        yield* store_(corrupted);
        const result = yield* Effect.result(store.getSnapshot);
        assert.strictEqual(result._tag, "Failure", `${corrupted} should refuse`);
      }
    }),
  );
});
