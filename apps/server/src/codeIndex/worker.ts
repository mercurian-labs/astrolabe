/**
 * The code index's worker process (see `workerJob.ts`):
 *
 *   node worker.ts [--assets <dir>] < job.json
 *
 * Reads a `WorkerJob` as JSON on stdin and prints one `WorkerOutput` JSON line per commit.
 * `--assets` names the directory a bundle ships the grammars and queries in. A failure exits 1
 * with its message on stderr; what was committed before it stays.
 */
import { useAssets } from "@mercurian/code-graph";
import * as Schema from "effect/Schema";

import { runJob } from "./workerJob.ts";
import { WorkerJob, WorkerOutput } from "./workerProtocol.ts";

const decodeJob = Schema.decodeUnknownSync(Schema.fromJsonString(WorkerJob));
const encodeOutput = Schema.encodeSync(Schema.fromJsonString(WorkerOutput));

async function readStdin(): Promise<string> {
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const argv = process.argv.slice(2);
const at = argv.indexOf("--assets");
const assets = at < 0 ? undefined : argv[at + 1];
if (assets !== undefined) useAssets(assets);
try {
  const job = decodeJob(await readStdin());
  await runJob(job, (output) => process.stdout.write(`${encodeOutput(output)}\n`));
} catch (error) {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
