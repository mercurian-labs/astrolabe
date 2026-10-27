/**
 * One tree's index, kept so the next tree costs only what changed. Facts parse once; a change
 * re-resolves, from stored facts, the changed files plus those whose references or imports could now
 * land differently. A reference narrows to its imports, then the file's own definitions (Go: its
 * package's), then every definition of the name. Unknown modules are external: recorded, never drawn.
 */
import {
  compareText,
  edgeKey,
  frontierId,
  type CodeEdge,
  type CodeIndex,
  type CodeSymbol,
  type EdgeKind,
  type ExternalUse,
  type FrontierSymbol,
  type Resolution,
  type SymbolKind,
} from "../model/code.ts";
import {
  DEFAULT_EXPORT,
  type FileFacts,
  type ImportBinding,
  type Reference,
  type ReferenceKind,
} from "../parse/extract.ts";
import { isBuiltin } from "./builtins.ts";
import { FolderTree } from "./folders.ts";
import { ModuleIndex, offeredKeys, wantedKeys } from "./modules.ts";

/** Where one reference lands. */
type Target =
  | { readonly kind: "found"; readonly ids: ReadonlyArray<string> }
  | { readonly kind: "external"; readonly source: string }
  | { readonly kind: "frontier" }
  | { readonly kind: "none" };

const NONE: Target = { kind: "none" };

interface Resolved {
  readonly edges: ReadonlyArray<CodeEdge>;
  readonly externals: ReadonlyArray<ExternalUse>;
}

/** The link each reference makes, and the kinds of definition it can land on. */
const REFERENCE_LINKS: Readonly<
  Record<ReferenceKind, { readonly link: EdgeKind; readonly accepts: ReadonlySet<SymbolKind> }>
> = {
  // A call that lands on a class constructs it: `instantiates`, below.
  calls: { link: "calls", accepts: new Set(["function", "method", "class"]) },
  instantiates: { link: "instantiates", accepts: new Set(["class", "function"]) },
  inherits: { link: "inherits", accepts: new Set(["class", "interface", "type", "enum"]) },
  implements: { link: "implements", accepts: new Set(["class", "interface", "type"]) },
  types: { link: "references", accepts: new Set(["class", "interface", "enum", "type"]) },
  values: { link: "references", accepts: new Set(["function", "method", "class"]) },
  accepts: { link: "accepts", accepts: new Set(["class", "interface", "enum", "type"]) },
  returns: { link: "returns", accepts: new Set(["class", "interface", "enum", "type"]) },
  throws: { link: "throws", accepts: new Set(["class", "interface", "enum", "type"]) },
  catches: { link: "catches", accepts: new Set(["class", "interface", "enum", "type"]) },
};

/** Only these may reach toward a name nothing defines. */
const MAY_BE_FRONTIER = new Set<ReferenceKind>(["calls", "instantiates", "inherits", "implements"]);

/** Contract and failure links never land on a language's builtin (`string`, `Error`, `ValueError`). */
const SKIPS_BUILTINS = new Set<ReferenceKind>(["accepts", "returns", "throws", "catches"]);

const SELF_QUALIFIERS = new Set(["this", "self", "Self"]);
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

const addTo = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
};
const removeFrom = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  const set = map.get(key);
  set?.delete(value);
  if (set?.size === 0) map.delete(key);
};

/** The names a file's resolution depends on: what it references and what it imports. */
function namesUsed(facts: FileFacts): Set<string> {
  const names = new Set(facts.references.map((reference) => reference.name));
  for (const binding of facts.imports) if (binding.imported !== null) names.add(binding.imported);
  return names;
}

export class CodeIndexer {
  readonly facts = new Map<string, FileFacts>();
  readonly folders: FolderTree;
  private readonly symbols = new Map<string, CodeSymbol>();
  /** Definitions by short name; files are left out, nothing calls a file. */
  private readonly byName = new Map<string, Set<string>>();
  /** Definitions by the symbol that holds them, for deriving overrides. */
  private readonly children = new Map<string, Set<string>>();
  /** Files by the names they use, to find who a changed definition affects. */
  private readonly users = new Map<string, Set<string>>();
  /** Files by the module keys their imports ask for, to find who a new or gone file affects. */
  private readonly askers = new Map<string, Set<string>>();
  private readonly modules = new ModuleIndex();
  private readonly resolved = new Map<string, Resolved>();

  /** `paths` are the index's pathspecs: folder chains start at their roots. */
  constructor(paths: ReadonlyArray<string> = []) {
    this.folders = new FolderTree(paths);
  }

  /** Add a file's facts (replacing any earlier ones); edges wait for `resolve`. */
  put(facts: FileFacts): void {
    this.drop(facts.path);
    this.facts.set(facts.path, facts);
    this.modules.add(facts.path, facts.language);
    this.folders.add(facts.path, facts.language);
    for (const symbol of facts.symbols) {
      this.symbols.set(symbol.id, symbol);
      if (symbol.kind === "file") continue;
      addTo(this.byName, symbol.name, symbol.id);
      if (symbol.parent !== undefined) addTo(this.children, symbol.parent, symbol.id);
    }
    for (const name of namesUsed(facts)) addTo(this.users, name, facts.path);
    for (const key of this.keysAsked(facts)) addTo(this.askers, key, facts.path);
  }

  /** Forget a file; its outgoing edges go with it. */
  drop(path: string): void {
    const facts = this.facts.get(path);
    if (facts === undefined) return;
    this.facts.delete(path);
    this.modules.remove(path, facts.language);
    this.folders.remove(path, facts.language);
    for (const symbol of facts.symbols) {
      this.symbols.delete(symbol.id);
      if (symbol.kind === "file") continue;
      removeFrom(this.byName, symbol.name, symbol.id);
      if (symbol.parent !== undefined) removeFrom(this.children, symbol.parent, symbol.id);
    }
    for (const name of namesUsed(facts)) removeFrom(this.users, name, path);
    for (const key of this.keysAsked(facts)) removeFrom(this.askers, key, path);
    this.resolved.delete(path);
  }

  /**
   * The files whose edges a change to `paths` can move: the changed files, the
   * users of any name they define(d), and the importers of any key they offer.
   */
  affectedBy(paths: Iterable<string>, before: ReadonlyArray<FileFacts>): Set<string> {
    const affected = new Set<string>();
    const touch = (facts: FileFacts) => {
      for (const symbol of facts.symbols) {
        for (const user of this.users.get(symbol.name) ?? []) affected.add(user);
      }
      for (const key of offeredKeys(facts.path, facts.language)) {
        for (const asker of this.askers.get(key) ?? []) affected.add(asker);
      }
    };
    for (const facts of before) touch(facts);
    for (const path of paths) {
      const facts = this.facts.get(path);
      if (facts === undefined) continue;
      affected.add(path);
      touch(facts);
    }
    return affected;
  }

  /** Resolve the given files' outgoing edges; returns the edges before and after. */
  resolve(paths: Iterable<string>): {
    readonly before: ReadonlyArray<CodeEdge>;
    readonly after: ReadonlyArray<CodeEdge>;
  } {
    const before: Array<CodeEdge> = [];
    const after: Array<CodeEdge> = [];
    for (const path of paths) {
      before.push(...this.edgesOf(path));
      const facts = this.facts.get(path);
      if (facts === undefined) {
        this.resolved.delete(path);
        continue;
      }
      const resolved = this.resolveFile(facts);
      this.resolved.set(path, resolved);
      after.push(...resolved.edges);
    }
    return { before, after };
  }

  /** A file's outgoing edges as last resolved. */
  edgesOf(path: string): ReadonlyArray<CodeEdge> {
    return this.resolved.get(path)?.edges ?? [];
  }

  /** A symbol as the index has it now: a file with its folder. */
  placed(symbol: CodeSymbol): CodeSymbol {
    if (symbol.kind !== "file") return symbol;
    const parent = this.folders.parentOf(symbol.path);
    return parent === undefined ? symbol : { ...symbol, parent };
  }

  snapshot(ref: string, commit: string): CodeIndex {
    const edges = [...this.resolved.values()].flatMap((resolved) => resolved.edges);
    const externals = [...this.resolved.values()].flatMap((resolved) => resolved.externals);
    const frontier = new Map<string, FrontierSymbol>();
    for (const edge of edges) {
      if (edge.to.startsWith("frontier:") && !frontier.has(edge.to)) {
        frontier.set(edge.to, { id: edge.to, name: edge.to.slice(9), frontier: true });
      }
    }
    const byId = (left: { id: string }, right: { id: string }) => compareText(left.id, right.id);
    return {
      ref,
      commit,
      symbols: [
        ...this.folders.symbols(),
        ...[...this.symbols.values()].map((symbol) => this.placed(symbol)),
      ].toSorted(byId),
      frontier: [...frontier.values()].toSorted(byId),
      edges: edges.toSorted((left, right) => compareText(edgeKey(left), edgeKey(right))),
      externals: externals.toSorted(
        (left, right) =>
          compareText(left.from, right.from) ||
          compareText(left.name, right.name) ||
          compareText(left.source, right.source),
      ),
    };
  }

  private keysAsked(facts: FileFacts): Set<string> {
    const keys = new Set<string>();
    for (const binding of facts.imports) {
      for (const key of wantedKeys(facts.language, facts.path, binding.source, binding.imported)) {
        keys.add(key);
      }
    }
    return keys;
  }

  private moduleFiles(facts: FileFacts, binding: ImportBinding, asModule: boolean) {
    return this.modules.lookup(
      wantedKeys(facts.language, facts.path, binding.source, asModule ? binding.imported : null),
    );
  }

  private definedIn(name: string, paths: ReadonlySet<string> | ((path: string) => boolean)) {
    const accept = typeof paths === "function" ? paths : (path: string) => paths.has(path);
    return [...(this.byName.get(name) ?? [])].filter((id) => {
      const symbol = this.symbols.get(id);
      return symbol !== undefined && accept(symbol.path);
    });
  }

  /** Where one reference lands; see the module comment for the rules. */
  private target(
    facts: FileFacts,
    bindings: ReadonlyMap<string, ImportBinding>,
    reference: Reference,
  ): Target {
    const { name, qualifier } = reference;
    const { accepts } = REFERENCE_LINKS[reference.kind];
    // A tier's candidates, of the kinds this reference can land on; none leaves it to the next tier.
    const found = (ids: ReadonlyArray<string>): Target | null => {
      const kept = ids.filter((id) => {
        const kind = this.symbols.get(id)?.kind;
        return kind !== undefined && accepts.has(kind);
      });
      return kept.length > 0 ? { kind: "found", ids: kept } : null;
    };
    const byName = () => found([...(this.byName.get(name) ?? [])]);
    const own = () =>
      found(
        this.definedIn(name, (path) =>
          facts.language === "go" ? dirname(path) === dirname(facts.path) : path === facts.path,
        ),
      );

    if (qualifier !== null && SELF_QUALIFIERS.has(qualifier)) return own() ?? byName() ?? NONE;

    const head = qualifier?.split(/\.|::/)[0] ?? "";
    const binding =
      qualifier === null ? bindings.get(name) : (bindings.get(qualifier) ?? bindings.get(head));
    if (binding !== undefined) {
      // Through a module binding the name is the reference's; through a named
      // binding used bare, it is the name the module exports.
      const files = this.moduleFiles(
        facts,
        binding,
        qualifier !== null && binding.kind === "named",
      );
      if (files.size === 0) return { kind: "external", source: binding.source };
      const imported = found(
        qualifier === null && binding.imported === DEFAULT_EXPORT
          ? // A default import names whatever each module exports as default.
            [...files].flatMap((path) => {
              const exported = this.facts.get(path)?.defaultExport;
              return exported === null || exported === undefined
                ? []
                : this.definedIn(exported, new Set([path]));
            })
          : this.definedIn(qualifier === null ? (binding.imported ?? name) : name, files),
      );
      // The module holds no such definition (a re-export, say): names decide, and a
      // bound name nothing defines is not a frontier.
      return imported ?? byName() ?? NONE;
    }
    if (qualifier !== null) {
      // `Math.max`, `console.log` are the language's (unless the file binds that name
      // itself, as a `parent` or `history` variable); other member accesses resolve by
      // name or not at all.
      return isBuiltin(facts.language, head) && !facts.locals.includes(head)
        ? NONE
        : (byName() ?? NONE);
    }
    // A variable or parameter the file binds (a callback, a React setter) is the
    // code's own, not every definition of that name and not a frontier.
    if (facts.locals.includes(name)) return own() ?? NONE;
    if (SKIPS_BUILTINS.has(reference.kind) && isBuiltin(facts.language, name)) return own() ?? NONE;
    const resolved = own() ?? byName();
    if (resolved !== null) return resolved;
    const defined = (this.byName.get(name)?.size ?? 0) > 0;
    return defined || !MAY_BE_FRONTIER.has(reference.kind) || isBuiltin(facts.language, name)
      ? NONE
      : { kind: "frontier" };
  }

  /** One candidate is exact; several in one file are overloads; several across files, a guess. */
  private resolutionOf(ids: ReadonlyArray<string>): Resolution {
    if (ids.length === 1) return "exact";
    const paths = new Set(ids.map((id) => this.symbols.get(id)?.path));
    return paths.size === 1 ? "overload" : "heuristic";
  }

  private resolveFile(facts: FileFacts): Resolved {
    const edges = new Map<string, CodeEdge>();
    const add = (edge: CodeEdge) => {
      if (edge.from === edge.to) return;
      const key = edgeKey(edge);
      if (!edges.has(key)) edges.set(key, edge);
    };
    const file = facts.symbols[0]?.id;
    const bindings = new Map<string, ImportBinding>();
    for (const binding of facts.imports) {
      if (binding.local !== null && !bindings.has(binding.local)) {
        bindings.set(binding.local, binding);
      }
      if (file === undefined) continue;
      for (const path of this.moduleFiles(facts, binding, false)) {
        const target = this.facts.get(path)?.symbols[0]?.id;
        if (target !== undefined)
          add({ from: file, to: target, kind: "imports", resolution: "exact" });
      }
    }
    if (file !== undefined) {
      for (const id of facts.exports)
        add({ from: file, to: id, kind: "exports", resolution: "exact" });
    }

    const externals = new Map<string, ExternalUse>();
    // Several references can land one edge; the surest resolution wins.
    const rank: Record<Resolution, number> = { exact: 0, overload: 1, heuristic: 2 };
    const land = (edge: CodeEdge) => {
      const key = edgeKey(edge);
      const prior = edges.get(key);
      if (prior === undefined || rank[edge.resolution] < rank[prior.resolution]) {
        if (edge.from !== edge.to) edges.set(key, edge);
      }
    };
    for (const reference of facts.references) {
      const target = this.target(facts, bindings, reference);
      const { from, name } = reference;
      const { link } = REFERENCE_LINKS[reference.kind];
      switch (target.kind) {
        case "found": {
          const resolution = this.resolutionOf(target.ids);
          for (const to of target.ids) {
            const constructs = link === "calls" && this.symbols.get(to)?.kind === "class";
            land({ from, to, kind: constructs ? "instantiates" : link, resolution });
          }
          break;
        }
        case "frontier":
          land({ from, to: frontierId(name), kind: link, resolution: "heuristic" });
          break;
        case "external":
          externals.set(`${from}\u0000${name}\u0000${target.source}`, {
            from,
            name,
            source: target.source,
          });
          break;
        case "none":
          break;
      }
    }

    // A method overrides the same-named method of a type its class inherits from or implements.
    const methodsOf = (id: string) =>
      [...(this.children.get(id) ?? [])].flatMap((child) => {
        const symbol = this.symbols.get(child);
        return symbol?.kind === "method" ? [symbol] : [];
      });
    // Taken before overrides land, since landing them adds to `edges`.
    const bases = [...edges.values()].filter(
      (edge) => edge.kind === "inherits" || edge.kind === "implements",
    );
    for (const edge of bases) {
      const base = new Map(methodsOf(edge.to).map((method) => [method.name, method.id]));
      for (const method of methodsOf(edge.from)) {
        const overridden = base.get(method.name);
        if (overridden !== undefined) {
          land({ from: method.id, to: overridden, kind: "overrides", resolution: edge.resolution });
        }
      }
    }
    return { edges: [...edges.values()], externals: [...externals.values()] };
  }
}
