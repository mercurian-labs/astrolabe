/**
 * Astrolabe: what can run in a code file, read from its text: tests, test groups and entry points,
 * by the conventions each language's tooling goes by. A language server's own answer takes
 * precedence where there is one (`serverRunnables.ts`); this is what stands without it.
 */

export type RunLanguage = "rust" | "go" | "python" | "javascript" | "java";

export type RunKind = "test" | "suite" | "benchmark" | "main";

export interface Detected {
  readonly kind: RunKind;
  /** Its enclosing names, then its own: `["tests", "adds"]`. */
  readonly names: readonly string[];
  /** Where the marker goes, from 1. */
  readonly line: number;
  /** The lines it spans, attributes included, for what the cursor is in. */
  readonly startLine: number;
  readonly endLine: number;
}

export interface DetectedFile {
  readonly language: RunLanguage;
  /** A JavaScript file that imports `node:test`, whatever its package's runner. */
  readonly nodeTest: boolean;
  readonly items: readonly Detected[];
}

/** Whether a position in the text is code, rather than a comment or a string. */
export type IsCode = (line: number, column: number) => boolean;

const LANGUAGES: Readonly<Record<string, RunLanguage>> = {
  rs: "rust",
  go: "go",
  py: "python",
  ts: "javascript",
  tsx: "javascript",
  mts: "javascript",
  cts: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  java: "java",
};

/** The language a file runs as; null for one nothing here runs, which gets no gutter at all. */
export function runLanguageFor(path: string): RunLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : (LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? null);
}

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === "";

/** The line its block ends on: where the indent comes back, a closing bracket included. */
function blockEnd(lines: readonly string[], start: number): number {
  const indent = indentOf(lines[start]!);
  let last = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isBlank(line)) continue;
    if (indentOf(line) > indent) {
      last = index;
      continue;
    }
    if (!/^\s*[)\]}]/.test(line)) return last;
    last = index;
    // `) -> Foo {` carries on a signature that ran over several lines.
    if (!/[{([:]\s*$/.test(line)) return last;
  }
  return last;
}

/** The last line of the block a line opens, both from 1. */
export const blockEndLine = (lines: readonly string[], line: number) =>
  blockEnd(lines, line - 1) + 1;

/** The names open around a line, closed again as the indent comes back. */
class Scopes<Scope extends { readonly indent: number }> {
  readonly open: Scope[] = [];

  at(line: string) {
    if (isBlank(line)) return;
    const indent = indentOf(line);
    while (this.open.length > 0 && this.open.at(-1)!.indent >= indent) this.open.pop();
  }
}

interface Scan {
  readonly lines: readonly string[];
  readonly isCode: IsCode;
  readonly add: (kind: RunKind, names: readonly string[], index: number, start?: number) => void;
}

const RUST_TEST = /^\s*#\[(?:[\w:]*::)?(test|bench)\b/;
const RUST_FN = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/;
const RUST_MOD = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{/;

function scanRust({ lines, isCode, add }: Scan) {
  const scopes = new Scopes<{ readonly indent: number; readonly name: string }>();
  let attribute: { kind: "test" | "bench" | "cfg"; start: number } | null = null;
  lines.forEach((line, index) => {
    scopes.at(line);
    const names = scopes.open.map((scope) => scope.name);
    const test = RUST_TEST.exec(line);
    if (test && isCode(index + 1, indentOf(line))) {
      attribute = { kind: test[1] as "test" | "bench", start: attribute?.start ?? index };
      return;
    }
    if (/^\s*#\[cfg\(test\)\]/.test(line)) {
      attribute = { kind: "cfg", start: attribute?.start ?? index };
      return;
    }
    // Other attributes and doc comments can sit between an attribute and its item.
    if (isBlank(line) || /^\s*(#\[|\/\/)/.test(line)) return;
    const seen = attribute;
    attribute = null;
    const fn = RUST_FN.exec(line);
    if (fn && isCode(index + 1, indentOf(line))) {
      const name = fn[1]!;
      if (seen?.kind === "test" || seen?.kind === "bench") {
        add(seen.kind === "test" ? "test" : "benchmark", [...names, name], index, seen.start);
      } else if (name === "main" && names.length === 0 && indentOf(line) === 0) {
        add("main", ["main"], index);
      }
      return;
    }
    const mod = RUST_MOD.exec(line);
    if (mod && isCode(index + 1, indentOf(line))) {
      const name = mod[1]!;
      if (seen?.kind === "cfg") add("suite", [...names, name], index, seen.start);
      scopes.open.push({ indent: indentOf(line), name });
    }
  });
}

const GO_TEST = /^func\s+(Test(?:[^a-z]\w*)?)\s*\(\s*\w+\s+\*testing\.T\s*\)/;
const GO_BENCHMARK = /^func\s+(Benchmark(?:[^a-z]\w*)?)\s*\(\s*\w+\s+\*testing\.B\s*\)/;

function scanGo({ lines, isCode, add }: Scan, path: string) {
  const isTestFile = path.endsWith("_test.go");
  let isMain = false;
  lines.forEach((line, index) => {
    if (/^package\s+main\b/.test(line)) isMain = true;
    if (!isCode(index + 1, 0)) return;
    const test = isTestFile ? GO_TEST.exec(line) : null;
    if (test) return add("test", [test[1]!], index);
    const benchmark = isTestFile ? GO_BENCHMARK.exec(line) : null;
    if (benchmark) return add("benchmark", [benchmark[1]!], index);
    if (isMain && /^func\s+main\s*\(\s*\)/.test(line)) add("main", ["main"], index);
  });
}

const PY_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
const PY_DEF = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/;
const PY_CLASS = /^\s*class\s+(\w+)\s*(\([^)]*\))?\s*:/;
const PY_MAIN = /^if\s+__name__\s*==\s*["']__main__["']\s*:/;

function scanPython({ lines, isCode, add }: Scan, path: string) {
  const isTestFile = PY_TEST_FILE.test(path);
  const scopes = new Scopes<{
    readonly indent: number;
    readonly name: string;
    readonly isTest: boolean;
  }>();
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  lines.forEach((line, index) => {
    scopes.at(line);
    if (!isCode(index + 1, indentOf(line))) return;
    if (PY_MAIN.test(line)) return add("main", [fileName], index);
    if (!isTestFile) return;
    const names = scopes.open.map((scope) => scope.name);
    const owner = scopes.open.at(-1);
    const classOf = PY_CLASS.exec(line);
    if (classOf) {
      const [, name, bases] = classOf;
      const isTest =
        (owner === undefined || owner.isTest) &&
        (name!.startsWith("Test") || /TestCase\b/.test(bases ?? ""));
      if (isTest) add("suite", [...names, name!], index);
      scopes.open.push({ indent: indentOf(line), name: name!, isTest });
      return;
    }
    const def = PY_DEF.exec(line);
    const collected = owner === undefined ? indentOf(line) === 0 : owner.isTest;
    if (def && collected) add("test", [...names, def[1]!], index);
  });
}

const JS_TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//;
const JS_TEST_IMPORT = /\b(?:from|import|require\()\s*\(?["'](node:test|vitest|@jest\/globals)["']/;
// `.each` and `.for` name their tests from a table, so no one name selects them.
const JS_CALL =
  /^\s*(describe|suite|context|it|test)(?:\.(?!each\b|for\b|todo\b)\w+)*\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\$])*)`)/;

const unescapeJs = (text: string) => text.replace(/\\(.)/g, "$1");

function scanJavaScript({ lines, isCode, add }: Scan, path: string, fileText: string) {
  if (!JS_TEST_FILE.test(path) && !JS_TEST_IMPORT.test(fileText)) return;
  const scopes = new Scopes<{ readonly indent: number; readonly name: string }>();
  lines.forEach((line, index) => {
    scopes.at(line);
    const call = JS_CALL.exec(line);
    if (!call || !isCode(index + 1, indentOf(line))) return;
    const name = unescapeJs(call[2] ?? call[3] ?? call[4] ?? "");
    if (name === "") return;
    const names = [...scopes.open.map((scope) => scope.name), name];
    if (call[1] === "it" || call[1] === "test") return add("test", names, index);
    add("suite", names, index);
    scopes.open.push({ indent: indentOf(line), name });
  });
}

const JAVA_PACKAGE = /^package\s+([\w.]+)\s*;/m;
const JAVA_TEST = /^\s*@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest)\b/;
const JAVA_CLASS = /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*class\s+(\w+)/;
const JAVA_METHOD =
  /^\s*(?:(?:public|protected|private|static|final|synchronized)\s+)*(?:<[^>]+>\s*)?[\w.<>[\],? ]+\s+(\w+)\s*\(/;
const JAVA_MAIN =
  /^\s*(?:public\s+)?static\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\]|\.\.\.)/;

function scanJava({ lines, isCode, add }: Scan, fileText: string) {
  const javaPackage = JAVA_PACKAGE.exec(fileText)?.[1] ?? "";
  const qualified = (name: string) => (javaPackage === "" ? name : `${javaPackage}.${name}`);
  const scopes = new Scopes<{
    readonly indent: number;
    readonly name: string;
    readonly line: number;
    tests: boolean;
  }>();
  let annotation: number | null = null;
  lines.forEach((line, index) => {
    scopes.at(line);
    if (JAVA_TEST.test(line) && isCode(index + 1, indentOf(line))) {
      annotation ??= index;
      return;
    }
    if (isBlank(line) || /^\s*(@|\/\/)/.test(line)) return;
    const start = annotation;
    annotation = null;
    if (!isCode(index + 1, indentOf(line))) return;
    const className = JAVA_CLASS.exec(line)?.[1];
    if (className !== undefined) {
      const outer = scopes.open.at(-1);
      const name = outer === undefined ? qualified(className) : `${outer.name}$${className}`;
      scopes.open.push({ indent: indentOf(line), name, line: index, tests: false });
      return;
    }
    const owner = scopes.open.at(-1);
    if (owner === undefined) return;
    if (JAVA_MAIN.test(line)) return add("main", [owner.name], index);
    const method = start === null ? undefined : JAVA_METHOD.exec(line)?.[1];
    if (method !== undefined && start !== null) {
      add("test", [owner.name, method], index, start);
      if (!owner.tests) {
        owner.tests = true;
        add("suite", [owner.name], owner.line);
      }
    }
  });
}

/** Past this a file is data, not something people write tests in, and each scan would show. */
const SCANNED_LENGTH = 2_000_000;

const ALL_CODE: IsCode = () => true;

/** What can run in `text`, in line order; null where nothing here runs this kind of file. */
export function detectRunnables(
  path: string,
  text: string,
  isCode: IsCode = ALL_CODE,
): DetectedFile | null {
  const language = runLanguageFor(path);
  if (language === null) return null;
  const items: Detected[] = [];
  if (text.length > SCANNED_LENGTH) return { language, nodeTest: false, items };
  const lines = text.split("\n");
  const scan: Scan = {
    lines,
    isCode,
    add: (kind, names, index, start = index) =>
      void items.push({
        kind,
        names,
        line: index + 1,
        startLine: start + 1,
        endLine: blockEnd(lines, index) + 1,
      }),
  };
  if (language === "rust") scanRust(scan);
  else if (language === "go") scanGo(scan, path);
  else if (language === "python") scanPython(scan, path);
  else if (language === "java") scanJava(scan, text);
  else scanJavaScript(scan, path, text);
  return {
    language,
    nodeTest: language === "javascript" && /["']node:test["']/.test(text),
    items: items.toSorted((left, right) => left.line - right.line),
  };
}
