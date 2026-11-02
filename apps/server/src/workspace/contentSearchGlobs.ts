/**
 * Include and exclude globs for project content search.
 *
 * Patterns match workspace-relative POSIX paths, globset style: `*` and `?` also match `/`, `**`
 * matches any number of segments, `{a,b}` alternates and `[...]` is a class. A pattern also matches
 * everything below a directory it matches, so `src/api` and `vendor/` cover their contents.
 */

const GLOB_METACHARACTERS = new Set(["*", "?", "[", "{"]);
const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|/]/g;
// fff reads these tokens from the query as path constraints that cover at least what the glob does.
const FFF_EXTENSION_CONSTRAINT = /^(?:\*\*\/)?\*\.(?:[\w-]+|\{[\w-]+(?:,[\w-]+)*\})$/;
const FFF_DIRECTORY_CONSTRAINT = /^[\w@.-]+(?:\/[\w@.-]+)*$/;

/** Splits on commas outside `{}`. `\,` is a literal comma; other escapes stay for the glob. */
export function splitGlobPatterns(text: string): string[] {
  const patterns: string[] = [];
  let current = "";
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "\\" && index + 1 < text.length) {
      const next = text[index + 1]!;
      current += next === "," ? "," : `\\${next}`;
      index += 1;
    } else if (character === "," && braceDepth === 0) {
      patterns.push(current);
      current = "";
    } else {
      if (character === "{") braceDepth += 1;
      if (character === "}" && braceDepth > 0) braceDepth -= 1;
      current += character;
    }
  }
  patterns.push(current);
  return patterns.flatMap((pattern) => {
    const normalized = normalizePattern(pattern);
    return normalized ? [normalized] : [];
  });
}

function normalizePattern(pattern: string): string {
  let normalized = pattern.trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "/");
  return normalized === "/" ? "" : normalized;
}

function hasBalancedBraces(pattern: string): boolean {
  let depth = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") index += 1;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

function globToRegexSource(pattern: string): string {
  const bracesAreSyntax = hasBalancedBraces(pattern);
  let source = "";
  let braceDepth = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "\\") {
      const next = pattern[index + 1];
      if (next !== undefined) {
        source += next.replace(REGEX_SPECIAL, "\\$&");
        index += 1;
      }
    } else if (character === "*") {
      if (pattern[index + 1] === "*") {
        const atSegmentStart = index === 0 || pattern[index - 1] === "/";
        if (atSegmentStart && pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
          continue;
        }
        index += 1;
      }
      source += ".*";
    } else if (character === "?") {
      source += ".";
    } else if (character === "[") {
      const close = pattern.indexOf("]", index + 2);
      if (close === -1) {
        source += "\\[";
        continue;
      }
      let body = pattern.slice(index + 1, close);
      const negated = body.startsWith("!") || body.startsWith("^");
      if (negated) body = body.slice(1);
      source += `[${negated ? "^" : ""}${body.replaceAll("\\", "\\\\").replaceAll("]", "\\]")}]`;
      index = close;
    } else if (bracesAreSyntax && character === "{") {
      braceDepth += 1;
      source += "(?:";
    } else if (bracesAreSyntax && character === "}" && braceDepth > 0) {
      braceDepth -= 1;
      source += ")";
    } else if (bracesAreSyntax && character === "," && braceDepth > 0) {
      source += "|";
    } else {
      source += character.replace(REGEX_SPECIAL, "\\$&");
    }
  }
  return source;
}

/** Characters before the first unescaped metacharacter, with escapes resolved. */
function literalPrefix(pattern: string): string {
  let prefix = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "\\") {
      prefix += pattern[index + 1] ?? "";
      index += 1;
    } else if (GLOB_METACHARACTERS.has(character)) {
      return prefix;
    } else {
      prefix += character;
    }
  }
  return prefix;
}

function fffIncludeConstraint(pattern: string): string | null {
  if (FFF_EXTENSION_CONSTRAINT.test(pattern)) return pattern;
  const directory = pattern.endsWith("/**")
    ? pattern.slice(0, -3)
    : pattern.endsWith("/")
      ? pattern.slice(0, -1)
      : null;
  return directory !== null &&
    FFF_DIRECTORY_CONSTRAINT.test(directory) &&
    !directory.split("/").some((segment) => segment === "." || segment === "..")
    ? `${directory}/`
    : null;
}

export interface ContentSearchPathFilter {
  readonly matches: (path: string) => boolean;
  /** False when nothing below `directory` can pass the filter, so a walk can skip it. */
  readonly mayMatchBelow: (directory: string) => boolean;
  /** Tokens to put before the query so fff skips files by path before reading them. */
  readonly fffConstraints: ReadonlyArray<string>;
}

interface CompiledGlob {
  readonly regex: RegExp;
  readonly prefix: string;
}

function compileGlob(pattern: string): CompiledGlob {
  const glob = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  return {
    regex: new RegExp(`^${globToRegexSource(glob)}(?:/.*)?$`, "s"),
    prefix: literalPrefix(glob),
  };
}

export function makeContentSearchPathFilter(input: {
  readonly include?: string | undefined;
  readonly exclude?: string | undefined;
}): ContentSearchPathFilter | null {
  const includePatterns = splitGlobPatterns(input.include ?? "");
  const excludePatterns = splitGlobPatterns(input.exclude ?? "");
  if (includePatterns.length === 0 && excludePatterns.length === 0) return null;

  const includes = includePatterns.map(compileGlob);
  const excludes = excludePatterns.map(compileGlob);
  const isExcluded = (path: string) => excludes.some((glob) => glob.regex.test(path));
  const fffIncludes = includePatterns.map(fffIncludeConstraint);

  return {
    matches: (path) =>
      (includes.length === 0 || includes.some((glob) => glob.regex.test(path))) &&
      !isExcluded(path),
    mayMatchBelow: (directory) => {
      if (isExcluded(directory)) return false;
      const below = `${directory}/`;
      return (
        includes.length === 0 ||
        includes.some((glob) => glob.prefix.startsWith(below) || below.startsWith(glob.prefix))
      );
    },
    // Exclusions stay out: fff would drop files the globs keep (it ignores case, and `api/` matches any depth).
    fffConstraints: fffIncludes.every((constraint) => constraint !== null) ? fffIncludes : [],
  };
}
