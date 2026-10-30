/**
 * The questions a checkout's code index answers: the local graph of a file's imports, a file's
 * outline, a name's definitions and uses, what changed between two refs, and how a slice of files
 * hangs together. Each reads stored facts through a `Snapshot` and resolves links as it goes.
 */
import { isIndexable, languageOf } from "@mercurian/code-graph/languages";
import {
  CODE_LOCAL_GRAPH_MAX_DEPTH,
  CodeIndexError,
  type CodeChangeState,
  type CodeChanges,
  type CodeFindResult,
  type CodeGraphLink,
  type CodeGraphNode,
  type CodeLocalGraphInput,
  type CodeMap,
  type CodeOutline,
  type CodeResolution,
  type CodeSymbolEntry,
  type CodeUse,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { View } from "./checkout.ts";
import type { StoredImport, StoredSymbol } from "./facts.ts";
import {
  definitionId,
  resolutionOf,
  resolveReference,
  usesIn,
  type CheckoutModules,
  type Definition,
  type FileView,
} from "./resolve.ts";

/** A checkout's files and the stored facts behind them. */
export interface Snapshot {
  readonly view: View;
  /**
   * Where the asking folder sits in the repository: "" at its top level, `apps/server` for a
   * project there. Facts and links use repository paths; questions take and answer the asker's.
   */
  readonly prefix: string;
  readonly modules: CheckoutModules;
  /** Lines of a file's stored version; null until it is parsed. */
  readonly linesOf: (path: string) => number | null;
  /** Facts of parsed files among `paths`. */
  readonly files: (
    paths: Iterable<string>,
  ) => Effect.Effect<ReadonlyMap<string, FileView>, CodeIndexError>;
  readonly imports: (
    paths: Iterable<string>,
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<StoredImport>>, CodeIndexError>;
  /** The checkout's files defining each name. */
  readonly definers: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<string>>, CodeIndexError>;
  /** The checkout's files referencing or importing a name. */
  readonly users: (name: string) => Effect.Effect<ReadonlyArray<string>, CodeIndexError>;
  /** The checkout's files with an import asking for any of `keys`. */
  readonly askers: (
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, CodeIndexError>;
}

/** A path the asking folder names, as a repository path; null when it leaves the repository. */
export function repositoryPath(prefix: string, path: string): string | null {
  const segments = prefix === "" ? [] : prefix.split("/");
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  return segments.join("/");
}

/** A repository path as the asking folder names it: `../` for what lies outside the folder. */
function askerPath(prefix: string, path: string): string {
  const from = prefix === "" ? [] : prefix.split("/");
  const to = path === "" ? [] : path.split("/");
  let shared = 0;
  while (shared < from.length && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/") || ".";
}

const outsideOf = (path: string) => path === ".." || path.startsWith("../");

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const under = (path: string, folder: string) => folder === "" || path.startsWith(`${folder}/`);

const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|spec|testing)\/|\.(test|spec|browser\.test)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/;
const isTestPath = (path: string) => TEST_PATH.test(path);

/** The files a repository path names in a checkout: the file, or every file under a folder. */
function filesAt(view: View, target: string): ReadonlyArray<string> {
  if (view.files.has(target)) return [target];
  return [...view.files.keys()].filter((file) => under(file, target)).toSorted();
}

const notFound = (message: string) => new CodeIndexError({ reason: "not-found", message });

const entryOf = (path: string, symbol: StoredSymbol): CodeSymbolEntry => ({
  name: symbol.name,
  kind: symbol.kind,
  path,
  line: Math.max(1, symbol.line),
  endLine: Math.max(1, symbol.endLine),
  parent: symbol.parent,
  signature: symbol.signature,
  exported: symbol.exported,
});

/** Several resolutions of one link: the surest wins. */
const surest = (left: CodeResolution, right: CodeResolution): CodeResolution => {
  const rank: Record<CodeResolution, number> = { resolved: 0, exact: 1, overload: 2, heuristic: 3 };
  return rank[left] <= rank[right] ? left : right;
};

// The local graph.

/** Past this many files on one side of a ring, files fold into their folders. */
const FOLD_LIMIT = 40;
/** Files reached per side before the graph stops widening; folding keeps what is drawn small. */
const REACH_LIMIT = 3000;

/** The folders above a path, outermost first: the top level `""`, `a` and `a/b` for `a/b/c`. */
const foldersAbove = (path: string) => {
  const segments = path === "" ? [] : path.split("/");
  return segments.map((_, index) => segments.slice(0, index).join("/"));
};

/**
 * Fold one side of a ring at a single folder level: the finest, `from` or deeper, that leaves at
 * most FOLD_LIMIT nodes (level 0 is the top level, 1 its folders). A folder of one file stays that
 * file; an opened folder shows its files, folded again below it when they are too many.
 */
function foldSide(
  files: ReadonlyArray<string>,
  from: number,
  expanded: ReadonlySet<string>,
  folded: Map<string, string>,
) {
  if (files.length <= FOLD_LIMIT) return;
  const above = files.map(foldersAbove);
  const groupsAt = (level: number) => {
    const groups = new Map<string, Array<string>>();
    let loose = 0;
    for (const [index, file] of files.entries()) {
      const folder = above[index]?.[level];
      const members = folder === undefined ? undefined : groups.get(folder);
      if (folder === undefined) loose += 1;
      else if (members === undefined) groups.set(folder, [file]);
      else members.push(file);
    }
    return { groups, nodes: loose + groups.size };
  };
  let level = from;
  for (const folders of above) level = Math.max(level, folders.length - 1);
  let found = groupsAt(level);
  while (found.nodes > FOLD_LIMIT && level > from) {
    level -= 1;
    found = groupsAt(level);
  }
  for (const [folder, members] of found.groups) {
    if (members.length < 2) continue;
    if (expanded.has(folder)) foldSide(members, level + 1, expanded, folded);
    else for (const member of members) folded.set(member, folder);
  }
}

export interface Changes {
  readonly branch: ReadonlySet<string>;
  readonly uncommitted: ReadonlySet<string>;
}

interface DraftNode {
  readonly id: string;
  readonly kind: CodeGraphNode["kind"];
  readonly name: string;
  readonly path: string | null;
  depth: number;
  readonly side: "uses" | "usedBy" | "center";
}

interface DraftLink {
  readonly from: string;
  readonly to: string;
  readonly line: number | null;
  readonly text: string | null;
  resolution: CodeResolution;
}

export const localGraph = Effect.fn("CodeIndex.localGraph.build")(function* (
  snapshot: Snapshot,
  input: CodeLocalGraphInput,
  changes: Changes,
  usedByPending: boolean,
) {
  const shown = (path: string) => askerPath(snapshot.prefix, path);
  const center = repositoryPath(snapshot.prefix, input.path);
  if (center === null) return yield* notFound(`${input.path} is not in this checkout.`);
  if (!snapshot.view.files.has(center)) {
    if (!isIndexable(center)) {
      return yield* new CodeIndexError({
        reason: "unsupported",
        message: `${shown(center)} is not a file the code index reads.`,
      });
    }
    return yield* notFound(`${shown(center)} is not in this checkout.`);
  }
  const maxDepth = Math.min(input.depth, CODE_LOCAL_GRAPH_MAX_DEPTH);
  const nodes = new Map<string, DraftNode>();
  const links = new Map<string, DraftLink>();
  const addNode = (node: DraftNode) => {
    const existing = nodes.get(node.id);
    if (existing === undefined) {
      nodes.set(node.id, node);
      return true;
    }
    existing.depth = Math.min(existing.depth, node.depth);
    return false;
  };
  const addLink = (link: DraftLink) => {
    if (link.from === link.to) return;
    const key = `${link.from}\u0000${link.to}`;
    const existing = links.get(key);
    if (existing === undefined) links.set(key, link);
    else existing.resolution = surest(existing.resolution, link.resolution);
  };
  addNode({
    id: center,
    kind: "file",
    name: basename(center),
    path: center,
    depth: 0,
    side: "center",
  });

  if (input.uses) {
    let frontier = [center];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const imports = yield* snapshot.imports(frontier);
      const next: Array<string> = [];
      for (const from of frontier) {
        const language = languageOf(from);
        if (language === null) continue;
        for (const binding of imports.get(from) ?? []) {
          const target = snapshot.modules.resolveImport(language, from, binding);
          const at = { line: binding.line, text: binding.text };
          if (target.kind === "files") {
            for (const path of target.paths) {
              const added = addNode({
                id: path,
                kind: "file",
                name: basename(path),
                path,
                depth,
                side: "uses",
              });
              if (added && nodes.size < REACH_LIMIT) next.push(path);
              addLink({ from, to: path, ...at, resolution: resolutionOf(target.paths.length) });
            }
          } else if (target.kind === "package") {
            const found = snapshot.modules.packages.get(target.name);
            addNode({
              id: target.name,
              kind: "package",
              name: target.name,
              path: target.entry ?? target.file ?? found?.manifest ?? null,
              depth,
              side: "uses",
            });
            addLink({ from, to: target.name, ...at, resolution: "exact" });
          } else if (target.kind === "dependency" && input.dependencies) {
            const id = `dependency:${target.name}`;
            addNode({ id, kind: "dependency", name: target.name, path: null, depth, side: "uses" });
            addLink({ from, to: id, ...at, resolution: "exact" });
          }
        }
      }
      frontier = next;
    }
  }

  if (input.usedBy && !usedByPending) {
    let frontier = [center];
    let reached = 0;
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const targets = new Set(frontier);
      const keys = [...new Set(frontier.flatMap((path) => snapshot.modules.keysFor(path)))];
      const candidates = (yield* snapshot.askers(keys)).filter((path) => path !== center);
      const imports = yield* snapshot.imports(candidates);
      const next: Array<string> = [];
      for (const from of candidates) {
        const language = languageOf(from);
        if (language === null) continue;
        for (const binding of imports.get(from) ?? []) {
          const reaches = snapshot.modules.importedFiles(language, from, binding);
          for (const to of reaches) {
            if (!targets.has(to)) continue;
            const added = addNode({
              id: from,
              kind: "file",
              name: basename(from),
              path: from,
              depth,
              side: "usedBy",
            });
            if (added) {
              reached += 1;
              if (reached < REACH_LIMIT) next.push(from);
            }
            const resolution = resolutionOf(reaches.length);
            addLink({ from, to, line: binding.line, text: binding.text, resolution });
          }
        }
      }
      frontier = next;
    }
  }

  // Fold each crowded side of a ring into folders, except the folders the reader opened.
  const expanded = new Set(
    input.expanded.flatMap((folder) => repositoryPath(snapshot.prefix, folder) ?? []),
  );
  const folded = new Map<string, string>();
  const rings = new Map<string, Array<string>>();
  for (const node of nodes.values()) {
    if (node.kind !== "file" || node.side === "center") continue;
    const ring = `${node.side}:${node.depth}`;
    const members = rings.get(ring);
    if (members === undefined) rings.set(ring, [node.id]);
    else members.push(node.id);
  }
  for (const ring of rings.values()) foldSide(ring, 0, expanded, folded);
  // Each ring folds alone, so one may draw a folder inside another's: the outer takes its files.
  const drawn = new Set(folded.values());
  for (const [file, folder] of folded) {
    const outer = foldersAbove(folder).find((above) => drawn.has(above));
    if (outer !== undefined) folded.set(file, outer);
  }
  const foldOf = (id: string) => folded.get(id) ?? id;

  const changedOf = (path: string): CodeChangeState | null =>
    changes.uncommitted.has(path) ? "uncommitted" : changes.branch.has(path) ? "branch" : null;
  // Output ids and paths are the asker's; packages and dependencies keep their names.
  const output = new Map<string, CodeGraphNode>();
  const ids = new Map<string, string>();
  const put = (key: string, node: CodeGraphNode) => {
    ids.set(key, node.id);
    const outside = node.path !== null && outsideOf(node.path);
    output.set(node.id, outside ? { ...node, outsideProject: true } : node);
  };
  const groups = new Map<string, Array<DraftNode>>();
  for (const node of nodes.values()) {
    const folder = folded.get(node.id);
    if (folder !== undefined) {
      groups.set(folder, [...(groups.get(folder) ?? []), node]);
      continue;
    }
    const isFile = node.kind === "file";
    put(node.id, {
      id: isFile ? shown(node.id) : node.id,
      kind: node.kind,
      name: node.name,
      path: node.path === null ? null : shown(node.path),
      depth: node.depth,
      lines: isFile ? snapshot.linesOf(node.id) : null,
      test: isFile && isTestPath(node.id),
      changed: isFile ? changedOf(node.id) : null,
      files: null,
    });
  }
  for (const [folder, members] of groups) {
    const states = members.map((member) => changedOf(member.id));
    put(folder, {
      id: shown(folder),
      kind: "folder",
      name: basename(folder) || ".",
      path: shown(folder),
      depth: Math.min(...members.map((member) => member.depth)),
      lines: null,
      test: members.every((member) => isTestPath(member.id)),
      changed: states.includes("uncommitted")
        ? "uncommitted"
        : states.includes("branch")
          ? "branch"
          : null,
      files: members.length,
    });
  }
  const outputLinks = new Map<string, CodeGraphLink>();
  for (const link of links.values()) {
    const from = foldOf(link.from);
    const to = foldOf(link.to);
    if (from === to) continue;
    const grouped = from !== link.from || to !== link.to;
    const key = `${from}\u0000${to}`;
    const existing = outputLinks.get(key);
    outputLinks.set(key, {
      from: ids.get(from) ?? from,
      to: ids.get(to) ?? to,
      line: grouped ? null : link.line,
      text: grouped ? null : link.text,
      resolution:
        existing === undefined ? link.resolution : surest(existing.resolution, link.resolution),
    });
  }
  return {
    center: shown(center),
    nodes: [...output.values()].toSorted(
      (left, right) => left.depth - right.depth || (left.id < right.id ? -1 : 1),
    ),
    links: [...outputLinks.values()].toSorted((left, right) =>
      left.from === right.from ? (left.to < right.to ? -1 : 1) : left.from < right.from ? -1 : 1,
    ),
  };
});

// Outline.

const OUTLINE_FILES = 100;
const OUTLINE_SYMBOLS = 2000;

export const outline = Effect.fn("CodeIndex.outline.build")(function* (
  snapshot: Snapshot,
  path: string,
) {
  const target = repositoryPath(snapshot.prefix, path);
  const paths = target === null ? [] : filesAt(snapshot.view, target);
  if (paths.length === 0) {
    const named = target === null ? path : askerPath(snapshot.prefix, target);
    return yield* notFound(`${named} is not in this checkout.`);
  }
  const kept = paths.slice(0, OUTLINE_FILES);
  const facts = yield* snapshot.files(kept);
  let symbols = 0;
  let truncated = kept.length < paths.length;
  const files: Array<CodeOutline["files"][number]> = [];
  for (const file of kept) {
    const stored = facts.get(file)?.facts.symbols ?? [];
    const room = Math.max(0, OUTLINE_SYMBOLS - symbols);
    if (stored.length > room) truncated = true;
    const taken = stored.slice(0, room);
    symbols += taken.length;
    const shown = askerPath(snapshot.prefix, file);
    files.push({
      path: shown,
      lines: snapshot.linesOf(file) ?? 0,
      symbols: taken.map((symbol) => entryOf(shown, symbol)),
    });
  }
  return { files, truncated } satisfies CodeOutline;
});

// Find.

const FIND_DEFINITIONS = 50;
const FIND_USER_FILES = 300;
const FIND_USES = 300;

/** Every definition of each name in the checkout. */
const definitionsOf = Effect.fn("CodeIndex.definitionsOf")(function* (
  snapshot: Snapshot,
  names: ReadonlyArray<string>,
  /** Names defined in more files than this resolve to nothing: they would be guesses. */
  maxFiles = Number.POSITIVE_INFINITY,
) {
  const definers = yield* snapshot.definers(names);
  const wanted = new Set<string>();
  for (const paths of definers.values()) {
    if (paths.length <= maxFiles) for (const path of paths) wanted.add(path);
  }
  const files = yield* snapshot.files(wanted);
  const byName = new Map<string, Array<Definition>>();
  for (const name of names) {
    const paths = definers.get(name) ?? [];
    if (paths.length > maxFiles) continue;
    const list: Array<Definition> = [];
    for (const path of paths) {
      for (const symbol of files.get(path)?.facts.symbols ?? []) {
        if (symbol.name === name) list.push({ path, symbol });
      }
    }
    byName.set(name, list);
  }
  return byName;
});

export const find = Effect.fn("CodeIndex.find.build")(function* (
  snapshot: Snapshot,
  name: string,
  path: string | undefined,
) {
  const shown = (file: string) => askerPath(snapshot.prefix, file);
  const all = (yield* definitionsOf(snapshot, [name])).get(name) ?? [];
  const scope = path === undefined ? "" : repositoryPath(snapshot.prefix, path);
  const definitions = all.filter(
    (definition) => scope !== null && (definition.path === scope || under(definition.path, scope)),
  );
  if (definitions.length === 0) {
    const where = path === undefined ? "" : ` in ${scope === null ? path : shown(scope)}`;
    return yield* notFound(`Nothing named ${name} is defined${where} in this checkout.`);
  }
  const wanted = new Set(definitions.map(definitionId));
  const users = yield* snapshot.users(name);
  const keptUsers = users.slice(0, FIND_USER_FILES);
  const files = yield* snapshot.files(keptUsers);
  const uses: Array<CodeUse> = [];
  for (const user of keptUsers) {
    const file = files.get(user);
    if (file === undefined) continue;
    for (const use of usesIn(snapshot.modules, file, name, all)) {
      if (!use.targets.some((target) => wanted.has(definitionId(target)))) continue;
      uses.push({
        path: shown(user),
        line: use.line,
        from: use.from,
        kind: use.kind,
        resolution: use.resolution,
      });
    }
  }
  return {
    definitions: definitions
      .slice(0, FIND_DEFINITIONS)
      .map((definition) => entryOf(shown(definition.path), definition.symbol)),
    uses: uses.slice(0, FIND_USES),
    truncated:
      definitions.length > FIND_DEFINITIONS ||
      users.length > FIND_USER_FILES ||
      uses.length > FIND_USES,
  } satisfies CodeFindResult;
});

// Changes.

const CHANGED_FILES = 300;
const CHANGED_ENTRIES = 300;
/** A name defined in more files than this is too common to say which one a link meant. */
const LINK_NAME_FILES = 25;

/** The links a file's references make, as `from → to` keys. */
const linksOf = Effect.fn("CodeIndex.linksOf")(function* (
  snapshot: Snapshot,
  paths: ReadonlyArray<string>,
) {
  const files = yield* snapshot.files(paths);
  const names = [
    ...new Set(
      [...files.values()].flatMap((file) =>
        file.facts.references.map((reference) => reference.name),
      ),
    ),
  ];
  const byName = yield* definitionsOf(snapshot, names, LINK_NAME_FILES);
  const shown = (path: string) => askerPath(snapshot.prefix, path);
  const made = new Map<string, CodeChanges["links"][number]>();
  for (const file of files.values()) {
    for (const reference of file.facts.references) {
      const landed = resolveReference(
        snapshot.modules,
        file,
        reference,
        byName.get(reference.name) ?? [],
      );
      if (landed === null) continue;
      const from = `${shown(file.path)}${reference.from === null ? "" : `#${reference.from}`}`;
      for (const target of landed.targets) {
        const to = `${shown(target.path)}#${target.symbol.qualified}`;
        const kind = reference.kind;
        const link = {
          change: "made" as const,
          from,
          to,
          kind:
            kind === "values"
              ? ("calls" as const)
              : kind === "accepts" || kind === "returns" || kind === "throws" || kind === "catches"
                ? ("types" as const)
                : kind,
          resolution: landed.resolution,
        };
        made.set(`${from}\u0000${to}\u0000${link.kind}`, link);
      }
    }
  }
  return made;
});

export const changes = Effect.fn("CodeIndex.changes.build")(function* (
  before: Snapshot,
  after: Snapshot,
) {
  const shown = (path: string) => askerPath(after.prefix, path);
  const files: Array<CodeChanges["files"][number]> = [];
  for (const [path, blob] of after.view.files) {
    const prior = before.view.files.get(path);
    if (prior === undefined) files.push({ path, change: "added" });
    else if (prior !== blob) files.push({ path, change: "modified" });
  }
  for (const path of before.view.files.keys()) {
    if (!after.view.files.has(path)) files.push({ path, change: "deleted" });
  }
  files.sort((left, right) => (left.path < right.path ? -1 : 1));
  const studied = files.slice(0, CHANGED_FILES).map((file) => file.path);
  const [old, now] = yield* Effect.all([before.files(studied), after.files(studied)]);

  const symbols: Array<CodeChanges["symbols"][number]> = [];
  for (const path of studied) {
    const was = new Map(
      (old.get(path)?.facts.symbols ?? []).map((symbol) => [symbol.qualified, symbol]),
    );
    const is = new Map(
      (now.get(path)?.facts.symbols ?? []).map((symbol) => [symbol.qualified, symbol]),
    );
    for (const [qualified, symbol] of is) {
      const prior = was.get(qualified);
      if (prior === undefined) {
        symbols.push({ change: "added", symbol: entryOf(shown(path), symbol) });
      } else if (prior.hash !== symbol.hash) {
        symbols.push({ change: "changed", symbol: entryOf(shown(path), symbol) });
      }
    }
    for (const [qualified, symbol] of was) {
      if (!is.has(qualified)) {
        symbols.push({ change: "removed", symbol: entryOf(shown(path), symbol) });
      }
    }
  }

  const [linksBefore, linksAfter] = yield* Effect.all([
    linksOf(
      before,
      studied.filter((path) => before.view.files.has(path)),
    ),
    linksOf(
      after,
      studied.filter((path) => after.view.files.has(path)),
    ),
  ]);
  const links: Array<CodeChanges["links"][number]> = [];
  for (const [key, link] of linksAfter) if (!linksBefore.has(key)) links.push(link);
  for (const [key, link] of linksBefore) {
    if (!linksAfter.has(key)) links.push({ ...link, change: "broken" });
  }
  return {
    files: files.slice(0, CHANGED_ENTRIES).map((file) => ({ ...file, path: shown(file.path) })),
    symbols: symbols.slice(0, CHANGED_ENTRIES),
    links: links.slice(0, CHANGED_ENTRIES),
    truncated:
      files.length > CHANGED_FILES ||
      symbols.length > CHANGED_ENTRIES ||
      links.length > CHANGED_ENTRIES,
  } satisfies CodeChanges;
});

// Map.

const MAP_FILES = 150;
const MAP_OUTSIDE = 100;

export const map = Effect.fn("CodeIndex.map.build")(function* (
  snapshot: Snapshot,
  paths: ReadonlyArray<string>,
) {
  const shown = (path: string) => askerPath(snapshot.prefix, path);
  const all = [
    ...new Set(
      paths.flatMap((path) => {
        const target = repositoryPath(snapshot.prefix, path);
        return target === null ? [] : filesAt(snapshot.view, target);
      }),
    ),
  ].toSorted();
  if (all.length === 0) return yield* notFound("None of those paths are in this checkout.");
  const slice = all.slice(0, MAP_FILES);
  const inSlice = new Set(slice);
  const facts = yield* snapshot.files(slice);
  const links = new Map<
    string,
    { from: string; to: string; names: Set<string>; resolution: CodeResolution }
  >();
  const outside = new Map<string, { path: string; direction: "uses" | "usedBy"; links: number }>();
  const countOutside = (path: string, direction: "uses" | "usedBy") => {
    const key = `${direction}\u0000${path}`;
    const entry = outside.get(key) ?? { path, direction, links: 0 };
    entry.links += 1;
    outside.set(key, entry);
  };
  for (const from of slice) {
    const file = facts.get(from);
    if (file === undefined) continue;
    const seenOutside = new Set<string>();
    for (const binding of file.imports) {
      const targets = snapshot.modules.importedFiles(file.language, from, binding);
      for (const to of targets) {
        if (to === from) continue;
        if (!inSlice.has(to)) {
          if (!seenOutside.has(to)) countOutside(to, "uses");
          seenOutside.add(to);
          continue;
        }
        const key = `${from}\u0000${to}`;
        const link = links.get(key) ?? {
          from,
          to,
          names: new Set<string>(),
          resolution: resolutionOf(targets.length),
        };
        if (binding.kind === "named" && binding.imported !== null) link.names.add(binding.imported);
        if (binding.kind === "namespace") link.names.add("*");
        links.set(key, link);
      }
    }
  }
  const keys = [...new Set(slice.flatMap((path) => snapshot.modules.keysFor(path)))];
  const importers = (yield* snapshot.askers(keys)).filter((path) => !inSlice.has(path));
  const importerImports = yield* snapshot.imports(importers);
  for (const from of importers) {
    const language = languageOf(from);
    if (language === null) continue;
    const reached = new Set<string>();
    for (const binding of importerImports.get(from) ?? []) {
      for (const to of snapshot.modules.importedFiles(language, from, binding)) {
        if (inSlice.has(to)) reached.add(to);
      }
    }
    for (let count = 0; count < reached.size; count += 1) countOutside(from, "usedBy");
  }
  const outsideList = [...outside.values()].toSorted(
    (left, right) => right.links - left.links || (left.path < right.path ? -1 : 1),
  );
  return {
    files: slice.map((path) => ({
      path: shown(path),
      lines: snapshot.linesOf(path) ?? 0,
      exports: [
        ...new Set(
          (facts.get(path)?.facts.symbols ?? [])
            .filter((symbol) => symbol.exported && symbol.parent === null)
            .map((symbol) => symbol.name),
        ),
      ],
    })),
    links: [...links.values()].map((link) => ({
      from: shown(link.from),
      to: shown(link.to),
      names: [...link.names].toSorted(),
      resolution: link.resolution,
    })),
    outside: outsideList
      .slice(0, MAP_OUTSIDE)
      .map((entry) => ({ ...entry, path: shown(entry.path) })),
    truncated: all.length > MAP_FILES || outsideList.length > MAP_OUTSIDE,
  } satisfies CodeMap;
});
