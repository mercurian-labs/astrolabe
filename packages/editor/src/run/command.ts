import type { Detected, DetectedFile, RunKind } from "./detect.ts";

/**
 * Astrolabe: the shell command that runs what `detect.ts` found. What it needs of the checkout
 * comes from the environment (`RunContext`), since only it can see the checkout's files.
 */

export type TestRunner = "vitest" | "jest" | "node" | "vp";

/** How the environment's terminals read a line: fish and PowerShell differ from POSIX. */
export type ShellFamily = "posix" | "fish" | "powershell" | "cmd";

/** The environment's `languageServers.runContext`, for what a command is built from. */
export interface RunContext {
  /** The nearest manifest's folder, within the checkout; "" at its root. */
  readonly root: string;
  readonly python: string;
  readonly shell: ShellFamily;
  readonly testRunner: TestRunner | null;
  /** What runs a package's own binary: "npx", "pnpm exec". */
  readonly packageRunner: string;
  readonly buildTool: "maven" | "gradle" | null;
  /** The project's wrapper where it has one: "./mvnw", "../gradlew", "mvn". */
  readonly buildCommand: string | null;
}

export interface RunTarget {
  readonly kind: RunKind;
  /** What its terminal tab is called. */
  readonly name: string;
  readonly command: string;
  /** The folder it runs in, within the checkout; "" at its root. */
  readonly directory: string;
}

// A command reaches an interactive shell, whose line editor acts on keys before any parsing:
// Ctrl-U erases what was typed, Tab completes. Invisible text would make what's shown a lie.
const NOT_TYPED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// cmd has no quote that keeps a double quote or a %VARIABLE% literal.
const NOT_QUOTABLE_IN_CMD = /["%]/;

/** Whether `text` can go on a command line as text, under `shell`. */
export const isRunnableText = (text: string, shell: ShellFamily) =>
  !NOT_TYPED.test(text) && !(shell === "cmd" && NOT_QUOTABLE_IN_CMD.test(text));

/** `text` as one word to `shell`. Text `isRunnableText` refuses has no safe form in cmd. */
export function shellQuote(text: string, shell: ShellFamily): string {
  switch (shell) {
    case "posix":
      return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
    case "fish":
      // Unlike POSIX, fish reads \\ and \' inside single quotes.
      return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/[\\']/g, "\\$&")}'`;
    case "powershell":
      // A bare word that starts with a dash splits at its first dot.
      return /^[\w./\\:][\w./\\:-]*$/.test(text) ? text : `'${text.replaceAll("'", "''")}'`;
    case "cmd":
      return /^[\w@+=:,./\\-]+$/.test(text) ? text : `"${text}"`;
  }
}

type Quote = (text: string) => string;

/** Test names are read as regular expressions by every runner's name filter. */
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `path` from `root`, or null when it isn't inside. */
function within(root: string, path: string): string | null {
  if (root === "") return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

function rustCommand(item: Detected, relative: string, quote: Quote): string {
  const name = item.names.join("::");
  const bin = /^src\/bin\/(?:([^/]+)\/main|([^/]+))\.rs$/.exec(relative);
  const binName = bin?.[1] ?? bin?.[2];
  if (item.kind === "main") {
    if (binName !== undefined) return `cargo run --bin ${quote(binName)}`;
    const example = /^examples\/([^/]+)\.rs$/.exec(relative)?.[1];
    return example === undefined ? "cargo run" : `cargo run --example ${quote(example)}`;
  }
  const target = /^tests\/([^/]+)\.rs$/.exec(relative)?.[1];
  const scope =
    target !== undefined
      ? ` --test ${quote(target)}`
      : binName !== undefined
        ? ` --bin ${quote(binName)}`
        : "";
  return `cargo ${item.kind === "benchmark" ? "bench" : "test"}${scope} ${quote(name)}`;
}

function goCommand(item: Detected, relative: string, quote: Quote): string {
  const folder = folderOf(relative);
  const pkg = folder === "" ? "." : `./${folder}`;
  const name = item.names.at(-1)!;
  if (item.kind === "main") return `go run ${quote(pkg)}`;
  return item.kind === "benchmark"
    ? `go test -run ${quote("^$")} -bench ${quote(`^${name}$`)} ${quote(pkg)}`
    : `go test -run ${quote(`^${name}$`)} ${quote(pkg)}`;
}

function pythonCommand(item: Detected, relative: string, context: RunContext, quote: Quote) {
  const quoted = quote(context.python);
  // A quoted path is a string to PowerShell until `&` says to run it.
  const python = context.shell === "powershell" && quoted.startsWith("'") ? `& ${quoted}` : quoted;
  if (item.kind === "main") return `${python} ${quote(relative)}`;
  return `${python} -m pytest ${quote([relative, ...item.names].join("::"))}`;
}

function javaScriptCommand(
  item: Detected,
  relative: string,
  file: DetectedFile,
  context: RunContext,
  quote: Quote,
): string | null {
  const runner = file.nodeTest ? "node" : context.testRunner;
  const target = quote(relative);
  const pattern = quote(escapePattern(item.names.join(" ")));
  switch (runner) {
    case "vitest":
      return `${context.packageRunner} vitest run ${target} -t ${pattern}`;
    case "jest":
      return `${context.packageRunner} jest ${target} -t ${pattern}`;
    case "vp":
      return `vp test run ${target} -t ${pattern}`;
    case "node": {
      // Node matches each test by itself, not by its describes' names before it.
      const own = escapePattern(item.names.at(-1)!);
      return `node --test ${quote(`--test-name-pattern=${own}`)} ${target}`;
    }
    case null:
      return null;
  }
}

function javaCommand(
  item: Detected,
  relative: string,
  context: RunContext,
  quote: Quote,
): string | null {
  const [owner, method] = item.names;
  const { buildCommand: tool, buildTool } = context;
  if (item.kind === "main") {
    if (buildTool === "maven") {
      return `${tool} compile exec:java ${quote(`-Dexec.mainClass=${owner}`)}`;
    }
    return buildTool === "gradle" ? `${tool} run` : `java ${quote(relative)}`;
  }
  if (buildTool === "maven") {
    return `${tool} test ${quote(`-Dtest=${method === undefined ? owner : `${owner}#${method}`}`)}`;
  }
  if (buildTool === "gradle") {
    const name = method === undefined ? owner! : `${owner}.${method}`;
    return `${tool} test --tests ${quote(name)}`;
  }
  return null;
}

/** What a tab is called: the file for an entry point, else the test as its language writes it. */
function tabName(item: Detected, file: DetectedFile, path: string): string {
  if (item.kind === "main") return `Run ${path.slice(path.lastIndexOf("/") + 1)}`;
  if (file.language === "rust") return item.names.join("::");
  if (file.language === "python") return item.names.join(".");
  if (file.language !== "java") return item.names.join(" ");
  return item.names.join(".").slice(item.names[0]!.lastIndexOf(".") + 1);
}

/** The command for `item`, of the file at `path`; null when nothing here can run it. */
export function runTargetFor(
  file: DetectedFile,
  item: Detected,
  path: string,
  context: RunContext,
): RunTarget | null {
  const relative = within(context.root, path);
  if (relative === null) return null;
  const runnable = (text: string) => isRunnableText(text, context.shell);
  if (!item.names.every(runnable) || !runnable(path)) return null;
  const quote: Quote = (text) => shellQuote(text, context.shell);
  const command = {
    rust: () => rustCommand(item, relative, quote),
    go: () => goCommand(item, relative, quote),
    python: () => pythonCommand(item, relative, context, quote),
    javascript: () => javaScriptCommand(item, relative, file, context, quote),
    java: () => javaCommand(item, relative, context, quote),
  }[file.language]();
  if (command === null || NOT_TYPED.test(command)) return null;
  return {
    kind: item.kind,
    name: tabName(item, file, path),
    command,
    directory: context.root,
  };
}
