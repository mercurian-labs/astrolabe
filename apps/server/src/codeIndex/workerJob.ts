// @effect-diagnostics nodeBuiltinImport:off - the worker is a plain Node process that runs no Effect.
/**
 * What a code index worker does, apart from being a process: parse file versions and write their
 * facts, or delete facts. Tree-sitter parses synchronously, so the server runs this in a process
 * of its own (`worker.ts`) and never on its event loop.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import {
  blobSizes,
  extractFile,
  languageOf,
  looksGenerated,
  readBlobs,
} from "@mercurian/code-graph";

import { recordOf } from "./facts.ts";
import { deleteFromStore, makeWriter, openStore, type ParsedFile } from "./store.ts";
import type { WorkerFile, WorkerJob, WorkerOutput } from "./workerProtocol.ts";

/** Files parsed between commits: each commit tells the server how far the job has come. */
const COMMIT_EVERY = 50;

/** Git's blob hash of some bytes, so a file read from disk is keyed as git would key it. */
const gitBlobHash = (bytes: Uint8Array) =>
  NodeCrypto.createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");

const looksBinary = (text: string) => text.slice(0, 8000).includes("\0");

async function parseOne(path: string, blob: string, text: string | null): Promise<ParsedFile> {
  const language = languageOf(path);
  if (language === null || text === null || looksBinary(text) || looksGenerated(text)) {
    return { path, blob, language, record: null };
  }
  try {
    return { path, blob, language, record: recordOf(await extractFile(path, language, text)) };
  } catch {
    return { path, blob, language, record: null };
  }
}

async function readFiles(
  repo: string,
  maxBytes: number,
  files: ReadonlyArray<WorkerFile>,
): Promise<ReadonlyArray<{ path: string; blob: string; text: string | null }>> {
  // A file gone from disk since the server listed it is left out: nothing to store.
  const fromGit = files.filter((file) => file.disk === null);
  const sizes = await blobSizes(
    repo,
    fromGit.map((file) => file.blob),
  );
  const readable = fromGit.flatMap((file, index) => {
    const size = sizes[index] ?? Number.POSITIVE_INFINITY;
    return size <= maxBytes ? [{ sha: file.blob, size }] : [];
  });
  const texts = new Map<string, string>();
  for (const [index, text] of (await readBlobs(repo, readable)).entries()) {
    const sha = readable[index]?.sha;
    if (sha !== undefined) texts.set(sha, text);
  }
  return files.flatMap((file) => {
    if (file.disk === null) {
      return [{ path: file.path, blob: file.blob, text: texts.get(file.blob) ?? null }];
    }
    let bytes: Buffer;
    try {
      bytes = NodeFS.readFileSync(file.disk);
    } catch {
      return [];
    }
    return [
      {
        path: file.path,
        blob: gitBlobHash(bytes),
        text: bytes.byteLength <= maxBytes ? bytes.toString("utf8") : null,
      },
    ];
  });
}

export async function runJob(job: WorkerJob, emit: (output: WorkerOutput) => void): Promise<void> {
  const db = openStore(job.db);
  try {
    if (job.op === "delete") {
      emit({ deleted: deleteFromStore(db, job) });
      return;
    }
    const writer = makeWriter(db, job.projectId);
    for (let start = 0; start < job.files.length; start += COMMIT_EVERY) {
      const batch = job.files.slice(start, start + COMMIT_EVERY);
      const read = await readFiles(job.repo, job.maxBytes, batch);
      const parsed: Array<ParsedFile> = [];
      for (const file of read) parsed.push(await parseOne(file.path, file.blob, file.text));
      emit({ written: writer.write(parsed) });
    }
  } finally {
    db.close();
  }
}
