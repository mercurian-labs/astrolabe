/**
 * Which files an import names. Each file offers keys (its path, its dotted or
 * `::` module names, its package directory), each import asks for keys in order
 * of preference, and the first key some file offers wins. Keeping both sides
 * as keys lets a change re-resolve exactly the imports a new or deleted file
 * could answer.
 */
import type { LanguageId } from "../parse/languages.ts";

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

/** Every trailing run of segments, longest first. */
const suffixes = (segments: ReadonlyArray<string>, join: string) =>
  segments.map((_, start) => segments.slice(start).join(join));

const family = (language: LanguageId) => (language === "tsx" ? "typescript" : language);

/** The keys a file answers to. */
export function offeredKeys(path: string, language: LanguageId): ReadonlyArray<string> {
  switch (family(language)) {
    case "typescript":
      return [`ts:${path}`];
    case "python": {
      const segments = path.replace(/\.py$/, "").split("/");
      if (segments.at(-1) === "__init__") segments.pop();
      return suffixes(segments, ".").map((key) => `py:${key}`);
    }
    case "go":
      return suffixes(dirname(path).split("/").filter(Boolean), "/").map((key) => `go:${key}`);
    default: {
      const segments = path.replace(/\.rs$/, "").split("/");
      const last = segments.at(-1);
      if (last === "mod" || last === "lib" || last === "main") segments.pop();
      return suffixes(segments, "::").map((key) => `rs:${key}`);
    }
  }
}

function pythonModule(from: string, source: string): string | null {
  const dots = /^\.*/.exec(source)?.[0].length ?? 0;
  if (dots === 0) return source;
  // One dot is the importing file's package; each further dot climbs one.
  let base = dirname(from).split("/").filter(Boolean);
  for (let climb = 1; climb < dots; climb += 1) {
    if (base.length === 0) return null;
    base = base.slice(0, -1);
  }
  const rest = source.slice(dots);
  return [...base, ...(rest === "" ? [] : rest.split("."))].join(".");
}

function rustModule(from: string, source: string): string | null {
  const segments = source.split("::");
  const own = from.replace(/\.rs$/, "").split("/");
  const last = own.at(-1);
  const isModRoot = last === "mod" || last === "lib" || last === "main";
  // The importing file's own module path, and the directory its children live in.
  const self = isModRoot ? own.slice(0, -1) : own;
  let at = self;
  const out: Array<string> = [];
  for (const [index, segment] of segments.entries()) {
    if (index === 0 && segment === "crate") {
      at = [];
      continue;
    }
    if (index === 0 && segment === "self") continue;
    if (segment === "super") {
      if (at.length === 0) return null;
      at = at.slice(0, -1);
      continue;
    }
    out.push(segment);
  }
  const relative = segments[0] === "self" || segments[0] === "super";
  return [...(relative ? at : []), ...out].join("::");
}

/**
 * The keys an import asks for, most specific first. `member` asks for a
 * submodule of that name first (`from a import b` may name module `a.b`).
 */
export function wantedKeys(
  language: LanguageId,
  from: string,
  source: string,
  member: string | null = null,
): ReadonlyArray<string> {
  switch (family(language)) {
    case "typescript": {
      if (!source.startsWith(".")) return [];
      const base = normalize(`${dirname(from)}/${source}`);
      if (base === null) return [];
      const swapped = base.replace(/\.(m|c)?jsx?$/, (extension) => extension.replace("js", "ts"));
      return [
        base,
        swapped,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].map((path) => `ts:${path}`);
    }
    case "python": {
      const module = pythonModule(from, source);
      if (module === null) return [];
      const names = member === null ? [module] : [`${module}.${member}`, module];
      return names.map((name) => `py:${name.replace(/^\./, "")}`);
    }
    case "go": {
      const segments = source.split("/");
      return suffixes(segments, "/").map((key) => `go:${key}`);
    }
    default: {
      const module = rustModule(from, source);
      if (module === null) return [];
      const names = member === null ? [module] : [`${module}::${member}`, module];
      return names.filter((name) => name !== "").map((name) => `rs:${name}`);
    }
  }
}

export class ModuleIndex {
  private readonly byKey = new Map<string, Set<string>>();

  add(path: string, language: LanguageId): void {
    for (const key of offeredKeys(path, language)) {
      let paths = this.byKey.get(key);
      if (paths === undefined) {
        paths = new Set();
        this.byKey.set(key, paths);
      }
      paths.add(path);
    }
  }

  remove(path: string, language: LanguageId): void {
    for (const key of offeredKeys(path, language)) {
      const paths = this.byKey.get(key);
      paths?.delete(path);
      if (paths?.size === 0) this.byKey.delete(key);
    }
  }

  /** The files the first answered key names, or none. */
  lookup(keys: ReadonlyArray<string>): ReadonlySet<string> {
    for (const key of keys) {
      const paths = this.byKey.get(key);
      if (paths !== undefined && paths.size > 0) return paths;
    }
    return EMPTY;
  }
}

const EMPTY: ReadonlySet<string> = new Set();
