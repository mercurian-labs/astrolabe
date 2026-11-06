import type { Detected, DetectedFile, RunKind } from "./detect.ts";

/**
 * Astrolabe: the shell command that runs what `detect.ts` found. What it needs of the checkout
 * comes from the environment (`RunContext`), since only it can see the checkout's files.
 */

export type TestRunner = "vitest" | "jest" | "node" | "vp";

/** The environment's `languageServers.runContext`, for what a command is built from. */
export interface RunContext {
  /** The nearest manifest's folder, within the checkout; "" at its root. */
  readonly root: string;
  readonly python: string;
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

/** `text` as one word to a POSIX shell. PowerShell reads a single-quoted word the same way. */
export function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Test names are read as regular expressions by every runner's name filter. */
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `path` from `root`, or null when it isn't inside. */
function within(root: string, path: string): string | null {
  if (root === "") return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

function rustCommand(item: Detected, relative: string): string {
  const name = item.names.join("::");
  const bin = /^src\/bin\/(?:([^/]+)\/main|([^/]+))\.rs$/.exec(relative);
  const binName = bin?.[1] ?? bin?.[2];
  if (item.kind === "main") {
    if (binName !== undefined) return `cargo run --bin ${shellQuote(binName)}`;
    const example = /^examples\/([^/]+)\.rs$/.exec(relative)?.[1];
    return example === undefined ? "cargo run" : `cargo run --example ${shellQuote(example)}`;
  }
  const target = /^tests\/([^/]+)\.rs$/.exec(relative)?.[1];
  const scope =
    target !== undefined
      ? ` --test ${shellQuote(target)}`
      : binName !== undefined
        ? ` --bin ${shellQuote(binName)}`
        : "";
  return `cargo ${item.kind === "benchmark" ? "bench" : "test"}${scope} ${shellQuote(name)}`;
}

function goCommand(item: Detected, relative: string): string {
  const folder = folderOf(relative);
  const pkg = folder === "" ? "." : `./${folder}`;
  const name = item.names.at(-1)!;
  if (item.kind === "main") return `go run ${pkg}`;
  return item.kind === "benchmark"
    ? `go test -run '^$' -bench ${shellQuote(`^${name}$`)} ${pkg}`
    : `go test -run ${shellQuote(`^${name}$`)} ${pkg}`;
}

function pythonCommand(item: Detected, relative: string, context: RunContext): string {
  const python = shellQuote(context.python);
  if (item.kind === "main") return `${python} ${shellQuote(relative)}`;
  return `${python} -m pytest ${shellQuote([relative, ...item.names].join("::"))}`;
}

function javaScriptCommand(
  item: Detected,
  relative: string,
  file: DetectedFile,
  context: RunContext,
): string | null {
  const runner = file.nodeTest ? "node" : context.testRunner;
  const target = shellQuote(relative);
  const pattern = shellQuote(escapePattern(item.names.join(" ")));
  switch (runner) {
    case "vitest":
      return `${context.packageRunner} vitest run ${target} -t ${pattern}`;
    case "jest":
      return `${context.packageRunner} jest ${target} -t ${pattern}`;
    case "vp":
      return `vp test run ${target} -t ${pattern}`;
    case "node":
      // Node matches each test by itself, not by its describes' names before it.
      return `node --test --test-name-pattern=${shellQuote(escapePattern(item.names.at(-1)!))} ${target}`;
    case null:
      return null;
  }
}

function javaCommand(item: Detected, relative: string, context: RunContext): string | null {
  const [owner, method] = item.names;
  const { buildCommand: tool, buildTool } = context;
  if (item.kind === "main") {
    if (buildTool === "maven") return `${tool} compile exec:java -Dexec.mainClass=${owner}`;
    return buildTool === "gradle" ? `${tool} run` : `java ${shellQuote(relative)}`;
  }
  if (buildTool === "maven") {
    return `${tool} test -Dtest=${shellQuote(method === undefined ? owner! : `${owner}#${method}`)}`;
  }
  if (buildTool === "gradle") {
    const name = method === undefined ? owner! : `${owner}.${method}`;
    return `${tool} test --tests ${shellQuote(name)}`;
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
  const command = {
    rust: () => rustCommand(item, relative),
    go: () => goCommand(item, relative),
    python: () => pythonCommand(item, relative, context),
    javascript: () => javaScriptCommand(item, relative, file, context),
    java: () => javaCommand(item, relative, context),
  }[file.language]();
  if (command === null) return null;
  return {
    kind: item.kind,
    name: tabName(item, file, path),
    command,
    directory: context.root,
  };
}
