import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient } from "effect/http";

import { encodeMessage, MessageDecoder } from "./framing.ts";
import { makeInstaller } from "./install.ts";
import { LANGUAGE_SERVERS, type LanguageServerSpec, licenceAllowed } from "./registry.ts";
import { readTar, TarError } from "./tar.ts";

const unusedHttp = HttpClient.make(() => Effect.die("no downloads here"));

/** A checkout whose node_modules holds TypeScript (or a package `name`d otherwise) at `version`, and a cache folder beside it. */
const setup = Effect.fn("setup")(function* (version: string | null, name = "typescript") {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-install-" });
  const cwd = path.join(root, "checkout");
  const modules = path.join(cwd, "node_modules");
  yield* fileSystem.makeDirectory(modules, { recursive: true });
  const put = (file: string, contents = "") =>
    fileSystem
      .makeDirectory(path.dirname(path.join(cwd, file)), { recursive: true })
      .pipe(Effect.andThen(fileSystem.writeFileString(path.join(cwd, file), contents)));
  if (version !== null) {
    yield* put("node_modules/typescript/package.json", JSON.stringify({ name, version }));
  }
  const installer = yield* makeInstaller({ cacheDir: path.join(root, "cache"), registry: "" }).pipe(
    Effect.provideService(HttpClient.HttpClient, unusedHttp),
  );
  return { cwd, put, installer, cache: path.join(root, "cache") };
});

const resolve = (env: Effect.Success<ReturnType<typeof setup>>, trusted = true) =>
  env.installer.resolve(env.cwd, LANGUAGE_SERVERS.typescript, trusted);

const onMac = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    // No PATH: nothing is found there.
    Effect.provideService(HostProcess.Environment, {}),
  );

describe("language server resolution", () => {
  it.effect(
    "runs nothing of an untrusted checkout, the Python it would hand a server included",
    () =>
      Effect.gen(function* () {
        const env = yield* setup(null);
        yield* env.put(".venv/bin/basedpyright-langserver");
        yield* env.put(".venv/bin/python");
        const basedpyright = LANGUAGE_SERVERS.basedpyright;
        expect(yield* env.installer.resolve(env.cwd, basedpyright, true)).toMatchObject({
          type: "ready",
          server: {
            source: "project",
            settings: { python: { pythonPath: `${env.cwd}/.venv/bin/python` } },
          },
        });
        const fileSystem = yield* FileSystem.FileSystem;
        const cached = `${env.cache}/basedpyright@1.40.2`;
        yield* fileSystem.makeDirectory(cached, { recursive: true });
        yield* fileSystem.writeFileString(`${cached}/langserver.index.js`, "");
        yield* fileSystem.writeFileString(`${cached}/.astrolabe-complete`, "1.40.2");
        const restricted = yield* env.installer.resolve(env.cwd, basedpyright, false);
        expect(restricted).toMatchObject({ type: "ready", server: { source: "cache" } });
        expect(JSON.stringify(restricted)).not.toContain(".venv");
      }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("doesn't probe a server for an untrusted checkout: a probe runs in the checkout", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const env = yield* setup(null);
      const binary = `${env.cache}-tool`;
      yield* fileSystem.writeFileString(binary, "#!/bin/sh\ntouch probed\n");
      yield* fileSystem.chmod(binary, 0o755);
      const spec: LanguageServerSpec = {
        ...LANGUAGE_SERVERS.gopls,
        launches: [
          { name: "Tool", knownPaths: [binary], probe: [], args: [], restrictedSafe: false },
        ],
      };
      expect(yield* env.installer.resolve(env.cwd, spec, false)).toMatchObject({
        type: "trust-needed",
        name: "Tool",
      });
      expect(yield* fileSystem.exists(`${env.cwd}/probed`)).toBe(false);
      expect(yield* env.installer.resolve(env.cwd, spec, true)).toMatchObject({ type: "ready" });
      expect(yield* fileSystem.exists(`${env.cwd}/probed`)).toBe(true);

      yield* fileSystem.remove(`${env.cwd}/probed`);
      const javaHome = `${env.cache}-java`;
      yield* fileSystem.makeDirectory(`${javaHome}/bin`, { recursive: true });
      yield* fileSystem.writeFileString(`${javaHome}/bin/java`, "#!/bin/sh\ntouch probed\n");
      yield* fileSystem.chmod(`${javaHome}/bin/java`, 0o755);
      const java = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Environment, { JAVA_HOME: javaHome }),
      );
      expect(yield* java.installer.resolve(env.cwd, LANGUAGE_SERVERS.jdtls, false)).toMatchObject({
        type: "trust-needed",
        message: "jdtls 1.63.0 (EPL-2.0) needs downloading from Eclipse.",
      });
      expect(yield* fileSystem.exists(`${env.cwd}/probed`)).toBe(false);
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("runs the project's TypeScript 7 as its own server", () =>
    Effect.gen(function* () {
      const env = yield* setup("7.0.2");
      yield* env.put("node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
      const resolution = yield* resolve(env);
      expect(resolution).toMatchObject({
        type: "ready",
        server: { name: "TypeScript 7.0.2", source: "project", args: ["--lsp", "--stdio"] },
      });
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "puts the project's TypeScript 6 behind typescript-language-server, downloading it if needed",
    () =>
      Effect.gen(function* () {
        const env = yield* setup("6.0.3");
        expect(yield* resolve(env)).toMatchObject({
          type: "download",
          name: "TypeScript 6.0.3",
          download: {
            kind: "npm",
            npm: { name: "typescript-language-server", version: "6.0.2", licence: "Apache-2.0" },
          },
        });
        yield* env.put("node_modules/typescript-language-server/lib/cli.mjs");
        const resolution = yield* resolve(env);
        expect(resolution).toMatchObject({ type: "ready", server: { source: "project" } });
        if (resolution.type !== "ready") return;
        expect(resolution.server.args.at(-1)).toBe("--stdio");
        expect(resolution.server.initializationOptions).toEqual({
          tsserver: { path: `${env.cwd}/node_modules/typescript/lib/tsserver.js` },
        });
      }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "uses our own TypeScript 7 without a project TypeScript, or in a restricted repository",
    () =>
      Effect.gen(function* () {
        const bare = yield* setup(null);
        expect(yield* resolve(bare)).toMatchObject({
          type: "download",
          download: { npm: { name: "@typescript/typescript-darwin-arm64", version: "7.0.2" } },
        });
        const project = yield* setup("7.0.2");
        yield* project.put("node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
        expect(yield* resolve(project, false)).toMatchObject({
          type: "trust-needed",
          name: "TypeScript 7.0.2",
          message: "TypeScript 7.0.2 can run code from this project.",
        });
        expect(yield* resolve(bare, false)).toMatchObject({
          type: "trust-needed",
          message: expect.stringContaining("needs downloading from npm"),
        });
        const fileSystem = yield* FileSystem.FileSystem;
        const cached = `${project.cache}/@typescript+typescript-darwin-arm64@7.0.2`;
        yield* fileSystem.makeDirectory(`${cached}/lib`, { recursive: true });
        yield* fileSystem.writeFileString(`${cached}/lib/tsc`, "");
        yield* fileSystem.writeFileString(`${cached}/.astrolabe-complete`, "7.0.2");
        expect(yield* resolve(project, false)).toMatchObject({
          type: "ready",
          server: { name: "TypeScript 7.0.2", source: "cache", executable: `${cached}/lib/tsc` },
        });
      }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("treats a drop-in installed as `typescript` as no project TypeScript", () =>
    Effect.gen(function* () {
      const env = yield* setup("0.8.0", "@tsc-rs/typescript");
      expect(yield* resolve(env)).toMatchObject({
        type: "download",
        download: { npm: { name: "@typescript/typescript-darwin-arm64", version: "7.0.2" } },
      });
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps `node --watch`'s dependency reporting out of the servers it starts", () =>
    Effect.gen(function* () {
      const env = yield* setup("7.0.2");
      yield* env.put("node_modules/@typescript/typescript-darwin-arm64/lib/tsc");
      const resolution = yield* resolve(env);
      if (resolution.type !== "ready") return expect.unreachable();
      expect(resolution.server.env).toEqual({ HOME: "/home" });
    }).pipe(
      Effect.scoped,
      Effect.provideService(HostProcess.Environment, {
        HOME: "/home",
        WATCH_REPORT_DEPENDENCIES: "1",
      }),
      onMac,
      Effect.provide(NodeServices.layer),
    ),
  );
});

/** An executable script in a temporary folder that prints `output` and exits with `code`. */
const script = Effect.fn("script")(function* (
  folder: string,
  name: string,
  output: string,
  code = 0,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(folder, name);
  yield* fileSystem.makeDirectory(folder, { recursive: true });
  yield* fileSystem.writeFileString(file, `#!/bin/sh\necho "${output}"\nexit ${code}\n`);
  yield* fileSystem.chmod(file, 0o755);
  return file;
});

describe("servers installed on the machine", () => {
  it.effect("takes a known install path off PATH, named by its version", () =>
    Effect.gen(function* () {
      const home = yield* FileSystem.FileSystem.use((fs) =>
        fs.makeTempDirectoryScoped({ prefix: "t3-lsp-home-" }),
      );
      const gopls = yield* script(`${home}/go/bin`, "gopls", "golang.org/x/tools/gopls v0.21.1");
      const env = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Environment, { HOME: home }),
      );
      const resolution = yield* env.installer.resolve(env.cwd, LANGUAGE_SERVERS.gopls, true);
      expect(resolution).toMatchObject({
        type: "ready",
        server: { name: "gopls 0.21.1", source: "path", executable: gopls },
      });
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("gives a server a data folder of its own for each checkout", () =>
    Effect.gen(function* () {
      const bin = yield* FileSystem.FileSystem.use((fs) =>
        fs.makeTempDirectoryScoped({ prefix: "t3-lsp-bin-" }),
      );
      const jdtls = yield* script(bin, "jdtls", "");
      const env = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Environment, { PATH: bin }),
      );
      const argsFor = (cwd: string) =>
        env.installer.resolve(cwd, LANGUAGE_SERVERS.jdtls, true).pipe(
          Effect.map((resolution) => {
            if (resolution.type !== "ready") return expect.unreachable();
            expect(resolution.server.executable).toBe(jdtls);
            return resolution.server.args;
          }),
        );
      const data = (yield* argsFor("/repos/one/app")).at(-1);
      expect(data).toContain(`${env.cache}/data/jdtls/`);
      expect((yield* argsFor("/repos/two/app")).at(-1)).not.toBe(data);
      expect((yield* argsFor("/repos/one/app")).at(-1)).toBe(data);
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("runs the downloaded jdtls on the first Java new enough, without its launcher", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const bin = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-java-" });
      yield* script(`${bin}/home/bin`, "java", 'openjdk version \\"17.0.1\\"');
      const java = yield* script(`${bin}/path`, "java", 'openjdk version \\"21.0.2\\"');
      const env = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Environment, {
          JAVA_HOME: `${bin}/home`,
          PATH: `${bin}/path`,
        }),
      );
      const jdtls = LANGUAGE_SERVERS.jdtls;
      expect(yield* env.installer.resolve(env.cwd, jdtls, true)).toMatchObject({
        type: "download",
        name: "jdtls 1.63.0",
        download: { kind: "release", java },
      });
      const cached = `${env.cache}/jdtls@1.63.0`;
      yield* fileSystem.makeDirectory(cached, { recursive: true });
      yield* fileSystem.writeFileString(`${cached}/.astrolabe-complete`, "1.63.0");
      const resolution = yield* env.installer.resolve(env.cwd, jdtls, true);
      if (resolution.type !== "ready") return expect.unreachable();
      expect(resolution.server).toMatchObject({ executable: java, source: "cache" });
      const { args } = resolution.server;
      const jar = args.indexOf("-jar");
      expect(args.slice(0, jar)).toEqual(
        expect.arrayContaining([
          `-Dosgi.sharedConfiguration.area=${cached}/config_mac_arm`,
          "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
        ]),
      );
      expect(args[jar + 1]).toMatch(/^.*\/plugins\/org\.eclipse\.equinox\.launcher_.*\.jar$/);
      expect(args.slice(jar + 2)).toEqual(["-data", expect.stringContaining("/data/jdtls/")]);
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads a Java's version once, until the file changes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const bin = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-java-" });
      const java = `${bin}/java`;
      yield* fileSystem.writeFileString(
        java,
        `#!/bin/sh\necho run >> ${bin}/runs\necho 'openjdk version "21.0.2"'\n`,
      );
      yield* fileSystem.chmod(java, 0o755);
      const env = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Environment, { JAVA_HOME: "/none", PATH: bin }),
      );
      const runs = fileSystem
        .readFileString(`${bin}/runs`)
        .pipe(Effect.map((log) => log.trim().split("\n").length));
      const resolve = env.installer.resolve(env.cwd, LANGUAGE_SERVERS.jdtls, true);
      yield* resolve;
      yield* resolve;
      expect(yield* runs).toBe(1);
      yield* fileSystem.utimes(java, 0, 1_000_000);
      yield* resolve;
      expect(yield* runs).toBe(2);
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "passes over a binary that fails its probe, as rustup's proxy does without the component",
    () =>
      Effect.gen(function* () {
        const bin = yield* FileSystem.FileSystem.use((fs) =>
          fs.makeTempDirectoryScoped({ prefix: "t3-lsp-bin-" }),
        );
        yield* script(bin, "rust-analyzer", "error: Unknown binary 'rust-analyzer'", 1);
        const env = yield* setup(null).pipe(
          Effect.provideService(HostProcess.Environment, { PATH: bin }),
        );
        const resolution = yield* env.installer.resolve(
          env.cwd,
          LANGUAGE_SERVERS["rust-analyzer"],
          true,
        );
        expect(resolution).toMatchObject({
          type: "download",
          name: "rust-analyzer 2026-11-02",
          download: { kind: "release", asset: { format: "gz" } },
        });
      }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );

  it.effect("says what to do where nothing is installed and nothing downloads", () =>
    Effect.gen(function* () {
      const env = yield* setup(null);
      // No Go to build gopls with.
      expect(yield* env.installer.resolve(env.cwd, LANGUAGE_SERVERS.gopls, true)).toEqual({
        type: "unavailable",
        message: LANGUAGE_SERVERS.gopls.missing,
      });
      // No Java new enough for jdtls, whatever this machine has.
      const jdtls = LANGUAGE_SERVERS.jdtls;
      const beyondAnyJava = {
        ...jdtls,
        launches: jdtls.launches.map((launch) => ({
          ...launch,
          release: { ...launch.release!, java: { minMajor: 1000 } },
        })),
      };
      expect(yield* env.installer.resolve(env.cwd, beyondAnyJava, true)).toEqual({
        type: "unavailable",
        message: jdtls.missing,
      });
      // No rust-analyzer build for FreeBSD.
      const freebsd = yield* setup(null).pipe(
        Effect.provideService(HostProcess.Platform, "freebsd"),
        Effect.provideService(HostProcess.Architecture, "x64"),
      );
      expect(
        yield* freebsd.installer.resolve(freebsd.cwd, LANGUAGE_SERVERS["rust-analyzer"], true),
      ).toEqual({ type: "unavailable", message: LANGUAGE_SERVERS["rust-analyzer"].missing });
    }).pipe(Effect.scoped, onMac, Effect.provide(NodeServices.layer)),
  );
});

describe("download checks", () => {
  it("allows only the licences on the allowlist", () => {
    expect(licenceAllowed("MIT")).toBe(true);
    expect(licenceAllowed("Apache-2.0")).toBe(true);
    expect(licenceAllowed("(MIT OR Apache-2.0)")).toBe(true);
    expect(licenceAllowed("MPL-2.0 OR MIT")).toBe(true);
    expect(licenceAllowed("MPL-2.0")).toBe(false);
    expect(licenceAllowed("MIT AND MPL-2.0")).toBe(false);
    expect(licenceAllowed("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(licenceAllowed("GPL-2.0 WITH Classpath-exception-2.0")).toBe(false);
    expect(licenceAllowed("MIT WITH Some-exception")).toBe(false);
    expect(licenceAllowed(undefined)).toBe(false);
  });

  it("pins every release by size and SHA-256, under a licence we may download", () => {
    for (const spec of Object.values(LANGUAGE_SERVERS)) {
      for (const { npm, release } of spec.launches) {
        if (npm !== undefined) expect(licenceAllowed(npm.licence), spec.id).toBe(true);
        if (release === undefined) continue;
        expect(release.licenceRuled === true || licenceAllowed(release.licence), spec.id).toBe(
          true,
        );
        for (const asset of Object.values(release.assets)) {
          expect(asset?.sha256, spec.id).toMatch(/^[0-9a-f]{64}$/);
          expect(asset?.bytes, spec.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it("refuses archive entries that climb out of the package", () => {
    const header = new Uint8Array(512);
    header.set(new TextEncoder().encode("package/../../evil"), 0);
    header.set(new TextEncoder().encode("00000000000\0"), 124);
    header.set(new TextEncoder().encode("0"), 156);
    expect(() => readTar(new Uint8Array([...header, ...new Uint8Array(1024)]))).toThrow(TarError);
  });
});

describe("message framing", () => {
  it("splits messages however the bytes are chunked", () => {
    const bytes = new Uint8Array([
      ...encodeMessage({ id: 1, result: "é" }),
      ...encodeMessage({ method: "x" }),
    ]);
    const decoder = new MessageDecoder();
    const messages = [];
    for (let index = 0; index < bytes.length; index += 7) {
      messages.push(...decoder.push(bytes.subarray(index, index + 7)));
    }
    expect(messages.map((text) => JSON.parse(text))).toEqual([
      { id: 1, result: "é" },
      { method: "x" },
    ]);
  });
});
