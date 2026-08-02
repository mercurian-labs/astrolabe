/**
 * The Mercurian store's SqlClient layer.
 *
 * Same engine and pattern as the fork's store — Effect `SqlClient` over
 * `node:sqlite` (or the Bun client under Bun), WAL journaling, statically
 * imported migrations run on layer build — but in its own database file,
 * `mercurian.sqlite`, beside `state.sqlite` in the state directory
 * (ADR 001 §2). The two stores coexist; nothing t3code-shaped changes.
 *
 * This layer provides the `SqlClient` tag pointed at the Mercurian file, so it
 * must be provided *privately* to Mercurian services (`Layer.provide`, never
 * `Layer.provideMerge`) — otherwise the global `SqlClient` every upstream
 * consumer resolves would stop being `state.sqlite`.
 *
 * @module MercurianSqlite
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { runMigrations } from "./Migrations.ts";
import { ServerConfig } from "../../config.ts";
import * as ServiceLauncherClient from "../../cloud/serviceLauncherClient.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";

export const MERCURIAN_DB_FILENAME = "mercurian.sqlite";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};

const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../../persistence/NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("mercurian.makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

const setup = (trial: boolean) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON;`;
      if (!trial) {
        yield* sql`PRAGMA journal_mode = WAL;`;
        yield* runMigrations();
      }
    }),
  );

export const make = Effect.fn("mercurian.makeSqlitePersistenceLive")(function* (
  dbPath: string,
  options?: { readonly trial?: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup(options?.trial === true),
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "mercurian-server",
      },
    }),
  );
}, Layer.unwrap);

/**
 * The Mercurian store at `<stateDir>/mercurian.sqlite`. The path is derived
 * here rather than in `ServerConfig` — it is Mercurian-owned, so it lives in
 * the Mercurian module.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const { join } = yield* Path.Path;
    const launcher = yield* ServiceLauncherClient.resolveServiceLauncherMode();
    return make(join(stateDir, MERCURIAN_DB_FILENAME), { trial: launcher.trial });
  }),
);

/**
 * In-memory Mercurian store with migrations applied — the test seam.
 */
export const layerMemory = Layer.provideMerge(setup(false), NodeSqliteClient.layerMemory());
