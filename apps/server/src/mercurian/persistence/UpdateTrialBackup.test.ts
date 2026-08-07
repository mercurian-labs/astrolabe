import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { PendingServiceUpdate, ServiceUpdateRecord } from "../../cloud/serviceProtocol.ts";
import { guardForLauncherUpdate } from "./UpdateTrialBackup.ts";

const pendingUpdate = (id: string): PendingServiceUpdate => ({
  id,
  fromVersion: "1.2.3",
  targetVersion: "1.2.4",
  dbPath: "/unused/state.sqlite",
  status: "pending",
});

const terminalUpdate = (
  id: string,
  status: "committed" | "rolled-back" | "failed",
): ServiceUpdateRecord => ({
  id,
  fromVersion: "1.2.3",
  targetVersion: "1.2.4",
  status,
});

const makeStateDir = Effect.fn("makeStateDir")(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "mercurian-trial-backup-" });
});

const seedDb = Effect.fn("seedDb")(function* (
  stateDir: string,
  contents: string,
  options?: { readonly wal?: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dbPath = path.join(stateDir, "mercurian.sqlite");
  yield* fs.writeFileString(dbPath, contents);
  if (options?.wal !== undefined) {
    yield* fs.writeFileString(`${dbPath}-wal`, options.wal);
  }
  return dbPath;
});

const readDb = Effect.fn("readDb")(function* (dbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(dbPath);
});

const snapshotDirFor = Effect.fn("snapshotDirFor")(function* (dbPath: string, updateId: string) {
  const path = yield* Path.Path;
  return path.join(path.dirname(dbPath), "mercurian-db-backup", updateId);
});

it.layer(NodeServices.layer)("UpdateTrialBackup", (it) => {
  it.effect("a trial snapshots the database before it is opened", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "pre-trial", { wal: "pre-trial wal" });

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));

      const snapshotDir = yield* snapshotDirFor(dbPath, "update-1");
      assert.strictEqual(yield* fs.readFileString(`${snapshotDir}/mercurian.sqlite`), "pre-trial");
      assert.strictEqual(
        yield* fs.readFileString(`${snapshotDir}/mercurian.sqlite-wal`),
        "pre-trial wal",
      );
      // The live database is untouched — the trial goes on to migrate it.
      assert.strictEqual(yield* readDb(dbPath), "pre-trial");
    }),
  );

  it.effect("a re-run of the same trial rewinds to its own snapshot first", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "pre-trial");

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));
      // The first attempt migrated the file, then crashed before commit.
      yield* fs.writeFileString(dbPath, "half-migrated");

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));

      assert.strictEqual(yield* readDb(dbPath), "pre-trial");
    }),
  );

  it.effect("a rollback restores the snapshot and discards it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "pre-trial", { wal: "pre-trial wal" });

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));
      // The trial migrated the database and checkpointed the WAL away.
      yield* fs.writeFileString(dbPath, "migrated");
      yield* fs.remove(`${dbPath}-wal`, { force: true });
      yield* fs.writeFileString(`${dbPath}-shm`, "trial shm");

      yield* guardForLauncherUpdate(dbPath, terminalUpdate("update-1", "rolled-back"));

      assert.strictEqual(yield* readDb(dbPath), "pre-trial");
      assert.strictEqual(yield* fs.readFileString(`${dbPath}-wal`), "pre-trial wal");
      // Side files the trial created but the snapshot lacks are removed.
      assert.isFalse(yield* fs.exists(`${dbPath}-shm`));
      assert.isFalse(yield* fs.exists(path.join(path.dirname(dbPath), "mercurian-db-backup")));
    }),
  );

  it.effect("a rollback of a trial that never booted is a no-op", () =>
    Effect.gen(function* () {
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "untouched");

      yield* guardForLauncherUpdate(dbPath, terminalUpdate("update-1", "failed"));

      assert.strictEqual(yield* readDb(dbPath), "untouched");
    }),
  );

  it.effect("a database that did not exist before the trial is deleted on rollback", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* makeStateDir();
      const dbPath = path.join(stateDir, "mercurian.sqlite");

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));
      // The trial created and migrated a fresh database.
      yield* fs.writeFileString(dbPath, "migrated from nothing");

      yield* guardForLauncherUpdate(dbPath, terminalUpdate("update-1", "rolled-back"));

      assert.isFalse(yield* fs.exists(dbPath));
    }),
  );

  it.effect("a committed boot discards the snapshot without touching the database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "pre-trial");

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));
      yield* fs.writeFileString(dbPath, "migrated");

      yield* guardForLauncherUpdate(dbPath, terminalUpdate("update-1", "committed"));

      assert.strictEqual(yield* readDb(dbPath), "migrated");
      assert.isFalse(yield* fs.exists(path.join(path.dirname(dbPath), "mercurian-db-backup")));
    }),
  );

  it.effect("a boot with no update in flight sweeps stale snapshots and never restores them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* makeStateDir();
      const dbPath = yield* seedDb(stateDir, "pre-trial");

      yield* guardForLauncherUpdate(dbPath, pendingUpdate("update-1"));
      yield* fs.writeFileString(dbPath, "current");

      yield* guardForLauncherUpdate(dbPath, undefined);

      assert.strictEqual(yield* readDb(dbPath), "current");
      assert.isFalse(yield* fs.exists(path.join(path.dirname(dbPath), "mercurian-db-backup")));
    }),
  );
});
