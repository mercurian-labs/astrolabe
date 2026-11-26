// @effect-diagnostics nodeBuiltinImport:off - readdir with file types avoids an lstat per child
import * as NodeFSP from "node:fs/promises";

import { isWikiDocument } from "@mercurian/wiki";
import { WikiError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { type IgnoreFile, parseIgnoreFile } from "../workspace/IgnorePatterns.ts";

/** As many files as the workspace search index keeps for a folder. */
const PLAIN_FOLDER_MAX_FILES = 25_000;
/** Document text read in all: what one git batch read of a repository's documents may carry. */
const PLAIN_FOLDER_MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const STAT_CONCURRENCY = 16;

export interface PlainFile {
  /** From the folder's root, `/`-separated. */
  readonly file: string;
  readonly size: number;
  readonly modified: Date | undefined;
  readonly created: Date | undefined;
}

export interface PlainScan {
  /** Every visible file that isn't ignored, documents included, sorted by path. */
  readonly files: ReadonlyArray<PlainFile>;
  readonly documents: Readonly<Record<string, string>>;
  /**
   * What a later read stats to know nothing changed: each folder walked (a file added, removed or
   * renamed in it moves its time), each document and each ignore file.
   */
  readonly stamps: ReadonlyArray<readonly [string, string]>;
}

interface Rules {
  readonly directory: string;
  readonly file: IgnoreFile;
}

/** Like ripgrep, the nearest folder's rules decide first, and its `.ignore` ahead of `.gitignore`. */
const IGNORE_FILES = [".gitignore", ".ignore"] as const;

const isIgnored = (rules: ReadonlyArray<Rules>, file: string, folder: boolean) => {
  for (const { directory, file: ignore } of rules) {
    const decision = ignore.decide(
      directory === "" ? file : file.slice(directory.length + 1),
      folder,
    );
    if (decision !== undefined) return decision === "ignored";
  }
  return false;
};

const stampOf = (info: FileSystem.File.Info) =>
  `${Option.match(info.mtime, { onNone: () => "", onSome: (at) => String(at.getTime()) })}:${info.size}`;

const tooLarge = (root: string, what: string) =>
  new WikiError({
    reason: "invalid",
    message: `${root} holds more than ${what} to read documents from. Leave some out with a .gitignore or .ignore file.`,
  });

/**
 * A folder without Git, walked for its documents and the files they can link to. Hidden folders,
 * `node_modules`, symlinks, what `.gitignore` and `.ignore` files leave out, `pruned` folders and
 * any nested repository (another root holds it) are skipped.
 */
export const scanPlainFolder = Effect.fn("scanPlainFolder")(function* (
  root: string,
  pruned: ReadonlySet<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: PlainFile[] = [];
  const documents: Record<string, string> = {};
  const stamps: Array<readonly [string, string]> = [];
  let documentBytes = 0;
  const pending: Array<{ readonly folder: string; readonly rules: ReadonlyArray<Rules> }> = [
    { folder: "", rules: [] },
  ];
  while (pending.length > 0) {
    const { folder, rules: inherited } = pending.pop()!;
    const absolute = folder === "" ? root : path.join(root, folder);
    const info = yield* fileSystem.stat(absolute).pipe(Effect.option);
    if (Option.isNone(info)) continue;
    stamps.push([absolute, stampOf(info.value)]);
    const children = yield* Effect.promise(() =>
      NodeFSP.readdir(absolute, { withFileTypes: true }).catch(() => []),
    );
    if (folder !== "" && children.some((child) => child.name === ".git")) continue;
    const own: Rules[] = [];
    for (const name of IGNORE_FILES) {
      if (!children.some((child) => child.name === name && child.isFile())) continue;
      const at = path.join(absolute, name);
      const contents = yield* fileSystem.readFileString(at).pipe(Effect.option);
      const stat = yield* fileSystem.stat(at).pipe(Effect.option);
      if (Option.isNone(contents) || Option.isNone(stat)) continue;
      stamps.push([at, stampOf(stat.value)]);
      own.unshift({ directory: folder, file: parseIgnoreFile(contents.value) });
    }
    const rules = own.length === 0 ? inherited : [...own, ...inherited];
    const visible: string[] = [];
    for (const child of children) {
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      const file = folder === "" ? child.name : `${folder}/${child.name}`;
      if (child.isDirectory()) {
        if (!pruned.has(path.join(root, file)) && !isIgnored(rules, file, true)) {
          pending.push({ folder: file, rules });
        }
      } else if (child.isFile() && !isIgnored(rules, file, false)) {
        visible.push(file);
      }
    }
    if (files.length + visible.length > PLAIN_FOLDER_MAX_FILES) {
      return yield* tooLarge(root, "25,000 files");
    }
    const statted = yield* Effect.forEach(
      visible,
      (file) =>
        fileSystem.stat(path.join(root, file)).pipe(
          Effect.option,
          Effect.map((stat) => ({ file, stat })),
        ),
      { concurrency: STAT_CONCURRENCY },
    );
    for (const { file, stat } of statted) {
      if (Option.isNone(stat)) continue;
      const size = Number(stat.value.size);
      if (isWikiDocument(file)) {
        documentBytes += size;
        if (documentBytes > PLAIN_FOLDER_MAX_DOCUMENT_BYTES) {
          return yield* tooLarge(root, "256 MB of documents");
        }
        const text = yield* fileSystem.readFileString(path.join(root, file)).pipe(Effect.option);
        if (Option.isNone(text)) continue;
        documents[file] = text.value;
        stamps.push([path.join(root, file), stampOf(stat.value)]);
      }
      files.push({
        file,
        size,
        modified: Option.getOrUndefined(stat.value.mtime),
        created: Option.getOrUndefined(stat.value.birthtime),
      });
    }
  }
  return {
    files: files.toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
    documents,
    stamps,
  } satisfies PlainScan;
});

/** Whether every folder, document and ignore file a scan read still stands as it did. */
export const plainScanFresh = Effect.fn("plainScanFresh")(function* (scan: PlainScan) {
  const fileSystem = yield* FileSystem.FileSystem;
  const changed = yield* Effect.forEach(
    scan.stamps,
    ([at, stamp]) =>
      fileSystem.stat(at).pipe(
        Effect.map((info) => stampOf(info) !== stamp),
        Effect.orElseSucceed(() => true),
      ),
    { concurrency: STAT_CONCURRENCY },
  );
  return !changed.includes(true);
});
