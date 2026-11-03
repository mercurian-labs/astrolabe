import type { LanguageServerId } from "@t3tools/contracts";

/**
 * Language servers as data: which to run for a checkout, where its binary comes from, its
 * licence, and whether it is safe in a repository that isn't trusted. The resolver reads these;
 * no server has install code of its own.
 */

/**
 * Licences we download; a server under any other (MPL included) has to be on PATH. An SPDX
 * `WITH` exception only grants more, so LLVM's is allowed with its licence.
 */
const LICENCE_ALLOWLIST = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const EXCEPTION_ALLOWLIST = new Set(["LLVM-exception"]);

/** `{platform}` and `{arch}` are Node's names for the environment's. */
export interface NpmSource {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  /** The file to run, inside the package. */
  readonly entry: string;
  /** `node` runs `entry` as a script; `native` runs it directly. */
  readonly runWith: "node" | "native";
}

/** One platform's release file, pinned by its size and SHA-256. */
export interface ReleaseAsset {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** `gz` is the executable itself, gzipped; `zip` unpacks whole and runs `entry`. */
  readonly format: "gz" | "zip";
  readonly entry?: string;
}

/** A project's published build, such as a GitHub release. */
export interface ReleaseSource {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly host: string;
  /** By `{platform}-{arch}`; a platform with no build has to find the server elsewhere. */
  readonly assets: Readonly<Partial<Record<string, ReleaseAsset>>>;
}

/** Built from source by the environment's own Go, which verifies it against Go's checksum database. */
export interface GoSource {
  readonly name: string;
  readonly module: string;
  readonly version: string;
  readonly licence: string;
}

/** The project's own toolchain package, and the major versions this launch is for. */
export interface Toolchain {
  readonly package: string;
  readonly minMajor?: number;
  readonly maxMajor?: number;
}

export interface Launch {
  /** Shown as "<name> <version>". */
  readonly name: string;
  readonly toolchain?: Toolchain;
  /** In the project, relative to the checkout; `{toolchain}` is the toolchain's folder. */
  readonly projectBinary?: { readonly path: string; readonly runWith: "node" | "native" };
  /** A command found on PATH. */
  readonly pathCommand?: string;
  /** Where installers leave it off PATH; `~/` is the home folder. Tried before PATH. */
  readonly knownPaths?: ReadonlyArray<string>;
  /**
   * Run with these arguments, a binary found on PATH or a known path must exit cleanly to count;
   * its output's first version number names it. Catches rustup's proxy for a missing component.
   */
  readonly probe?: ReadonlyArray<string>;
  readonly npm?: NpmSource;
  readonly release?: ReleaseSource;
  readonly go?: GoSource;
  /** `{data}` is a folder of the server's own for this checkout, under the cache. */
  readonly args: ReadonlyArray<string>;
  /** `{toolchain}` is replaced by the toolchain's folder. */
  readonly initializationOptions?: unknown;
  /**
   * The answers to the server's `workspace/configuration`, by section. `{python}` is the
   * checkout's virtual environment interpreter; a value naming one the checkout lacks is left out.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
  /**
   * rust-analyzer's own protocol: it answers a pull with nothing while it loads, and its
   * `experimental/serverStatus` says when it has finished, so its files are pulled again then.
   */
  readonly reportsQuiescence?: boolean;
  /** Runs no repository code (plugins, build scripts), so restricted repositories may use it. */
  readonly restrictedSafe: boolean;
}

export interface LanguageServerSpec {
  readonly id: LanguageServerId;
  /** The server as people know it, before a version is known: "rust-analyzer". */
  readonly name: string;
  /** The languages it serves, for settings: "C and C++". */
  readonly languages: string;
  /** Tried in order: the first whose toolchain matches decides, downloading if it must. */
  readonly launches: ReadonlyArray<Launch>;
  /** What to do when no launch applies. */
  readonly missing: string;
  /** Said in settings when the checkout has none of `unless` (relative paths). */
  readonly hint?: { readonly unless: ReadonlyArray<string>; readonly message: string };
}

const TYPESCRIPT_NATIVE = "@typescript/typescript-{platform}-{arch}";

const RUST_ANALYZER_RELEASE =
  "https://github.com/rust-lang/rust-analyzer/releases/download/2026-11-02";
const CLANGD_RELEASE = "https://github.com/clangd/clangd/releases/download/23.1.0";

export const LANGUAGE_SERVERS: Readonly<Record<LanguageServerId, LanguageServerSpec>> = {
  typescript: {
    id: "typescript",
    name: "TypeScript",
    languages: "TypeScript and JavaScript",
    missing: "No language server applies to this checkout.",
    launches: [
      {
        // TypeScript 7's native compiler is its own language server (pull diagnostics only).
        name: "TypeScript",
        toolchain: { package: "typescript", minMajor: 7 },
        projectBinary: { path: `node_modules/${TYPESCRIPT_NATIVE}/lib/tsc`, runWith: "native" },
        args: ["--lsp", "--stdio"],
        restrictedSafe: false,
      },
      {
        // Before 7, tsserver behind typescript-language-server, with the project's TypeScript.
        name: "TypeScript",
        toolchain: { package: "typescript", maxMajor: 6 },
        projectBinary: {
          path: "node_modules/typescript-language-server/lib/cli.mjs",
          runWith: "node",
        },
        pathCommand: "typescript-language-server",
        npm: {
          name: "typescript-language-server",
          version: "6.0.2",
          licence: "Apache-2.0",
          entry: "lib/cli.mjs",
          runWith: "node",
        },
        args: ["--stdio"],
        initializationOptions: { tsserver: { path: "{toolchain}/lib/tsserver.js" } },
        restrictedSafe: false,
      },
      {
        // No project TypeScript, or a repository that isn't trusted: ours, which loads no plugins.
        name: "TypeScript",
        npm: {
          name: TYPESCRIPT_NATIVE,
          version: "7.0.2",
          licence: "Apache-2.0",
          entry: "lib/tsc",
          runWith: "native",
        },
        args: ["--lsp", "--stdio"],
        restrictedSafe: true,
      },
    ],
  },
  basedpyright: {
    id: "basedpyright",
    name: "basedpyright",
    languages: "Python",
    missing: "basedpyright could not be found or downloaded.",
    hint: {
      unless: [".venv", "venv"],
      message: "No .venv or venv here: imports resolve against the Python on PATH.",
    },
    launches: [
      {
        name: "basedpyright",
        projectBinary: { path: ".venv/bin/basedpyright-langserver", runWith: "native" },
        pathCommand: "basedpyright-langserver",
        npm: {
          name: "basedpyright",
          version: "1.40.2",
          licence: "MIT",
          entry: "langserver.index.js",
          runWith: "node",
        },
        args: ["--stdio"],
        // "standard" checking, not basedpyright's strict-like default; a project's own
        // pyrightconfig.json or pyproject.toml settings still win.
        settings: {
          python: { pythonPath: "{python}" },
          basedpyright: { analysis: { typeCheckingMode: "standard" } },
        },
        // Type checking reads the code; it never runs it.
        restrictedSafe: true,
      },
    ],
  },
  "rust-analyzer": {
    id: "rust-analyzer",
    name: "rust-analyzer",
    languages: "Rust",
    missing:
      "rust-analyzer has no download for this machine: run `rustup component add rust-analyzer`, then try again.",
    launches: [
      {
        name: "rust-analyzer",
        // rustup's own, matching the project's toolchain; its proxy fails the probe without it.
        pathCommand: "rust-analyzer",
        knownPaths: ["~/.cargo/bin/rust-analyzer"],
        probe: ["--version"],
        release: {
          name: "rust-analyzer",
          version: "2026-11-02",
          licence: "MIT OR Apache-2.0",
          host: "GitHub",
          assets: {
            "darwin-arm64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-aarch64-apple-darwin.gz`,
              bytes: 14307639,
              sha256: "d10ca0a10e386f74ca36847b3df2ad5ab6f1328feeb1591467b3724f3fd8e8cf",
              format: "gz",
            },
            "darwin-x64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-x86_64-apple-darwin.gz`,
              bytes: 15052626,
              sha256: "2c3d6c564f9b2734085cf6439c78896545e86b54ebb63870ba701e12ca582b22",
              format: "gz",
            },
            "linux-arm64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-aarch64-unknown-linux-gnu.gz`,
              bytes: 14723671,
              sha256: "4f8699eaee4231df5a5ffd477106ecae3bf6328918a60de742798912ecff6869",
              format: "gz",
            },
            "linux-x64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-x86_64-unknown-linux-gnu.gz`,
              bytes: 15296882,
              sha256: "5249da68c3f36bb77ea7d401824f5e8bd8d0a47a162daf5f72208eb7c1bf1500",
              format: "gz",
            },
            "win32-arm64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-aarch64-pc-windows-msvc.zip`,
              bytes: 16127235,
              sha256: "e726401feb041e0952e3ba745e7a7cac5ea4e8bfa9ad2e078998ba835a524ac7",
              format: "zip",
              entry: "rust-analyzer.exe",
            },
            "win32-x64": {
              url: `${RUST_ANALYZER_RELEASE}/rust-analyzer-x86_64-pc-windows-msvc.zip`,
              bytes: 18023014,
              sha256: "5450a3735c601f047dc9ca46a01add55c4ac7ef450ae5e710d249a26d65f5632",
              format: "zip",
              entry: "rust-analyzer.exe",
            },
          },
        },
        args: [],
        reportsQuiescence: true,
        // Runs build scripts and procedural macros, and `cargo check` on save.
        restrictedSafe: false,
      },
    ],
  },
  gopls: {
    id: "gopls",
    name: "gopls",
    languages: "Go",
    missing: "gopls needs Go: install it from go.dev/dl, then try again.",
    launches: [
      {
        name: "gopls",
        pathCommand: "gopls",
        // Where `go install` puts it by default, often off PATH.
        knownPaths: ["~/go/bin/gopls"],
        probe: ["version"],
        go: {
          name: "gopls",
          module: "golang.org/x/tools/gopls",
          version: "v0.24.0",
          licence: "BSD-3-Clause",
        },
        args: [],
        // Loads packages through `go list`, which can run the module's toolchain directives.
        restrictedSafe: false,
      },
    ],
  },
  clangd: {
    id: "clangd",
    name: "clangd",
    languages: "C and C++",
    hint: {
      unless: ["compile_commands.json", "build/compile_commands.json", "compile_flags.txt"],
      message:
        "No compile_commands.json: clangd guesses each file's flags, so includes and macros may be wrong. Have your build tool write one (CMake: -DCMAKE_EXPORT_COMPILE_COMMANDS=ON).",
    },
    missing: "clangd has no download for this machine: install clangd (LLVM), then try again.",
    launches: [
      {
        name: "clangd",
        // Apple's command line tools and Xcode ship it, as does Homebrew's (keg-only) LLVM.
        knownPaths: [
          "/Library/Developer/CommandLineTools/usr/bin/clangd",
          "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clangd",
          "/opt/homebrew/opt/llvm/bin/clangd",
          "/usr/local/opt/llvm/bin/clangd",
        ],
        pathCommand: "clangd",
        probe: ["--version"],
        release: {
          name: "clangd",
          version: "23.1.0",
          licence: "Apache-2.0 WITH LLVM-exception",
          host: "GitHub",
          assets: {
            "darwin-arm64": {
              url: `${CLANGD_RELEASE}/clangd-mac-23.1.0.zip`,
              bytes: 100060151,
              sha256: "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253",
              format: "zip",
              entry: "clangd_23.1.0/bin/clangd",
            },
            "darwin-x64": {
              url: `${CLANGD_RELEASE}/clangd-mac-23.1.0.zip`,
              bytes: 100060151,
              sha256: "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253",
              format: "zip",
              entry: "clangd_23.1.0/bin/clangd",
            },
            "linux-x64": {
              url: `${CLANGD_RELEASE}/clangd-linux-23.1.0.zip`,
              bytes: 117949007,
              sha256: "e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd",
              format: "zip",
              entry: "clangd_23.1.0/bin/clangd",
            },
            "win32-x64": {
              url: `${CLANGD_RELEASE}/clangd-windows-23.1.0.zip`,
              bytes: 29690805,
              sha256: "23412a240756a162e7b98a282f36aa2a23a88db5ce16a0cbc4fef7253768c810",
              format: "zip",
              entry: "clangd_23.1.0/bin/clangd.exe",
            },
          },
        },
        args: ["--background-index", "--header-insertion=never"],
        // Parses and indexes; it never builds or runs the code.
        restrictedSafe: true,
      },
    ],
  },
  jdtls: {
    id: "jdtls",
    name: "jdtls",
    languages: "Java",
    // Eclipse's server is EPL-2.0, outside the licences we download: it has to be installed.
    missing:
      "jdtls isn't installed: run `brew install jdtls`, or put Eclipse's `jdtls` on PATH (it needs Java 21 or newer), then try again.",
    hint: {
      unless: [
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
      ],
      message:
        "No Maven or Gradle build here: jdtls reads each Java file on its own, without dependencies.",
    },
    launches: [
      {
        name: "jdtls",
        // Its launcher refuses a Java older than 21 itself.
        knownPaths: ["/opt/homebrew/bin/jdtls", "/usr/local/bin/jdtls"],
        pathCommand: "jdtls",
        // Its default data folder is named after the checkout's folder alone, so two checkouts
        // of the same name would fight over it.
        // The property keeps Eclipse's .project, .classpath and .settings out of the checkout; as
        // an LSP setting it has no effect.
        args: [
          "--jvm-arg=-Djava.import.generatesMetadataFilesAtProjectRoot=false",
          "-data",
          "{data}",
        ],
        // Imports Maven and Gradle builds, which run their plugins and build scripts.
        restrictedSafe: false,
      },
    ],
  },
};

/**
 * Whether an SPDX expression allows us to download: one allowed side of an OR, all of an AND,
 * each licence bare or `WITH` an allowed exception.
 */
export const licenceAllowed = (expression: unknown): boolean => {
  if (typeof expression !== "string") return false;
  const bare = expression.replaceAll(/[()]/g, "").trim();
  return bare.split(/\s+OR\s+/).some((alternative) =>
    alternative.split(/\s+AND\s+/).every((term) => {
      const [licence, exception, ...rest] = term.trim().split(/\s+WITH\s+/);
      return (
        rest.length === 0 &&
        LICENCE_ALLOWLIST.has(licence ?? "") &&
        (exception === undefined || EXCEPTION_ALLOWLIST.has(exception))
      );
    }),
  );
};

export const fillPlatform = (text: string, platform: string, arch: string) =>
  text.replaceAll("{platform}", platform).replaceAll("{arch}", arch);
