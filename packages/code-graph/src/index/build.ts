/**
 * Build a tree's index from git, and move it to another tree by parsing only
 * the files that differ.
 */
import { blobSizes, diffPaths, listTree, readBlobs, revParse } from "../git.ts";
import { edgeKey, type CodeDelta, type CodeEdge, type CodeSymbol } from "../model/code.ts";
import {
  extractFile,
  newExtractStats,
  type ExtractStats,
  type FileFacts,
} from "../parse/extract.ts";
import { isIndexable, languageOf, looksGenerated } from "../parse/languages.ts";
import { CodeIndexer } from "./indexer.ts";

export interface IndexOptions {
  /** Pathspecs the index is restricted to; empty for the whole tree. */
  readonly paths: ReadonlyArray<string>;
  /** Files larger than this are skipped. */
  readonly maxBytes: number;
}

export const DEFAULT_MAX_BYTES = 512 * 1024;

/** Milliseconds per phase, summed across calls. */
export type Timings = Record<string, number>;

export async function timed<T>(timings: Timings, phase: string, run: () => Promise<T>) {
  const start = performance.now();
  try {
    return await run();
  } finally {
    timings[phase] = (timings[phase] ?? 0) + (performance.now() - start);
  }
}

export interface IndexState {
  readonly repo: string;
  readonly options: IndexOptions;
  readonly indexer: CodeIndexer;
  /** The commit the index describes. */
  commit: string;
  readonly stats: ExtractStats;
  readonly timings: Timings;
}

/**
 * Whether a regular file is indexed, the same test for a full index and a
 * delta: a supported, non-vendored path no larger than `maxBytes` bytes.
 */
const eligible = (options: IndexOptions, path: string, bytes: number) =>
  isIndexable(path) && bytes <= options.maxBytes;

/** Read the blobs and parse them; generated files are skipped once their text is known. */
async function readAndParse(
  state: IndexState,
  files: ReadonlyArray<{ readonly path: string; readonly sha: string; readonly size: number }>,
): Promise<ReadonlyArray<FileFacts>> {
  const texts = await timed(state.timings, "read", () => readBlobs(state.repo, files));
  return await timed(state.timings, "parse", async () => {
    const facts: Array<FileFacts> = [];
    for (const [index, { path }] of files.entries()) {
      const language = languageOf(path);
      const text = texts[index];
      if (language === null || text === undefined || looksGenerated(text)) continue;
      facts.push(await extractFile(path, language, text, state.stats));
    }
    return facts;
  });
}

/** Index one tree. The only step whose cost grows with the repository. */
export async function buildIndex(
  repo: string,
  ref: string,
  options: IndexOptions,
): Promise<IndexState> {
  const timings: Timings = {};
  const commit = await revParse(repo, ref);
  const state: IndexState = {
    repo,
    options,
    indexer: new CodeIndexer(options.paths),
    commit,
    stats: newExtractStats(),
    timings,
  };
  const entries = await timed(timings, "list", () => listTree(repo, commit, options.paths));
  const facts = await readAndParse(
    state,
    entries.filter((entry) => eligible(options, entry.path, entry.size)),
  );
  await timed(timings, "resolve", async () => {
    for (const file of facts) state.indexer.put(file);
    state.indexer.resolve(state.indexer.facts.keys());
  });
  return state;
}

function diffSymbols(before: ReadonlyArray<FileFacts>, after: ReadonlyArray<FileFacts>) {
  const old = new Map(
    before.flatMap((facts) => facts.symbols).map((symbol) => [symbol.id, symbol]),
  );
  const now = new Map(after.flatMap((facts) => facts.symbols).map((symbol) => [symbol.id, symbol]));
  const added: Array<CodeSymbol> = [];
  const modified: Array<{ before: CodeSymbol; after: CodeSymbol }> = [];
  for (const [id, symbol] of now) {
    const prior = old.get(id);
    if (prior === undefined) added.push(symbol);
    else if (prior.hash !== symbol.hash) modified.push({ before: prior, after: symbol });
  }
  const removed = [...old.values()].filter((symbol) => !now.has(symbol.id));
  return { added, removed, modified };
}

function diffEdges(before: ReadonlyArray<CodeEdge>, after: ReadonlyArray<CodeEdge>) {
  const old = new Map(before.map((edge) => [edgeKey(edge), edge]));
  const now = new Map(after.map((edge) => [edgeKey(edge), edge]));
  return {
    addedEdges: [...now].filter(([key]) => !old.has(key)).map(([, edge]) => edge),
    removedEdges: [...old].filter(([key]) => !now.has(key)).map(([, edge]) => edge),
    reresolvedEdges: [...now]
      .filter(([key, edge]) => {
        const prior = old.get(key);
        return prior !== undefined && prior.resolution !== edge.resolution;
      })
      .map(([, edge]) => edge),
  };
}

/**
 * Move the index to `toRef` and say what changed. Parses the changed files at
 * `toRef` only (their `fromRef` facts are already held); re-resolves the
 * changed files and the files whose references or imports they could move.
 */
export async function advance(state: IndexState, toRef: string): Promise<CodeDelta> {
  const { repo, options, indexer, timings } = state;
  const fromCommit = state.commit;
  const toCommit = await revParse(repo, toRef);
  const changed = (
    await timed(timings, "diff", () => diffPaths(repo, fromCommit, toCommit, options.paths))
  ).filter((change) => isIndexable(change.path));
  // A path that is no longer a regular file, or grew past the limit, is gone from the index.
  const present = changed.flatMap((change) =>
    change.sha === null ? [] : [{ path: change.path, sha: change.sha }],
  );
  const sizes = await timed(timings, "read", () =>
    blobSizes(
      repo,
      present.map((change) => change.sha),
    ),
  );
  const after = await readAndParse(
    state,
    present
      .map((change, index) => ({ ...change, size: sizes[index] ?? Number.POSITIVE_INFINITY }))
      .filter((change) => eligible(options, change.path, change.size)),
  );
  return await timed(timings, "resolve", async () => {
    const paths = changed.map((change) => change.path);
    const before = paths.flatMap((path) => {
      const facts = indexer.facts.get(path);
      return facts === undefined ? [] : [facts];
    });
    // Replacing a file's facts forgets its edges, so take the changed files' edges first.
    const edgesBefore = paths.flatMap((path) => [...indexer.edgesOf(path)]);
    const foldersBefore = indexer.folders.around(paths);
    for (const path of paths) indexer.drop(path);
    for (const facts of after) indexer.put(facts);
    const foldersAfter = indexer.folders.around(paths);
    const affected = indexer.affectedBy(
      after.map((facts) => facts.path),
      before,
    );
    const { before: resolvedBefore, after: resolvedAfter } = indexer.resolve(affected);
    state.commit = toCommit;
    const symbols = diffSymbols(before, after);
    const folderIds = new Set(foldersBefore.map((folder) => folder.id));
    const newFolderIds = new Set(foldersAfter.map((folder) => folder.id));
    return {
      fromRef: fromCommit,
      toRef: toCommit,
      changedPaths: paths,
      // Folders come and go with the files under them; files take their folder now.
      added: [
        ...foldersAfter.filter((folder) => !folderIds.has(folder.id)),
        ...symbols.added.map((symbol) => indexer.placed(symbol)),
      ],
      removed: [
        ...foldersBefore.filter((folder) => !newFolderIds.has(folder.id)),
        ...symbols.removed,
      ],
      modified: symbols.modified.map(({ before: prior, after: now }) => ({
        before: prior,
        after: indexer.placed(now),
      })),
      ...diffEdges([...edgesBefore, ...resolvedBefore], resolvedAfter),
    };
  });
}
