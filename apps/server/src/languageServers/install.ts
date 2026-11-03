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
import { parseJson, stringifyJson } from "./json.ts";
import { readTar } from "./tar.ts";

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
}

/** Something the launch that applies needs, which isn't cached yet. */
export type Download =
  | { readonly kind: "npm"; readonly npm: NpmSource }
  | { readonly kind: "release"; readonly release: ReleaseSource; readonly asset: ReleaseAsset }
  | { readonly kind: "go"; readonly go: GoSource; readonly goCommand: string };

export type Resolution =
  | { readonly type: "ready"; readonly server: ResolvedServer }
  | { readonly type: "download"; readonly name: string; readonly download: Download }
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
const CONSENT = "download-consent.json";
const PROBE_TIMEOUT = Duration.seconds(10);
const GO_INSTALL_TIMEOUT = Duration.minutes(10);
const VERSION = /\d+\.\d+(?:\.\d+)?/;
const GO_INSTALLS = ["/usr/local/go/bin/go", "/opt/homebrew/bin/go"];
/** Where a checkout's virtual environment keeps its interpreter, tried in order. */
const PYTHON_INTERPRETERS = [
  ".venv/bin/python",
  "venv/bin/python",
  ".venv/Scripts/python.exe",
  "venv/Scripts/python.exe",
];

const cacheFolder = (download: Download) => {
  const [name, version] =
    download.kind === "npm"
      ? [download.npm.name, download.npm.version]
      : download.kind === "release"
        ? [download.release.name, download.release.version]
        : [download.go.name, download.go.version];
  return `${name.replaceAll("/", "+")}@${version}`;
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
  const probe = Effect.fn("LanguageServers.probe")(function* (file: string, launch: Launch) {
    if (launch.probe === undefined) return "";
    const result = yield* run(file, launch.probe, { timeout: PROBE_TIMEOUT });
    if (result === null || result.code !== 0) return null;
    return VERSION.exec(result.output)?.[0] ?? "";
  });

  /** On the machine: a known install path first, then PATH. */
  const installed = Effect.fn("LanguageServers.installed")(function* (launch: Launch) {
    const candidates = (launch.knownPaths ?? []).flatMap((known) =>
      known.startsWith("~/") ? (home === null ? [] : [path.join(home, known.slice(2))]) : [known],
    );
    if (launch.pathCommand !== undefined) {
      const onPath = yield* resolveCommandPath(launch.pathCommand, { env: environment }).pipe(
        Effect.provideService(CommandResolutionCache, new Map()),
        Effect.orElseSucceed(() => null),
      );
      // macOS's /usr/bin developer tools are shims that offer to install Xcode's tools when run.
      if (onPath !== null && !(platform === "darwin" && onPath.startsWith("/usr/bin/"))) {
        candidates.push(onPath);
      }
    }
    for (const file of candidates) {
      if (!(yield* exists(file))) continue;
      const version = yield* probe(file, launch);
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

  const pythonOf = Effect.fn("LanguageServers.pythonOf")(function* (cwd: string) {
    for (const interpreter of PYTHON_INTERPRETERS) {
      const file = path.join(cwd, interpreter);
      if (yield* exists(file)) return file;
    }
    return null;
  });

  /** What a launch downloads on this machine, or null when it has nothing for it. */
  const downloadOf = Effect.fn("LanguageServers.downloadOf")(function* (launch: Launch) {
    if (launch.npm !== undefined) return { kind: "npm", npm: filled(launch.npm) } as const;
    if (launch.release !== undefined) {
      const asset = launch.release.assets[`${platform}-${arch}`];
      if (asset !== undefined) return { kind: "release", release: launch.release, asset } as const;
    }
    if (launch.go !== undefined) {
      const onPath = yield* resolveCommandPath("go", { env: environment }).pipe(
        Effect.provideService(CommandResolutionCache, new Map()),
        Effect.orElseSucceed(() => null),
      );
      // Our PATH dates from when we started; Go installed since is in one of its usual places.
      for (const go of [onPath, ...GO_INSTALLS]) {
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

  /** The first launch whose toolchain the checkout has (and trust allows) decides. */
  const resolve = Effect.fn("LanguageServers.resolve")(function* (
    cwd: string,
    spec: LanguageServerSpec,
    trusted: boolean,
  ) {
    const python = yield* pythonOf(cwd);
    const data = path.join(
      options.cacheDir,
      "data",
      spec.id,
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
          binary,
          name: name(packageVersion),
          source,
          initializationOptions: fill(launch.initializationOptions ?? {}, { toolchain }),
          settings: fill(launch.settings ?? {}, { python }) as Record<string, unknown>,
          reportsQuiescence: listed.reportsQuiescence === true,
        },
      });
      if (launch.projectBinary !== undefined) {
        const file = path.join(cwd, fillPlatform(launch.projectBinary.path, platform, arch));
        if (yield* exists(file)) {
          const found = yield* command(file, launch.projectBinary.runWith, launch);
          return ready(file, found, "project", null);
        }
      }
      const onMachine = yield* installed(launch);
      if (onMachine !== null) {
        return ready(
          onMachine.file,
          { executable: onMachine.file, args: launch.args, env: environment },
          "path",
          onMachine.version || null,
        );
      }
      const download = yield* downloadOf(launch);
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
        const found = yield* command(
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

  const consentFile = path.join(options.cacheDir, CONSENT);
  const consented = exists(consentFile);
  const consent = fileSystem.makeDirectory(options.cacheDir, { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFileString(consentFile, stringifyJson({ consented: true }))),
    Effect.mapError(
      (cause) => new InstallError({ message: "Could not record the download consent.", cause }),
    ),
  );

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

  /** An npm package, after checking its licence and integrity. */
  const downloadNpm = Effect.fn("LanguageServers.downloadNpm")(function* (
    npm: NpmSource,
    folder: string,
  ) {
    const metadataUrl = `${options.registry}/${npm.name.replace("/", "%2f")}/${npm.version}`;
    const metadata = yield* http.execute(HttpClientRequest.get(metadataUrl)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.mapError(failed(`Could not read ${npm.name} from the npm registry.`)),
    );
    const record = metadata as {
      readonly license?: unknown;
      readonly dist?: { readonly tarball?: unknown; readonly integrity?: unknown };
    };
    // Verified upstream: the registry's own record must carry an allowed licence too.
    if (!licenceAllowed(record.license)) {
      return yield* new InstallError({
        message: `${npm.name} ${npm.version} is published under a licence we don't download.`,
      });
    }
    const tarball = record.dist?.tarball;
    const integrity = record.dist?.integrity;
    if (
      typeof tarball !== "string" ||
      typeof integrity !== "string" ||
      !integrity.startsWith("sha512-")
    ) {
      return yield* new InstallError({ message: `${npm.name} has no verifiable download.` });
    }
    const bytes = yield* http.execute(HttpClientRequest.get(tarball)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError(failed(`Downloading ${npm.name} failed.`)),
    );
    const digest = NodeCrypto.createHash("sha512").update(bytes).digest("base64");
    if (`sha512-${digest}` !== integrity) {
      return yield* new InstallError({ message: `${npm.name} failed its integrity check.` });
    }
    const files = yield* Effect.try({
      try: () => readTar(NodeZlib.gunzipSync(bytes)),
      catch: failed(`${npm.name}'s archive could not be read.`),
    });
    yield* install(folder, npm.name, npm.version, (staging) =>
      Effect.gen(function* () {
        for (const file of files) {
          const target = path.join(staging, file.path);
          yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
          yield* fileSystem.writeFile(target, file.data, { mode: file.mode & 0o755 || 0o644 });
        }
      }).pipe(Effect.mapError(failed(`Could not unpack ${npm.name}.`))),
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
        if (asset.format === "gz") {
          const executable = path.join(
            staging,
            `${release.name}${platform === "win32" ? ".exe" : ""}`,
          );
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

  /** Fetches what a resolution asked for into the cache. */
  const download = Effect.fn("LanguageServers.download")(function* (wanted: Download) {
    const [label, licence] =
      wanted.kind === "npm"
        ? [wanted.npm.name, wanted.npm.licence]
        : wanted.kind === "release"
          ? [wanted.release.name, wanted.release.licence]
          : [wanted.go.name, wanted.go.licence];
    if (!licenceAllowed(licence)) {
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

  return { resolve, download, consented, consent };
});

export type Installer = Effect.Success<ReturnType<typeof makeInstaller>>;
