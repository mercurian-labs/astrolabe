/**
 * WorkspaceSettingsStore — the settings that belong to the workspace, not to
 * the machine.
 *
 * One rule shapes the whole surface: an instance is machine-local, so nothing
 * stored here ever names one. The last-used planning model is kept as the abstract pair
 * {@link PlanningModelSelection} — a provider and a model — and the mapping to
 * an instance is computed per machine from that machine's live provider
 * snapshots. That mapping is a fact about a machine at a moment, so it is never
 * written down; `resolvePlanningModel` in contracts is where it happens, for
 * clients and for the server alike.
 *
 * Deliberately absent: any dependency on the provider registry. This store
 * holds workspace facts and nothing else, which is what keeps the last-used pair
 * portable to a machine with a different set of accounts signed in.
 *
 * A stored value that fails to decode refuses loudly rather than reading as
 * "unset" — the last-used seed must not appear to vanish because a build got
 * confused about its shape.
 *
 * @module WorkspaceSettingsStore
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PlanningModelSelection, type WorkspaceSettingsSnapshot } from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";

export type WorkspaceSettingsStoreError = PersistenceSqlError | PersistenceDecodeError;

/**
 * The one key this store writes today. Named as a constant because the table
 * is key-value: the shapelessness stops here, where each key is paired with the
 * schema its value decodes through.
 */
const PLANNING_MODEL_KEY = "planningModel";

export class WorkspaceSettingsStore extends Context.Service<
  WorkspaceSettingsStore,
  {
    /** Every workspace-scoped setting in one value. */
    readonly getSnapshot: Effect.Effect<WorkspaceSettingsSnapshot, WorkspaceSettingsStoreError>;
    /** Record the abstract pair used by the latest turn-opening human message. */
    readonly recordLastUsedPlanningModel: (
      selection: PlanningModelSelection,
    ) => Effect.Effect<void, WorkspaceSettingsStoreError>;
    /** Fires once per mutation. What keeps a subscribed client fresh. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/workspace/WorkspaceSettingsStore") {}

// ===============================
// Rows
// ===============================

const SettingRow = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
  updatedAt: Schema.DateTimeUtcFromString,
});

const SettingKeyRequest = Schema.Struct({ key: Schema.String });

/**
 * The stored form: the selection as a JSON string. Parsing and validating in
 * one codec is what makes a malformed row a refusal rather than a crash — bad
 * JSON and a wrong shape both arrive as the same decode failure.
 */
const StoredPlanningModel = Schema.fromJsonString(PlanningModelSelection);

const decodePlanningModel = Schema.decodeUnknownEffect(StoredPlanningModel);
const encodePlanningModel = Schema.encodeEffect(StoredPlanningModel);

function toStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): WorkspaceSettingsStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation: sqlOperation, cause });
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changesPubSub = yield* PubSub.unbounded<void>();

  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  const findSettingRow = SqlSchema.findOneOption({
    Request: SettingKeyRequest,
    Result: SettingRow,
    execute: ({ key }) => sql`
      SELECT
        key AS "key",
        value AS "value",
        updated_at AS "updatedAt"
      FROM workspace_settings
      WHERE key = ${key}
    `,
  });

  const upsertSettingRow = SqlSchema.void({
    Request: SettingRow,
    execute: (row) => sql`
      INSERT INTO workspace_settings (key, value, updated_at)
      VALUES (${row.key}, ${row.value}, ${row.updatedAt})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
  });

  const readPlanningModel = Effect.gen(function* () {
    const row = yield* findSettingRow({ key: PLANNING_MODEL_KEY });
    if (Option.isNone(row)) {
      return null;
    }
    // A stored value that no longer parses is a refusal, not an absence: the
    // client renders an error rather than an empty picker that would overwrite
    // the workspace's real choice on the next edit.
    return yield* decodePlanningModel(row.value.value);
  });

  const getSnapshot: WorkspaceSettingsStore["Service"]["getSnapshot"] = Effect.gen(function* () {
    return { planningModel: yield* readPlanningModel } satisfies WorkspaceSettingsSnapshot;
  }).pipe(
    Effect.mapError(
      toStoreError(
        "WorkspaceSettingsStore.getSnapshot:query",
        "WorkspaceSettingsStore.getSnapshot:decodeRow",
      ),
    ),
  );

  const recordLastUsedPlanningModel: WorkspaceSettingsStore["Service"]["recordLastUsedPlanningModel"] =
    (selection) =>
      Effect.gen(function* () {
        const updatedAt = yield* DateTime.now;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* upsertSettingRow({
              key: PLANNING_MODEL_KEY,
              value: yield* encodePlanningModel(selection),
              updatedAt,
            });
          }),
        );
        yield* announceChange;
      }).pipe(
        Effect.mapError(
          toStoreError(
            "WorkspaceSettingsStore.recordLastUsedPlanningModel:query",
            "WorkspaceSettingsStore.recordLastUsedPlanningModel:encodeRequest",
          ),
        ),
      );

  return {
    getSnapshot,
    recordLastUsedPlanningModel,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies WorkspaceSettingsStore["Service"];
});

export const layer = Layer.effect(WorkspaceSettingsStore, make);
