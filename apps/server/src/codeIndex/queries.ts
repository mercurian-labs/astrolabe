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
  type CodeGraphCluster,
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
  dirname,
  Modules,
  moduleId,
  parseNodeId,
  symbolId,
  symbolTree,
  type SymbolTree,
} from "./levels.ts";
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
  id: symbolId(path, symbol.qualified),
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

/** Past this many nodes on one side of a ring, files fold into their folders. */
const FOLD_LIMIT = 40;
/** Files reached per side before the graph stops widening; folding keeps what is drawn small. */
const REACH_LIMIT = 3000;
/** Past this many files, links between files of the same ring are not looked for. */
const SIBLING_LINK_FILES = 1500;
/** A folder named as a root stands for at most this many of its files. */
const ROOT_FILES = 500;
/** An open file shows at most this many definitions, an open definition this many members. */
const SYMBOL_LIMIT = 60;

/** The folders above a path, outermost first: the top level `""`, `a` and `a/b` for `a/b/c`. */
const foldersAbove = (path: string) => {
  const segments = path === "" ? [] : path.split("/");
  return segments.map((_, index) => segments.slice(0, index).join("/"));
};

/**
 * Fold one side of a ring (files, or folders at the directory level) at the finest folder level,
 * `from` or deeper, that leaves at most FOLD_LIMIT nodes. An opened folder shows its paths, folded
 * again below it when too many, and `opened` says which opened folder each came out of.
 */
function foldSide(
  paths: ReadonlyArray<string>,
  from: number,
  expanded: ReadonlySet<string>,
  folded: Map<string, string>,
  opened: Map<string, string>,
) {
  if (paths.length <= FOLD_LIMIT) return;
  const above = paths.map(foldersAbove);
  const groupsAt = (level: number) => {
    const groups = new Map<string, Array<string>>();
    let loose = 0;
    for (const [index, path] of paths.entries()) {
      const folder = above[index]?.[level];
      const members = folder === undefined ? undefined : groups.get(folder);
      if (folder === undefined) loose += 1;
      else if (members === undefined) groups.set(folder, [path]);
      else members.push(path);
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
    if (expanded.has(folder)) {
      for (const member of members) opened.set(member, folder);
      foldSide(members, level + 1, expanded, folded, opened);
    } else for (const member of members) folded.set(member, folder);
  }
}

export interface Changes {
  readonly branch: ReadonlySet<string>;
  readonly uncommitted: ReadonlySet<string>;
}

interface DraftNode {
  readonly id: string;
  readonly kind: "file" | "package" | "dependency";
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

/** A use between two definitions (or a file's top level, `null`), found from stored references. */
interface DraftUse {
  readonly fromFile: string;
  readonly fromQualified: string | null;
  readonly toFile: string;
  readonly toQualified: string;
  readonly line: number | null;
  readonly resolution: CodeResolution;
}

/** What a file shows as, before it opens: itself, its folder, or its module. */
interface Unit {
  readonly key: string;
  readonly kind: "file" | "folder" | "module";
  readonly name: string;
  /** The file or folder; a module's folder. */
  readonly path: string;
  readonly files: Array<string>;
  depth: number;
  side: DraftNode["side"];
}

export const localGraph = Effect.fn("CodeIndex.localGraph.build")(function* (
  snapshot: Snapshot,
  input: CodeLocalGraphInput,
  changes: Changes,
  usedByPending: boolean,
) {
  const { view, prefix } = snapshot;
  const shown = (path: string) => askerPath(prefix, path);
  /** An id the asker wrote, as the repository names it; null when it leaves the repository. */
  const fromAsker = (id: string): string | null => {
    const ref = parseNodeId(id);
    if (ref.kind === "module") {
      const folder = repositoryPath(prefix, ref.folder);
      return folder === null ? null : moduleId(folder);
    }
    const path = repositoryPath(prefix, ref.path);
    if (path === null) return null;
    return ref.kind === "symbol" ? symbolId(path, ref.qualified) : path;
  };
  /** A repository id as the asker names it; packages and dependencies keep their names. */
  const toAsker = (id: string, kind: CodeGraphNode["kind"] | CodeGraphCluster["kind"]): string => {
    if (kind === "package" || kind === "dependency") return id;
    const ref = parseNodeId(id);
    if (ref.kind === "module") return moduleId(shown(ref.folder));
    return ref.kind === "symbol" ? symbolId(shown(ref.path), ref.qualified) : shown(ref.path);
  };

  // The roots: files, the files of a folder, and definitions (whose files the graph grows from).
  const rootFiles = new Set<string>();
  /** Files named whole, directly or by their folder: open, they show every definition. */
  const namedFiles = new Set<string>();
  const rootSymbols = new Map<string, Set<string>>();
  const unknown: Array<string> = [];
  for (const root of input.roots) {
    const ref = parseNodeId(root);
    const path = ref.kind === "module" ? null : repositoryPath(prefix, ref.path);
    if (path === null || ref.kind === "module") {
      unknown.push(root);
    } else if (view.files.has(path)) {
      rootFiles.add(path);
      if (ref.kind === "symbol") {
        rootSymbols.set(path, (rootSymbols.get(path) ?? new Set()).add(ref.qualified));
      } else namedFiles.add(path);
    } else if (ref.kind === "path" && filesAt(view, path).length > 0) {
      for (const file of filesAt(view, path).slice(0, ROOT_FILES)) {
        rootFiles.add(file);
        namedFiles.add(file);
      }
    } else unknown.push(root);
  }
  // A definition the file does not hold is unknown; a file left with none is no root.
  const rootFacts = yield* snapshot.files(rootSymbols.keys());
  for (const [file, wanted] of rootSymbols) {
    const held = new Set((rootFacts.get(file)?.facts.symbols ?? []).map((each) => each.qualified));
    for (const qualified of wanted) {
      if (held.has(qualified)) continue;
      wanted.delete(qualified);
      unknown.push(symbolId(shown(file), qualified));
    }
    if (wanted.size === 0 && !namedFiles.has(file)) rootFiles.delete(file);
  }
  if (rootFiles.size === 0) {
    const [first] = input.roots;
    const ref = parseNodeId(first);
    const path = ref.kind === "module" ? null : repositoryPath(prefix, ref.path);
    if (input.roots.length === 1 && path !== null && ref.kind === "path" && !isIndexable(path)) {
      if (filesAt(view, path).length === 0 && !view.files.has(path)) {
        return yield* new CodeIndexError({
          reason: "unsupported",
          message: `${shown(path)} is not a file the code index reads.`,
        });
      }
    }
    return yield* notFound(
      input.roots.length === 1
        ? `${path === null ? first : shown(path)} is not in this checkout.`
        : "None of those are in this checkout.",
    );
  }

  // Reach files through imports, as far as the depth says, from every root at once.
  const maxDepth = Math.min(Math.max(1, input.depth), CODE_LOCAL_GRAPH_MAX_DEPTH);
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
  for (const file of rootFiles) {
    addNode({ id: file, kind: "file", name: basename(file), path: file, depth: 0, side: "center" });
  }

  if (input.uses || input.depth === 0) {
    let frontier = [...rootFiles];
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

  if (input.usedBy && input.depth > 0 && !usedByPending) {
    let frontier = [...rootFiles];
    let reached = 0;
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const targets = new Set(frontier);
      const keys = [...new Set(frontier.flatMap((path) => snapshot.modules.keysFor(path)))];
      const candidates = (yield* snapshot.askers(keys)).filter((path) => !rootFiles.has(path));
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

  // Links between the files reached, as Obsidian draws every link among what it shows.
  const reachedFiles = [...nodes.values()].filter((node) => node.kind === "file");
  if (input.depth > 0 && reachedFiles.length <= SIBLING_LINK_FILES) {
    const imports = yield* snapshot.imports(reachedFiles.map((node) => node.id));
    for (const { id: from } of reachedFiles) {
      const language = languageOf(from);
      if (language === null) continue;
      for (const binding of imports.get(from) ?? []) {
        const reaches = snapshot.modules.importedFiles(language, from, binding);
        for (const to of reaches) {
          if (nodes.get(to)?.kind !== "file") continue;
          const resolution = resolutionOf(reaches.length);
          addLink({ from, to, line: binding.line, text: binding.text, resolution });
        }
      }
    }
  }

  // Depth 0 keeps the roots and the links between them.
  if (input.depth === 0) {
    for (const id of nodes.keys()) if (!rootFiles.has(id)) nodes.delete(id);
    for (const [key, link] of links) {
      if (!nodes.has(link.from) || !nodes.has(link.to)) links.delete(key);
    }
  }

  // Each file's unit at the level: a closed folder or module above it, else what the level says.
  const level = input.level;
  const expanded = new Set(input.expanded.flatMap((id) => fromAsker(id) ?? []));
  const collapsed = new Set(input.collapsed.flatMap((id) => fromAsker(id) ?? []));
  const modules = new Modules(view.files, snapshot.modules.packages);
  const moduleOfFile = (file: string) => {
    const language = languageOf(file);
    return language === null ? null : modules.of(file, language);
  };
  const files = [...nodes.values()].filter((node) => node.kind === "file");
  const units = new Map<string, Unit>();
  const unitOfFile = new Map<string, string>();
  const place = (file: DraftNode, kind: Unit["kind"], key: string, name: string, path: string) => {
    const unit = units.get(key) ?? {
      key,
      kind,
      name,
      path,
      files: [],
      depth: file.depth,
      side: file.side,
    };
    unit.files.push(file.id);
    unit.depth = Math.min(unit.depth, file.depth);
    if (file.side === "center") unit.side = "center";
    units.set(key, unit);
    unitOfFile.set(file.id, key);
  };
  for (const file of files) {
    const closedFolder = foldersAbove(file.id).find((folder) => collapsed.has(folder));
    const module = moduleOfFile(file.id);
    if (closedFolder !== undefined) {
      place(file, "folder", closedFolder, basename(closedFolder), closedFolder);
    } else if (module !== null && collapsed.has(module.id)) {
      place(file, "module", module.id, module.name, module.folder);
    } else if (level === "directory" && !expanded.has(dirname(file.id))) {
      const folder = dirname(file.id);
      place(file, "folder", folder, basename(folder), folder);
    } else if (level === "module" && module !== null && !expanded.has(module.id)) {
      place(file, "module", module.id, module.name, module.folder);
    } else place(file, "file", file.id, file.name, file.id);
  }

  // Fold each crowded side of a ring into folders, except the folders the reader opened.
  const folded = new Map<string, string>();
  const opened = new Map<string, string>();
  const rings = new Map<string, Array<string>>();
  for (const unit of units.values()) {
    if (unit.kind === "module" || unit.side === "center") continue;
    const ring = `${unit.side}:${unit.depth}`;
    rings.set(ring, [...(rings.get(ring) ?? []), unit.key]);
  }
  for (const ring of rings.values()) foldSide(ring, 0, expanded, folded, opened);
  // Each ring folds alone, so one may draw a folder inside another's: the outer takes its paths.
  const drawn = new Set(folded.values());
  for (const [path, folder] of folded) {
    const outer = foldersAbove(folder).find((above) => drawn.has(above));
    if (outer !== undefined) folded.set(path, outer);
  }
  for (const [key, folder] of folded) {
    const unit = units.get(key);
    if (unit === undefined) continue;
    units.delete(key);
    const group = units.get(folder) ?? {
      key: folder,
      kind: "folder" as const,
      name: basename(folder),
      path: folder,
      files: [],
      depth: unit.depth,
      side: unit.side,
    };
    group.files.push(...unit.files);
    group.depth = Math.min(group.depth, unit.depth);
    units.set(folder, group);
    for (const file of unit.files) unitOfFile.set(file, folder);
  }

  // Open clusters: folders and modules the reader opened, files and definitions opened in place.
  const openFolders = new Set(opened.values());
  if (level === "directory") {
    for (const unit of units.values()) {
      if (unit.kind === "file" && expanded.has(dirname(unit.key)))
        openFolders.add(dirname(unit.key));
    }
  }
  const folderAbove = (path: string) =>
    foldersAbove(path)
      .toReversed()
      .find((folder) => openFolders.has(folder)) ?? null;
  const unitParent = (unit: Unit): string | null => {
    if (unit.kind === "module") return null;
    const module = unit.kind === "file" ? moduleOfFile(unit.key) : null;
    if (level === "module" && module !== null && expanded.has(module.id)) return module.id;
    return folderAbove(unit.path);
  };
  const openFiles = new Set(
    [...units.values()]
      .filter(
        (unit) =>
          unit.kind === "file" &&
          !collapsed.has(unit.key) &&
          (expanded.has(unit.key) || level === "symbol" || level === "member"),
      )
      .map((unit) => unit.key),
  );

  // Uses between definitions, where an end is in an open file.
  const uses: Array<DraftUse> = [];
  const trees = new Map<string, SymbolTree>();
  if (openFiles.size > 0) {
    const userFiles = new Set(openFiles);
    for (const link of links.values()) {
      if (openFiles.has(link.to) && nodes.get(link.from)?.kind === "file") userFiles.add(link.from);
    }
    const facts = yield* snapshot.files(userFiles);
    for (const file of openFiles) {
      const view = facts.get(file);
      if (view === undefined) openFiles.delete(file);
      else trees.set(file, symbolTree(view.facts.symbols));
    }
    const names = [
      ...new Set(
        [...facts.values()].flatMap((file) =>
          file.facts.references.map((reference) => reference.name),
        ),
      ),
    ];
    const byName = yield* definitionsOf(snapshot, names, LINK_NAME_FILES);
    for (const file of facts.values()) {
      for (const reference of file.facts.references) {
        const landed = resolveReference(
          snapshot.modules,
          file,
          reference,
          byName.get(reference.name) ?? [],
        );
        if (landed === null) continue;
        for (const target of landed.targets) {
          if (nodes.get(target.path)?.kind !== "file") continue;
          if (!openFiles.has(file.path) && !openFiles.has(target.path)) continue;
          uses.push({
            fromFile: file.path,
            fromQualified: reference.from,
            toFile: target.path,
            toQualified: target.symbol.qualified,
            line: reference.lines[0] ?? null,
            resolution: landed.resolution,
          });
        }
      }
    }
  }

  // An open file named whole shows every definition; one open by the level, those it links by.
  const shownTop = new Map<string, Set<string>>();
  const linkedTop = (file: string, qualified: string | null) => {
    const owner = qualified === null ? null : (trees.get(file)?.ownerOf(qualified) ?? null);
    if (owner !== null) shownTop.set(file, (shownTop.get(file) ?? new Set()).add(owner.top));
  };
  for (const file of openFiles) {
    const tree = trees.get(file);
    if (tree === undefined) continue;
    if (namedFiles.has(file) || expanded.has(file)) {
      const all = tree.top.toSorted((left, right) => left.line - right.line).slice(0, SYMBOL_LIMIT);
      shownTop.set(file, new Set(all.map((symbol) => symbol.qualified)));
    }
    for (const qualified of rootSymbols.get(file) ?? []) linkedTop(file, qualified);
  }
  for (const use of uses) {
    const fromWhole = namedFiles.has(use.fromFile) || expanded.has(use.fromFile);
    const toWhole = namedFiles.has(use.toFile) || expanded.has(use.toFile);
    if (openFiles.has(use.fromFile) && !fromWhole) linkedTop(use.fromFile, use.fromQualified);
    if (openFiles.has(use.toFile) && !toWhole) linkedTop(use.toFile, use.toQualified);
  }
  // A file open by the level with nothing to show stays closed.
  for (const file of openFiles) if ((shownTop.get(file)?.size ?? 0) === 0) openFiles.delete(file);
  const openSymbols = new Set<string>();
  for (const file of openFiles) {
    const tree = trees.get(file);
    for (const qualified of shownTop.get(file) ?? []) {
      const id = symbolId(file, qualified);
      if (
        (tree?.members.get(qualified)?.length ?? 0) > 0 &&
        !collapsed.has(id) &&
        (level === "member" || expanded.has(id))
      ) {
        openSymbols.add(id);
      }
    }
  }
  /** The node a definition (or a file's top level) shows as; null where nothing shows it. */
  const shownEnd = (file: string, qualified: string | null): string | null => {
    if (!openFiles.has(file)) return unitOfFile.get(file) ?? file;
    const owner = qualified === null ? null : (trees.get(file)?.ownerOf(qualified) ?? null);
    if (owner === null || !shownTop.get(file)?.has(owner.top)) return null;
    const top = symbolId(file, owner.top);
    const members = trees.get(file)?.members.get(owner.top) ?? [];
    const memberShown = members
      .slice(0, SYMBOL_LIMIT)
      .some((member) => member.qualified === owner.member);
    return owner.member !== null && openSymbols.has(top) && memberShown
      ? symbolId(file, owner.member)
      : top;
  };

  // Links between what shows: imports between closed files, uses where an end is open.
  const shownLinks = new Map<string, DraftLink & { readonly key: string }>();
  const link = (draft: DraftLink, rolled: boolean) => {
    if (draft.from === draft.to) return;
    const key = `${draft.from}\u0000${draft.to}`;
    const existing = shownLinks.get(key);
    if (existing === undefined) {
      shownLinks.set(key, {
        ...draft,
        key,
        line: rolled ? null : draft.line,
        text: rolled ? null : draft.text,
      });
    } else {
      shownLinks.set(key, {
        ...existing,
        line: existing.line === draft.line && !rolled ? existing.line : null,
        text: existing.text === draft.text && !rolled ? existing.text : null,
        resolution: surest(existing.resolution, draft.resolution),
      });
    }
  };
  for (const draft of links.values()) {
    if (openFiles.has(draft.from) || openFiles.has(draft.to)) continue;
    const from = unitOfFile.get(draft.from) ?? draft.from;
    const to = unitOfFile.get(draft.to) ?? draft.to;
    link({ ...draft, from, to }, from !== draft.from || to !== draft.to);
  }
  for (const use of uses) {
    const from = shownEnd(use.fromFile, use.fromQualified);
    const to = shownEnd(use.toFile, use.toQualified);
    if (from === null || to === null) continue;
    const exact =
      from === symbolId(use.fromFile, use.fromQualified ?? "") &&
      to === symbolId(use.toFile, use.toQualified);
    link({ from, to, line: use.line, text: null, resolution: use.resolution }, !exact);
  }

  // The nodes and clusters, in the asker's paths.
  const changedOf = (path: string): CodeChangeState | null =>
    changes.uncommitted.has(path) ? "uncommitted" : changes.branch.has(path) ? "branch" : null;
  const changedAmong = (paths: ReadonlyArray<string>): CodeChangeState | null => {
    const states = paths.map(changedOf);
    return states.includes("uncommitted")
      ? "uncommitted"
      : states.includes("branch")
        ? "branch"
        : null;
  };
  const output: Array<CodeGraphNode> = [];
  const put = (node: CodeGraphNode) => {
    const outside = node.path !== null && outsideOf(node.path);
    output.push(outside ? { ...node, outsideProject: true } : node);
  };
  const clusters = new Map<string, CodeGraphCluster>();
  const cluster = (id: string, value: Omit<CodeGraphCluster, "id">) =>
    clusters.set(id, { id, ...value });
  const parentShown = (parent: string | null, kind: CodeGraphCluster["kind"]) =>
    parent === null ? null : toAsker(parent, kind);
  const parentKind = (parent: string): CodeGraphCluster["kind"] =>
    parent.startsWith("module:") ? "module" : "folder";
  const holdsRoot = (paths: ReadonlyArray<string>) => paths.some((path) => rootFiles.has(path));

  for (const unit of units.values()) {
    const parent = unitParent(unit);
    const parentId = parent === null ? null : parentShown(parent, parentKind(parent));
    if (parent !== null) {
      const module = parent.startsWith("module:") ? moduleOfFile(unit.key) : null;
      cluster(parentId ?? parent, {
        kind: parentKind(parent),
        name: module?.name ?? (basename(parent) || "."),
        path: shown(module?.folder ?? parent),
        parent: module === null ? parentShown(folderAbove(parent), "folder") : null,
        root: holdsRoot(unit.files) || (clusters.get(parentId ?? parent)?.root ?? false),
      });
    }
    if (unit.kind === "file" && openFiles.has(unit.key)) {
      const file = unit.key;
      const fileId = shown(file);
      cluster(fileId, {
        kind: "file",
        name: unit.name,
        path: fileId,
        parent: parentId,
        root: rootFiles.has(file),
      });
      const tree = trees.get(file);
      const symbolNode = (symbol: StoredSymbol, owner: string, root: boolean): CodeGraphNode => ({
        id: symbolId(fileId, symbol.qualified),
        kind: "symbol",
        name: symbol.name,
        path: fileId,
        depth: unit.depth,
        root,
        lines: Math.max(1, symbol.endLine - symbol.line + 1),
        test: isTestPath(file),
        changed: null,
        files: null,
        parent: owner,
        expandable: (tree?.members.get(symbol.qualified)?.length ?? 0) > 0,
        symbol: { kind: symbol.kind, line: Math.max(1, symbol.line) },
      });
      for (const qualified of shownTop.get(file) ?? []) {
        const symbol = tree?.byQualified.get(qualified);
        if (symbol === undefined) continue;
        const id = symbolId(file, qualified);
        const root = namedFiles.has(file) || (rootSymbols.get(file)?.has(qualified) ?? false);
        if (!openSymbols.has(id)) {
          put(symbolNode(symbol, fileId, root));
          continue;
        }
        const symbolShown = symbolId(fileId, qualified);
        cluster(symbolShown, {
          kind: "symbol",
          name: symbol.name,
          path: fileId,
          parent: fileId,
          root,
        });
        for (const member of (tree?.members.get(qualified) ?? []).slice(0, SYMBOL_LIMIT)) {
          const memberRoot = root || (rootSymbols.get(file)?.has(member.qualified) ?? false);
          put({ ...symbolNode(member, symbolShown, memberRoot), expandable: false });
        }
      }
      continue;
    }
    const isFile = unit.kind === "file";
    put({
      id: toAsker(unit.key, unit.kind),
      kind: unit.kind,
      name: unit.name || ".",
      path: shown(unit.path),
      depth: unit.depth,
      root: holdsRoot(unit.files),
      lines: isFile ? snapshot.linesOf(unit.key) : null,
      test: unit.files.every(isTestPath),
      changed: isFile ? changedOf(unit.key) : changedAmong(unit.files),
      files: isFile ? null : unit.files.length,
      parent: parentId,
      expandable: true,
      symbol: null,
    });
  }
  for (const node of nodes.values()) {
    if (node.kind === "file") continue;
    put({
      id: node.id,
      kind: node.kind,
      name: node.name,
      path: node.path === null ? null : shown(node.path),
      depth: node.depth,
      root: false,
      lines: null,
      test: false,
      changed: null,
      files: null,
      parent: null,
      expandable: false,
      symbol: null,
    });
  }
  const kindOf = new Map<string, CodeGraphNode["kind"]>();
  for (const unit of units.values()) kindOf.set(unit.key, unit.kind);
  const shownId = (id: string) => {
    const kind = kindOf.get(id) ?? (nodes.get(id)?.kind === "file" ? "file" : nodes.get(id)?.kind);
    if (kind !== undefined) return toAsker(id, kind);
    return toAsker(id, "symbol");
  };
  const byOrder = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
  return {
    roots: output
      .filter((node) => node.root)
      .map((node) => node.id)
      .toSorted(byOrder),
    nodes: output.toSorted((left, right) => left.depth - right.depth || byOrder(left.id, right.id)),
    clusters: [...clusters.values()].toSorted((left, right) => byOrder(left.id, right.id)),
    links: [...shownLinks.values()]
      .map(({ key: _, ...draft }) => ({
        ...draft,
        from: shownId(draft.from),
        to: shownId(draft.to),
      }))
      .toSorted((left, right) => byOrder(left.from, right.from) || byOrder(left.to, right.to)),
    unknown,
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

// Checking node ids.

/** The ids among `ids` the checkout does not hold: files, folders, modules and definitions. */
export const checkNodes = Effect.fn("CodeIndex.checkNodes.build")(function* (
  snapshot: Snapshot,
  ids: ReadonlyArray<string>,
) {
  const refs = ids.map((id) => {
    const ref = parseNodeId(id);
    const path = repositoryPath(snapshot.prefix, ref.kind === "module" ? ref.folder : ref.path);
    return { id, ref, path };
  });
  const symbolFiles = refs.flatMap(({ ref, path }) =>
    ref.kind === "symbol" && path !== null ? [path] : [],
  );
  const facts = yield* snapshot.files(symbolFiles);
  const unknown = refs.flatMap(({ id, ref, path }) => {
    if (path === null) return [id];
    if (ref.kind === "symbol") {
      const held = facts.get(path)?.facts.symbols.some((each) => each.qualified === ref.qualified);
      return held === true ? [] : [id];
    }
    return filesAt(snapshot.view, path).length > 0 ? [] : [id];
  });
  return { unknown };
});
