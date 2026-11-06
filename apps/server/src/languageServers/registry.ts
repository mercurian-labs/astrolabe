import type {
  BuiltInLanguageServerId,
  LanguageServerId,
  LanguageServerToolchainKind,
} from "@t3tools/contracts";

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
  /**
   * What `entry` needs at run time, exactly pinned and unpacked side by side in `node_modules`.
   * npm's tarball holds none of them; each is checked like the package itself.
   */
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** One platform's release file, pinned by its size and SHA-256. */
export interface ReleaseAsset {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /**
   * `gz` is the executable itself, gzipped; `zip` and `tgz` unpack whole and run `entry` (the
   * release's name by default). A `tgz`'s top folder is dropped.
   */
  readonly format: "gz" | "zip" | "tgz";
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
  /** Over the environment's own. */
  readonly env?: Readonly<Record<string, string>>;
  /** What a person named in settings: it runs wherever the name leads, and isn't second-guessed. */
  readonly chosen?: boolean;
  /** `{toolchain}` is replaced by the toolchain's folder. */
  readonly initializationOptions?: unknown;
  /**
   * The answers to the server's `workspace/configuration`, by section. `{python}` is the
   * interpreter chosen for the checkout, or its virtual environment's; a value naming one the
   * checkout lacks is left out.
   * `{rootUri}` and `{rootName}` are the checkout's.
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
  /** Folders it writes inside a checkout, kept out of that checkout's git status. */
  readonly writes?: ReadonlyArray<string>;
  /** Stops treating a file as the project's once it closes, until told the file exists. */
  readonly forgetsClosedFiles?: boolean;
  /** Said in settings when the checkout has none of `unless` (relative paths). */
  readonly hint?: { readonly unless: ReadonlyArray<string>; readonly message: string };
  /** For a language's primary: who may format its files, in order. Without it, the primary. */
  readonly formatters?: ReadonlyArray<LanguageServerId>;
  /** The toolchain it reads, whose choice restarts it. */
  readonly usesToolchain?: LanguageServerToolchainKind;
  /** Added in settings to run beside a language's servers, so it goes first past the memory budget. */
  readonly joins?: boolean;
  /**
   * For a companion: what shows the checkout uses it, read at its root. Without it, every
   * checkout does.
   */
  readonly activation?: Activation;
}

export interface Activation {
  /** Any of these files. */
  readonly files: ReadonlyArray<string>;
  /** Or any of these in package.json's dependencies of any kind. */
  readonly packages: ReadonlyArray<string>;
  /** "an ESLint config", as in "no ESLint config or eslint in package.json". */
  readonly description: string;
}

const TYPESCRIPT_NATIVE = "@typescript/typescript-{platform}-{arch}";

const RUST_ANALYZER_RELEASE =
  "https://github.com/rust-lang/rust-analyzer/releases/download/2026-11-02";
// What TypeScript's servers offer once told to. Offering costs nothing: an editor asks for hints
// and lenses only when its settings show them, and the kinds it wants are chosen there.
const TYPESCRIPT_FEATURES = {
  inlayHints: {
    // TypeScript 7's own names.
    parameterNames: { enabled: "literals", suppressWhenArgumentMatchesName: true },
    parameterTypes: { enabled: true },
    variableTypes: { enabled: true, suppressWhenTypeMatchesName: true },
    propertyDeclarationTypes: { enabled: true },
    functionLikeReturnTypes: { enabled: true },
    enumMemberValues: { enabled: true },
    // tsserver's, through typescript-language-server.
    includeInlayParameterNameHints: "literals",
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayFunctionParameterTypeHints: true,
    includeInlayVariableTypeHints: true,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: true,
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayEnumMemberValueHints: true,
  },
  referencesCodeLens: { enabled: true },
  implementationsCodeLens: { enabled: true },
};
const TYPESCRIPT_SETTINGS = {
  "js/ts": TYPESCRIPT_FEATURES,
  typescript: TYPESCRIPT_FEATURES,
  javascript: TYPESCRIPT_FEATURES,
};

const CLANGD_RELEASE = "https://github.com/clangd/clangd/releases/download/23.1.0";
const RUFF_RELEASE = "https://github.com/astral-sh/ruff/releases/download/0.17.4";

export const LANGUAGE_SERVERS: Readonly<Record<BuiltInLanguageServerId, LanguageServerSpec>> = {
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
        settings: TYPESCRIPT_SETTINGS,
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
        settings: TYPESCRIPT_SETTINGS,
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
    // A rename would otherwise skip every file that was opened and closed since it started.
    forgetsClosedFiles: true,
    hint: {
      unless: [".venv", "venv"],
      message: "No .venv or venv here: imports resolve against the Python on PATH.",
    },
    // basedpyright has no formatter of its own today; a later one must not fight Ruff's.
    formatters: ["ruff", "basedpyright"],
    usesToolchain: "python",
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
        settings: {
          gopls: {
            hints: {
              assignVariableTypes: true,
              compositeLiteralFields: true,
              compositeLiteralTypes: true,
              constantValues: true,
              functionTypeParameters: true,
              parameterNames: true,
              rangeVariableTypes: true,
            },
          },
        },
        // Loads packages through `go list`, which can run the module's toolchain directives.
        restrictedSafe: false,
      },
    ],
  },
  clangd: {
    id: "clangd",
    name: "clangd",
    languages: "C and C++",
    // Its background index sits beside the compile commands.
    writes: [".cache/clangd/"],
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
  ruff: {
    id: "ruff",
    name: "Ruff",
    languages: "Python",
    missing: "Ruff could not be found or downloaded.",
    launches: [
      {
        name: "Ruff",
        projectBinary: { path: ".venv/bin/ruff", runWith: "native" },
        pathCommand: "ruff",
        probe: ["--version"],
        release: {
          name: "ruff",
          version: "0.17.4",
          licence: "MIT",
          host: "GitHub",
          // Linux builds are musl: static, so they run on any distribution.
          assets: {
            "darwin-arm64": {
              url: `${RUFF_RELEASE}/ruff-aarch64-apple-darwin.tar.gz`,
              bytes: 9350605,
              sha256: "6ef8b3a7fd5294f5e8384ceb29784a6f5657da0853824312b1d2cef53aef17af",
              format: "tgz",
            },
            "darwin-x64": {
              url: `${RUFF_RELEASE}/ruff-x86_64-apple-darwin.tar.gz`,
              bytes: 10165222,
              sha256: "0475a156ae8d73ba3386c90207804a72b3d7002ceb9dbca38dabc5d84aa95c9b",
              format: "tgz",
            },
            "linux-arm64": {
              url: `${RUFF_RELEASE}/ruff-aarch64-unknown-linux-musl.tar.gz`,
              bytes: 9608470,
              sha256: "71491cf93242d1bde15dcc628fd105f27c54738bef6b94050b9363ba6795f97e",
              format: "tgz",
            },
            "linux-x64": {
              url: `${RUFF_RELEASE}/ruff-x86_64-unknown-linux-musl.tar.gz`,
              bytes: 10433557,
              sha256: "d1d6ec9ce1ce0c01e23532a157a677077ba1f82f7cd2cde6f0bd75e65f85df93",
              format: "tgz",
            },
            "win32-arm64": {
              url: `${RUFF_RELEASE}/ruff-aarch64-pc-windows-msvc.zip`,
              bytes: 9831205,
              sha256: "44f5ca139d81e85fdc92c03ce759c30af834f6afaea22be449683b9e638e6b86",
              format: "zip",
              entry: "ruff.exe",
            },
            "win32-x64": {
              url: `${RUFF_RELEASE}/ruff-x86_64-pc-windows-msvc.zip`,
              bytes: 10234551,
              sha256: "d37f57c7a0cfb8ed5a39adc96f7a0a63767b3c5abe4629c4c84e33c06da46885",
              format: "zip",
              entry: "ruff.exe",
            },
          },
        },
        args: ["server"],
        // Written in Rust with no plugins: its configuration names rules and paths, never code to
        // load, and `ruff server` runs no subprocess. The project's own binary needs trust.
        restrictedSafe: true,
      },
    ],
  },
  eslint: {
    id: "eslint",
    name: "ESLint",
    languages: "TypeScript and JavaScript",
    missing: "ESLint's language server could not be found or downloaded.",
    activation: {
      files: [
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        "eslint.config.ts",
        "eslint.config.mts",
        "eslint.config.cts",
        ".eslintrc",
        ".eslintrc.js",
        ".eslintrc.cjs",
        ".eslintrc.json",
        ".eslintrc.yaml",
        ".eslintrc.yml",
      ],
      packages: ["eslint"],
      description: "ESLint config",
    },
    launches: [
      {
        name: "ESLint",
        // Not from PATH: the server loads the project's ESLint, so a machine's old copy brings
        // nothing and can't read today's configs.
        projectBinary: {
          path: "node_modules/vscode-langservers-extracted/bin/vscode-eslint-language-server",
          runWith: "node",
        },
        npm: {
          name: "vscode-langservers-extracted",
          version: "4.10.0",
          licence: "MIT",
          entry: "bin/vscode-eslint-language-server",
          runWith: "node",
          // What the ESLint server of that package requires; its other servers are not used.
          dependencies: {
            "core-js": "3.51.0",
            "regenerator-runtime": "0.13.11",
            semver: "7.8.6",
            "vscode-jsonrpc": "9.0.3",
            "vscode-languageserver": "10.1.2",
            "vscode-languageserver-protocol": "3.18.4",
            "vscode-languageserver-textdocument": "1.0.16",
            "vscode-languageserver-types": "3.18.4",
            "vscode-uri": "3.2.0",
          },
        },
        args: ["--stdio"],
        // The server asks for these with no section; it treats most as required. `useFlatConfig`
        // stays unset so it follows what the project's ESLint does.
        settings: {
          validate: "on",
          run: "onType",
          format: false,
          quiet: false,
          onIgnoredFiles: "off",
          nodePath: null,
          options: {},
          rulesCustomizations: [],
          workingDirectory: { mode: "auto" },
          workspaceFolder: { uri: "{rootUri}", name: "{rootName}" },
          experimental: {},
          problems: { shortenToSingleLine: false },
          codeAction: {
            disableRuleComment: { enable: true, location: "separateLine" },
            showDocumentation: { enable: true },
          },
          codeActionOnSave: { enable: false, mode: "all" },
        },
        // Loads the project's ESLint, its config and its plugins.
        restrictedSafe: false,
      },
    ],
  },
  tailwindcss: {
    id: "tailwindcss",
    name: "Tailwind CSS",
    languages: "TypeScript and JavaScript",
    missing: "Tailwind's language server could not be found or downloaded.",
    activation: {
      files: [
        "tailwind.config.js",
        "tailwind.config.cjs",
        "tailwind.config.mjs",
        "tailwind.config.ts",
        "tailwind.config.cts",
        "tailwind.config.mts",
      ],
      packages: ["tailwindcss"],
      description: "Tailwind config",
    },
    launches: [
      {
        name: "Tailwind CSS",
        // Not from PATH, as with ESLint: it loads the project's Tailwind.
        projectBinary: {
          path: "node_modules/@tailwindcss/language-server/bin/tailwindcss-language-server",
          runWith: "node",
        },
        npm: {
          name: "@tailwindcss/language-server",
          version: "0.16.0",
          licence: "MIT",
          entry: "bin/tailwindcss-language-server",
          runWith: "node",
        },
        args: ["--stdio"],
        // Loads the project's config and its plugins, which are code.
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
