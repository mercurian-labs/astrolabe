/**
 * Git without a checkout: trees from `ls-tree`, changes from `diff --raw`, blobs
 * by object id from `cat-file`. Only regular files (mode 100644 or 100755) count:
 * symlinks, submodules, and the like are never read, in a full index or a delta.
 * Paths are pathspecs; every listing is NUL-separated, so no path can misalign one.
 */
import * as NodeChildProcess from "node:child_process";

export async function git(repo: string, args: ReadonlyArray<string>): Promise<string> {
  return await new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", repo, ...args],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout);
        else reject(new Error(`git ${args.join(" ")}: ${stderr.trim() || error.message}`));
      },
    );
  });
}

/** Run a git command that reads object ids on stdin; resolves with all of stdout. */
async function gitWithInput(
  repo: string,
  args: ReadonlyArray<string>,
  input: string,
): Promise<Buffer> {
  const child = NodeChildProcess.spawn("git", ["-C", repo, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks: Array<Buffer> = [];
  const errors: Array<Buffer> = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`git ${args.join(" ")}: ${Buffer.concat(errors).toString().trim()}`)),
    );
  });
  child.stdin.end(input);
  await done;
  return Buffer.concat(chunks);
}

const pathspec = (paths: ReadonlyArray<string>) => (paths.length > 0 ? ["--", ...paths] : []);
const REGULAR_MODES = new Set(["100644", "100755"]);

export interface TreeEntry {
  readonly path: string;
  readonly sha: string;
  /** Bytes. */
  readonly size: number;
}

/** Every regular file in the tree. */
export async function listTree(
  repo: string,
  ref: string,
  paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<TreeEntry>> {
  const out = await git(repo, [
    "ls-tree",
    "-r",
    "-l",
    "-z",
    "--full-tree",
    ref,
    ...pathspec(paths),
  ]);
  const entries: Array<TreeEntry> = [];
  for (const line of out.split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type, sha, size] = line.slice(0, tab).split(/\s+/);
    if (type !== "blob" || !REGULAR_MODES.has(mode) || sha === undefined) continue;
    entries.push({ path: line.slice(tab + 1), sha, size: Number(size) });
  }
  return entries;
}

/**
 * Every regular file in the tree, by path, without sizes: `ls-tree` reads each
 * blob's header for `-l`, which costs most of a large tree's listing.
 */
export async function listBlobs(repo: string, ref: string): Promise<Map<string, string>> {
  const out = await git(repo, ["ls-tree", "-r", "-z", "--full-tree", ref]);
  const blobs = new Map<string, string>();
  for (const line of out.split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type, sha] = line.slice(0, tab).split(/\s+/);
    if (type !== "blob" || !REGULAR_MODES.has(mode) || sha === undefined) continue;
    blobs.set(line.slice(tab + 1), sha);
  }
  return blobs;
}

export interface ChangedPath {
  readonly path: string;
  /** The blob at the later tree when the path is a regular file there; else null. */
  readonly sha: string | null;
}

/**
 * Paths that differ between two trees, renames split into a delete and an add
 * so both sides re-parse. A path that stops being a regular file (a symlink now,
 * say) reads as gone.
 */
export async function diffPaths(
  repo: string,
  from: string,
  to: string,
  paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<ChangedPath>> {
  const out = await git(repo, [
    "diff",
    "--raw",
    "--no-renames",
    "--no-abbrev",
    "-z",
    from,
    to,
    ...pathspec(paths),
  ]);
  const fields = out.split("\0");
  const changed: Array<ChangedPath> = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    // `:<old mode> <new mode> <old sha> <new sha> <status>`, then the path.
    const [, newMode = "", , newSha = "", status = ""] = (fields[index] ?? "").slice(1).split(" ");
    const path = fields[index + 1] ?? "";
    if (path === "") continue;
    const regular = REGULAR_MODES.has(newMode) && !status.startsWith("D");
    changed.push({ path, sha: regular ? newSha : null });
  }
  return changed;
}

/** Blob sizes in bytes, by object id. */
export async function blobSizes(
  repo: string,
  shas: ReadonlyArray<string>,
): Promise<ReadonlyArray<number>> {
  if (shas.length === 0) return [];
  const out = await gitWithInput(repo, ["cat-file", "--batch-check"], `${shas.join("\n")}\n`);
  return out
    .toString("utf8")
    .split("\n")
    .slice(0, shas.length)
    .map((line) => Number(line.split(" ")[2]));
}

/** Bounds on one `cat-file --batch` round trip, so a large tree never sits in memory whole. */
const BATCH_BLOBS = 256;
const BATCH_BYTES = 32 * 1024 * 1024;

/**
 * Read blobs by object id, in bounded batches: each batch is requested, read,
 * and decoded before the next is asked for.
 */
export async function readBlobs(
  repo: string,
  blobs: ReadonlyArray<{ readonly sha: string; readonly size: number }>,
): Promise<ReadonlyArray<string>> {
  const texts: Array<string> = [];
  let start = 0;
  while (start < blobs.length) {
    let end = start;
    let bytes = 0;
    while (
      end < blobs.length &&
      end - start < BATCH_BLOBS &&
      (end === start || bytes + (blobs[end]?.size ?? 0) <= BATCH_BYTES)
    ) {
      bytes += blobs[end]?.size ?? 0;
      end += 1;
    }
    const batch = blobs.slice(start, end);
    const out = await gitWithInput(
      repo,
      ["cat-file", "--batch"],
      `${batch.map((blob) => blob.sha).join("\n")}\n`,
    );
    let at = 0;
    for (const blob of batch) {
      const newline = out.indexOf(10, at);
      const [sha, type, size] = out.subarray(at, newline).toString().split(" ");
      if (sha !== blob.sha || type !== "blob") {
        throw new Error(`git cat-file --batch: expected blob ${blob.sha}, read ${sha} ${type}`);
      }
      at = newline + 1;
      texts.push(out.subarray(at, at + Number(size)).toString("utf8"));
      at += Number(size) + 1;
    }
    start = end;
  }
  return texts;
}

export interface Commit {
  readonly sha: string;
  readonly subject: string;
  /** Committer date, YYYY-MM-DD. */
  readonly date: string;
}

/**
 * The commits of `from..to` in git's meaning (first parents of `to` that `from`
 * cannot reach) that touch `paths`, oldest first.
 */
export async function commitsBetween(
  repo: string,
  from: string,
  to: string,
  paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<Commit>> {
  const out = await git(repo, [
    "log",
    "--reverse",
    "--first-parent",
    "--format=%H%x00%s%x00%cs",
    `${from}..${to}`,
    ...pathspec(paths),
  ]);
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [sha = "", subject = "", date = ""] = line.split("\0");
      return { sha, subject, date };
    });
}

export const revParse = async (repo: string, ref: string) =>
  (await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
