// Enforces the sidecar rules in AGENTS.md against the upstream base recorded in
// apps/mercurian/sidecar.json:
//
//   - main builds on that base by rebase, and never has upstream merged in;
//   - nothing outside apps/mercurian/ and docs/mercurian/ changes, except the
//     paths the config allows;
//   - code under apps/mercurian/ imports no upstream package except the ones
//     the config allows.
//
// Usage: node apps/mercurian/scripts/sidecar-check.ts [--upstream-ref <ref>]
//
// Pass --upstream-ref (a fetched upstream branch) to also catch upstream
// commits that reached main after the recorded base. CI always passes it.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const CONFIG_PATH = "apps/mercurian/sidecar.json";
const MERCURIAN_DIRS = ["apps/mercurian/", "docs/mercurian/"];
const MERCURIAN_CODE_DIR = "apps/mercurian/";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export interface SidecarConfig {
  readonly upstream: {
    readonly repository: string;
    readonly branch: string;
    readonly base: string;
  };
  readonly allowedChangesOutsideMercurian: ReadonlyArray<string>;
  readonly importableUpstreamPackages: ReadonlyArray<string>;
}

export interface Violation {
  readonly rule: "history" | "upstream-edit" | "upstream-import";
  readonly file?: string;
  readonly message: string;
}

const git = (root: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

const gitSucceeds = (root: string, args: ReadonlyArray<string>): boolean => {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
};

const lines = (output: string): Array<string> => output.split("\n").filter((line) => line !== "");

const isAncestor = (root: string, ancestor: string, descendant: string): boolean =>
  gitSucceeds(root, ["merge-base", "--is-ancestor", ancestor, descendant]);

export const readConfig = (root: string): SidecarConfig =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(root, CONFIG_PATH), "utf8")) as SidecarConfig;

/** Main must descend from the recorded base, and every commit since it must be ours. */
export const checkHistory = (
  root: string,
  config: SidecarConfig,
  upstreamRef?: string,
): Array<Violation> => {
  const base = config.upstream.base;
  if (!gitSucceeds(root, ["cat-file", "-e", `${base}^{commit}`])) {
    return [
      {
        rule: "history",
        message: `The recorded upstream base ${base} is not in this clone. Fetch full history, or fix the base in ${CONFIG_PATH}.`,
      },
    ];
  }
  if (!isAncestor(root, base, "HEAD")) {
    return [
      {
        rule: "history",
        message: `HEAD does not build on the recorded upstream base ${base}. After moving main onto upstream, record the new base in ${CONFIG_PATH}.`,
      },
    ];
  }

  const violations: Array<Violation> = [];
  for (const line of lines(git(root, ["rev-list", "--merges", "--parents", `${base}..HEAD`]))) {
    const [merge, ...parents] = line.split(" ");
    const foreign = parents.filter((parent) => !isAncestor(root, base, parent));
    if (foreign.length > 0) {
      violations.push({
        rule: "history",
        message: `Merge ${merge} brings in history that does not build on the recorded upstream base (${foreign.join(", ")}). Main moves onto upstream by rebase, never by merging upstream in.`,
      });
    }
  }

  if (upstreamRef !== undefined) {
    const upstreamCommits = new Set(lines(git(root, ["rev-list", upstreamRef, `^${base}`])));
    const merged = lines(git(root, ["rev-list", "HEAD", `^${base}`])).filter((commit) =>
      upstreamCommits.has(commit),
    );
    if (merged.length > 0) {
      violations.push({
        rule: "history",
        message: `HEAD contains ${merged.length} upstream commit(s) after the recorded base, such as ${merged
          .slice(0, 3)
          .join(
            ", ",
          )}. Either upstream was merged in, or main moved onto upstream without recording the new base in ${CONFIG_PATH}.`,
      });
    }
  }
  return violations;
};

/** Every path changed since the base must be Mercurian's own or explicitly allowed. */
export const checkChangedFiles = (root: string, config: SidecarConfig): Array<Violation> => {
  const allowed = new Set(config.allowedChangesOutsideMercurian);
  return lines(git(root, ["diff", "--name-only", "--no-renames", config.upstream.base, "HEAD"]))
    .filter((file) => !MERCURIAN_DIRS.some((dir) => file.startsWith(dir)) && !allowed.has(file))
    .map((file) => ({
      rule: "upstream-edit" as const,
      file,
      message: `${file} is upstream's. Move the change under apps/mercurian/ or docs/mercurian/, or add the path to allowedChangesOutsideMercurian in ${CONFIG_PATH}.`,
    }));
};

/** Blanks out comments, keeping string contents and line structure. */
const stripComments = (source: string): string => {
  let output = "";
  let quote: string | undefined;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote !== undefined) {
      output += char;
      if (char === "\\") output += source[++index] ?? "";
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += char;
    } else if (source.startsWith("//", index)) {
      while (index < source.length && source[index] !== "\n") index++;
      output += "\n";
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
      output += " ";
    } else {
      output += char;
    }
  }
  return output;
};

const MODULE_KEYWORDS = new Set(["from", "import", "require"]);
const WORD = /[\w$]+/y;
const SPECIFIER_OPENING = /\s*\(?\s*(["'])/y;

/** Index just past the string or template literal opening at `start`. */
const skipString = (source: string, start: number): number => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length && source[index] !== quote) {
    index += source[index] === "\\" ? 2 : 1;
  }
  return index + 1;
};

/**
 * Module specifiers in code position: static imports and re-exports
 * (`from "x"`, `import "x"`), `import("x")`, and `require("x")`. Text inside
 * comments and other string literals is never read as a specifier.
 */
export const moduleSpecifiers = (source: string): Array<string> => {
  const code = stripComments(source);
  const specifiers: Array<string> = [];
  let index = 0;
  while (index < code.length) {
    const char = code[index]!;
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(code, index);
    } else if (/[A-Za-z_$]/.test(char)) {
      // `Buffer.from("x")` and other property accesses are not module keywords.
      const isProperty = /\.\s*$/.test(code.slice(Math.max(0, index - 8), index));
      WORD.lastIndex = index;
      const word = WORD.exec(code)![0];
      index += word.length;
      SPECIFIER_OPENING.lastIndex = index;
      const opening =
        MODULE_KEYWORDS.has(word) && !isProperty ? SPECIFIER_OPENING.exec(code) : null;
      if (opening !== null) {
        const open = index + opening[0].length - 1;
        index = skipString(code, open);
        specifiers.push(code.slice(open + 1, index - 1));
      }
    } else {
      index++;
    }
  }
  return specifiers;
};

const parseJsonc = (source: string): unknown =>
  JSON.parse(stripComments(source).replace(/,(\s*[}\]])/g, "$1"));

const packageNameOf = (specifier: string): string => {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
};

const isInsideMercurian = (root: string, absolutePath: string): boolean => {
  const relative = NodePath.relative(root, absolutePath).split(NodePath.sep).join("/");
  return `${relative}/`.startsWith(MERCURIAN_CODE_DIR) || relative.includes("node_modules/");
};

/** Names of every workspace package upstream owns. */
const upstreamPackageNames = (root: string): Set<string> => {
  const names = new Set<string>();
  for (const file of lines(git(root, ["ls-files", "--", ":(glob)**/package.json"]))) {
    if (file.startsWith(MERCURIAN_CODE_DIR) || file.startsWith(".repos/")) continue;
    const name = (
      JSON.parse(NodeFS.readFileSync(NodePath.join(root, file), "utf8")) as { name?: unknown }
    ).name;
    if (typeof name === "string") names.add(name);
  }
  return names;
};

/** Code under apps/mercurian/ reaches upstream only through the importable packages. */
export const checkImports = (root: string, config: SidecarConfig): Array<Violation> => {
  const importable = new Set(config.importableUpstreamPackages);
  const forbidden = upstreamPackageNames(root);
  for (const name of importable) forbidden.delete(name);

  const violations: Array<Violation> = [];
  const forbid = (file: string, message: string) =>
    violations.push({ rule: "upstream-import", file, message });

  for (const file of lines(git(root, ["ls-files", "--", MERCURIAN_CODE_DIR]))) {
    const absolute = NodePath.join(root, file);
    const basename = NodePath.basename(file);

    if (CODE_EXTENSIONS.has(NodePath.extname(file))) {
      const source = NodeFS.readFileSync(absolute, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          if (!isInsideMercurian(root, NodePath.resolve(NodePath.dirname(absolute), specifier))) {
            forbid(file, `${file} imports "${specifier}", which reaches outside apps/mercurian/.`);
          }
        } else if (forbidden.has(packageNameOf(specifier))) {
          forbid(file, `${file} imports upstream package "${specifier}".`);
        }
      }
    } else if (basename === "package.json") {
      const manifest = JSON.parse(NodeFS.readFileSync(absolute, "utf8")) as Record<string, unknown>;
      for (const field of DEPENDENCY_FIELDS) {
        const dependencies = manifest[field];
        if (typeof dependencies !== "object" || dependencies === null) continue;
        for (const name of Object.keys(dependencies)) {
          if (forbidden.has(name)) {
            forbid(file, `${file} depends on upstream package "${name}" in ${field}.`);
          }
        }
      }
    } else if (/^tsconfig.*\.json$/.test(basename)) {
      const tsconfig = parseJsonc(NodeFS.readFileSync(absolute, "utf8"));
      const options = (tsconfig as { compilerOptions?: { baseUrl?: string; paths?: unknown } })
        ?.compilerOptions;
      if (typeof options?.paths !== "object" || options.paths === null) continue;
      const pathsRoot = NodePath.resolve(NodePath.dirname(absolute), options.baseUrl ?? ".");
      for (const [alias, targets] of Object.entries(options.paths)) {
        for (const target of Array.isArray(targets) ? targets : []) {
          if (typeof target !== "string") continue;
          if (!isInsideMercurian(root, NodePath.resolve(pathsRoot, target.replace(/\*.*$/, "")))) {
            forbid(
              file,
              `${file} maps "${alias}" to "${target}", which is outside apps/mercurian/.`,
            );
          }
        }
      }
    }
  }
  return violations;
};

export const checkSidecar = (root: string, upstreamRef?: string): Array<Violation> => {
  const config = readConfig(root);
  const history = checkHistory(root, config, upstreamRef);
  // Without a usable base there is nothing to diff against.
  const baseUsable =
    gitSucceeds(root, ["cat-file", "-e", `${config.upstream.base}^{commit}`]) &&
    isAncestor(root, config.upstream.base, "HEAD");
  return [
    ...history,
    ...(baseUsable ? checkChangedFiles(root, config) : []),
    ...checkImports(root, config),
  ];
};

const main = () => {
  const args = process.argv.slice(2);
  const refIndex = args.indexOf("--upstream-ref");
  const upstreamRef = refIndex === -1 ? undefined : args[refIndex + 1];
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();

  const violations = checkSidecar(root, upstreamRef);
  if (violations.length === 0) {
    console.log("Sidecar rules hold.");
    return;
  }

  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const violation of violations) {
    console.error(`[${violation.rule}] ${violation.message}`);
    if (annotate) {
      const location = violation.file === undefined ? "" : ` file=${violation.file}`;
      console.error(`::error${location}::${violation.message}`);
    }
  }
  console.error(`\n${violations.length} sidecar rule violation(s). See AGENTS.md.`);
  process.exitCode = 1;
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href
) {
  main();
}
