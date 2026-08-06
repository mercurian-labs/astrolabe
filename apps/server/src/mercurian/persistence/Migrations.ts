/**
 * Mercurian's migration sequence — its own numbering, its own
 * `effect_sql_migrations` tracking table, in its own database file.
 *
 * Deliberately not appended to `apps/server/src/persistence/Migrations.ts`:
 * upstream's sequence is high-churn territory and appending to it guarantees
 * numbering collisions on every upstream merge (ADR 001 §2, ADR 004 §1).
 *
 * @module MercurianMigrations
 */
import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import Migration0001 from "./Migrations/001_CommitGraph.ts";
import Migration0002 from "./Migrations/002_ProjectsPlans.ts";
import Migration0003 from "./Migrations/003_WorkspaceSettings.ts";

export const migrationEntries = [
  [1, "CommitGraph", Migration0001],
  [2, "ProjectsPlans", Migration0002],
  [3, "WorkspaceSettings", Migration0003],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending Mercurian migrations against the Mercurian store.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("mercurian.runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Mercurian database schema is current")
    : Effect.log("Mercurian migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});

/**
 * Layer that runs Mercurian migrations when the layer is built.
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
