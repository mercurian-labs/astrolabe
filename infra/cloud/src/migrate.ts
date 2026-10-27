// @effect-diagnostics anyUnknownInErrorContext:off - drizzle-orm/effect-postgres types its query errors as any.
/**
 * Applies the cloud database's migrations and exits, as a one-off ECS task during deploy (see
 * alchemy.run.ts) because the database is only reachable inside its network. Exit 0 lets the
 * deploy continue. Each folder keeps its own ledger table, so the relay's upstream migrations
 * merge in unchanged next to ours; the auth folder comes from apps/cloud.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

// Order matters: later folders may reference earlier ones' tables.
const FOLDERS = [
  { name: "auth", table: "auth_migrations" },
  { name: "relay", table: "relay_migrations" },
] as const;

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* Config.String("MIGRATIONS_DIR").pipe(
    Config.withDefault(path.join(import.meta.dirname, "migrations")),
  );
  const db = yield* PgDrizzle.makeWithDefaults();
  // A fresh database can still be starting when the task runs.
  yield* db
    .execute("SELECT 1")
    .pipe(Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 30 }));
  for (const folder of FOLDERS) {
    yield* migrate(db, {
      migrationsFolder: path.join(root, folder.name),
      migrationsTable: folder.table,
    });
    yield* Effect.log(`migrated ${folder.name}`);
  }
});

const PgLive = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") });

NodeRuntime.runMain(main.pipe(Effect.provide(Layer.mergeAll(PgLive, NodeServices.layer))));
