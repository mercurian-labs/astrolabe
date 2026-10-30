/**
 * What a checkout holds, read from git: each indexable file's path and blob, with uncommitted
 * files hashed as git would hash them. A checkout's code index is this list plus the shared facts.
 */
import { isIndexable } from "@mercurian/code-graph/languages";
import { CodeIndexError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const MANIFEST = "package.json";
export const isManifest = (path: string) =>
  (path === MANIFEST || path.endsWith(`/${MANIFEST}`)) && !path.split("/").includes("node_modules");

/** A git tree's files the index reads. */
export interface Listing {
  readonly tree: string;
  /** Indexable files: path → blob. */
  readonly files: ReadonlyMap<string, string>;
  /** `package.json` files, which name the repository's packages: path → blob. */
  readonly manifests: ReadonlyMap<string, string>;
}

/** A checkout as the index answers for it. */
export interface View {
  /** The checkout's top level; null for a ref, which has no files on disk. */
  readonly root: string | null;
  readonly commit: string | null;
  readonly tree: string | null;
  /** Indexable, unskipped files: path → blob. */
  readonly files: ReadonlyMap<string, string>;
  readonly manifests: ReadonlyMap<string, string>;
  /** Files and manifests whose blob was hashed from disk: uncommitted changes. */
  readonly uncommitted: ReadonlySet<string>;
}

type Git = GitVcsDriver.GitVcsDriver["Service"];

const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

export const gitFailed = (cause: unknown) =>
  new CodeIndexError({ reason: "git-failed", message: "Git could not read the checkout.", cause });

/** Run git in a checkout for its output; a failure is the index's `git-failed`. */
export const runGit = (
  git: Git,
  cwd: string,
  operation: string,
  args: ReadonlyArray<string>,
  options?: { readonly stdin?: string; readonly allowNonZeroExit?: boolean },
) =>
  git
    .execute({
      operation: `codeIndex.${operation}`,
      cwd,
      args,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      timeoutMs: 120_000,
      ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options?.allowNonZeroExit === true ? { allowNonZeroExit: true } : {}),
    })
    .pipe(
      Effect.map((result) => result.stdout),
      Effect.mapError(gitFailed),
    );

const REGULAR_MODES = new Set(["100644", "100755"]);

function addEntry(
  listing: { files: Map<string, string>; manifests: Map<string, string> },
  path: string,
  blob: string,
) {
  if (isIndexable(path)) listing.files.set(path, blob);
  else if (isManifest(path)) listing.manifests.set(path, blob);
}

/** `ls-tree -r -z` of a whole tree. */
export function parseLsTree(tree: string, out: string): Listing {
  const listing = { tree, files: new Map<string, string>(), manifests: new Map<string, string>() };
  for (const line of out.split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type, sha] = line.slice(0, tab).split(" ");
    if (type !== "blob" || !REGULAR_MODES.has(mode) || sha === undefined) continue;
    addEntry(listing, line.slice(tab + 1), sha);
  }
  return listing;
}

/** Apply `diff-tree -r -z --no-renames` output to a listing of its first tree. */
export function applyTreeDiff(base: Listing, tree: string, out: string): Listing {
  const listing = { tree, files: new Map(base.files), manifests: new Map(base.manifests) };
  const fields = out.split("\0");
  for (let index = 0; index + 1 < fields.length; index += 2) {
    // `:<old mode> <new mode> <old sha> <new sha> <status>`, then the path.
    const [, newMode = "", , newSha = "", status = ""] = (fields[index] ?? "").slice(1).split(" ");
    const path = fields[index + 1] ?? "";
    if (path === "") continue;
    listing.files.delete(path);
    listing.manifests.delete(path);
    if (REGULAR_MODES.has(newMode) && !status.startsWith("D")) addEntry(listing, path, newSha);
  }
  return listing;
}

export interface Dirty {
  /** Changed or new files on disk, still present. */
  readonly present: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
}

/** `status --porcelain=v1 -z --no-renames --untracked-files=all`. */
export function parseStatus(out: string): Dirty {
  const present: Array<string> = [];
  const deleted: Array<string> = [];
  for (const entry of out.split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code[1] === "D" || (code[0] === "D" && code[1] === " ")) deleted.push(path);
    else present.push(path);
  }
  return { present, deleted };
}

/**
 * Gitignore-style patterns as one test: `dir/` skips a folder anywhere, `/dir` only at the root,
 * a pattern with a slash is anchored, `*` stays within a segment and `**` crosses them.
 */
export function skipMatcher(patterns: ReadonlyArray<string>): (path: string) => boolean {
  const tests: Array<RegExp> = [];
  for (const raw of patterns) {
    let pattern = raw.trim();
    if (pattern === "" || pattern.startsWith("#") || pattern.startsWith("!")) continue;
    const folderOnly = pattern.endsWith("/");
    pattern = pattern.replace(/\/+$/, "");
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    pattern = pattern.replace(/^\/+/, "");
    let glob = "";
    for (let at = 0; at < pattern.length; at += 1) {
      const char = pattern[at] ?? "";
      if (pattern.startsWith("**/", at)) {
        glob += "(?:.*/)?";
        at += 2;
      } else if (pattern.startsWith("**", at)) {
        glob += ".*";
        at += 1;
      } else if (char === "*") glob += "[^/]*";
      else if (char === "?") glob += "[^/]";
      else glob += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    tests.push(new RegExp(`${anchored ? "^" : "(?:^|/)"}${glob}${folderOnly ? "/" : "(?:/|$)"}`));
  }
  return (path) => tests.some((test) => test.test(path));
}

export function filterListing(listing: Listing, skipped: (path: string) => boolean): Listing {
  return {
    tree: listing.tree,
    files: new Map([...listing.files].filter(([path]) => !skipped(path))),
    manifests: listing.manifests,
  };
}
