/**
 * The code index's SQLite file. Facts are keyed by (path, blob) within a repository, so every
 * branch, worktree and checkpoint of it shares one copy of each file version. Paths, names and
 * module keys are interned to integers: the by-name tables repeat them once per file version.
 *
 * Only worker processes write here (parsing, deleting); the server opens the file to read.
 */
import * as NodeSqlite from "node:sqlite";

import { encodeJson, type FileRecord } from "./facts.ts";

/** Bumped when the stored facts change shape; an index with another version is deleted. */
export const SCHEMA_VERSION = 1;

export const VersionState = { parsed: 0, skipped: 1 } as const;
export type VersionState = (typeof VersionState)[keyof typeof VersionState];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS paths (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS names (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path_id INTEGER NOT NULL REFERENCES paths(id),
  blob TEXT NOT NULL,
  state INTEGER NOT NULL,
  language TEXT,
  lines INTEGER NOT NULL,
  facts BLOB,
  imports BLOB,
  UNIQUE (repo_id, path_id, blob)
);
CREATE TABLE IF NOT EXISTS defines (
  name_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (name_id, version_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS defines_version ON defines (version_id);
CREATE TABLE IF NOT EXISTS uses (
  name_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (name_id, version_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS uses_version ON uses (version_id);
CREATE TABLE IF NOT EXISTS asks (
  key_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (key_id, version_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS asks_version ON asks (version_id);
`;

/**
 * Open the index, creating it when empty. Throws when the file holds another schema version;
 * the server deletes such a file before anything opens it.
 */
export function openStore(file: string): NodeSqlite.DatabaseSync {
  const db = new NodeSqlite.DatabaseSync(file);
  // Workers and the server write and read from separate processes; wait rather than fail.
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("PRAGMA foreign_keys = ON");
  const version = (db.prepare("PRAGMA user_version").get()?.user_version ?? 0) as number;
  if (version === 0) {
    // Set before the first table, so freed pages can be returned without a full VACUUM.
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`BEGIN IMMEDIATE; ${SCHEMA} PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT;`);
  } else if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`code index schema ${version} is not ${SCHEMA_VERSION}`);
  }
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}

/** The schema version of an index file, or null when it has none yet. */
export function schemaVersionOf(file: string): number | null {
  const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
  try {
    const version = (db.prepare("PRAGMA user_version").get()?.user_version ?? 0) as number;
    return version === 0 ? null : version;
  } finally {
    db.close();
  }
}

export interface WrittenVersion {
  readonly id: number;
  readonly path: string;
  readonly blob: string;
  readonly state: VersionState;
  readonly language: string | null;
  readonly lines: number;
}

/** Interns strings into one of the lookup tables, remembering ids for the process's lifetime. */
function interner(db: NodeSqlite.DatabaseSync, table: "paths" | "names" | "keys", column: string) {
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${column}) VALUES (?)`);
  const select = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`);
  const ids = new Map<string, number>();
  return {
    id(value: string): number {
      const known = ids.get(value);
      if (known !== undefined) return known;
      insert.run(value);
      const id = Number(select.get(value)?.id);
      ids.set(value, id);
      return id;
    },
    /** Forget remembered ids: another process may have deleted and re-numbered them. */
    reset: () => ids.clear(),
  };
}

export interface ParsedFile {
  readonly path: string;
  readonly blob: string;
  readonly language: string | null;
  /** Null when the file was skipped: too large, binary, generated, or unparseable. */
  readonly record: FileRecord | null;
}

/** Writes file versions for one repository, a transaction per `write` call. */
export function makeWriter(db: NodeSqlite.DatabaseSync, projectId: string) {
  db.prepare("INSERT OR IGNORE INTO repos (project_id) VALUES (?)").run(projectId);
  const repoId = Number(db.prepare("SELECT id FROM repos WHERE project_id = ?").get(projectId)?.id);
  const paths = interner(db, "paths", "path");
  const names = interner(db, "names", "name");
  const keys = interner(db, "keys", "key");
  const insertVersion = db.prepare(
    `INSERT OR IGNORE INTO versions (repo_id, path_id, blob, state, language, lines, facts, imports)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectVersion = db.prepare(
    "SELECT id, state, language, lines FROM versions WHERE repo_id = ? AND path_id = ? AND blob = ?",
  );
  const insertDefine = db.prepare("INSERT OR IGNORE INTO defines VALUES (?, ?)");
  const insertUse = db.prepare("INSERT OR IGNORE INTO uses VALUES (?, ?)");
  const insertAsk = db.prepare("INSERT OR IGNORE INTO asks VALUES (?, ?)");

  const writeOne = (file: ParsedFile): WrittenVersion => {
    const pathId = paths.id(file.path);
    const record = file.record;
    const state = record === null ? VersionState.skipped : VersionState.parsed;
    const lines = record?.lines ?? 0;
    const inserted = insertVersion.run(
      repoId,
      pathId,
      file.blob,
      state,
      file.language,
      lines,
      record === null ? null : encodeJson(record.facts),
      record === null ? null : encodeJson(record.imports),
    );
    if (inserted.changes === 0) {
      // Another worker wrote this version first; theirs stands.
      const row = selectVersion.get(repoId, pathId, file.blob);
      return {
        id: Number(row?.id),
        path: file.path,
        blob: file.blob,
        state: Number(row?.state) as VersionState,
        language: (row?.language ?? null) as string | null,
        lines: Number(row?.lines),
      };
    }
    const id = Number(inserted.lastInsertRowid);
    if (record !== null) {
      for (const name of record.defines) insertDefine.run(names.id(name), id);
      for (const name of record.uses) insertUse.run(names.id(name), id);
      for (const key of record.asks) insertAsk.run(keys.id(key), id);
    }
    return { id, path: file.path, blob: file.blob, state, language: file.language, lines };
  };

  return {
    repoId,
    write(files: ReadonlyArray<ParsedFile>): ReadonlyArray<WrittenVersion> {
      db.exec("BEGIN IMMEDIATE");
      try {
        const written = files.map(writeOne);
        db.exec("COMMIT");
        return written;
      } catch (error) {
        db.exec("ROLLBACK");
        paths.reset();
        names.reset();
        keys.reset();
        throw error;
      }
    },
  };
}

const DELETE_CHUNK = 500;

/**
 * Delete file versions, whole repositories, or everything, then hand the freed pages back to
 * the file system. Interned strings nothing uses any more go too.
 */
export function deleteFromStore(
  db: NodeSqlite.DatabaseSync,
  target: {
    readonly versionIds?: ReadonlyArray<number>;
    readonly projectIds?: ReadonlyArray<string>;
    readonly all?: boolean;
  },
): number {
  let deleted = 0;
  const inTransaction = (run: () => void) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  if (target.all === true) {
    inTransaction(() => {
      deleted += Number(db.prepare("SELECT COUNT(*) AS count FROM versions").get()?.count ?? 0);
      for (const table of [
        "asks",
        "uses",
        "defines",
        "versions",
        "repos",
        "keys",
        "names",
        "paths",
      ]) {
        db.exec(`DELETE FROM ${table}`);
      }
    });
  } else {
    const ids = [...(target.versionIds ?? [])];
    for (const projectId of target.projectIds ?? []) {
      const rows = db
        .prepare(
          "SELECT versions.id AS id FROM versions JOIN repos ON repos.id = versions.repo_id WHERE repos.project_id = ?",
        )
        .all(projectId);
      for (const row of rows) ids.push(Number(row.id));
    }
    for (let start = 0; start < ids.length; start += DELETE_CHUNK) {
      const chunk = ids.slice(start, start + DELETE_CHUNK);
      const marks = chunk.map(() => "?").join(", ");
      inTransaction(() => {
        for (const table of ["asks", "uses", "defines"]) {
          db.prepare(`DELETE FROM ${table} WHERE version_id IN (${marks})`).run(...chunk);
        }
        deleted += Number(
          db.prepare(`DELETE FROM versions WHERE id IN (${marks})`).run(...chunk).changes,
        );
      });
    }
    if (target.projectIds !== undefined && target.projectIds.length > 0) {
      const marks = target.projectIds.map(() => "?").join(", ");
      inTransaction(() => {
        db.prepare(`DELETE FROM repos WHERE project_id IN (${marks})`).run(...target.projectIds!);
      });
    }
    inTransaction(() => {
      db.exec("DELETE FROM paths WHERE id NOT IN (SELECT path_id FROM versions)");
      db.exec(
        "DELETE FROM names WHERE id NOT IN (SELECT name_id FROM defines UNION SELECT name_id FROM uses)",
      );
      db.exec("DELETE FROM keys WHERE id NOT IN (SELECT key_id FROM asks)");
    });
  }
  db.exec("PRAGMA incremental_vacuum");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return deleted;
}
