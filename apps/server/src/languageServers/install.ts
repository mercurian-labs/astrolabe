// @effect-diagnostics nodeBuiltinImport:off - Effect has no gunzip or SHA digests.
import type { LanguageServerSource } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";
import { CommandResolutionCache, resolveCommandPath } from "@t3tools/shared/shell";
import * as EffectNodeStream from "@effect/platform-node/NodeStream";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";

import { openZipArchive } from "../zipArchive.ts";
import {
  fillPlatform,
  type GoSource,
  type LanguageServerSpec,
  type Launch,
  licenceAllowed,
  type NpmSource,
  type ReleaseAsset,
  type ReleaseSource,
} from "./registry.ts";
import { parseJson } from "./json.ts";
import { mergeJson } from "./settings.ts";
import { readTar, type TarFile } from "./tar.ts";
import { checkoutInterpreters, findJavaInstalls, findPythonInterpreters } from "./toolchains.ts";

/**
 * Finding a language server's binary, in the ruled order: the project's own (or one installed on
 * the machine), then our cache under T3 home shared by every checkout, then a download into it.
 */

export interface ResolvedServer {
  /** The server's own file: `executable` itself, or the script Node runs. */
  readonly binary: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly name: string;
  readonly source: LanguageServerSource;
  readonly initializationOptions: unknown;
  /** Answers to `workspace/configuration`, by section. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly reportsQuiescence: boolean;
  /** Sent once after `initialized`. */
  readonly notifications: ReadonlyArray<string>;
}

/** Something the launch that applies needs, which isn't cached yet. */
export type Download =
  | { readonly kind: "npm"; readonly npm: NpmSource }
  | {
      readonly kind: "release";
      readonly release: ReleaseSource;
      readonly asset: ReleaseAsset;
      /** The machine's Java that will run it, for a release that needs one. */
      readonly java: string | null;
    }
  | { readonly kind: "go"; readonly go: GoSource; readonly goCommand: string };

export type Resolution =
  | { readonly type: "ready"; readonly server: ResolvedServer }
  | { readonly type: "download"; readonly name: string; readonly download: Download }
  /** An untrusted checkout's server that won't start until it is trusted; `message` says why. */
  | { readonly type: "trust-needed"; readonly name: string; readonly message: string }
  | { readonly type: "unavailable"; readonly message: string };

/** "rust-analyzer 2026-11-02 (MIT OR Apache-2.0) needs downloading from GitHub." */
export const describeDownload = (download: Download): string => {
  switch (download.kind) {
    case "npm":
      return `${download.npm.name} ${download.npm.version} (${download.npm.licence}) needs downloading from npm.`;
    case "release":
      return `${download.release.name} ${download.release.version} (${download.release.licence}) needs downloading from ${download.release.host}.`;
    case "go":
      return `${download.go.name} ${download.go.version} (${download.go.licence}) needs building with Go.`;
  }
};

class InstallError extends Data.TaggedError("InstallError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const COMPLETE = ".astrolabe-complete";
const PROBE_TIMEOUT = Duration.seconds(10);
const GO_INSTALL_TIMEOUT = Duration.minutes(10);
const VERSION = /\d+\.\d+(?:\.\d+)?/;
const GO_INSTALLS = ["/usr/local/go/bin/go", "/opt/homebrew/bin/go"];
const JAVA_HOME_TOOL = "/usr/libexec/java_home";
const JVM_ARG = "--jvm-arg=";

const PACKAGE_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

const cacheFolder = (download: Download) => {
  const [name, version] =
    download.kind === "npm"
      ? [download.npm.name, download.npm.version]
      : download.kind === "release"
        ? [download.release.name, download.release.version]
        : [download.go.name, download.go.version];
  const folder = `${name.replaceAll("/", "+")}@${version}`;
  if (download.kind !== "npm" || download.npm.dependencies === undefined) return folder;
  // One package can run several servers, each with its own pins, and a pin can move.
  const pins = JSON.stringify([download.npm.entry, download.npm.dependencies]);
  return `${folder}-${NodeCrypto.createHash("sha256").update(pins).digest("hex").slice(0, 8)}`;
};

const MISSING = Symbol("missing");

/**
 * `{name}` placeholders replaced by `vars`. A string naming a var that is null is left out of
 * its object, so a setting the checkout can't fill keeps the server's default.
 */
const fill = (value: unknown, vars: Readonly<Record<string, string | null>>): unknown => {
  if (typeof value === "string") {
    let filled = value;
    for (const [name, replacement] of Object.entries(vars)) {
      if (!filled.includes(`{${name}}`)) continue;
      if (replacement === null) return MISSING;
      filled = filled.replaceAll(`{${name}}`, replacement);
    }
    return filled;
  }
  if (Array.isArray(value)) {
    return value.map((item) => fill(item, vars)).filter((item) => item !== MISSING);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const filled = fill(item, vars);
        return filled === MISSING ? [] : [[key, filled]];
      }),
    );
  }
  return value;
};

const gunzip = NodeUtil.promisify(NodeZlib.gunzip);

const majorOf = (version: string) => Number.parseInt(version.split(".")[0] ?? "", 10);

export const makeInstaller = Effect.fn("LanguageServers.makeInstaller")(function* (options: {
  readonly cacheDir: string;
  readonly registry: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const environment = { ...(yield* HostProcess.Environment) };
  // Set by the dev server's `node --watch`; a forked Node child that inherits it reports its
  // imports over IPC, which typescript-language-server takes for a broken tsserver and exits.
  delete environment.WATCH_REPORT_DEPENDENCIES;
  const home = environment.HOME ?? environment.USERPROFILE ?? null;

  const exists = (file: string) => fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));

  const readJson = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.map(parseJson),
      Effect.orElseSucceed(() => null),
    );

  const filled = (npm: NpmSource): NpmSource => ({
    ...npm,
    name: fillPlatform(npm.name, platform, arch),
  });

  const failed = (message: string) => (cause: unknown) => new InstallError({ message, cause });

  /** A command's exit code and output, or null when it can't run or outlasts the timeout. */
  const run = Effect.fn("LanguageServers.run")(
    function* (
      executable: string,
      args: ReadonlyArray<string>,
      runOptions: {
        readonly cwd?: string;
        readonly env?: Record<string, string | undefined>;
        readonly timeout: Duration.Duration;
      },
    ) {
      const child = yield* spawner.spawn(
        ChildProcess.make(executable, [...args], {
          ...(runOptions.cwd === undefined ? {} : { cwd: runOptions.cwd }),
          env: runOptions.env ?? environment,
          extendEnv: false,
          stdin: "ignore",
          forceKillAfter: "1 second",
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { code: Number(code), output: `${stdout}\n${stderr}` };
    },
    Effect.scoped,
    (effect, _executable, _args, runOptions) =>
      effect.pipe(
        Effect.timeoutOption(runOptions.timeout),
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      ),
  );

  /** A binary installed on the machine, if it runs: its version, or "" without a probe. */
  const probe = Effect.fn("LanguageServers.probe")(function* (
    file: string,
    launch: Launch,
    cwd: string,
  ) {
    if (launch.probe === undefined) return "";
    // In the checkout: rustup's proxy picks its toolchain from the folder it runs in.
    const result = yield* run(file, launch.probe, { cwd, timeout: PROBE_TIMEOUT });
    if (result === null || result.code !== 0) return null;
    return VERSION.exec(result.output)?.[0] ?? "";
  });

  const onPath = (name: string) =>
    resolveCommandPath(name, { env: environment }).pipe(
      Effect.provideService(CommandResolutionCache, new Map()),
      Effect.orElseSucceed(() => null),
    );

  // macOS's /usr/bin developer tools are shims that offer to install Xcode's tools when run.
  const isShim = (file: string) => platform === "darwin" && file.startsWith("/usr/bin/");

  /** On the machine: a known install path first, then PATH. */
  const installed = Effect.fn("LanguageServers.installed")(function* (
    launch: Launch,
    cwd: string,
    probing: boolean,
  ) {
    const candidates = (launch.knownPaths ?? []).flatMap((known) =>
      known.startsWith("~/") ? (home === null ? [] : [path.join(home, known.slice(2))]) : [known],
    );
    if (launch.pathCommand !== undefined) {
      const found = yield* onPath(launch.pathCommand);
      if (found !== null && (launch.chosen === true || !isShim(found))) candidates.push(found);
    }
    for (const file of candidates) {
      if (!(yield* exists(file))) continue;
      const version = probing ? yield* probe(file, launch, cwd) : "";
      if (version !== null) return { file, version };
    }
    return null;
  });

  const command = Effect.fn("LanguageServers.command")(function* (
    file: string,
    runWith: "node" | "native",
    launch: Launch,
  ) {
    if (runWith === "native") return { executable: file, args: launch.args, env: environment };
    const node = yield* resolveNodeExecutable("Language servers").pipe(
      Effect.mapError((cause) => new InstallError({ message: cause.message, cause })),
    );
    return {
      executable: node,
      args: [file, ...launch.args],
      env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
    };
  });

  /** The checkout's virtual environment's interpreter, or null without one. */
  const pythonOf = Effect.fn("LanguageServers.pythonOf")(function* (cwd: string) {
    for (const file of checkoutInterpreters(path, cwd)) {
      if (yield* exists(file)) return file;
    }
    return null;
  });

  /** The interpreter a checkout's servers are told of: the chosen one while it's still there. */
  const activePython = Effect.fn("LanguageServers.activePython")(function* (
    cwd: string,
    chosen: string | null,
  ) {
    return chosen !== null && (yield* exists(chosen)) ? chosen : yield* pythonOf(cwd);
  });

  const pythonInterpreters = (cwd: string) =>
    findPythonInterpreters({ cwd, home, platform, environment }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  /** A JVM takes a moment to start, and Settings resolves every server each time it opens. */
  const javaMajors = new Map<string, { readonly changed: string; readonly major: number }>();
  /** Java's major version, or 0; per checkout too, since version managers' shims obey its files. */
  const javaMajor = Effect.fn("LanguageServers.javaMajor")(function* (java: string, cwd: string) {
    const key = `${cwd}\0${java}`;
    const changed = yield* fileSystem.stat(java).pipe(
      Effect.map((info) => String(Option.getOrNull(info.mtime)?.getTime())),
      Effect.orElseSucceed(() => null),
    );
    const known = javaMajors.get(key);
    if (known !== undefined && known.changed === changed) return known.major;
    const version = yield* run(java, ["-version"], { cwd, timeout: PROBE_TIMEOUT });
    if (version === null) return 0;
    const major = version.code === 0 ? Number(/version "(\d+)/.exec(version.output)?.[1] ?? 0) : 0;
    if (changed !== null) javaMajors.set(key, { changed, major });
    return major;
  });

  /**
   * The first Java new enough to run a release. `java_home` answers with what it has even when
   * that's too old, and version managers' shims obey the checkout's own file, so each is run
   * there, unless it can't be: then the first one here stands for what trust would find.
   */
  const findJava = Effect.fn("LanguageServers.findJava")(function* (
    minMajor: number,
    cwd: string,
    probing: boolean,
  ) {
    const inHome = (folder: string | undefined) =>
      folder ? [path.join(folder, "bin", platform === "win32" ? "java.exe" : "java")] : [];
    const found = yield* onPath("java");
    const javaHome =
      platform === "darwin" && (yield* exists(JAVA_HOME_TOOL))
        ? yield* run(JAVA_HOME_TOOL, ["-v", `${minMajor}+`], { timeout: PROBE_TIMEOUT })
        : null;
    const installs = yield* findJavaInstalls().pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const candidates = [
      ...inHome(environment.JAVA_HOME),
      ...(found === null || isShim(found) ? [] : [found]),
      ...(javaHome?.code === 0 ? inHome(javaHome.output.split("\n")[0]?.trim()) : []),
      ...installs,
    ];
    for (const java of candidates) {
      if (!(yield* exists(java))) continue;
      if (!probing) return java;
      if ((yield* javaMajor(java, cwd)) >= minMajor) return java;
    }
    return null;
  });

  /** What a launch downloads on this machine, or null when it has nothing for it. */
  const downloadOf = Effect.fn("LanguageServers.downloadOf")(function* (
    launch: Launch,
    cwd: string,
    probing: boolean,
  ) {
    if (launch.npm !== undefined) return { kind: "npm", npm: filled(launch.npm) } as const;
    if (launch.release !== undefined) {
      const { release } = launch;
      const asset = release.assets[`${platform}-${arch}`];
      const java = release.java ? yield* findJava(release.java.minMajor, cwd, probing) : null;
      if (asset !== undefined && (java !== null || release.java === undefined)) {
        return { kind: "release", release, asset, java } as const;
      }
    }
    if (launch.go !== undefined) {
      // Our PATH dates from when we started; Go installed since is in one of its usual places.
      for (const go of [yield* onPath("go"), ...GO_INSTALLS]) {
        if (go !== null && (yield* exists(go))) {
          return { kind: "go", go: launch.go, goCommand: go } as const;
        }
      }
    }
    return null;
  });

  /** The executable inside a cached download. */
  const cachedEntry = (download: Download, folder: string) =>
    download.kind === "npm"
      ? path.join(folder, download.npm.entry)
      : download.kind === "release"
        ? path.join(
            folder,
            download.asset.entry ?? `${download.release.name}${platform === "win32" ? ".exe" : ""}`,
          )
        : path.join(folder, `${download.go.name}${platform === "win32" ? ".exe" : ""}`);

  /**
   * The first launch whose toolchain the checkout has (and trust allows) decides. Without trust
   * nothing of the checkout's runs: not its binaries, nor its interpreter, which basedpyright would
   * start to find its imports.
   */
  const walk = Effect.fn("LanguageServers.walk")(function* (
    cwd: string,
    spec: LanguageServerSpec,
    trusted: boolean,
    probing: boolean,
    chosenPython: string | null,
  ) {
    const python = trusted ? yield* activePython(cwd, chosenPython) : null;
    const rootUri = NodeURL.pathToFileURL(cwd).href;
    const data = path.join(
      options.cacheDir,
      "data",
      spec.id.replace(":", "-"),
      NodeCrypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16),
    );
    for (const listed of spec.launches) {
      const launch = { ...listed, args: fill(listed.args, { data }) as ReadonlyArray<string> };
      if (!trusted && !launch.restrictedSafe) continue;
      let toolchain: string | null = null;
      let version: string | null = null;
      if (launch.toolchain !== undefined) {
        const folder = path.join(cwd, "node_modules", launch.toolchain.package);
        const manifest = yield* readJson(path.join(folder, "package.json"));
        // A drop-in installed under the name (tsc-rs) has neither tsserver nor `--lsp`.
        const found =
          typeof manifest === "object" &&
          manifest !== null &&
          "version" in manifest &&
          "name" in manifest &&
          manifest.name === launch.toolchain.package
            ? String(manifest.version)
            : null;
        if (found === null) continue;
        const major = majorOf(found);
        if (launch.toolchain.minMajor !== undefined && !(major >= launch.toolchain.minMajor))
          continue;
        if (launch.toolchain.maxMajor !== undefined && !(major <= launch.toolchain.maxMajor))
          continue;
        toolchain = folder;
        version = found;
      }
      const limits = trusted ? undefined : launch.restricted;
      const name = (packageVersion: string | null) =>
        [launch.name, version ?? packageVersion].filter(Boolean).join(" ");
      const ready = (
        binary: string,
        found: { executable: string; args: ReadonlyArray<string>; env: ResolvedServer["env"] },
        source: LanguageServerSource,
        packageVersion: string | null,
      ): Resolution => ({
        type: "ready",
        server: {
          ...found,
          env: { ...found.env, ...launch.env },
          binary,
          name: name(packageVersion),
          source,
          initializationOptions: mergeJson(
            fill(launch.initializationOptions ?? {}, { toolchain }),
            limits?.initializationOptions ?? {},
          ),
          settings: mergeJson(
            fill(launch.settings ?? {}, { python, rootUri, rootName: path.basename(cwd) }),
            limits?.settings ?? {},
          ) as Record<string, unknown>,
          reportsQuiescence: listed.reportsQuiescence === true,
          notifications: limits?.notify ?? [],
        },
      });
      if (trusted && launch.projectBinary !== undefined) {
        const file = path.join(cwd, fillPlatform(launch.projectBinary.path, platform, arch));
        if (yield* exists(file)) {
          const found = yield* command(file, launch.projectBinary.runWith, launch);
          return ready(file, found, "project", null);
        }
      }
      const onMachine = yield* installed(launch, cwd, probing);
      if (onMachine !== null) {
        return ready(
          onMachine.file,
          { executable: onMachine.file, args: launch.args, env: environment },
          "path",
          onMachine.version || null,
        );
      }
      const download = yield* downloadOf(launch, cwd, probing);
      if (download === null) continue;
      const folder = path.join(options.cacheDir, cacheFolder(download));
      const downloadVersion =
        download.kind === "npm"
          ? download.npm.version
          : download.kind === "release"
            ? download.release.version
            : download.go.version.replace(/^v/, "");
      if (yield* exists(path.join(folder, COMPLETE))) {
        const entry = cachedEntry(download, folder);
        const found =
          download.kind === "release" && download.java !== null
            ? {
                executable: download.java,
                args: [
                  ...(fill(download.asset.jvmArgs ?? [], {
                    release: folder,
                    data,
                  }) as Array<string>),
                  ...launch.args
                    .filter((arg) => arg.startsWith(JVM_ARG))
                    .map((arg) => arg.slice(JVM_ARG.length)),
                  "-jar",
                  entry,
                  ...launch.args.filter((arg) => !arg.startsWith(JVM_ARG)),
                ],
                env: environment,
              }
            : yield* command(
                entry,
                download.kind === "npm" ? download.npm.runWith : "native",
                launch,
              );
        return ready(entry, found, "cache", downloadVersion);
      }
      return { type: "download", name: name(downloadVersion), download } satisfies Resolution;
    }
    return { type: "unavailable", message: spec.missing } satisfies Resolution;
  });

  /** What runs for a checkout. Untrusted, only restricted-safe launches already here do. */
  const resolve = Effect.fn("LanguageServers.resolve")(function* (
    cwd: string,
    spec: LanguageServerSpec,
    trusted: boolean,
    chosenPython: string | null = null,
  ) {
    const allowed = yield* walk(cwd, spec, trusted, true, chosenPython);
    if (trusted || allowed.type === "ready") return allowed;
    // What trust would bring, unprobed: a probe runs in the checkout, and rustup's proxy obeys
    // the checkout's toolchain file.
    const wanted = yield* walk(cwd, spec, true, false, chosenPython);
    switch (wanted.type) {
      case "ready":
        return {
          type: "trust-needed",
          name: wanted.server.name,
          message: `${wanted.server.name} can run code from this project.`,
        } satisfies Resolution;
      case "download":
        return {
          type: "trust-needed",
          name: wanted.name,
          message: describeDownload(wanted.download),
        } satisfies Resolution;
      default:
        return wanted;
    }
  });

  /** Fills a staging folder and swaps it in for `folder` once it is complete. */
  const install = Effect.fn("LanguageServers.install")(function* (
    folder: string,
    label: string,
    version: string,
    fill: (staging: string) => Effect.Effect<void, InstallError>,
  ) {
    yield* fileSystem
      .makeDirectory(options.cacheDir, { recursive: true })
      .pipe(Effect.mapError(failed("Could not create the language-server cache.")));
    const staging = yield* fileSystem
      .makeTempDirectory({ directory: options.cacheDir, prefix: ".download-" })
      .pipe(Effect.mapError(failed("Could not create the language-server cache.")));
    yield* fill(staging).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(path.join(staging, COMPLETE), version);
          yield* fileSystem.remove(folder, { recursive: true, force: true });
          yield* fileSystem.rename(staging, folder);
        }).pipe(Effect.mapError(failed(`Could not unpack ${label}.`))),
      ),
      Effect.onError(() =>
        fileSystem.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
  });

  /** One npm package's files, after checking its licence and integrity. */
  const fetchNpm = Effect.fn("LanguageServers.fetchNpm")(function* (name: string, version: string) {
    const metadataUrl = `${options.registry}/${name.replace("/", "%2f")}/${version}`;
    const metadata = yield* http.execute(HttpClientRequest.get(metadataUrl)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.mapError(failed(`Could not read ${name} from the npm registry.`)),
    );
    const record = metadata as {
      readonly license?: unknown;
      readonly dist?: { readonly tarball?: unknown; readonly integrity?: unknown };
    };
    // Verified upstream: the registry's own record must carry an allowed licence too.
    if (!licenceAllowed(record.license)) {
      return yield* new InstallError({
        message: `${name} ${version} is published under a licence we don't download.`,
      });
    }
    const tarball = record.dist?.tarball;
    const integrity = record.dist?.integrity;
    if (
      typeof tarball !== "string" ||
      typeof integrity !== "string" ||
      !integrity.startsWith("sha512-")
    ) {
      return yield* new InstallError({ message: `${name} has no verifiable download.` });
    }
    const bytes = yield* http.execute(HttpClientRequest.get(tarball)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError(failed(`Downloading ${name} failed.`)),
    );
    const digest = NodeCrypto.createHash("sha512").update(bytes).digest("base64");
    if (`sha512-${digest}` !== integrity) {
      return yield* new InstallError({ message: `${name} failed its integrity check.` });
    }
    return yield* Effect.try({
      try: () => readTar(NodeZlib.gunzipSync(bytes)),
      catch: failed(`${name}'s archive could not be read.`),
    });
  });

  const writeFiles = Effect.fn("LanguageServers.writeFiles")(function* (
    folder: string,
    files: ReadonlyArray<TarFile>,
    label: string,
  ) {
    yield* Effect.forEach(
      files,
      (file) => {
        const target = path.join(folder, file.path);
        return fileSystem
          .makeDirectory(path.dirname(target), { recursive: true })
          .pipe(
            Effect.andThen(
              fileSystem.writeFile(target, file.data, { mode: file.mode & 0o755 || 0o644 }),
            ),
            Effect.mapError(failed(`Could not unpack ${label}.`)),
          );
      },
      { discard: true },
    );
  });

  /** An npm package and the dependencies it pins, all fetched before any is unpacked. */
  const downloadNpm = Effect.fn("LanguageServers.downloadNpm")(function* (
    npm: NpmSource,
    folder: string,
  ) {
    const files = yield* fetchNpm(npm.name, npm.version);
    const dependencies = yield* Effect.forEach(
      Object.entries(npm.dependencies ?? {}),
      ([name, version]) =>
        fetchNpm(name, version).pipe(Effect.map((fetched) => ({ name, fetched }))),
      { concurrency: 4 },
    );
    yield* install(folder, npm.name, npm.version, (staging) =>
      Effect.gen(function* () {
        yield* writeFiles(staging, files, npm.name);
        for (const { name, fetched } of dependencies) {
          yield* writeFiles(path.join(staging, "node_modules", name), fetched, name);
        }
      }),
    );
  });

  /** A release file, streamed to disk and checked against its pinned size and SHA-256. */
  const downloadRelease = Effect.fn("LanguageServers.downloadRelease")(function* (
    release: ReleaseSource,
    asset: ReleaseAsset,
    folder: string,
  ) {
    yield* install(folder, release.name, release.version, (staging) =>
      Effect.gen(function* () {
        const archive = path.join(staging, ".archive");
        const hash = NodeCrypto.createHash("sha256");
        let received = 0;
        const response = yield* http
          .execute(HttpClientRequest.get(asset.url))
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.mapError(failed(`Downloading ${release.name} failed.`)),
          );
        yield* response.stream.pipe(
          Stream.tap((chunk) =>
            Effect.suspend(() => {
              received += chunk.byteLength;
              if (received > asset.bytes) {
                return Effect.fail(
                  new InstallError({ message: `${release.name}'s download is too large.` }),
                );
              }
              hash.update(chunk);
              return Effect.void;
            }),
          ),
          Stream.run(fileSystem.sink(archive, { flag: "wx", mode: 0o600 })),
          Effect.mapError((cause) =>
            cause instanceof InstallError
              ? cause
              : failed(`Downloading ${release.name} failed.`)(cause),
          ),
        );
        if (received !== asset.bytes || hash.digest("hex") !== asset.sha256) {
          return yield* new InstallError({
            message: `${release.name} failed its integrity check.`,
          });
        }
        const executable = path.join(
          staging,
          `${release.name}${platform === "win32" ? ".exe" : ""}`,
        );
        if (asset.format === "binary") {
          yield* fileSystem
            .rename(archive, executable)
            .pipe(
              Effect.andThen(fileSystem.chmod(executable, 0o755)),
              Effect.mapError(failed(`Could not unpack ${release.name}.`)),
            );
        } else if (asset.format === "gz") {
          const bytes = yield* fileSystem
            .readFile(archive)
            .pipe(Effect.mapError(failed(`Could not unpack ${release.name}.`)));
          const unpacked = yield* Effect.try({
            try: () => NodeZlib.gunzipSync(bytes),
            catch: failed(`${release.name}'s download could not be read.`),
          });
          yield* fileSystem
            .writeFile(executable, unpacked, { mode: 0o755 })
            .pipe(Effect.mapError(failed(`Could not unpack ${release.name}.`)));
        } else if (asset.format === "tgz") {
          const bytes = yield* fileSystem
            .readFile(archive)
            .pipe(Effect.mapError(failed(`Could not unpack ${release.name}.`)));
          // On its own thread: Eclipse's archive would stall the server for a moment here.
          const files = yield* Effect.tryPromise({
            try: () => gunzip(bytes).then(readTar),
            catch: failed(`${release.name}'s download could not be read.`),
          });
          yield* writeFiles(staging, files, release.name);
        } else {
          yield* unzip(archive, staging, release.name);
        }
        yield* fileSystem.remove(archive).pipe(Effect.ignore);
      }),
    );
  });

  /** Every file of a zip into `target`, keeping each file's executable bit. */
  const unzip = Effect.fn("LanguageServers.unzip")(function* (
    archive: string,
    target: string,
    label: string,
  ) {
    const zip = yield* openZipArchive(
      archive,
      (detail, cause) => new InstallError({ message: `${label}: ${detail}`, cause }),
    );
    while (true) {
      const entry = yield* zip.next;
      if (entry === null) break;
      const parts = entry.fileName.split("/").filter((part) => part !== "" && part !== ".");
      if (parts.some((part) => part === "..") || entry.fileName.startsWith("/")) {
        return yield* new InstallError({ message: `${label}'s archive points outside itself.` });
      }
      const file = path.join(target, ...parts);
      // Unix permissions and file type live in the high half of a zip entry's external attributes.
      const unix = entry.externalFileAttributes >>> 16;
      if ((unix & 0o170000) === 0o120000) {
        return yield* new InstallError({ message: `${label}'s archive holds a link.` });
      }
      if (entry.fileName.endsWith("/")) {
        yield* fileSystem
          .makeDirectory(file, { recursive: true })
          .pipe(Effect.mapError(failed(`Could not unpack ${label}.`)));
        continue;
      }
      yield* fileSystem
        .makeDirectory(path.dirname(file), { recursive: true })
        .pipe(Effect.mapError(failed(`Could not unpack ${label}.`)));
      yield* Effect.scoped(
        zip.streamEntry(entry).pipe(
          Effect.flatMap((readable) =>
            EffectNodeStream.fromReadable<Uint8Array, InstallError>({
              evaluate: () => readable,
              onError: failed(`Could not unpack ${label}.`),
            }).pipe(
              Stream.run(fileSystem.sink(file, { flag: "wx", mode: unix & 0o111 ? 0o755 : 0o644 })),
              Effect.mapError((cause) =>
                cause instanceof InstallError ? cause : failed(`Could not unpack ${label}.`)(cause),
              ),
            ),
          ),
        ),
      );
    }
  }, Effect.scoped);

  /** `go install` into the cache; Go verifies the module against its checksum database. */
  const installGo = Effect.fn("LanguageServers.installGo")(function* (
    go: GoSource,
    goCommand: string,
    folder: string,
  ) {
    yield* install(folder, go.name, go.version, (staging) =>
      Effect.gen(function* () {
        const result = yield* run(goCommand, ["install", `${go.module}@${go.version}`], {
          cwd: staging,
          // Outside any module, with no workspace: only the pinned version is built.
          env: { ...environment, GOBIN: staging, GOWORK: "off", GOFLAGS: "-mod=mod" },
          timeout: GO_INSTALL_TIMEOUT,
        });
        if (result === null || result.code !== 0) {
          const tail = result?.output.trim().split("\n").slice(-3).join("\n") ?? "";
          return yield* new InstallError({
            message: `Building ${go.name} with Go failed${tail ? `: ${tail}` : "."}`,
          });
        }
      }),
    );
  });

  /** Why a checkout does or doesn't use a companion: the first evidence, or what would be. */
  const activationOf = Effect.fn("LanguageServers.activationOf")(function* (
    cwd: string,
    spec: LanguageServerSpec,
  ) {
    const activation = spec.activation;
    if (activation === undefined) {
      return { active: true, reason: `Runs on every ${spec.languages} file.` };
    }
    for (const file of activation.files) {
      if (yield* exists(path.join(cwd, file))) return { active: true, reason: `Found ${file}.` };
    }
    const manifest = (yield* readJson(path.join(cwd, "package.json"))) as Record<
      string,
      unknown
    > | null;
    for (const name of activation.packages) {
      const declared = PACKAGE_SECTIONS.some((section) => {
        const packages = manifest?.[section];
        return typeof packages === "object" && packages !== null && name in packages;
      });
      if (declared) return { active: true, reason: `Found ${name} in package.json.` };
    }
    const wanted = activation.packages.join(" or ");
    return {
      active: false,
      reason:
        activation.packages.length === 0
          ? `Not active: no ${activation.files.join(" or ")} at this checkout's root.`
          : `Not active: no ${activation.description} or ${wanted} in package.json.`,
    };
  });

  /** Fetches what a resolution asked for into the cache. */
  const download = Effect.fn("LanguageServers.download")(function* (wanted: Download) {
    const [label, licence] =
      wanted.kind === "npm"
        ? [wanted.npm.name, wanted.npm.licence]
        : wanted.kind === "release"
          ? [wanted.release.name, wanted.release.licence]
          : [wanted.go.name, wanted.go.licence];
    const ruled = wanted.kind === "release" && wanted.release.licenceRuled === true;
    if (!ruled && !licenceAllowed(licence)) {
      return yield* new InstallError({ message: `${label} is not under a licence we download.` });
    }
    const folder = path.join(options.cacheDir, cacheFolder(wanted));
    if (yield* exists(path.join(folder, COMPLETE))) return;
    switch (wanted.kind) {
      case "npm":
        return yield* downloadNpm(wanted.npm, folder);
      case "release":
        return yield* downloadRelease(wanted.release, wanted.asset, folder);
      case "go":
        return yield* installGo(wanted.go, wanted.goCommand, folder);
    }
  });

  /** Lists `patterns` in the checkout's own git excludes; a checkout without git needs nothing. */
  const excludeFromGit = Effect.fn("LanguageServers.excludeFromGit")(
    function* (cwd: string, patterns: ReadonlyArray<string>) {
      const found = yield* run("git", ["rev-parse", "--git-path", "info/exclude"], {
        cwd,
        timeout: PROBE_TIMEOUT,
      });
      if (found === null || found.code !== 0) return;
      const file = path.resolve(cwd, found.output.trim());
      const text = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
      const known = new Set(text.split("\n"));
      const missing = patterns.filter((pattern) => !known.has(pattern));
      if (missing.length === 0) return;
      yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
      const lead = text === "" || text.endsWith("\n") ? "" : "\n";
      yield* fileSystem.writeFileString(file, `${text}${lead}${missing.join("\n")}\n`);
    },
    Effect.ignore({ log: "Warn", message: "Could not keep a server's files out of git." }),
  );

  /**
   * The folder every checkout of `cwd`'s repository shares; null for a folder without git. Only
   * the repository's own worktree list counts: a `.git` file can name any repository it likes.
   */
  const repositoryOf = Effect.fn("LanguageServers.repositoryOf")(function* (cwd: string) {
    const options = { cwd, timeout: PROBE_TIMEOUT };
    const found = yield* run("git", ["rev-parse", "--git-common-dir", "--show-toplevel"], options);
    if (found === null || found.code !== 0) return null;
    const [commonDir, topLevel] = found.output.trim().split("\n");
    if (commonDir === undefined || topLevel === undefined) return null;
    const listed = yield* run("git", ["worktree", "list", "--porcelain"], options);
    if (listed === null || listed.code !== 0) return null;
    const real = (folder: string) =>
      fileSystem.realPath(folder).pipe(Effect.orElseSucceed(() => folder));
    const own = yield* real(topLevel);
    const worktrees = yield* Effect.forEach(
      listed.output.split("\n").filter((line) => line.startsWith("worktree ")),
      (line) => real(line.slice("worktree ".length)),
    );
    return worktrees.includes(own) ? path.resolve(cwd, commonDir) : null;
  });

  return {
    resolve,
    download,
    excludeFromGit,
    repositoryOf,
    activationOf,
    activePython,
    pythonOnPath: platform === "win32" ? "python" : "python3",
    pythonInterpreters,
  };
});

export type Installer = Effect.Success<ReturnType<typeof makeInstaller>>;
