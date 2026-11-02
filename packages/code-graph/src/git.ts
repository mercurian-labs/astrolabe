/** Git without a checkout: blobs by object id, their sizes and texts, from `cat-file`. */
import * as NodeChildProcess from "node:child_process";

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
