// @effect-diagnostics nodeBuiltinImport:off - Effect has no gunzip or SHA-512 digest.
import type { LanguageServerSource } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";
import { CommandResolutionCache, resolveCommandPath } from "@t3tools/shared/shell";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";

import {
  fillPlatform,
  type LanguageServerSpec,
  type Launch,
  licenceAllowed,
  type NpmSource,
} from "./registry.ts";
import { parseJson, stringifyJson } from "./json.ts";
import { readTar } from "./tar.ts";

/**
 * Finding a language server's binary, in the ruled order: the project's own (or PATH), then our
 * cache under T3 home shared by every checkout, then a download into that cache.
 */

export interface ResolvedServer {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly name: string;
  readonly source: LanguageServerSource;
  readonly initializationOptions: unknown;
}

export type Resolution =
  | { readonly type: "ready"; readonly server: ResolvedServer }
  /** The launch that applies needs this package, which isn't cached yet. */
  | { readonly type: "download"; readonly name: string; readonly npm: NpmSource }
  | { readonly type: "unavailable"; readonly message: string };

class InstallError extends Data.TaggedError("InstallError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const COMPLETE = ".astrolabe-complete";
const CONSENT = "download-consent.json";

const cacheFolder = (npm: NpmSource) => `${npm.name.replaceAll("/", "+")}@${npm.version}`;

const fill = (value: unknown, toolchain: string | null): unknown => {
  if (typeof value === "string")
    return toolchain === null ? value : value.replaceAll("{toolchain}", toolchain);
  if (Array.isArray(value)) return value.map((item) => fill(item, toolchain));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fill(item, toolchain)]),
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
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const environment = { ...(yield* HostProcess.Environment) };
  // Set by the dev server's `node --watch`; a forked Node child that inherits it reports its
  // imports over IPC, which typescript-language-server takes for a broken tsserver and exits.
  delete environment.WATCH_REPORT_DEPENDENCIES;

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

  /** The first launch whose toolchain the checkout has (and trust allows) decides. */
  const resolve = Effect.fn("LanguageServers.resolve")(function* (
    cwd: string,
    spec: LanguageServerSpec,
    trusted: boolean,
  ) {
    for (const launch of spec.launches) {
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
        found: { executable: string; args: ReadonlyArray<string>; env: ResolvedServer["env"] },
        source: LanguageServerSource,
        packageVersion: string | null,
      ): Resolution => ({
        type: "ready",
        server: {
          ...found,
          name: name(packageVersion),
          source,
          initializationOptions: fill(launch.initializationOptions ?? {}, toolchain),
        },
      });
      if (launch.projectBinary !== undefined) {
        const file = path.join(cwd, fillPlatform(launch.projectBinary.path, platform, arch));
        if (yield* exists(file)) {
          const found = yield* command(file, launch.projectBinary.runWith, launch);
          return ready(found, "project", null);
        }
      }
      if (launch.pathCommand !== undefined) {
        const file = yield* resolveCommandPath(launch.pathCommand).pipe(
          Effect.provideService(CommandResolutionCache, new Map()),
          Effect.orElseSucceed(() => null),
        );
        if (file !== null) {
          return ready({ executable: file, args: launch.args, env: environment }, "path", null);
        }
      }
      if (launch.npm !== undefined) {
        const npm = filled(launch.npm);
        const folder = path.join(options.cacheDir, cacheFolder(npm));
        if (yield* exists(path.join(folder, COMPLETE))) {
          const found = yield* command(path.join(folder, npm.entry), npm.runWith, launch);
          return ready(found, "cache", npm.version);
        }
        return { type: "download", name: name(npm.version), npm } satisfies Resolution;
      }
    }
    return {
      type: "unavailable",
      message: "No language server applies to this checkout.",
    } satisfies Resolution;
  });

  const consentFile = path.join(options.cacheDir, CONSENT);
  const consented = exists(consentFile);
  const consent = fileSystem.makeDirectory(options.cacheDir, { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFileString(consentFile, stringifyJson({ consented: true }))),
    Effect.mapError(
      (cause) => new InstallError({ message: "Could not record the download consent.", cause }),
    ),
  );

  const failed = (message: string) => (cause: unknown) => new InstallError({ message, cause });

  /** Downloads the package into the cache after checking its licence and integrity. */
  const download = Effect.fn("LanguageServers.download")(function* (npm: NpmSource) {
    if (!licenceAllowed(npm.licence)) {
      return yield* new InstallError({
        message: `${npm.name} is not under a licence we download.`,
      });
    }
    const folder = path.join(options.cacheDir, cacheFolder(npm));
    if (yield* exists(path.join(folder, COMPLETE))) return;
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
    yield* fileSystem
      .makeDirectory(options.cacheDir, { recursive: true })
      .pipe(Effect.mapError(failed("Could not create the language-server cache.")));
    const staging = yield* fileSystem
      .makeTempDirectory({ directory: options.cacheDir, prefix: ".download-" })
      .pipe(Effect.mapError(failed("Could not create the language-server cache.")));
    yield* Effect.gen(function* () {
      for (const file of files) {
        const target = path.join(staging, file.path);
        yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
        yield* fileSystem.writeFile(target, file.data, { mode: file.mode & 0o755 || 0o644 });
      }
      yield* fileSystem.writeFileString(path.join(staging, COMPLETE), npm.version);
      yield* fileSystem.remove(folder, { recursive: true, force: true });
      yield* fileSystem.rename(staging, folder);
    }).pipe(
      Effect.mapError(failed(`Could not unpack ${npm.name}.`)),
      Effect.onError(() =>
        fileSystem.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
  });

  return { resolve, download, consented, consent };
});

export type Installer = Effect.Success<ReturnType<typeof makeInstaller>>;
