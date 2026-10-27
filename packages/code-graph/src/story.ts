/**
 * A run of commits told as an Atlas Graph thread. The memory is the code at the
 * first commit; each later commit is a turn whose events carry the rest, the
 * way the graph replays a thread over the memory its branch started from.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  Boundaries,
  LensEdge,
  Memory,
  MemoryLink,
  MemoryNote,
  ThreadEvent,
  ThreadRecord,
  ThreadTurn,
} from "./model/graph.ts";

import { commitsBetween, git, revParse, type Commit } from "./git.ts";
import { parseBoundaries } from "./boundaries.ts";
import { advance, buildIndex, timed, type IndexOptions, type IndexState } from "./index/build.ts";
import {
  compareText,
  CONTAINER_KINDS,
  edgeKey,
  isFolder,
  type CodeDelta,
  type CodeEdge,
  type CodeIndex,
  type CodeSymbol,
  type EdgeKind,
} from "./model/code.ts";

/** Every link kind, in the order a turn's links are told. */
export const LINK_KINDS: ReadonlyArray<EdgeKind> = [
  "imports",
  "exports",
  "inherits",
  "implements",
  "overrides",
  "instantiates",
  "calls",
  "references",
  "accepts",
  "returns",
  "throws",
  "catches",
];

const LINK_MEANINGS: Readonly<Record<EdgeKind, string>> = {
  imports: "The source file imports the target file.",
  exports: "The source file exports the target.",
  inherits: "The source inherits from the target.",
  implements: "The source implements the target.",
  overrides: "The source method overrides the target method.",
  instantiates: "The source constructs the target.",
  calls: "The source calls the target.",
  references:
    "The source mentions the target without calling it: a function passed as a value, or a type in its body.",
  accepts: "The source takes the target type as a parameter.",
  returns: "The source gives the target type back.",
  throws: "The source throws, raises, or returns as an error the target type.",
  catches: "The source catches the target error type.",
};

/** Where a story was read from, so a viewer can show its files at each turn's commit. */
export interface StorySource {
  /** The repository's absolute path when the story was generated. */
  readonly repo: string;
  /** The pathspecs the story was restricted to; empty for the whole tree. */
  readonly paths: ReadonlyArray<string>;
}

export interface CodeStory {
  readonly source: StorySource;
  /** The layers the codebase declares at the last commit, when it declares any; see `boundaries.ts`. */
  readonly boundaries?: Boundaries;
  readonly memory: Memory;
  /** Each turn's id is its commit's full sha. */
  readonly thread: ThreadRecord;
  /** Symbols some turn removed and no later turn wrote back. Nothing is emitted for them yet. */
  readonly removed: ReadonlyArray<string>;
}

const depth = (symbol: CodeSymbol) => symbol.path.split("/").length;
/** Folders outermost first, then each file's symbols in source order, the file first. */
const bySource = (left: CodeSymbol, right: CodeSymbol) => {
  const leftFolder = isFolder(left);
  const rightFolder = isFolder(right);
  if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
  if (leftFolder) return depth(left) - depth(right) || compareText(left.path, right.path);
  return (
    compareText(left.path, right.path) ||
    left.range.startLine - right.range.startLine ||
    (left.kind === "file" ? -1 : right.kind === "file" ? 1 : 0) ||
    compareText(left.id, right.id)
  );
};
const byLink = (left: CodeEdge, right: CodeEdge) =>
  LINK_KINDS.indexOf(left.kind) - LINK_KINDS.indexOf(right.kind) ||
  compareText(left.from, right.from) ||
  compareText(left.to, right.to);

/** Source order, except that a symbol whose parent is among them comes after it. */
function parentsFirst(symbols: ReadonlyArray<CodeSymbol>): ReadonlyArray<CodeSymbol> {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const ordered: Array<CodeSymbol> = [];
  const placed = new Set<string>();
  const place = (symbol: CodeSymbol) => {
    if (placed.has(symbol.id)) return;
    placed.add(symbol.id);
    const parent = symbol.parent === undefined ? undefined : byId.get(symbol.parent);
    if (parent !== undefined) place(parent);
    ordered.push(symbol);
  };
  for (const symbol of symbols.toSorted(bySource)) place(symbol);
  return ordered;
}

/** A note's label, layout group, kind, and container, as a note or a write carries them. */
function describe(symbol: CodeSymbol) {
  return {
    name: symbol.name,
    group: symbol.path,
    ...(symbol.parent === undefined ? {} : { parent: symbol.parent }),
    ...lines(symbol),
    ...contract(symbol),
  };
}

/** A definition's or file's lines at this commit, for a code view to scroll to; a folder has none. */
const lines = (symbol: CodeSymbol) => (isFolder(symbol) ? {} : { range: symbol.range });

/** A definition's declaration line and doc, when it has them. */
const contract = (symbol: CodeSymbol) => ({
  ...(symbol.signature === undefined ? {} : { signature: symbol.signature }),
  ...(symbol.doc === undefined ? {} : { doc: symbol.doc }),
});

/**
 * A delta's events in replay order: writes (each after its container), amends, links, unlinks. Folders
 * and files are never amended. Links are per kind and carry the edge's resolution (unlinks the old
 * one); a standing link whose resolution changed is relinked so replays match the index at every
 * checkpoint. Removed symbols emit nothing (memory has no delete); text-unchanged symbols are untouched.
 */
export function turnEvents(delta: CodeDelta): ReadonlyArray<ThreadEvent> {
  const events: Array<ThreadEvent> = [];
  for (const symbol of parentsFirst(delta.added)) {
    events.push({ kind: "write", note: symbol.id, ...describe(symbol), noteKind: symbol.kind });
  }
  for (const { after } of delta.modified.toSorted((left, right) =>
    bySource(left.after, right.after),
  )) {
    if (CONTAINER_KINDS.has(after.kind)) continue;
    events.push({ kind: "amend", note: after.id, ...describe(after), noteKind: after.kind });
  }
  // A standing link re-resolved is linked again with its new resolution, after the new links.
  for (const edge of [
    ...delta.addedEdges.toSorted(byLink),
    ...delta.reresolvedEdges.toSorted(byLink),
  ]) {
    const { from, to, kind, resolution } = edge;
    events.push({ kind: "link", from, to, linkKind: kind, resolution });
  }
  for (const edge of delta.removedEdges.toSorted(byLink)) {
    const { from, to, kind, resolution } = edge;
    events.push({ kind: "unlink", from, to, linkKind: kind, resolution });
  }
  return events;
}

/**
 * A file's area: its first two directories below the root the story was
 * restricted to (`src/model`, `playground`), or `.` for a file at the root.
 */
export function areaOf(path: string, roots: ReadonlyArray<string>): string {
  const root = roots
    .map((spec) => spec.replace(/\/+$/, ""))
    .filter((spec) => spec !== "" && path.startsWith(`${spec}/`))
    .reduce((longest, spec) => (spec.length > longest.length ? spec : longest), "");
  const relative = root === "" ? path : path.slice(root.length + 1);
  const directories = relative.split("/").slice(0, -1);
  return directories.length === 0 ? "." : directories.slice(0, 2).join("/");
}

/**
 * The story's memory: the first commit's folders, files, definitions, red links and links, with two
 * lenses over everything the run ever held: Packages types each parent tie by the note's area;
 * Relationships types every link by kind, for filtering (the graph tints a lens by its slot).
 */
export function storyMemory(
  id: string,
  start: CodeIndex,
  everSymbols: ReadonlyMap<string, CodeSymbol>,
  everEdges: ReadonlyArray<CodeEdge>,
  roots: ReadonlyArray<string>,
): Memory {
  const notes: Array<MemoryNote> = [
    ...parentsFirst(start.symbols).map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      frontier: false,
      group: symbol.path,
      kind: symbol.kind,
      ...contract(symbol),
      ...(symbol.parent === undefined ? {} : { parent: symbol.parent }),
      ...lines(symbol),
    })),
    ...start.frontier.map((symbol) => ({ id: symbol.id, name: symbol.name, frontier: true })),
  ];
  const links: Array<MemoryLink> = start.edges.toSorted(byLink).map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    resolution: edge.resolution,
  }));

  const areas = new Set<string>();
  const areaEdges: Array<LensEdge> = [];
  for (const symbol of parentsFirst([...everSymbols.values()])) {
    if (symbol.parent === undefined) continue;
    const container = isFolder(symbol) ? `${symbol.path}/.` : symbol.path;
    const type = areaOf(container, roots);
    areas.add(type);
    areaEdges.push({ from: symbol.parent, type, to: symbol.id });
  }
  const kinds = new Set(everEdges.map((edge) => edge.kind));
  return {
    id,
    notes,
    links,
    lenses: [
      {
        name: "Packages",
        types: Object.fromEntries(
          [...areas]
            .toSorted(compareText)
            .map((area) => [
              area,
              area === "." ? "Defined at the story's root." : `Defined under ${area}.`,
            ]),
        ),
        edges: areaEdges,
      },
      {
        name: "Relationships",
        types: Object.fromEntries(
          LINK_KINDS.filter((kind) => kinds.has(kind)).map((kind) => [kind, LINK_MEANINGS[kind]]),
        ),
        edges: everEdges
          .toSorted(byLink)
          .map((edge) => ({ from: edge.from, type: edge.kind, to: edge.to })),
      },
    ],
  };
}

export interface StoryOptions extends IndexOptions {
  /** The memory's id; the thread is named after it. */
  readonly id: string;
  readonly title?: string;
  /**
   * A boundaries file on disk to use instead of the one at the last commit. Its
   * layer paths are taken relative to where it sits in its own repository.
   */
  readonly boundariesFile?: string;
}

/**
 * The boundaries the story carries: from `boundariesFile` when given, else
 * from `.atlas/boundaries.json` under the first `--paths` root, or at the
 * repository's root, at `commit`. A file that does not parse is a warning.
 */
async function loadBoundaries(
  repo: string,
  commit: string,
  options: StoryOptions,
): Promise<Boundaries | undefined> {
  let found: { text: string; root: string; where: string } | null = null;
  if (options.boundariesFile !== undefined) {
    // Real paths on both sides: git reports its top level with symlinks resolved.
    const file = NodeFS.realpathSync(NodePath.resolve(options.boundariesFile));
    const top = (await git(NodePath.dirname(file), ["rev-parse", "--show-toplevel"])).trim();
    const relative = NodePath.relative(top, file).split(NodePath.sep).join("/");
    // `<root>/.atlas/boundaries.json`: the layers' paths are relative to `<root>`.
    const root = NodePath.posix.dirname(NodePath.posix.dirname(relative));
    found = {
      text: NodeFS.readFileSync(file, "utf8"),
      root: root === "." ? "" : root,
      where: file,
    };
  } else {
    const roots = [...options.paths.slice(0, 1).map((path) => path.replace(/\/+$/, "")), ""];
    for (const root of roots) {
      const path = `${root === "" ? "" : `${root}/`}.atlas/boundaries.json`;
      const text = await git(repo, ["show", `${commit}:${path}`]).catch(() => null);
      if (text !== null) {
        found = { text, root, where: `${commit.slice(0, 12)}:${path}` };
        break;
      }
    }
  }
  if (found === null) return undefined;
  const parsed = parseBoundaries(found.text, found.root);
  if ("error" in parsed) {
    console.warn(`boundaries in ${found.where} ignored: ${parsed.error}`);
    return undefined;
  }
  return parsed.boundaries;
}

export interface StoryRun {
  readonly story: CodeStory;
  /** The index at the last commit. */
  readonly index: CodeIndex;
  readonly commits: ReadonlyArray<Commit>;
  readonly deltas: ReadonlyArray<CodeDelta>;
  readonly state: IndexState;
}

/**
 * Tell `from..to` (git's meaning: the commits `to` has that `from` lacks,
 * first parents only) as a story. The memory is the tree at `from` itself; when
 * `from` has diverged from `to`, the first turn carries the difference from it.
 */
export async function buildStory(
  repo: string,
  from: string,
  to: string,
  options: StoryOptions,
): Promise<StoryRun> {
  const toCommit = await revParse(repo, to);
  const state = await buildIndex(repo, from, options);
  const commits = await timed(state.timings, "diff", () =>
    commitsBetween(repo, state.commit, toCommit, options.paths),
  );

  const start = state.indexer.snapshot(from, state.commit);
  const everSymbols = new Map(start.symbols.map((symbol) => [symbol.id, symbol]));
  const everEdges = new Map(start.edges.map((edge) => [edgeKey(edge), edge]));
  const removed = new Set<string>();
  const turns: Array<ThreadTurn> = [];
  const deltas: Array<CodeDelta> = [];
  for (const commit of commits) {
    const delta = await advance(state, commit.sha);
    deltas.push(delta);
    for (const symbol of delta.added) {
      everSymbols.set(symbol.id, symbol);
      removed.delete(symbol.id);
    }
    for (const { after } of delta.modified) everSymbols.set(after.id, after);
    for (const symbol of delta.removed) removed.add(symbol.id);
    for (const edge of delta.addedEdges) everEdges.set(edgeKey(edge), edge);
    turns.push({ id: commit.sha, label: commit.subject, events: turnEvents(delta) });
  }

  const index = state.indexer.snapshot(to, state.commit);
  const memory = await timed(state.timings, "story", async () =>
    storyMemory(options.id, start, everSymbols, [...everEdges.values()], options.paths),
  );
  const boundaries = await loadBoundaries(repo, toCommit, options);
  return {
    story: {
      source: { repo, paths: options.paths },
      ...(boundaries === undefined ? {} : { boundaries }),
      memory,
      thread: {
        id: `${options.id}@${toCommit.slice(0, 12)}`,
        title: options.title ?? `${options.id}: ${from}..${to}`,
        memoryId: options.id,
        turns,
      },
      removed: [...removed].toSorted(compareText),
    },
    index,
    commits,
    deltas,
    state,
  };
}
