/**
 * Links, resolved when a question is asked: an import names files, a package of the repository,
 * or a dependency; a reference narrows to its imports, then its own file, then every definition of
 * the name (the tiers of code-graph's indexer, over a checkout's stored facts).
 */
import type { ReferenceKind } from "@mercurian/code-graph";
import { isBuiltin } from "@mercurian/code-graph/builtins";
import { languageOf, type LanguageId } from "@mercurian/code-graph/languages";
import { ModuleIndex, offeredKeys, wantedKeys } from "@mercurian/code-graph/modules";
import type { CodeResolution, CodeSymbolKind, CodeUse } from "@t3tools/contracts";

import { packageNameOf, type StoredFacts, type StoredImport, type StoredSymbol } from "./facts.ts";

const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

function normalize(path: string): string | null {
  const out: Array<string> = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join("/");
}

// Packages: a repository's own `package.json` names, so `@scope/name/sub` lands on its file.

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly manifest: string;
  readonly exports: unknown;
  readonly main: string | null;
}

/** Read a manifest's text; null when it names no package. */
export function readManifest(path: string, text: string): WorkspacePackage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name === "") return null;
  const main = [record.source, record.types, record.module, record.main].find(
    (field): field is string => typeof field === "string",
  );
  return {
    name: record.name,
    dir: dirname(path),
    manifest: path,
    exports: record.exports ?? null,
    main: main ?? null,
  };
}

const CONDITIONS = ["source", "types", "import", "default", "require", "node"];

function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = exportTarget(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const condition of CONDITIONS) {
    const found = exportTarget(record[condition]);
    if (found !== null) return found;
  }
  for (const nested of Object.values(record)) {
    const found = exportTarget(nested);
    if (found !== null) return found;
  }
  return null;
}

/** The target an `exports` map gives a subpath (`.` or `./sub`), patterns included. */
function exportFor(exports: unknown, subpath: string): string | null {
  if (exports === null || exports === undefined) return null;
  if (typeof exports === "string" || Array.isArray(exports)) {
    return subpath === "." ? exportTarget(exports) : null;
  }
  if (typeof exports !== "object") return null;
  const record = exports as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.some((key) => key.startsWith(".")))
    return subpath === "." ? exportTarget(record) : null;
  if (subpath in record) return exportTarget(record[subpath]);
  for (const key of keys) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const middle = subpath.slice(prefix.length, subpath.length - suffix.length);
    return exportTarget(record[key])?.replaceAll("*", middle) ?? null;
  }
  return null;
}

/** A path as written in a manifest or an import, matched against the checkout's files. */
function fileAt(
  files: ReadonlySet<string> | ReadonlyMap<string, string>,
  base: string,
): string | null {
  const candidates = [
    base,
    base.replace(/\.(m|c)?jsx?$/, (extension) => extension.replace("js", "ts")),
    base.replace(/\.d\.(m|c)?ts$/, (extension) => extension.replace(".d", "")),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

export class Packages {
  private readonly byName = new Map<string, WorkspacePackage>();

  constructor(packages: Iterable<WorkspacePackage>) {
    // The shallowest manifest wins a name: fixtures and examples repeat real ones.
    const ordered = [...packages].toSorted(
      (left, right) => left.dir.split("/").length - right.dir.split("/").length,
    );
    for (const found of ordered)
      if (!this.byName.has(found.name)) this.byName.set(found.name, found);
  }

  get(name: string): WorkspacePackage | undefined {
    return this.byName.get(name);
  }

  /** The package whose folder holds a file, the deepest first. */
  owning(path: string): WorkspacePackage | null {
    let best: WorkspacePackage | null = null;
    for (const found of this.byName.values()) {
      if (found.dir !== "" && !path.startsWith(`${found.dir}/`)) continue;
      if (best === null || found.dir.length > best.dir.length) best = found;
    }
    return best;
  }

  /** The file a specifier of the package reaches: its entry for the bare name. */
  fileFor(
    found: WorkspacePackage,
    specifier: string,
    files: ReadonlyMap<string, string>,
  ): string | null {
    const sub = specifier.slice(found.name.length);
    const subpath = sub === "" ? "." : `.${sub}`;
    const join = (target: string) => normalize(`${found.dir}/${target}`);
    const target = exportFor(found.exports, subpath);
    if (target !== null) {
      const base = join(target);
      return base === null ? null : fileAt(files, base);
    }
    if (found.exports !== null) return null;
    if (subpath === ".") {
      for (const base of [found.main, "src/index", "index"]) {
        const joined = base === null ? null : join(base);
        const file = joined === null ? null : fileAt(files, joined);
        if (file !== null) return file;
      }
      return null;
    }
    for (const base of [join(subpath), join(`src/${subpath}`)]) {
      const file = base === null ? null : fileAt(files, base);
      if (file !== null) return file;
    }
    return null;
  }
}

// Imports.

export type ImportTarget =
  | { readonly kind: "files"; readonly paths: ReadonlyArray<string> }
  | {
      readonly kind: "package";
      readonly name: string;
      /** What the package's name opens. */
      readonly entry: string | null;
      /** What this specifier reaches; the entry for the bare name. */
      readonly file: string | null;
    }
  | { readonly kind: "dependency"; readonly name: string }
  | { readonly kind: "none" };

const NONE: ImportTarget = { kind: "none" };

/** The files, packages and modules of one checkout, for resolving its imports. */
export class CheckoutModules {
  private readonly modules = new ModuleIndex();
  readonly files: ReadonlyMap<string, string>;
  readonly packages: Packages;

  constructor(files: ReadonlyMap<string, string>, packages: Packages) {
    this.files = files;
    this.packages = packages;
    for (const path of files.keys()) {
      const language = languageOf(path);
      if (language !== null) this.modules.add(path, language);
    }
  }

  lookup(
    language: LanguageId,
    from: string,
    source: string,
    member: string | null,
  ): ReadonlyArray<string> {
    return [...this.modules.lookup(wantedKeys(language, from, source, member))];
  }

  resolveImport(language: LanguageId, from: string, binding: StoredImport): ImportTarget {
    const files = this.lookup(language, from, binding.source, binding.imported);
    if (files.length > 0) return { kind: "files", paths: files };
    switch (language) {
      case "typescript":
      case "tsx": {
        const name = packageNameOf(binding.source);
        if (name === null) return NONE;
        const found = this.packages.get(name);
        if (found === undefined) return { kind: "dependency", name };
        return {
          kind: "package",
          name,
          entry: this.packages.fileFor(found, name, this.files),
          file: this.packages.fileFor(found, binding.source, this.files),
        };
      }
      case "python":
        return binding.source.startsWith(".")
          ? NONE
          : { kind: "dependency", name: binding.source.split(".")[0] ?? binding.source };
      case "go":
        return { kind: "dependency", name: binding.source };
      default: {
        const head = binding.source.split("::")[0] ?? "";
        return head === "crate" || head === "self" || head === "super" || head === ""
          ? NONE
          : { kind: "dependency", name: head };
      }
    }
  }

  /** The files an import binding lands on, a package's file included. */
  importedFiles(language: LanguageId, from: string, binding: StoredImport): ReadonlyArray<string> {
    const target = this.resolveImport(language, from, binding);
    if (target.kind === "files") return target.paths;
    if (target.kind === "package" && target.file !== null) return [target.file];
    return [];
  }

  /** The module keys a file answers to, for finding who imports it. */
  keysFor(path: string): ReadonlyArray<string> {
    const language = languageOf(path);
    if (language === null) return [];
    const keys = [...offeredKeys(path, language)];
    if (language === "typescript" || language === "tsx") {
      const owner = this.packages.owning(path);
      if (owner !== null) keys.push(`pkg:${owner.name}`);
    }
    return keys;
  }
}

export const resolutionOf = (count: number): CodeResolution => (count <= 1 ? "exact" : "heuristic");

// References.

/** The kinds of definition each reference can land on (code-graph's REFERENCE_LINKS). */
const ACCEPTS: Readonly<Record<ReferenceKind, ReadonlySet<CodeSymbolKind>>> = {
  calls: new Set(["function", "method", "class"]),
  instantiates: new Set(["class", "function"]),
  inherits: new Set(["class", "interface", "type", "enum"]),
  implements: new Set(["class", "interface", "type"]),
  types: new Set(["class", "interface", "enum", "type"]),
  values: new Set(["function", "method", "class"]),
  accepts: new Set(["class", "interface", "enum", "type"]),
  returns: new Set(["class", "interface", "enum", "type"]),
  throws: new Set(["class", "interface", "enum", "type"]),
  catches: new Set(["class", "interface", "enum", "type"]),
};

const USE_KINDS: Readonly<Record<ReferenceKind, CodeUse["kind"]>> = {
  calls: "calls",
  instantiates: "instantiates",
  inherits: "inherits",
  implements: "implements",
  types: "types",
  values: "calls",
  accepts: "types",
  returns: "types",
  throws: "types",
  catches: "types",
};

export const useKindOf = (kind: ReferenceKind) => USE_KINDS[kind];

const SKIPS_BUILTINS = new Set<ReferenceKind>(["accepts", "returns", "throws", "catches"]);
const SELF_QUALIFIERS = new Set(["this", "self", "Self"]);

/** A definition somewhere in the checkout. */
export interface Definition {
  readonly path: string;
  readonly symbol: StoredSymbol;
}

export const definitionId = (definition: Definition) =>
  `${definition.path}#${definition.symbol.qualified}`;

/** A file's facts, ready to resolve its references. */
export interface FileView {
  readonly path: string;
  readonly language: LanguageId;
  readonly facts: StoredFacts;
  readonly imports: ReadonlyArray<StoredImport>;
}

/**
 * Where a file's reference lands among `byName` (every definition of the name in the checkout),
 * or null when it lands nowhere: a dependency, a builtin, a local variable.
 */
export function resolveReference(
  modules: CheckoutModules,
  file: FileView,
  reference: {
    readonly name: string;
    readonly kind: ReferenceKind;
    readonly qualifier: string | null;
  },
  byName: ReadonlyArray<Definition>,
): { readonly targets: ReadonlyArray<Definition>; readonly resolution: CodeResolution } | null {
  const accepts = ACCEPTS[reference.kind];
  const accepted = byName.filter((definition) => accepts.has(definition.symbol.kind));
  const found = (list: ReadonlyArray<Definition>) => {
    if (list.length === 0) return null;
    const paths = new Set(list.map((definition) => definition.path));
    const resolution: CodeResolution =
      list.length === 1 ? "exact" : paths.size === 1 ? "overload" : "heuristic";
    return { targets: list, resolution };
  };
  const inFiles = (paths: ReadonlySet<string>) =>
    accepted.filter((definition) => paths.has(definition.path));
  const own = () =>
    found(
      accepted.filter((definition) =>
        file.language === "go"
          ? dirname(definition.path) === dirname(file.path)
          : definition.path === file.path,
      ),
    );
  const all = () => found(accepted);
  const { name, qualifier } = reference;

  if (qualifier !== null && SELF_QUALIFIERS.has(qualifier)) return own() ?? all();
  const head = qualifier?.split(/\.|::/)[0] ?? "";
  const bindings = new Map<string, StoredImport>();
  for (const binding of file.imports) {
    if (binding.local !== null && !bindings.has(binding.local))
      bindings.set(binding.local, binding);
  }
  const binding =
    qualifier === null ? bindings.get(name) : (bindings.get(qualifier) ?? bindings.get(head));
  if (binding !== undefined) {
    const asModule = qualifier !== null && binding.kind === "named";
    const target = modules.resolveImport(file.language, file.path, {
      ...binding,
      imported: asModule ? binding.imported : null,
    });
    const files =
      target.kind === "files"
        ? new Set(target.paths)
        : target.kind === "package" && target.file !== null
          ? new Set([target.file])
          : null;
    if (files === null) return null;
    // code-graph's DEFAULT_EXPORT, written out so the server does not load the parser.
    if (qualifier === null && binding.imported === "default") {
      // A default import names whatever the module exports as default; the facts of that file say.
      return found(inFiles(files).filter((definition) => definition.symbol.exported)) ?? null;
    }
    const wanted = qualifier === null ? (binding.imported ?? name) : name;
    return found(inFiles(files).filter((definition) => definition.symbol.name === wanted)) ?? all();
  }
  if (qualifier !== null) {
    return isBuiltin(file.language, head) && !file.facts.locals.includes(head) ? null : all();
  }
  if (file.facts.locals.includes(name)) return own();
  if (SKIPS_BUILTINS.has(reference.kind) && isBuiltin(file.language, name)) return own();
  return own() ?? all();
}

/** The lines and enclosing symbols where a file uses a name, each with where it lands. */
export function usesIn(
  modules: CheckoutModules,
  file: FileView,
  name: string,
  byName: ReadonlyArray<Definition>,
): ReadonlyArray<{
  readonly line: number;
  readonly from: string | null;
  readonly kind: CodeUse["kind"];
  readonly targets: ReadonlyArray<Definition>;
  readonly resolution: CodeResolution;
}> {
  const uses: Array<{
    line: number;
    from: string | null;
    kind: CodeUse["kind"];
    targets: ReadonlyArray<Definition>;
    resolution: CodeResolution;
  }> = [];
  for (const binding of file.imports) {
    if (binding.kind !== "named" || binding.imported !== name) continue;
    const files = new Set(modules.importedFiles(file.language, file.path, binding));
    const targets = byName.filter((definition) => files.has(definition.path));
    if (targets.length === 0) continue;
    uses.push({
      line: binding.line,
      from: null,
      kind: "imports",
      targets,
      resolution: resolutionOf(targets.length),
    });
  }
  for (const reference of file.facts.references) {
    if (reference.name !== name) continue;
    const landed = resolveReference(modules, file, reference, byName);
    if (landed === null) continue;
    for (const line of reference.lines) {
      uses.push({
        line,
        from: reference.from,
        kind: useKindOf(reference.kind),
        targets: landed.targets,
        resolution: landed.resolution,
      });
    }
  }
  return uses.toSorted((left, right) => left.line - right.line);
}
