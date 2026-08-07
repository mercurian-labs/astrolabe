/**
 * Self-update trial protection for the Mercurian database.
 *
 * Protocol 2 of the service launcher snapshots the t3code database before a
 * self-update trial and restores it when the trial rolls back
 * (`serviceLauncher.ts`, `backupDatabaseOnce` / `restoreDatabaseBackup`). That
 * snapshot covers exactly one path — `serverConfig.dbPath` — so
 * `mercurian.sqlite`, which lives beside it (ADR 001 §2), is outside the net:
 * a trial child runs Mercurian migrations at boot, and a rolled-back trial
 * would hand the previous server a forward-migrated file.
 *
 * The launcher cannot learn about our file — during an update it is the
 * previous version's launcher that is running — so the child owns the
 * discipline, mirroring the launcher's:
 *
 * - A trial child (`update.status === "pending"`) snapshots the database
 *   files (`""`, `-wal`, `-shm`) before opening them, keyed by update id. If
 *   its own snapshot already exists, a previous attempt of the same trial
 *   crashed: restore first, so migrations always run from the pre-trial state.
 * - The restored previous server sees the terminal outcome in its launcher
 *   context (`#returnToPrevious` forwards it): on `"rolled-back"` or
 *   `"failed"` it restores the snapshot, then discards it. Discard only
 *   happens after a completed restore, so a crash mid-restore retries on the
 *   next boot.
 * - A boot that sees `"committed"`, or no update at all, discards leftover
 *   snapshots. They are pre-migration state of an update that succeeded (or
 *   was consumed); restoring one without a matching outcome would destroy
 *   data, so stale snapshots are never restored.
 *
 * An empty snapshot directory is meaningful: it records that the database did
 * not exist before the trial, and restoring it deletes the files the trial
 * created.
 *
 * @module MercurianUpdateTrialBackup
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  SERVICE_LAUNCHER_CONTEXT_ENV,
  decodeServiceLauncherContext,
  type ServiceUpdateRecord,
} from "../../cloud/serviceProtocol.ts";

/** Same side-file set the launcher snapshots for its own database. */
const DB_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;

const BACKUP_ROOT_NAME = "mercurian-db-backup";

const backupRootFor = (path: Path.Path, dbPath: string) =>
  path.join(path.dirname(dbPath), BACKUP_ROOT_NAME);

const createSnapshot = Effect.fn("mercurian.updateTrialBackup.create")(function* (
  dbPath: string,
  snapshotDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stagingDir = `${snapshotDir}.staging`;
  yield* fs.remove(stagingDir, { recursive: true, force: true });
  yield* fs.makeDirectory(stagingDir, { recursive: true });
  const baseName = path.basename(dbPath);
  for (const suffix of DB_FILE_SUFFIXES) {
    const source = `${dbPath}${suffix}`;
    if (!(yield* fs.exists(source))) continue;
    yield* fs.copyFile(source, path.join(stagingDir, `${baseName}${suffix}`));
  }
  yield* fs.rename(stagingDir, snapshotDir);
});

const restoreSnapshot = Effect.fn("mercurian.updateTrialBackup.restore")(function* (
  dbPath: string,
  snapshotDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseName = path.basename(dbPath);
  for (const suffix of DB_FILE_SUFFIXES) {
    const source = path.join(snapshotDir, `${baseName}${suffix}`);
    const target = `${dbPath}${suffix}`;
    if (yield* fs.exists(source)) {
      yield* fs.copyFile(source, target);
    } else {
      yield* fs.remove(target, { force: true });
    }
  }
});

const discardSnapshots = Effect.fn("mercurian.updateTrialBackup.discard")(function* (
  backupRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(backupRoot, { recursive: true, force: true });
});

/**
 * Bring the Mercurian database in line with the launcher update recorded in
 * the child's context. Runs before the database is opened; failures fail the
 * boot, which is the safe direction — an unprotected trial would be exactly
 * the regression this module exists to prevent, and a trial boot failure
 * rolls the update back.
 */
export const guardForLauncherUpdate = Effect.fn("mercurian.updateTrialBackup.guard")(function* (
  dbPath: string,
  update: ServiceUpdateRecord | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const backupRoot = backupRootFor(path, dbPath);

  if (update === undefined || update.status === "committed") {
    if (yield* fs.exists(backupRoot)) {
      yield* Effect.logDebug("Discarding stale Mercurian database snapshots.").pipe(
        Effect.annotateLogs({ backupRoot }),
      );
      yield* discardSnapshots(backupRoot);
    }
    return;
  }

  const snapshotDir = path.join(backupRoot, update.id);
  if (update.status === "pending") {
    if (yield* fs.exists(snapshotDir)) {
      // A previous attempt of this same trial crashed after snapshotting.
      // Rewind so migrations run from the pre-trial state, exactly once.
      yield* restoreSnapshot(dbPath, snapshotDir);
    } else {
      yield* createSnapshot(dbPath, snapshotDir);
    }
    return;
  }

  // "rolled-back" | "failed" — we are the restored previous server.
  if (yield* fs.exists(snapshotDir)) {
    yield* Effect.logInfo("Restoring the Mercurian database from its pre-trial snapshot.").pipe(
      Effect.annotateLogs({ updateId: update.id, status: update.status }),
    );
    yield* restoreSnapshot(dbPath, snapshotDir);
  }
  yield* discardSnapshots(backupRoot);
});

/**
 * The production entry: read the launcher context the way
 * `serviceLauncherClient` does and apply {@link guardForLauncherUpdate}.
 * Unmanaged servers (no context) fall through to the stale-snapshot sweep.
 */
export const guardFromEnvironment = Effect.fn("mercurian.updateTrialBackup.guardFromEnvironment")(
  function* (dbPath: string) {
    const raw = process.env[SERVICE_LAUNCHER_CONTEXT_ENV];
    const context = raw === undefined ? undefined : decodeServiceLauncherContext(raw);
    yield* guardForLauncherUpdate(dbPath, context?.update);
  },
);
