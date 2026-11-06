import type { LanguageServerRunContext } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * What a client needs of a checkout to build the command that runs a file's test: the nearest
 * manifest's folder, and which tools it names. Only reads files: nothing here runs one.
 */

type Tools = Omit<LanguageServerRunContext, "trusted" | "python" | "shell">;

export const NO_RUN_TOOLS: Tools = {
  root: "",
  testRunner: null,
  packageRunner: "npx",
  buildTool: null,
  buildCommand: null,
};

const PYTHON_MANIFESTS = ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg", "setup.py"];
const JAVASCRIPT = /\.[cm]?[jt]sx?$/i;

const StringRecord = Schema.Record(Schema.String, Schema.Unknown);
const PackageManifest = Schema.Struct({
  dependencies: Schema.optional(StringRecord),
  devDependencies: Schema.optional(StringRecord),
  scripts: Schema.optional(StringRecord),
  packageManager: Schema.optional(Schema.String),
});
const decodePackage = Schema.decodeUnknownOption(Schema.fromJsonString(PackageManifest));

/** The runner a package's own test script names, else the one it depends on. */
function testRunnerOf(
  manifest: typeof PackageManifest.Type,
): LanguageServerRunContext["testRunner"] {
  const script = manifest.scripts?.test;
  if (typeof script === "string") {
    if (/\bvitest\b/.test(script)) return "vitest";
    if (/\bjest\b/.test(script)) return "jest";
    if (/\bvp\s+test\b/.test(script)) return "vp";
    if (/\bnode\b.*\s--test\b/.test(script)) return "node";
  }
  const depends = (name: string) =>
    manifest.devDependencies?.[name] !== undefined || manifest.dependencies?.[name] !== undefined;
  if (depends("vitest")) return "vitest";
  if (depends("jest")) return "jest";
  return depends("vite-plus") ? "vp" : null;
}

const PACKAGE_RUNNERS: Readonly<Record<string, string>> = {
  pnpm: "pnpm exec",
  yarn: "yarn",
  bun: "bunx",
  npm: "npx",
};

const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm exec"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bunx"],
  ["bun.lockb", "bunx"],
  ["package-lock.json", "npx"],
];

const WRAPPERS = {
  posix: { maven: "mvnw", gradle: "gradlew", here: "./", up: "../" },
  win32: { maven: "mvnw.cmd", gradle: "gradlew.bat", here: ".\\", up: "..\\" },
} as const;

export const readRunTools = Effect.fn("LanguageServers.readRunTools")(function* (
  cwd: string,
  relativePath: string,
  platform: NodeJS.Platform,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here = (folder: string, name: string) => path.join(cwd, folder, name);
  const exists = (file: string) => fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));

  // Nearest first, ending at the checkout's root.
  const parts = relativePath.split("/").slice(0, -1);
  const folders = parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
  folders.push("");

  const nearest = Effect.fnUntraced(function* (names: ReadonlyArray<string>) {
    for (const folder of folders) {
      for (const name of names) {
        if (yield* exists(here(folder, name))) return { folder, name };
      }
    }
    return null;
  });

  const rootOf = Effect.fnUntraced(function* (names: ReadonlyArray<string>) {
    return { ...NO_RUN_TOOLS, root: (yield* nearest(names))?.folder ?? "" };
  });

  /** Java's build, run through the project's wrapper from wherever the wrapper is. */
  const javaTools = Effect.fnUntraced(function* () {
    const found = yield* nearest(["pom.xml", "build.gradle", "build.gradle.kts"]);
    if (found === null) return NO_RUN_TOOLS;
    const buildTool = found.name === "pom.xml" ? ("maven" as const) : ("gradle" as const);
    const wrappers = WRAPPERS[platform === "win32" ? "win32" : "posix"];
    const wrapper = wrappers[buildTool];
    const upward = folders.slice(folders.indexOf(found.folder));
    for (const [levels, folder] of upward.entries()) {
      if (yield* exists(here(folder, wrapper))) {
        const climb = levels === 0 ? wrappers.here : wrappers.up.repeat(levels);
        return { ...NO_RUN_TOOLS, root: found.folder, buildTool, buildCommand: climb + wrapper };
      }
    }
    return {
      ...NO_RUN_TOOLS,
      root: found.folder,
      buildTool,
      buildCommand: buildTool === "maven" ? "mvn" : "gradle",
    };
  });

  /** The nearest package with a runner, for a monorepo whose root holds it. */
  const javaScriptTools = Effect.fnUntraced(function* () {
    let nearestPackage: string | null = null;
    let tested: { folder: string; runner: Tools["testRunner"] } | null = null;
    let packageRunner: string | null = null;
    for (const folder of folders) {
      const text = yield* fileSystem
        .readFileString(here(folder, "package.json"))
        .pipe(Effect.orElseSucceed(() => null));
      const manifest = text === null ? Option.none() : decodePackage(text);
      if (text !== null) nearestPackage ??= folder;
      if (Option.isSome(manifest)) {
        const runner = testRunnerOf(manifest.value);
        if (runner !== null) tested ??= { folder, runner };
        const manager = manifest.value.packageManager?.split("@")[0] ?? "";
        packageRunner ??= PACKAGE_RUNNERS[manager] ?? null;
      }
      for (const [lockfile, runner] of LOCKFILES) {
        if (packageRunner === null && (yield* exists(here(folder, lockfile)))) {
          packageRunner = runner;
        }
      }
    }
    return {
      ...NO_RUN_TOOLS,
      root: tested?.folder ?? nearestPackage ?? "",
      testRunner: tested?.runner ?? null,
      packageRunner: packageRunner ?? NO_RUN_TOOLS.packageRunner,
    };
  });

  if (relativePath.endsWith(".rs")) return yield* rootOf(["Cargo.toml"]);
  if (relativePath.endsWith(".go")) return yield* rootOf(["go.mod"]);
  if (relativePath.endsWith(".py")) return yield* rootOf(PYTHON_MANIFESTS);
  if (relativePath.endsWith(".java")) return yield* javaTools();
  return JAVASCRIPT.test(relativePath) ? yield* javaScriptTools() : NO_RUN_TOOLS;
});
