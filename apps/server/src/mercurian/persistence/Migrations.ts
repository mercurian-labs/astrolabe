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
import Migration0003 from "./Migrations/003_Repositories.ts";
import Migration0004 from "./Migrations/004_WorkspaceSettings.ts";
import Migration0005 from "./Migrations/005_TrackerConnections.ts";
import Migration0006 from "./Migrations/006_PlanVisits.ts";
import Migration0007 from "./Migrations/007_PlanLifecycle.ts";
import Migration0008 from "./Migrations/008_PlanOrigins.ts";
import Migration0009 from "./Migrations/009_PlanImplementVerdicts.ts";
import Migration0010 from "./Migrations/010_CodingSessions.ts";
import Migration0011 from "./Migrations/011_MemorySources.ts";
import Migration0012 from "./Migrations/012_LineBranches.ts";
import Migration0013 from "./Migrations/013_WorktreeSlots.ts";
import Migration0014 from "./Migrations/014_SnapshotChain.ts";
import Migration0015 from "./Migrations/015_LineBranchHolds.ts";
import Migration0016 from "./Migrations/016_DropPlanImplementVerdicts.ts";

export const migrationEntries = [
  [1, "CommitGraph", Migration0001],
  [2, "ProjectsPlans", Migration0002],
  [3, "Repositories", Migration0003],
  [4, "WorkspaceSettings", Migration0004],
  [5, "TrackerConnections", Migration0005],
  [6, "PlanVisits", Migration0006],
  [7, "PlanLifecycle", Migration0007],
  [8, "PlanOrigins", Migration0008],
  [9, "PlanImplementVerdicts", Migration0009],
  [10, "CodingSessions", Migration0010],
  [11, "MemorySources", Migration0011],
  [12, "LineBranches", Migration0012],
  [13, "WorktreeSlots", Migration0013],
  [14, "SnapshotChain", Migration0014],
  [15, "LineBranchHolds", Migration0015],
  [16, "DropPlanImplementVerdicts", Migration0016],
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
