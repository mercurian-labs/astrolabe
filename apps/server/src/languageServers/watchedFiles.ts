// @effect-diagnostics nodeBuiltinImport:off - a watcher's base uri converts synchronously.
import * as NodeURL from "node:url";

/** A file created, changed or deleted outside the documents a server has open. */
export interface WatchedFileChange {
  readonly relativePath: string;
  readonly type: "created" | "changed" | "deleted";
}

/** LSP's `FileChangeType`. */
export const FILE_CHANGE_TYPES = { created: 1, changed: 2, deleted: 3 } as const;

/** LSP's `WatchKind` bit for each change; a watcher without `kind` wants all three. */
const WATCH_KINDS = { created: 1, changed: 2, deleted: 4 } as const;

export interface FileWatcher {
  /** Tested against `/`-separated absolute paths. */
  readonly pattern: RegExp;
  readonly kind: number;
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An LSP glob (`*`, `**`, `?`, `{a,b}`, `[a-z]`) as a regular expression. Case-insensitive:
 * TypeScript 7 lowercases the paths it registers on a case-insensitive file system.
 */
export const globPattern = (glob: string, base = ""): RegExp => {
  let source = "";
  let braces = 0;
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      // `**/` also matches no folder at all.
      if (glob[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") {
      braces += 1;
      source += "(?:";
    } else if (char === "}" && braces > 0) {
      braces -= 1;
      source += ")";
    } else if (char === "," && braces > 0) source += "|";
    else if (char === "[" && glob.indexOf("]", index + 2) > 0) {
      const end = glob.indexOf("]", index + 2);
      const body = glob.slice(index + 1, end).replaceAll("\\", "\\\\");
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
      index = end;
    } else source += escape(char);
  }
  return new RegExp(`^${escape(base)}${source}$`, "i");
};

/** The watchers of a `workspace/didChangeWatchedFiles` registration, skipping any it can't read. */
export const watchersOf = (registerOptions: unknown): ReadonlyArray<FileWatcher> => {
  const watchers = (registerOptions as { watchers?: unknown } | null)?.watchers;
  if (!Array.isArray(watchers)) return [];
  return watchers.flatMap((watcher): Array<FileWatcher> => {
    const kind = typeof watcher?.kind === "number" ? watcher.kind : 7;
    const glob = watcher?.globPattern;
    if (typeof glob === "string")
      return [{ pattern: globPattern(glob.replaceAll("\\", "/")), kind }];
    // A RelativePattern: its base is a uri, or a workspace folder with one.
    const baseUri = typeof glob?.baseUri === "string" ? glob.baseUri : glob?.baseUri?.uri;
    if (typeof baseUri !== "string" || typeof glob?.pattern !== "string") return [];
    let base: string;
    try {
      base = NodeURL.fileURLToPath(baseUri).replaceAll("\\", "/");
    } catch {
      return [];
    }
    return [{ pattern: globPattern(glob.pattern, base.endsWith("/") ? base : `${base}/`), kind }];
  });
};

/** Whether any watcher wants `change` at one of the file's absolute paths. */
export const watched = (
  watchers: Iterable<FileWatcher>,
  absolutePaths: ReadonlyArray<string>,
  type: WatchedFileChange["type"],
): boolean => {
  const paths = absolutePaths.map((absolute) => absolute.replaceAll("\\", "/"));
  for (const watcher of watchers) {
    if ((watcher.kind & WATCH_KINDS[type]) === 0) continue;
    if (paths.some((absolute) => watcher.pattern.test(absolute))) return true;
  }
  return false;
};

/** Two changes to one file in a burst, as the one the server should hear; null for none. */
export const mergeChange = (
  before: WatchedFileChange["type"] | undefined,
  after: WatchedFileChange["type"],
): WatchedFileChange["type"] | null => {
  if (before === "created") return after === "deleted" ? null : "created";
  if (before === "deleted" && after !== "deleted") return "changed";
  return after;
};
