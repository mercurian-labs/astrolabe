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
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 2000;
const CACHED_FILES = 32;

/** A turn as the blame walks it: the checkpoints at its start (null if gone) and its end. */
export interface BlameTurn {
  /** Turns are numbered in the order they ran, across every checkout. */
  readonly key: number;
  readonly startRef: string | null;
  readonly endRef: string;
  /** When the person asked for the turn, in Unix seconds, when known. */
  readonly requestedAt?: number;
}

/** One checkout's turns, oldest first. `own` is the checkout the file is in. */
export interface BlameChain {
  readonly own: boolean;
  readonly turns: ReadonlyArray<BlameTurn>;
}

export type LineSource =
  | { readonly origin: "turn"; readonly turn: number }
  | { readonly origin: "before" }
  | { readonly origin: "outside" }
  | { readonly origin: "unsaved" };

interface CheckpointCommit {
  readonly tree: string;
  /** HEAD when the checkpoint was captured; null on an unborn branch. */
  readonly head: string | null;
  readonly capturedAt: string;
}

/**
 * Astrolabe: the turn behind each line of an open file. The turns that changed the file in one
 * checkout run in sequence, so each checkout's checkpoints become one throwaway history (the
 * file at each turn's start, then at its end) and `git blame` follows the file's lines back
 * through it. The history is written to a scratch repository that borrows this one's objects.
 */
export class IntentBlame extends Context.Service<
  IntentBlame,
  {
    readonly blame: (input: IntentBlameInput) => Effect.Effect<IntentBlameResult, IntentBlameError>;
  }
>()("t3/vcs/IntentBlame") {}

/**
 * For each line of `contents`, the turn that last changed it. The file's own checkout decides
 * first; other checkouts speak only for lines it gives to no turn, and there the oldest turn wins,
 * since a later identical line elsewhere is a copy. When HEAD moved during a turn, what arrived
 * with the move is a second parent of the turn, so a pull or merge does not count as the turn's.
 */
export const attributeLines = Effect.fn("IntentBlame.attributeLines")(function* (input: {
  /** The repository's root. */
  readonly repo: string;
  /** Relative to the repository's root. */
  readonly path: string;
  /** The file on disk. */
  readonly saved: string;
  /** The text to attribute: the editor's, or the file on disk. */
  readonly contents: string;
  readonly chains: ReadonlyArray<BlameChain>;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lineCount = countLines(input.contents);
  if (lineCount === 0) return [];
  if (input.chains.length === 0 && input.contents === input.saved) {
    return Array.from({ length: lineCount }, (): LineSource => ({ origin: "outside" }));
  }

  const inRepo = (operation: string, args: ReadonlyArray<string>) =>
    git.execute({ operation: `IntentBlame.${operation}`, cwd: input.repo, args });
  const refs = [
    ...new Set(
      input.chains.flatMap((chain) =>
        chain.turns.flatMap((turn) =>
          turn.startRef ? [turn.startRef, turn.endRef] : [turn.endRef],
        ),
      ),
    ),
  ];
  const checkpoints = new Map<string, CheckpointCommit>();
  // In batches: Windows caps a command line near 32K characters.
  for (let at = 0; at < refs.length; at += 100) {
    const listed = yield* inRepo("checkpoints", [
      "for-each-ref",
      "--format=%(refname) %(tree) %(committerdate:unix) %(parent)",
      ...refs.slice(at, at + 100),
    ]);
    for (const line of listed.stdout.split("\n")) {
      const [ref, tree, capturedAt, head] = line.split(" ");
      if (ref && tree && capturedAt) checkpoints.set(ref, { tree, head: head || null, capturedAt });
    }
  }

  // What arrived when HEAD moved during a turn: the newest commit made before the turn began.
  // A thread's later turns start from the previous turn's end, so the request's time bounds it.
  const imports = new Map<number, string>();
  const moved = input.chains.flatMap((chain) =>
    chain.turns.flatMap((turn) => {
      const start = turn.startRef === null ? undefined : checkpoints.get(turn.startRef);
      const end = checkpoints.get(turn.endRef);
      return start?.head && end?.head && start.head !== end.head ? [{ turn, start, end }] : [];
    }),
  );
  yield* Effect.forEach(
    moved,
    ({ turn, start, end }) =>
      inRepo("imports", [
        "log",
        "--format=%T %ct",
        `--until=@${Math.max(Number(start.capturedAt), turn.requestedAt ?? 0)}`,
        `${start.head}..${end.head}`,
      ]).pipe(
        Effect.map((result) => {
          let newest: { tree: string; at: number } | null = null;
          for (const line of result.stdout.split("\n")) {
            const [tree, at] = line.split(" ");
            if (tree && at && (newest === null || Number(at) > newest.at)) {
              newest = { tree, at: Number(at) };
            }
          }
          if (newest !== null) imports.set(turn.key, newest.tree);
        }),
        // A shallow clone can lack the history between the two heads.
        Effect.ignore,
      ),
    { concurrency: 4, discard: true },
  );

  const objects = yield* inRepo("objects", [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "objects",
  ]);
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "t3-intent-blame-" });
  yield* inRepo("scratch", ["init", "--quiet", "--bare", scratch]);
  yield* fs.writeFileString(
    path.join(scratch, "objects", "info", "alternates"),
    `${objects.stdout.trim()}\n`,
  );

  const stream: string[] = [];
  const meanings = new Map<number, LineSource>();
  let mark = 0;
  const commit = (
    branch: number,
    meaning: LineSource,
    parents: ReadonlyArray<number>,
    change: string,
  ) => {
    mark += 1;
    meanings.set(mark, meaning);
    const [from, ...merges] = parents;
    stream.push(
      `commit refs/chains/${branch}`,
      `mark :${mark}`,
      "committer Astrolabe <intent-blame@astrolabe.invalid> 0 +0000",
      "data 0",
      ...(from === undefined ? [] : [`from :${from}`]),
      ...merges.map((parent) => `merge :${parent}`),
      change,
      "",
    );
    return mark;
  };
  const root = (tree: string) => `M 040000 ${tree} ""`;
  // Cleaned as `git add` would (line endings, filters), so the text matches the checkpoints.
  const blob = (text: string) =>
    git
      .execute({
        operation: "IntentBlame.blob",
        cwd: input.repo,
        args: ["hash-object", "-w", `--path=${input.path}`, "--stdin"],
        env: { GIT_OBJECT_DIRECTORY: path.join(scratch, "objects") },
        stdin: text,
      })
      .pipe(Effect.map((result) => `M 100644 ${result.stdout.trim()} ${quotePath(input.path)}`));
  const savedFile = yield* blob(input.saved);
  // The editor joins lines with LF; a file saved with CRLF gets them back.
  const editorText =
    input.saved.includes("\r\n") && !input.contents.includes("\r")
      ? input.contents.replaceAll("\n", "\r\n")
      : input.contents;
  const editorFile = editorText === input.saved ? null : yield* blob(editorText);

  const chains = input.chains.length > 0 ? input.chains : [{ own: true, turns: [] }];
  const tips = chains.map((chain, branch) => {
    let tip: number | null = null;
    for (const turn of chain.turns) {
      const end = checkpoints.get(turn.endRef);
      if (end === undefined) continue;
      const start = turn.startRef === null ? undefined : checkpoints.get(turn.startRef);
      if (start === undefined) {
        // Without the turn's start, nothing says which of these lines the turn wrote.
        tip = commit(
          branch,
          tip === null ? { origin: "before" } : { origin: "outside" },
          tip === null ? [] : [tip],
          root(end.tree),
        );
        continue;
      }
      const before: number = commit(
        branch,
        tip === null ? { origin: "before" } : { origin: "outside" },
        tip === null ? [] : [tip],
        root(start.tree),
      );
      const imported = imports.get(turn.key);
      const arrived =
        imported === undefined
          ? []
          : [commit(branch, { origin: "outside" }, [before], root(imported))];
      tip = commit(
        branch,
        { origin: "turn", turn: turn.key },
        [before, ...arrived],
        root(end.tree),
      );
    }
    const saved = commit(branch, { origin: "outside" }, tip === null ? [] : [tip], savedFile);
    return editorFile === null ? saved : commit(branch, { origin: "unsaved" }, [saved], editorFile);
  });

  const marksFile = path.join(scratch, "marks");
  yield* git.execute({
    operation: "IntentBlame.history",
    cwd: input.repo,
    args: [
      `--git-dir=${scratch}`,
      "fast-import",
      "--quiet",
      "--date-format=raw",
      `--export-marks=${marksFile}`,
    ],
    stdin: `${stream.join("\n")}\ndone\n`,
  });
  const commits = new Map<string, LineSource>();
  const shas = new Map<number, string>();
  for (const line of (yield* fs.readFileString(marksFile)).split("\n")) {
    const [name, sha] = line.split(" ");
    const meaning = name ? meanings.get(Number(name.slice(1))) : undefined;
    if (sha && meaning) {
      commits.set(sha, meaning);
      shas.set(Number(name!.slice(1)), sha);
    }
  }

  const perChain = yield* Effect.forEach(
    tips,
    (tip) =>
      git
        .execute({
          operation: "IntentBlame.blame",
          cwd: input.repo,
          // -M keeps a turn's lines its own when they are moved within the file later.
          args: [
            `--git-dir=${scratch}`,
            "blame",
            "--incremental",
            "-M",
            shas.get(tip)!,
            "--",
            input.path,
          ],
          maxOutputBytes: 16 * MAX_FILE_BYTES,
        })
        .pipe(
          Effect.map((blamed) => {
            const sources: Array<LineSource> = [];
            for (const entry of parseIncrementalBlame(blamed.stdout)) {
              const source: LineSource = commits.get(entry.commit) ?? { origin: "outside" };
              for (let line = entry.finalLine; line < entry.finalLine + entry.lines; line += 1) {
                sources[line - 1] = source;
              }
            }
            return sources;
          }),
        ),
    { concurrency: 4 },
  );

  return Array.from({ length: lineCount }, (_, index): LineSource => {
    const seen = perChain.map((sources) => sources[index] ?? { origin: "outside" as const });
    const own = chains.flatMap((chain, at) => (chain.own ? [seen[at]!] : []));
    const ownTurn = own.find((source) => source.origin === "turn");
    if (ownTurn) return ownTurn;
    let oldest: LineSource | null = null;
    for (const source of seen) {
      if (source.origin === "turn" && (oldest?.origin !== "turn" || source.turn < oldest.turn)) {
        oldest = source;
      }
    }
    if (oldest) return oldest;
    if (seen.some((source) => source.origin === "unsaved")) return { origin: "unsaved" };
    // "Before" must hold for every recorded turn; "outside" is never false.
    return seen.every((source) => source.origin === "before")
      ? { origin: "before" }
      : { origin: "outside" };
  });
}, Effect.scoped);

/** A path as `git fast-import` reads it: C-style quoted. */
function quotePath(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

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

interface ChangedRow {
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
  readonly requested_at: number | null;
}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const sql = yield* SqlClient.SqlClient;
  const digest = yield* Digest.Digest;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = Layer.mergeAll(
    Layer.succeed(GitVcsDriver.GitVcsDriver, git),
    Layer.succeed(FileSystem.FileSystem, fs),
    Layer.succeed(Path.Path, path),
  );
  // One answer per file, reused while its text and the turns that changed it stay the same.
  const answers = new Map<
    string,
    {
      readonly contents: string;
      readonly saved: string;
      readonly turns: string;
      readonly result: IntentBlameResult;
    }
  >();

  const blame: IntentBlame["Service"]["blame"] = Effect.fn("IntentBlame.blame")(function* (input) {
    const failure = (detail: string) => (cause: unknown) =>
      new IntentBlameError({ cwd: input.cwd, path: input.path, detail, cause });
    yield* knownWorkspaces
      .assertContains(input.cwd)
      .pipe(Effect.mapError(failure("Not a known workspace.")));

    const unreadable = failure("The file cannot be read.");
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot: input.cwd, relativePath: input.path })
      .pipe(Effect.mapError(failure("The path is outside the workspace.")));
    const realCwd = yield* fs.realPath(input.cwd).pipe(Effect.mapError(unreadable));
    const file = yield* fs.realPath(resolved.absolutePath).pipe(Effect.mapError(unreadable));
    if (!KnownWorkspaces.isWithinRoot(path, file, realCwd)) {
      return yield* failure("The path is outside the workspace.")(undefined);
    }
    const info = yield* fs.stat(file).pipe(Effect.mapError(unreadable));
    if (info.type !== "File") return yield* unreadable(undefined);
    if (
      Number(info.size) > MAX_FILE_BYTES ||
      (input.contents !== undefined && Buffer.byteLength(input.contents) > MAX_FILE_BYTES)
    ) {
      return yield* failure("The file is too big to attribute.")(undefined);
    }
    const saved = yield* fs.readFileString(file).pipe(Effect.mapError(unreadable));
    const contents = input.contents ?? saved;

    const notInGit = failure("Not in a Git repository.");
    const top = yield* git
      .execute({
        operation: "IntentBlame.root",
        cwd: realCwd,
        args: ["rev-parse", "--show-toplevel"],
      })
      .pipe(Effect.mapError(notInGit));
    const repo = yield* fs.realPath(top.stdout.trim()).pipe(Effect.mapError(notInGit));
    const repoPath = path.relative(repo, file).split(path.sep).join("/");
    if (!KnownWorkspaces.isWithinRoot(path, file, repo)) return yield* notInGit(undefined);

    const queryFailure = failure("Could not read the turns that changed it.");
    const changed = yield* sql<ChangedRow>`
      SELECT checkpoint.thread_id, checkpoint.run_id, checkpoint.scope_id,
        checkpoint.ordinal_within_scope AS ordinal, checkpoint.captured_at,
        json_extract(checkpoint.payload_json, '$.ref') AS ref,
        json_extract(scope.payload_json, '$.cwd') AS checkout,
        thread.title, run.ordinal AS turn_number,
        json_extract(run.payload_json, '$.userMessageId') AS user_message_id,
        CAST(strftime('%s', run.requested_at) AS INTEGER) AS requested_at
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

    const gitFailure = failure("Git could not follow the file's lines.");
    // A turn in another repository can list the same path; only this repository has its refs.
    const present = yield* git
      .execute({
        operation: "IntentBlame.refs",
        cwd: repo,
        args: ["cat-file", "--batch-check=%(objecttype)"],
        stdin: changed.map((row) => `${row.ref}\n`).join(""),
      })
      .pipe(Effect.mapError(gitFailure));
    const presence = present.stdout.trimEnd().split("\n");
    const worktrees = yield* git
      .execute({
        operation: "IntentBlame.worktrees",
        cwd: repo,
        args: ["worktree", "list", "--porcelain", "-z"],
      })
      .pipe(Effect.mapError(gitFailure));
    // Compared through symlinks: a scope's cwd is recorded as the project was opened.
    const realPaths = new Map<string, string>();
    for (const value of [
      ...worktrees.stdout
        .split("\0")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length)),
      ...changed.map((row) => row.checkout),
    ]) {
      if (!realPaths.has(value)) {
        realPaths.set(value, yield* fs.realPath(value).pipe(Effect.orElseSucceed(() => value)));
      }
    }
    const checkouts = worktrees.stdout
      .split("\0")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => realPaths.get(line.slice("worktree ".length))!);
    // The checkout a turn ran in, as its root: the longest listed checkout holding its cwd.
    const checkoutRoot = (cwd: string) => {
      const real = realPaths.get(cwd) ?? cwd;
      return (
        checkouts
          .filter((root) => KnownWorkspaces.isWithinRoot(path, real, root))
          .toSorted((a, b) => b.length - a.length)[0] ?? real
      );
    };
    // The same root as the agent named it, for matching the paths of its file edits.
    const recordedRoot = (cwd: string) =>
      path.resolve(cwd, path.relative(realPaths.get(cwd) ?? cwd, checkoutRoot(cwd)));
    const rows = changed.filter((_, index) => presence[index] === "commit");
    const missingCheckpoints = changed.filter(
      (row, index) =>
        presence[index] !== "commit" && checkouts.includes(checkoutRoot(row.checkout)),
    ).length;

    // A new checkpoint or a renamed thread changes the answer.
    const signature = rows
      .map((row) => `${row.ref}\u0001${row.title}\u0001${row.checkout}`)
      .join("\u0000");
    const cacheKey = `${repo}\0${repoPath}`;
    const cached = answers.get(cacheKey);
    if (
      cached &&
      cached.contents === contents &&
      cached.saved === saved &&
      cached.turns === signature
    ) {
      answers.delete(cacheKey);
      answers.set(cacheKey, cached);
      return { ...cached.result, missingCheckpoints };
    }

    const chains = new Map<string, BlameTurn[]>();
    for (const [key, row] of rows.entries()) {
      const startRef = yield* checkpointRefForScopeOrdinal({
        scopeId: CheckpointScopeId.make(row.scope_id),
        ordinalWithinScope: row.ordinal - 1,
      }).pipe(Effect.provideService(Digest.Digest, digest));
      const root = checkoutRoot(row.checkout);
      const chain = chains.get(root) ?? [];
      chain.push({
        key,
        startRef,
        endRef: row.ref,
        ...(row.requested_at === null ? {} : { requestedAt: row.requested_at }),
      });
      chains.set(root, chain);
    }
    const sources = yield* attributeLines({
      repo,
      path: repoPath,
      saved,
      contents,
      chains: [...chains.entries()].map(([root, turns]) => ({ own: root === repo, turns })),
    }).pipe(Effect.provide(services), Effect.mapError(gitFailure));

    const used = [...new Set(sources.flatMap((s) => (s.origin === "turn" ? [s.turn] : [])))].sort(
      (a, b) => a - b,
    );
    const index = new Map(used.map((key, position) => [key, position]));
    const turns: IntentBlameTurn[] = [];
    for (const key of used) {
      const row = rows[key]!;
      const absolute = path.join(recordedRoot(row.checkout), repoPath);
      turns.push(yield* describeTurn(row, absolute).pipe(Effect.mapError(queryFailure)));
    }
    const result: IntentBlameResult = {
      spans: toSpans(
        sources.map((source) =>
          source.origin === "turn" ? { origin: "turn", turn: index.get(source.turn)! } : source,
        ),
      ),
      turns,
      changedBy: rows.length,
      missingCheckpoints,
    };
    answers.delete(cacheKey);
    answers.set(cacheKey, { contents, saved, turns: signature, result });
    if (answers.size > CACHED_FILES) answers.delete(answers.keys().next().value!);
    return result;
  });

  const describeTurn = Effect.fn("IntentBlame.describeTurn")(function* (
    row: ChangedRow,
    absolutePath: string,
  ) {
    const [request] =
      row.user_message_id === null
        ? []
        : yield* sql<{ readonly text: string | null }>`
            SELECT json_extract(payload_json, '$.text') AS text
            FROM orchestration_v2_projection_messages
            WHERE message_id = ${row.user_message_id}
          `;
    const said = yield* sql<{
      readonly message_id: string;
      readonly created_at: string;
      readonly text: string | null;
    }>`
      SELECT message_id, created_at, json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages
      WHERE run_id = ${row.run_id} AND role = 'assistant'
      ORDER BY created_at ASC
    `;
    // When the agent first changed this file in the turn, from its own file edits.
    const [firstChange] = yield* sql<{ readonly at: string | null }>`
      SELECT MIN(json_extract(payload_json, '$.startedAt')) AS at
      FROM orchestration_v2_projection_turn_items
      WHERE run_id = ${row.run_id} AND type = 'file_change'
        AND json_extract(payload_json, '$.fileName') = ${absolutePath}
    `;
    const changedAt = firstChange?.at ?? null;
    const before =
      changedAt === null ? undefined : said.findLast((message) => message.created_at <= changedAt);
    const beforeChange = clip(before?.text);
    const last = said.at(-1);
    const closing = clip(last?.text);
    return {
      threadId: ThreadId.make(row.thread_id),
      threadTitle: row.title,
      turnNumber: row.turn_number,
      userMessageId: row.user_message_id === null ? null : MessageId.make(row.user_message_id),
      request: clip(request?.text) ?? "",
      beforeChange,
      beforeChangeMessageId: before && beforeChange ? MessageId.make(before.message_id) : null,
      closing,
      closingMessageId: last && closing ? MessageId.make(last.message_id) : null,
      at: row.captured_at,
      checkout: row.checkout,
    } satisfies IntentBlameTurn;
  });

  return IntentBlame.of({ blame });
});

export const layer = Layer.effect(IntentBlame, make);
