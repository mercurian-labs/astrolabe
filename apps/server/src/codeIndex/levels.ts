/**
 * The units a code graph shows at each level of detail, derived from a checkout's file list:
 * folders, the language's modules, files, and a file's definitions. Pure, so the query that rolls
 * links up to them (`queries.ts`) stays a walk over stored facts.
 */
import type { LanguageId } from "@mercurian/code-graph/languages";

import type { StoredSymbol } from "./facts.ts";
import type { Packages } from "./resolve.ts";

export const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A module holding several files: its folder (repository path) and its name. */
export interface ModuleUnit {
  readonly id: string;
  readonly folder: string;
  readonly name: string;
}

export const moduleId = (folder: string) => `module:${folder}`;

const RUST_ROOTS = new Set(["mod.rs", "lib.rs", "main.rs"]);

const moduleAt = (folder: string, name: string): ModuleUnit => ({
  id: moduleId(folder),
  folder,
  name: name === "" ? "." : name,
});

/**
 * Each file's module, as its language groups files; null where the file is its own module.
 * TypeScript: the workspace package (nearest named package.json) holding it. Go: its folder.
 * Python: the package (folder with `__init__.py`) holding it. Rust: the `mod` holding it, which
 * spans `a.rs` and the folder `a/` when both are there.
 */
export class Modules {
  readonly #files: ReadonlyMap<string, string>;
  readonly #packages: Packages;
  #rustFolders: ReadonlySet<string> | null = null;
  readonly #cache = new Map<string, ModuleUnit | null>();

  constructor(files: ReadonlyMap<string, string>, packages: Packages) {
    this.#files = files;
    this.#packages = packages;
  }

  of(path: string, language: LanguageId): ModuleUnit | null {
    const cached = this.#cache.get(path);
    if (cached !== undefined) return cached;
    const found = this.#find(path, language);
    this.#cache.set(path, found);
    return found;
  }

  #find(path: string, language: LanguageId): ModuleUnit | null {
    switch (language) {
      case "typescript":
      case "tsx": {
        const owner = this.#packages.owning(path);
        return owner === null ? null : moduleAt(owner.dir, owner.name);
      }
      case "go": {
        const folder = dirname(path);
        return moduleAt(folder, basename(folder));
      }
      case "python": {
        const folder = dirname(path);
        if (!this.#files.has(`${folder === "" ? "" : `${folder}/`}__init__.py`)) return null;
        // A package's name is its folders from the outermost package down.
        const names = [basename(folder)];
        for (let up = dirname(folder); up !== "" && this.#files.has(`${up}/__init__.py`);) {
          names.unshift(basename(up));
          up = dirname(up);
        }
        return moduleAt(folder, names.join("."));
      }
      case "rust": {
        const name = basename(path);
        const own = path.slice(0, -".rs".length);
        // `a.rs` beside a folder `a/` of Rust files is that module's root.
        const folder = !RUST_ROOTS.has(name) && this.#rustFolder(own) ? own : dirname(path);
        const named = basename(folder);
        return moduleAt(folder, named === "src" ? basename(dirname(folder)) || named : named);
      }
    }
  }

  #rustFolder(folder: string): boolean {
    if (this.#rustFolders === null) {
      const folders = new Set<string>();
      for (const file of this.#files.keys()) if (file.endsWith(".rs")) folders.add(dirname(file));
      this.#rustFolders = folders;
    }
    return this.#rustFolders.has(folder);
  }
}

/** A node id as a code graph names it: a path, `module:<folder>`, or `path#Qualified.name`. */
export type NodeRef =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "module"; readonly folder: string }
  | { readonly kind: "symbol"; readonly path: string; readonly qualified: string };

export function parseNodeId(id: string): NodeRef {
  if (id.startsWith("module:")) return { kind: "module", folder: id.slice("module:".length) };
  const hash = id.indexOf("#");
  if (hash > 0 && hash < id.length - 1) {
    return { kind: "symbol", path: id.slice(0, hash), qualified: id.slice(hash + 1) };
  }
  return { kind: "path", path: id };
}

export const symbolId = (path: string, qualified: string) => `${path}#${qualified}`;

/** A file's definitions as a tree: each top-level one, and each member under its owner. */
export interface SymbolTree {
  readonly top: ReadonlyArray<StoredSymbol>;
  /** Members by their owner's qualified name: a class's methods. */
  readonly members: ReadonlyMap<string, ReadonlyArray<StoredSymbol>>;
  readonly byQualified: ReadonlyMap<string, StoredSymbol>;
  /** The top-level definition holding `qualified`, and the member of it holding it; null outside. */
  readonly ownerOf: (
    qualified: string,
  ) => { readonly top: string; readonly member: string | null } | null;
}

/**
 * A definition is a member when the name before its last dot is another definition of the file
 * (`Class.method`, a Go receiver's method, a nested function); otherwise it is top-level.
 */
export function symbolTree(symbols: ReadonlyArray<StoredSymbol>): SymbolTree {
  const byQualified = new Map(symbols.map((symbol) => [symbol.qualified, symbol]));
  const ownerName = (qualified: string) => {
    const dot = qualified.lastIndexOf(".");
    const owner = dot > 0 ? qualified.slice(0, dot) : null;
    return owner !== null && byQualified.has(owner) ? owner : null;
  };
  const top: Array<StoredSymbol> = [];
  const members = new Map<string, Array<StoredSymbol>>();
  for (const symbol of symbols) {
    const owner = ownerName(symbol.qualified);
    if (owner === null) top.push(symbol);
    else members.set(owner, [...(members.get(owner) ?? []), symbol]);
  }
  const ownerOf = (qualified: string) => {
    if (!byQualified.has(qualified)) return null;
    const chain = [qualified];
    for (let owner = ownerName(qualified); owner !== null; owner = ownerName(owner)) {
      chain.unshift(owner);
    }
    return { top: chain[0] ?? qualified, member: chain[1] ?? null };
  };
  return { top, members, byQualified, ownerOf };
}
