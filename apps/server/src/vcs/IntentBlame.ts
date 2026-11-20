import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import {
  CheckpointScopeId,
  IntentBlameError,
  MessageId,
  ThreadId,
  type IntentBlameInput,
  type IntentBlameResult,
  type IntentBlameSpan,
  type IntentBlameTurn,
} from "@t3tools/contracts";

import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 2000;
const NOT_COMMITTED = /^0{40}$/;
// Commits made here are throwaway, so fixed identities and dates keep them reproducible.
const SYNTHETIC_COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Astrolabe",
  GIT_AUTHOR_EMAIL: "intent-blame@astrolabe.invalid",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "Astrolabe",
  GIT_COMMITTER_EMAIL: "intent-blame@astrolabe.invalid",
  GIT_COMMITTER_DATE: "@0 +0000",
};

/** A turn as the blame walks it: the checkpoints at its start (null if gone) and its end. */
export interface BlameTurn {
  readonly key: number;
  readonly startRef: string | null;
  readonly endRef: string;
}

export type LineSource =
  | { readonly origin: "turn"; readonly turn: number }
  | { readonly origin: "before" }
  | { readonly origin: "outside" };

/**
 * Astrolabe: the turn behind each line of an open file. The turns that changed the file in one
 * checkout run in sequence, so each checkout's checkpoints become one throwaway history (the
 * file at each turn's start, then at its end) and `git blame` follows the file's lines back
 * through it. The commits go to a temporary object directory, never the repository's.
 */
export class IntentBlame extends Context.Service<
  IntentBlame,
  {
    readonly blame: (input: IntentBlameInput) => Effect.Effect<IntentBlameResult, IntentBlameError>;
  }
>()("t3/vcs/IntentBlame") {}

/**
 * For each line of `contents`, the newest turn any checkout's history says wrote it. A line no
 * history gives to a turn is `before` when every history had it from its start.
 */
export const attributeLines = Effect.fn("IntentBlame.attributeLines")(function* (input: {
  readonly cwd: string;
  /** Relative to the repository's root. */
  readonly path: string;
  readonly contents: string;
  /** Each checkout's turns, oldest first. */
  readonly chains: ReadonlyArray<ReadonlyArray<BlameTurn>>;
  /** Higher for newer turns: which turn a line goes to when two histories claim it. */
  readonly rank: (key: number) => number;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const lineCount = countLines(input.contents);
  const sources: Array<LineSource | null> = Array.from({ length: lineCount }, () => null);
  const outsideAnywhere: boolean[] = Array.from({ length: lineCount }, () => false);
  if (input.chains.length === 0 || lineCount === 0) {
    return sources.map((): LineSource => ({ origin: "outside" }));
  }

  const objects = yield* git.execute({
    operation: "IntentBlame.objects",
    cwd: input.cwd,
    args: ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
  });
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "t3-intent-blame-" });
  const env = {
    ...SYNTHETIC_COMMIT_ENV,
    GIT_OBJECT_DIRECTORY: scratch,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: objects.stdout.trim(),
  };
  const run = (operation: string, args: ReadonlyArray<string>, stdin?: string) =>
    git.execute({
      operation: `IntentBlame.${operation}`,
      cwd: input.cwd,
      args,
      env,
      allowNonZeroExit: true,
      maxOutputBytes: 16 * MAX_FILE_BYTES,
      ...(stdin === undefined ? {} : { stdin }),
    });

  const refs = input.chains.flatMap((chain) =>
    chain.flatMap((turn) => (turn.startRef ? [turn.startRef, turn.endRef] : [turn.endRef])),
  );
  const checked = yield* run(
    "trees",
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    refs.map((ref) => `${ref}^{tree}\n`).join(""),
  );
  const trees = new Map<string, string>();
  checked.stdout
    .trimEnd()
    .split("\n")
    .forEach((line, index) => {
      const [id, type] = line.split(" ");
      const ref = refs[index];
      if (ref !== undefined && id !== undefined && type === "tree") trees.set(ref, id);
    });

  const commit = Effect.fn("IntentBlame.commit")(function* (
    tree: string,
    parent: string | null,
    message: string,
  ) {
    const made = yield* run("commit", [
      "commit-tree",
      tree,
      ...(parent === null ? [] : ["-p", parent]),
      "-m",
      message,
    ]);
    return made.exitCode === 0 ? made.stdout.trim() : null;
  });

  for (const chain of input.chains) {
    // What each commit of the history stands for.
    const meaning = new Map<string, LineSource>();
    let tip: string | null = null;
    for (const turn of chain) {
      const end = trees.get(turn.endRef);
      if (end === undefined) continue;
      const start = turn.startRef === null ? undefined : trees.get(turn.startRef);
      if (start !== undefined) {
        const made: string | null = yield* commit(start, tip, `start ${turn.key}`);
        if (made === null) continue;
        meaning.set(made, tip === null ? { origin: "before" } : { origin: "outside" });
        tip = made;
      }
      const made: string | null = yield* commit(end, tip, `turn ${turn.key}`);
      if (made === null) continue;
      meaning.set(made, tip === null ? { origin: "before" } : { origin: "turn", turn: turn.key });
      tip = made;
    }
    if (tip === null) continue;
    const blamed = yield* run(
      "blame",
      // -M keeps a turn's lines its own when they are moved within the file later.
      ["blame", "--incremental", "-M", "--contents", "-", tip, "--", input.path],
      input.contents,
    );
    // The file is not in this checkout's history, which then says nothing of its lines.
    if (blamed.exitCode !== 0) continue;
    for (const entry of parseIncrementalBlame(blamed.stdout)) {
      const source: LineSource = NOT_COMMITTED.test(entry.commit)
        ? { origin: "outside" }
        : (meaning.get(entry.commit) ?? { origin: "outside" });
      for (let line = entry.finalLine; line < entry.finalLine + entry.lines; line += 1) {
        const index = line - 1;
        if (index < 0 || index >= lineCount) continue;
        const current = sources[index] ?? null;
        if (source.origin === "outside") outsideAnywhere[index] = true;
        if (source.origin === "turn") {
          if (current?.origin !== "turn" || input.rank(source.turn) > input.rank(current.turn)) {
            sources[index] = source;
          }
        } else if (current === null) {
          sources[index] = source;
        }
      }
    }
  }
  return sources.map((source, index): LineSource => {
    if (source?.origin === "turn") return source;
    return source?.origin === "before" && !outsideAnywhere[index]
      ? { origin: "before" }
      : { origin: "outside" };
  });
}, Effect.scoped);

/** `git blame --incremental` entries: which commit gave which run of the final lines. */
function parseIncrementalBlame(output: string): Array<{
  readonly commit: string;
  readonly finalLine: number;
  readonly lines: number;
}> {
  const entries: Array<{ commit: string; finalLine: number; lines: number }> = [];
  for (const line of output.split("\n")) {
    const match = /^([0-9a-f]{40}) \d+ (\d+) (\d+)$/.exec(line);
    if (match) {
      entries.push({ commit: match[1]!, finalLine: Number(match[2]), lines: Number(match[3]) });
    }
  }
  return entries;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

function toSpans(sources: ReadonlyArray<LineSource>): IntentBlameSpan[] {
  const spans: IntentBlameSpan[] = [];
  sources.forEach((source, index) => {
    const line = index + 1;
    const turn = source.origin === "turn" ? source.turn : undefined;
    const last = spans.at(-1);
    if (last && last.origin === source.origin && last.turn === turn && last.endLine === index) {
      spans[spans.length - 1] = { ...last, endLine: line };
      return;
    }
    spans.push({
      startLine: line,
      endLine: line,
      origin: source.origin,
      ...(turn === undefined ? {} : { turn }),
    });
  });
  return spans;
}

const clip = (text: string | null | undefined) => {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}…` : trimmed;
};

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const sql = yield* SqlClient.SqlClient;
  const digest = yield* Digest.Digest;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = Layer.mergeAll(
    Layer.succeed(GitVcsDriver.GitVcsDriver, git),
    Layer.succeed(FileSystem.FileSystem, fs),
  );

  const blame: IntentBlame["Service"]["blame"] = Effect.fn("IntentBlame.blame")(function* (input) {
    const failure = (detail: string) => (cause: unknown) =>
      new IntentBlameError({ cwd: input.cwd, path: input.path, detail, cause });
    yield* knownWorkspaces
      .assertContains(input.cwd)
      .pipe(Effect.mapError(failure("Not a known workspace.")));

    const prefix = yield* git
      .execute({
        operation: "IntentBlame.prefix",
        cwd: input.cwd,
        args: ["rev-parse", "--show-prefix"],
      })
      .pipe(Effect.mapError(failure("Not in a Git repository.")));
    const repoPath = `${prefix.stdout.trim()}${input.path}`;
    const file = path.join(input.cwd, input.path);
    const size = yield* fs.stat(file).pipe(Effect.mapError(failure("The file cannot be read.")));
    if (Number(size.size) > MAX_FILE_BYTES) {
      return yield* failure("The file is too big to attribute.")(undefined);
    }
    const contents = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError(failure("The file cannot be read.")));

    const queryFailure = failure("Could not read the turns that changed it.");
    const changed = yield* sql<{
      readonly thread_id: string;
      readonly run_id: string;
      readonly scope_id: string;
      readonly ordinal: number;
      readonly captured_at: string;
      readonly ref: string;
      readonly checkout: string;
      readonly title: string;
      readonly turn_number: number;
      readonly user_message_id: string | null;
    }>`
      SELECT checkpoint.thread_id, checkpoint.run_id, checkpoint.scope_id,
        checkpoint.ordinal_within_scope AS ordinal, checkpoint.captured_at,
        json_extract(checkpoint.payload_json, '$.ref') AS ref,
        json_extract(scope.payload_json, '$.cwd') AS checkout,
        thread.title, run.ordinal AS turn_number,
        json_extract(run.payload_json, '$.userMessageId') AS user_message_id
      FROM orchestration_v2_projection_checkpoints AS checkpoint
      JOIN orchestration_v2_projection_checkpoint_scopes AS scope
        ON scope.scope_id = checkpoint.scope_id
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = checkpoint.thread_id
      JOIN orchestration_v2_projection_runs AS run ON run.run_id = checkpoint.run_id
      WHERE thread.deleted_at IS NULL
        AND checkpoint.status = 'ready'
        AND checkpoint.ordinal_within_scope > 0
        AND run.status != 'rolled_back'
        AND EXISTS (
          SELECT 1 FROM json_each(checkpoint.payload_json, '$.files') AS file
          WHERE json_extract(file.value, '$.path') = ${repoPath}
        )
      ORDER BY checkpoint.captured_at ASC
    `.pipe(Effect.mapError(queryFailure));

    // A turn in another repository can list the same path; only this repository has its refs.
    const present = yield* git
      .execute({
        operation: "IntentBlame.refs",
        cwd: input.cwd,
        args: ["cat-file", "--batch-check=%(objecttype)"],
        stdin: changed.map((row) => `${row.ref}\n`).join(""),
        allowNonZeroExit: true,
      })
      .pipe(Effect.mapError(failure("Could not read the turns' checkpoints.")));
    const presence = present.stdout.trimEnd().split("\n");
    const worktrees = yield* git
      .execute({
        operation: "IntentBlame.worktrees",
        cwd: input.cwd,
        args: ["worktree", "list", "--porcelain"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.mapError(failure("Could not list the repository's checkouts.")));
    const checkouts = new Set(
      worktrees.stdout
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length)),
    );
    const rows = changed.filter((_, index) => presence[index] === "commit");
    const missingCheckpoints = changed.filter(
      (row, index) => presence[index] !== "commit" && checkouts.has(row.checkout),
    ).length;

    const chains = new Map<string, BlameTurn[]>();
    for (const [key, row] of rows.entries()) {
      const startRef = yield* checkpointRefForScopeOrdinal({
        scopeId: CheckpointScopeId.make(row.scope_id),
        ordinalWithinScope: row.ordinal - 1,
      }).pipe(Effect.provideService(Digest.Digest, digest));
      const chain = chains.get(row.checkout) ?? [];
      chain.push({ key, startRef, endRef: row.ref });
      chains.set(row.checkout, chain);
    }
    const sources = yield* attributeLines({
      cwd: input.cwd,
      path: repoPath,
      contents,
      chains: [...chains.values()],
      rank: (key) => key,
    }).pipe(
      Effect.provide(services),
      Effect.mapError(failure("Git could not follow the file's lines.")),
    );

    // Only the turns a line goes to are described, in the order they ran.
    const used = [...new Set(sources.flatMap((s) => (s.origin === "turn" ? [s.turn] : [])))].sort(
      (a, b) => a - b,
    );
    const index = new Map(used.map((key, position) => [key, position]));
    const turns: IntentBlameTurn[] = [];
    for (const key of used) {
      const row = rows[key]!;
      turns.push(yield* describeTurn(row, repoPath).pipe(Effect.mapError(queryFailure)));
    }
    const spans = toSpans(
      sources.map((source) =>
        source.origin === "turn" ? { origin: "turn", turn: index.get(source.turn)! } : source,
      ),
    );
    return { spans, turns, missingCheckpoints };
  });

  const describeTurn = Effect.fn("IntentBlame.describeTurn")(function* (
    row: {
      readonly thread_id: string;
      readonly run_id: string;
      readonly captured_at: string;
      readonly checkout: string;
      readonly title: string;
      readonly turn_number: number;
      readonly user_message_id: string | null;
    },
    repoPath: string,
  ) {
    const [request] =
      row.user_message_id === null
        ? []
        : yield* sql<{ readonly text: string | null }>`
            SELECT json_extract(payload_json, '$.text') AS text
            FROM orchestration_v2_projection_messages
            WHERE message_id = ${row.user_message_id}
          `;
    const said = yield* sql<{ readonly created_at: string; readonly text: string | null }>`
      SELECT created_at, json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages
      WHERE run_id = ${row.run_id} AND role = 'assistant'
      ORDER BY created_at ASC
    `;
    // When the agent first wrote this file in the turn, from its own file edits.
    const [firstChange] = yield* sql<{ readonly at: string | null }>`
      SELECT MIN(json_extract(payload_json, '$.startedAt')) AS at
      FROM orchestration_v2_projection_turn_items
      WHERE run_id = ${row.run_id} AND type = 'file_change' AND instr(payload_json, ${repoPath}) > 0
    `;
    const changedAt = firstChange?.at ?? null;
    const before =
      changedAt === null ? undefined : said.findLast((message) => message.created_at <= changedAt);
    return {
      threadId: ThreadId.make(row.thread_id),
      threadTitle: row.title,
      turnNumber: row.turn_number,
      userMessageId: row.user_message_id === null ? null : MessageId.make(row.user_message_id),
      request: clip(request?.text) ?? "",
      beforeChange: clip(before?.text),
      closing: clip(said.at(-1)?.text),
      at: row.captured_at,
      checkout: row.checkout,
    } satisfies IntentBlameTurn;
  });

  return IntentBlame.of({ blame });
});

export const layer = Layer.effect(IntentBlame, make);
