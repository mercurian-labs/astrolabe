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
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
  /** Its `#` specifiers. */
  readonly imports: unknown;
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
    imports: record.imports ?? null,
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

/**
 * The key of a specifier map (`exports`, `imports`, tsconfig `paths`) a specifier takes: its own,
 * else the `*` pattern with the longest prefix; `star` is what the `*` stands for.
 */
function matchKey(
  keys: Iterable<string>,
  specifier: string,
): { readonly key: string; readonly star: string } | null {
  let best: { readonly key: string; readonly star: string } | null = null;
  let longest = -1;
  for (const key of keys) {
    if (key === specifier) return { key, star: "" };
    const at = key.indexOf("*");
    if (at < 0 || at <= longest) continue;
    const prefix = key.slice(0, at);
    const suffix = key.slice(at + 1);
    if (specifier.length < prefix.length + suffix.length) continue;
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    longest = at;
    best = { key, star: specifier.slice(prefix.length, specifier.length - suffix.length) };
  }
  return best;
}

/** The target a specifier map gives a specifier, its `*` filled in. */
function mappedTarget(map: unknown, specifier: string): string | null {
  if (typeof map !== "object" || map === null || Array.isArray(map)) return null;
  const record = map as Record<string, unknown>;
  const match = matchKey(Object.keys(record), specifier);
  if (match === null) return null;
  return exportTarget(record[match.key])?.replaceAll("*", match.star) ?? null;
}

/** The target an `exports` map gives a subpath (`.` or `./sub`), patterns included. */
function exportFor(exports: unknown, subpath: string): string | null {
  if (exports === null || exports === undefined) return null;
  if (typeof exports === "string" || Array.isArray(exports)) {
    return subpath === "." ? exportTarget(exports) : null;
  }
  if (typeof exports !== "object") return null;
  const record = exports as Record<string, unknown>;
  if (!Object.keys(record).some((key) => key.startsWith(".")))
    return subpath === "." ? exportTarget(record) : null;
  return mappedTarget(record, subpath);
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

  all(): Iterable<WorkspacePackage> {
    return this.byName.values();
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

// Path aliases: tsconfig `paths` and package.json `imports`, so `~/panes/tree` lands on its file.

/** What a tsconfig says about where imports go, as written. */
export interface TsConfig {
  readonly extends: ReadonlyArray<string>;
  readonly baseUrl: string | null;
  readonly paths: Readonly<Record<string, ReadonlyArray<string>>> | null;
}

const decodeTsConfig = Schema.decodeUnknownOption(
  fromLenientJson(
    Schema.Struct({
      extends: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      compilerOptions: Schema.optionalKey(
        Schema.Struct({
          baseUrl: Schema.optionalKey(Schema.String),
          paths: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
        }),
      ),
    }),
  ),
);

/** Read a tsconfig's text, comments and trailing commas allowed; null when it is not one. */
export function readTsConfig(text: string): TsConfig | null {
  const decoded = decodeTsConfig(text);
  if (Option.isNone(decoded)) return null;
  const { extends: parents, compilerOptions } = decoded.value;
  return {
    extends: parents === undefined ? [] : typeof parents === "string" ? [parents] : parents,
    baseUrl: compilerOptions?.baseUrl ?? null,
    paths: compilerOptions?.paths ?? null,
  };
}

/** Patterns and the repository paths they stand for, each with at most one `*`. */
type Aliases = ReadonlyMap<string, ReadonlyArray<string>>;

const NO_ALIASES: Aliases = new Map();
/** The configs a folder's files take, nearest first; others are only extended. */
const OWN_CONFIGS = ["tsconfig.json", "jsconfig.json"];

interface Setting<A> {
  readonly value: A;
  /** The folder of the config that set it, which its relative paths start from. */
  readonly dir: string;
}

interface Settings {
  readonly baseUrl: Setting<string> | null;
  readonly paths: Setting<Readonly<Record<string, ReadonlyArray<string>>>> | null;
}

/** Each file's tsconfig `paths`: its nearest tsconfig's, following `extends` within the checkout. */
class PathAliases {
  private readonly configs: ReadonlyMap<string, TsConfig>;
  private readonly packages: Packages;
  private readonly byConfig = new Map<string, Aliases>();
  private readonly byFolder = new Map<string, Aliases>();
  private everyAlias: ReadonlyArray<Aliases> | null = null;

  constructor(configs: ReadonlyMap<string, TsConfig>, packages: Packages) {
    this.configs = configs;
    this.packages = packages;
  }

  /** The aliases the nearest tsconfig above a file gives it. */
  forFile(path: string): Aliases {
    return this.forFolder(dirname(path));
  }

  /** Every config's aliases, for finding the files an alias could name. */
  all(): ReadonlyArray<Aliases> {
    this.everyAlias ??= [...this.configs.keys()]
      .filter((path) => OWN_CONFIGS.some((name) => path === name || path.endsWith(`/${name}`)))
      .map((path) => this.ofConfig(path));
    return this.everyAlias;
  }

  private forFolder(folder: string): Aliases {
    const known = this.byFolder.get(folder);
    if (known !== undefined) return known;
    const config = OWN_CONFIGS.map((name) => (folder === "" ? name : `${folder}/${name}`)).find(
      (path) => this.configs.has(path),
    );
    const aliases =
      config !== undefined
        ? this.ofConfig(config)
        : folder === ""
          ? NO_ALIASES
          : this.forFolder(dirname(folder));
    this.byFolder.set(folder, aliases);
    return aliases;
  }

  private ofConfig(path: string): Aliases {
    const known = this.byConfig.get(path);
    if (known !== undefined) return known;
    const { baseUrl, paths } = this.settingsOf(path, new Set());
    const aliases = new Map<string, ReadonlyArray<string>>();
    // Without a baseUrl, paths start from the config that wrote them.
    const base =
      baseUrl === null ? (paths?.dir ?? null) : normalize(`${baseUrl.dir}/${baseUrl.value}`);
    if (paths !== null && base !== null) {
      for (const [pattern, targets] of Object.entries(paths.value)) {
        aliases.set(
          pattern,
          targets.flatMap((target) => normalize(`${base}/${target}`) ?? []),
        );
      }
    }
    this.byConfig.set(path, aliases);
    return aliases;
  }

  /** The baseUrl and paths a config ends with: its own, else the last config it extends that sets them. */
  private settingsOf(path: string, chain: ReadonlySet<string>): Settings {
    const config = this.configs.get(path);
    if (config === undefined || chain.has(path)) return { baseUrl: null, paths: null };
    const dir = dirname(path);
    let { baseUrl, paths }: Settings = { baseUrl: null, paths: null };
    for (const parent of config.extends) {
      const found = this.extended(dir, parent);
      if (found === null) continue;
      const inherited = this.settingsOf(found, new Set([...chain, path]));
      baseUrl = inherited.baseUrl ?? baseUrl;
      paths = inherited.paths ?? paths;
    }
    return {
      baseUrl: config.baseUrl === null ? baseUrl : { value: config.baseUrl, dir },
      paths: config.paths === null ? paths : { value: config.paths, dir },
    };
  }

  /** The config an `extends` names, when the checkout holds it: a path, or a package's file. */
  private extended(dir: string, parent: string): string | null {
    let base: string | null = null;
    if (parent.startsWith(".")) base = normalize(`${dir}/${parent}`);
    else {
      const name = packageNameOf(parent);
      const found = name === null ? undefined : this.packages.get(name);
      if (name !== null && found !== undefined) {
        const sub = parent.slice(name.length);
        base = normalize(`${found.dir}/${sub === "" ? "tsconfig.json" : sub}`);
      }
    }
    if (base === null) return null;
    return [base, `${base}.json`].find((path) => this.configs.has(path)) ?? null;
  }
}

/** What an import can write to reach a file, as `fileAt` reads it: `x.ts` as itself, `x.js` or `x`. */
function basesOf(file: string): ReadonlyArray<string> {
  const typed = /\.([mc]?)ts(x?)$/.exec(file);
  if (typed === null) return [file];
  const stem = file.slice(0, typed.index);
  const [, module = "", jsx = ""] = typed;
  const bases = [file, `${stem}.${module}js${jsx}`];
  if (jsx === "") bases.push(`${stem}.d.${module}ts`);
  if (module === "") bases.push(stem);
  if (module === "" && stem.endsWith("/index")) bases.push(stem.slice(0, -"/index".length));
  return bases;
}

/** The `pkg:` keys stored for imports an alias could write to reach a file. */
function aliasKeys(aliases: Aliases, file: string, keys: Set<string>) {
  for (const [pattern, targets] of aliases) {
    const star = pattern.indexOf("*");
    for (const target of targets) {
      const at = target.indexOf("*");
      const prefix = target.slice(0, at);
      const suffix = target.slice(at + 1);
      for (const base of basesOf(file)) {
        let specifier: string | null = null;
        if (at < 0 || star < 0) specifier = base === target ? pattern.replace("*", "") : null;
        else if (
          base.length >= prefix.length + suffix.length &&
          base.startsWith(prefix) &&
          base.endsWith(suffix)
        ) {
          const middle = base.slice(prefix.length, base.length - suffix.length);
          specifier = `${pattern.slice(0, star)}${middle}${pattern.slice(star + 1)}`;
        }
        const name = specifier === null ? null : packageNameOf(specifier);
        if (name !== null) keys.add(`pkg:${name}`);
      }
    }
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
  private readonly aliases: PathAliases;
  private packageImports: ReadonlyArray<Aliases> | null = null;
  readonly files: ReadonlyMap<string, string>;
  readonly packages: Packages;

  constructor(
    files: ReadonlyMap<string, string>,
    packages: Packages,
    tsConfigs: ReadonlyMap<string, TsConfig>,
  ) {
    this.files = files;
    this.packages = packages;
    this.aliases = new PathAliases(tsConfigs, packages);
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
        const aliases = this.aliases.forFile(from);
        const match = matchKey(aliases.keys(), binding.source);
        if (match !== null) {
          const targets = aliases.get(match.key) ?? [];
          const file = this.fileAmong(targets.map((target) => target.replace("*", match.star)));
          if (file !== null) return { kind: "files", paths: [file] };
          // `~/*` owns its names, so `~/app.css` names no package; a bare `*` owns none.
          if (!match.key.startsWith("*")) return NONE;
        }
        const owner = binding.source.startsWith("#") ? this.packages.owning(from) : null;
        const mapped = owner === null ? null : mappedTarget(owner.imports, binding.source);
        if (owner !== null && mapped !== null) {
          if (!mapped.startsWith("./")) return this.packageTarget(mapped);
          const base = normalize(`${owner.dir}/${mapped}`);
          const file = base === null ? null : this.fileAmong([base]);
          return file === null ? NONE : { kind: "files", paths: [file] };
        }
        return this.packageTarget(binding.source);
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

  /** The first file an alias's targets name, in order; null when none is a file the index reads. */
  private fileAmong(bases: ReadonlyArray<string>): string | null {
    for (const base of bases) {
      const file = fileAt(this.files, base);
      if (file !== null) return file;
    }
    return null;
  }

  private packageTarget(specifier: string): ImportTarget {
    const name = packageNameOf(specifier);
    if (name === null) return NONE;
    const found = this.packages.get(name);
    if (found === undefined) return { kind: "dependency", name };
    return {
      kind: "package",
      name,
      entry: this.packages.fileFor(found, name, this.files),
      file: this.packages.fileFor(found, specifier, this.files),
    };
  }

  /** Each package's `imports` as aliases from the repository's top level. */
  private importAliases(): ReadonlyArray<Aliases> {
    this.packageImports ??= [...this.packages.all()].flatMap((found) => {
      if (typeof found.imports !== "object" || found.imports === null) return [];
      const aliases = new Map<string, ReadonlyArray<string>>();
      for (const [pattern, value] of Object.entries(found.imports)) {
        const target = exportTarget(value);
        const path = target?.startsWith("./") ? normalize(`${found.dir}/${target}`) : null;
        if (path !== null) aliases.set(pattern, [path]);
      }
      return aliases.size === 0 ? [] : [aliases];
    });
    return this.packageImports;
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
    const keys = new Set(offeredKeys(path, language));
    if (language === "typescript" || language === "tsx") {
      const owner = this.packages.owning(path);
      if (owner !== null) keys.add(`pkg:${owner.name}`);
      // An aliased import is stored asking for its first segments, `~` for `~/panes/tree`.
      for (const aliases of [...this.aliases.all(), ...this.importAliases()]) {
        aliasKeys(aliases, path, keys);
      }
    }
    return [...keys];
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

const useKindOf = (kind: ReferenceKind) => USE_KINDS[kind];

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
