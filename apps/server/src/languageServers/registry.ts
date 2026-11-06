import type { BuiltInLanguageServerId, LanguageServerId } from "@t3tools/contracts";

/**
 * Language servers as data: which to run for a checkout, where its binary comes from, its
 * licence, and whether it is safe in a repository that isn't trusted. The resolver reads these;
 * no server has install code of its own.
 */

/**
 * Licences we download; a server under any other (MPL included) has to be on PATH, unless its
 * own row says otherwise (`licenceRuled`). An SPDX `WITH` exception only grants more, so LLVM's
 * is allowed with its licence.
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
   * `binary` is the executable itself and `gz` the same gzipped; `zip` and `tgz` unpack whole and
   * run `entry` (the release's name by default). A `tgz`'s one top folder is dropped, if it has one.
   */
  readonly format: "binary" | "gz" | "zip" | "tgz";
  readonly entry?: string;
  /**
   * With `java`, what comes before `-jar entry`. `{release}` is the unpacked folder and `{data}`
   * the launch's own. Launchers name a platform's configuration, so these differ by platform.
   */
  readonly jvmArgs?: ReadonlyArray<string>;
}

/** A project's published build, such as a GitHub release. */
export interface ReleaseSource {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  /** Outside the allowlist, and allowed for this one server by a maintainer's ruling. */
  readonly licenceRuled?: boolean;
  readonly host: string;
  /**
   * `entry` is a jar for this Java or newer, which the machine must already have: no launch
   * applies without it. A launch's `--jvm-arg=` arguments reach the JVM, as jdtls's launcher does.
   */
  readonly java?: { readonly minMajor: number };
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
  /**
   * Publishes only what differs from its last, so a clean file or an edit that changes no
   * problem gets no word at all, and an agent has to stop waiting for one.
   */
  readonly quietUnchanged?: boolean;
  /** Said in settings when the checkout has none of `unless` (relative paths). */
  readonly hint?: { readonly unless: ReadonlyArray<string>; readonly message: string };
  /** For a language's primary: who may format its files, in order. Without it, the primary. */
  readonly formatters?: ReadonlyArray<LanguageServerId>;
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

/** What every server of `vscode-langservers-extracted` runs on. */
const VSCODE_SERVER = {
  "@vscode/l10n": "0.0.18",
  "core-js": "3.51.0",
  "regenerator-runtime": "0.13.11",
  "vscode-jsonrpc": "9.0.3",
  "vscode-languageserver": "10.1.2",
  "vscode-languageserver-protocol": "3.18.4",
  "vscode-languageserver-textdocument": "1.0.16",
  "vscode-languageserver-types": "3.18.4",
  "vscode-uri": "3.2.0",
};

/** One of that package's servers, with what it alone needs: HTML's TypeScript is 22 MB. */
const extractedServer = (server: string, dependencies: Record<string, string>): NpmSource => ({
  name: "vscode-langservers-extracted",
  version: "4.10.0",
  licence: "MIT",
  entry: `bin/vscode-${server}-language-server`,
  runWith: "node",
  dependencies,
});

const TAPLO_RELEASE = "https://github.com/tamasfe/taplo/releases/download/0.10.0";
const LUA_RELEASE = "https://github.com/LuaLS/lua-language-server/releases/download/3.19.2";
const MARKSMAN_RELEASE = "https://github.com/artempyanykh/marksman/releases/download/2026-02-08";
const CLANGD_RELEASE = "https://github.com/clangd/clangd/releases/download/23.1.0";
const RUFF_RELEASE = "https://github.com/astral-sh/ruff/releases/download/0.17.4";

/** One tarball for every platform; `config` names each platform's native parts. */
const jdtlsAsset = (config: string): ReleaseAsset => ({
  url: "https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz",
  bytes: 51143565,
  sha256: "b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4",
  format: "tgz",
  entry: "plugins/org.eclipse.equinox.launcher_1.8.0.v20260804-1928.jar",
  // What the Python launcher in that tarball passes, so Python needn't be on the machine. Java 24
  // and newer need the two XML limits lifted; older ones ignore them.
  jvmArgs: [
    "-Djdk.xml.maxGeneralEntitySizeLimit=0",
    "-Djdk.xml.totalEntitySizeLimit=0",
    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
    "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product",
    "-Dosgi.checkConfiguration=true",
    `-Dosgi.sharedConfiguration.area={release}/${config}`,
    "-Dosgi.sharedConfiguration.area.readOnly=true",
    "-Dosgi.configuration.cascaded=true",
    // Equinox would otherwise write here into the release, which every checkout shares.
    "-Dosgi.configuration.area={data}/configuration",
    "-Xms1G",
    "--add-modules=ALL-SYSTEM",
    "--add-opens",
    "java.base/java.util=ALL-UNNAMED",
    "--add-opens",
    "java.base/java.lang=ALL-UNNAMED",
  ],
});

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
    missing:
      "jdtls needs Java 21 or newer, which this machine doesn't have: run `brew install openjdk` or install one from adoptium.net, then try again.",
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
        release: {
          name: "jdtls",
          version: "1.63.0",
          licence: "EPL-2.0",
          // Ruled 2026-11-06: Eclipse's own milestone build, for this server only.
          licenceRuled: true,
          host: "Eclipse",
          java: { minMajor: 21 },
          assets: {
            "darwin-arm64": jdtlsAsset("config_mac_arm"),
            "darwin-x64": jdtlsAsset("config_mac"),
            "linux-arm64": jdtlsAsset("config_linux_arm"),
            "linux-x64": jdtlsAsset("config_linux"),
            "win32-arm64": jdtlsAsset("config_win"),
            "win32-x64": jdtlsAsset("config_win"),
          },
        },
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
  json: {
    id: "json",
    name: "JSON",
    languages: "JSON",
    missing: "JSON's language server could not be found or downloaded.",
    launches: [
      {
        name: "JSON",
        pathCommand: "vscode-json-language-server",
        npm: extractedServer("json", {
          ...VSCODE_SERVER,
          "jsonc-parser": "3.3.1",
          "request-light": "0.7.0",
          "vscode-json-languageservice": "5.7.2",
        }),
        args: ["--stdio"],
        initializationOptions: { provideFormatter: true },
        // Runs nothing. A file's `$schema` can make it fetch that URL, a GET and no more.
        restrictedSafe: true,
      },
    ],
  },
  css: {
    id: "css",
    name: "CSS",
    languages: "CSS, SCSS and Less",
    missing: "CSS's language server could not be found or downloaded.",
    launches: [
      {
        name: "CSS",
        pathCommand: "vscode-css-language-server",
        npm: extractedServer("css", {
          ...VSCODE_SERVER,
          "vscode-css-languageservice": "6.3.10",
        }),
        args: ["--stdio"],
        initializationOptions: { provideFormatter: true },
        // Its linter fails on no settings at all, which it reports as a clean file.
        settings: { css: {}, scss: {}, less: {} },
        // Parses stylesheets; it follows no import to run anything.
        restrictedSafe: true,
      },
    ],
  },
  html: {
    id: "html",
    name: "HTML",
    languages: "HTML",
    missing: "HTML's language server could not be found or downloaded.",
    launches: [
      {
        name: "HTML",
        pathCommand: "vscode-html-language-server",
        npm: extractedServer("html", {
          ...VSCODE_SERVER,
          typescript: "4.9.5",
          "vscode-css-languageservice": "6.3.10",
          "vscode-html-languageservice": "5.6.2",
        }),
        args: ["--stdio"],
        initializationOptions: { provideFormatter: true },
        settings: { html: {}, css: {}, javascript: {} },
        // Embedded scripts go to its own TypeScript, which loads no project plugins.
        restrictedSafe: true,
      },
    ],
  },
  yaml: {
    id: "yaml",
    name: "YAML",
    languages: "YAML",
    missing: "YAML's language server could not be found or downloaded.",
    launches: [
      {
        name: "YAML",
        pathCommand: "yaml-language-server",
        npm: {
          name: "yaml-language-server",
          version: "2.0.0",
          licence: "MIT",
          entry: "bin/yaml-language-server",
          runWith: "node",
          dependencies: {
            "@vscode/l10n": "0.0.18",
            ajv: "8.20.0",
            "ajv-draft-04": "1.0.0",
            "ajv-i18n": "4.2.0",
            "fast-deep-equal": "3.1.3",
            "fast-uri": "3.1.9",
            "json-schema-traverse": "1.0.0",
            "jsonc-parser": "3.3.1",
            picomatch: "4.0.7",
            prettier: "3.9.10",
            "request-light": "0.5.8",
            "require-from-string": "2.0.2",
            "vscode-jsonrpc": "9.0.3",
            "vscode-languageserver": "10.1.2",
            "vscode-languageserver-protocol": "3.18.4",
            "vscode-languageserver-textdocument": "1.0.16",
            "vscode-languageserver-types": "3.18.4",
            "vscode-uri": "3.2.0",
            yaml: "2.8.3",
          },
        },
        args: ["--stdio"],
        // Runs nothing. It fetches schemas: SchemaStore's list, and a URL a file names.
        restrictedSafe: true,
      },
    ],
  },
  bash: {
    id: "bash",
    name: "Bash",
    languages: "Bash",
    missing: "Bash's language server could not be found or downloaded.",
    launches: [
      {
        name: "Bash",
        pathCommand: "bash-language-server",
        npm: {
          name: "bash-language-server",
          version: "5.8.1",
          licence: "MIT",
          entry: "out/cli.js",
          runWith: "node",
          dependencies: {
            "@isaacs/balanced-match": "4.0.1",
            "@isaacs/brace-expansion": "5.0.1",
            "@mixmark-io/domino": "2.2.0",
            "@nodelib/fs.scandir": "2.1.5",
            "@nodelib/fs.stat": "2.0.5",
            "@nodelib/fs.walk": "1.2.8",
            "@one-ini/wasm": "0.2.1",
            braces: "3.0.3",
            commander: "14.0.3",
            editorconfig: "3.0.2",
            "fast-glob": "3.3.3",
            fastq: "1.20.3",
            "fill-range": "7.1.1",
            "fuzzy-search": "3.2.1",
            "glob-parent": "5.1.2",
            "is-extglob": "2.1.1",
            "is-glob": "4.0.3",
            "is-number": "7.0.0",
            merge2: "1.4.1",
            micromatch: "4.0.8",
            // The last under ISC, and what `.editorconfig` globs need of it: later ones are
            // BlueOak-1.0.0, which we don't download.
            minimatch: "10.0.3",
            picomatch: "2.3.2",
            "queue-microtask": "1.2.3",
            reusify: "1.1.0",
            "run-parallel": "1.2.0",
            semver: "7.8.6",
            "to-regex-range": "5.0.1",
            turndown: "7.2.4",
            "vscode-jsonrpc": "9.0.2",
            "vscode-languageserver": "10.1.1",
            "vscode-languageserver-protocol": "3.18.3",
            "vscode-languageserver-textdocument": "1.0.14",
            "vscode-languageserver-types": "3.18.3",
            "web-tree-sitter": "0.27.0",
            zod: "3.25.76",
          },
        },
        args: ["start"],
        // Only ShellCheck and shfmt from the machine, which read scripts and never run them.
        restrictedSafe: true,
      },
    ],
  },
  dockerfile: {
    id: "dockerfile",
    name: "Dockerfile",
    languages: "Dockerfile",
    missing: "Dockerfile's language server could not be found or downloaded.",
    launches: [
      {
        name: "Dockerfile",
        pathCommand: "docker-langserver",
        npm: {
          name: "dockerfile-language-server-nodejs",
          version: "0.15.0",
          licence: "MIT",
          entry: "bin/docker-langserver",
          runWith: "node",
          dependencies: {
            "dockerfile-ast": "0.7.1",
            "dockerfile-language-service": "0.16.1",
            "dockerfile-utils": "0.16.3",
            "vscode-jsonrpc": "8.0.2",
            "vscode-languageserver": "8.0.2",
            "vscode-languageserver-protocol": "3.17.2",
            "vscode-languageserver-textdocument": "1.0.16",
            "vscode-languageserver-types": "3.17.2",
          },
        },
        args: ["--stdio"],
        // Reads the file in front of it, and starts nothing.
        restrictedSafe: true,
      },
    ],
  },
  taplo: {
    id: "taplo",
    name: "Taplo",
    languages: "TOML",
    missing: "Taplo has no download for this machine: install `taplo`, then try again.",
    launches: [
      {
        name: "Taplo",
        pathCommand: "taplo",
        probe: ["--version"],
        release: {
          name: "taplo",
          version: "0.10.0",
          licence: "MIT",
          host: "GitHub",
          assets: {
            "darwin-arm64": {
              url: `${TAPLO_RELEASE}/taplo-darwin-aarch64.gz`,
              bytes: 4616415,
              sha256: "713734314c3e71894b9e77513c5349835eefbd52908445a0d73b0c7dc469347d",
              format: "gz",
            },
            "darwin-x64": {
              url: `${TAPLO_RELEASE}/taplo-darwin-x86_64.gz`,
              bytes: 4921954,
              sha256: "898122cde3a0b1cd1cbc2d52d3624f23338218c91b5ddb71518236a4c2c10ef2",
              format: "gz",
            },
            "linux-arm64": {
              url: `${TAPLO_RELEASE}/taplo-linux-aarch64.gz`,
              bytes: 4631779,
              sha256: "033681d01eec8376c3fd38fa3703c79316f5e14bb013d859943b60a07bccdcc3",
              format: "gz",
            },
            "linux-x64": {
              url: `${TAPLO_RELEASE}/taplo-linux-x86_64.gz`,
              bytes: 5116068,
              sha256: "8fe196b894ccf9072f98d4e1013a180306e17d244830b03986ee5e8eabeb6156",
              format: "gz",
            },
            "win32-arm64": {
              url: `${TAPLO_RELEASE}/taplo-windows-aarch64.gz`,
              bytes: 4810191,
              sha256: "c16a9a1248bdd746fde657b0196bfc47c8bede1e50ae73b7d9d33088a6682180",
              format: "gz",
            },
            "win32-x64": {
              url: `${TAPLO_RELEASE}/taplo-windows-x86_64.gz`,
              bytes: 5182493,
              sha256: "550fdc955343f8a196447a05346ecf8827e391726e4ded577bb00a0a36cf220c",
              format: "gz",
            },
          },
        },
        args: ["lsp", "stdio"],
        // Parses TOML, with no plugins. Its config can name schemas to fetch, not code to run.
        restrictedSafe: true,
      },
    ],
  },
  lua: {
    id: "lua",
    name: "LuaLS",
    languages: "Lua",
    quietUnchanged: true,
    missing:
      "LuaLS has no download for this machine: install `lua-language-server`, then try again.",
    launches: [
      {
        name: "LuaLS",
        pathCommand: "lua-language-server",
        release: {
          name: "lua-language-server",
          version: "3.19.2",
          licence: "MIT",
          host: "GitHub",
          assets: {
            "darwin-arm64": {
              url: `${LUA_RELEASE}/lua-language-server-3.19.2-darwin-arm64.tar.gz`,
              bytes: 3286148,
              sha256: "79149584320a23bd5fcd5bc31f47a1975acd8a4560a0e89036bb1016fa61687f",
              format: "tgz",
              entry: "bin/lua-language-server",
            },
            "darwin-x64": {
              url: `${LUA_RELEASE}/lua-language-server-3.19.2-darwin-x64.tar.gz`,
              bytes: 2337043,
              sha256: "6f2174ece5ec63bcd9d5b22b2c902445c1cd9045fafe48c62602448ebf4c09cc",
              format: "tgz",
              entry: "bin/lua-language-server",
            },
            "linux-arm64": {
              url: `${LUA_RELEASE}/lua-language-server-3.19.2-linux-arm64.tar.gz`,
              bytes: 2633728,
              sha256: "17b8e401a874440adeb649e5024c364f2bb9d15156c74a40e56d1ae9a1b2e4f2",
              format: "tgz",
              entry: "bin/lua-language-server",
            },
            "linux-x64": {
              url: `${LUA_RELEASE}/lua-language-server-3.19.2-linux-x64.tar.gz`,
              bytes: 3696210,
              sha256: "93ad326b10f6c00911dd8c450fa098332dbd8f9f45d1052f5636a2d54479b947",
              format: "tgz",
              entry: "bin/lua-language-server",
            },
            "win32-x64": {
              url: `${LUA_RELEASE}/lua-language-server-3.19.2-win32-x64.zip`,
              bytes: 4455290,
              sha256: "4a3dc851b3b31e7b75a23f645d1ba4a2137579a55f5fa4edbb17a3e2a6254044",
              format: "zip",
              entry: "bin/lua-language-server.exe",
            },
          },
        },
        // Out of the release, which every checkout shares.
        args: ["--logpath={data}/log", "--metapath={data}/meta"],
        settings: { Lua: { hint: { enable: true }, telemetry: { enable: false } } },
        // `.luarc.json` can name a Lua plugin, which it runs.
        restrictedSafe: false,
      },
    ],
  },
  marksman: {
    id: "marksman",
    name: "Marksman",
    languages: "Markdown",
    quietUnchanged: true,
    missing: "Marksman has no download for this machine: install `marksman`, then try again.",
    launches: [
      {
        name: "Marksman",
        pathCommand: "marksman",
        release: {
          name: "marksman",
          version: "2026-02-08",
          licence: "MIT",
          host: "GitHub",
          assets: {
            // One universal build; its musl builds still need musl, so glibc's is the wider.
            "darwin-arm64": {
              url: `${MARKSMAN_RELEASE}/marksman-macos`,
              bytes: 43856208,
              sha256: "6a801c17b5ac0dba69787c5282b3b3bd416e66c96253fae098d311c6bbd1833b",
              format: "binary",
            },
            "darwin-x64": {
              url: `${MARKSMAN_RELEASE}/marksman-macos`,
              bytes: 43856208,
              sha256: "6a801c17b5ac0dba69787c5282b3b3bd416e66c96253fae098d311c6bbd1833b",
              format: "binary",
            },
            "linux-arm64": {
              url: `${MARKSMAN_RELEASE}/marksman-linux-arm64`,
              bytes: 21851058,
              sha256: "db8e124527f7f8048e3e6c91821b9c52ef173d92c01e47d221bf1337afd962fb",
              format: "binary",
            },
            "linux-x64": {
              url: `${MARKSMAN_RELEASE}/marksman-linux-x64`,
              bytes: 22500875,
              sha256: "be5098e8213219269c47fc0d916a66fa31ce0602ec967475c722260aabf26087",
              format: "binary",
            },
            "win32-x64": {
              url: `${MARKSMAN_RELEASE}/marksman.exe`,
              bytes: 20502938,
              sha256: "a6d05beb08ebe41b0a9f09c98a438540421436fa5531424c22e0bb1d22529705",
              format: "binary",
            },
          },
        },
        args: ["server"],
        // Reads Markdown and nothing else; `.marksman.toml` holds only its own options.
        restrictedSafe: true,
      },
    ],
  },
  // Installed, not downloaded: each of these needs its language's own toolchain to be any use,
  // and that toolchain, or the version it pins, decides which build fits.
  zls: {
    id: "zls",
    name: "zls",
    languages: "Zig",
    missing:
      "zls isn't installed: run `brew install zls`, or get the build matching your Zig from zigtools.org, then try again.",
    launches: [
      {
        name: "zls",
        pathCommand: "zls",
        probe: ["--version"],
        args: [],
        // Runs the project's `build.zig` to learn its modules.
        restrictedSafe: false,
      },
    ],
  },
  "sourcekit-lsp": {
    id: "sourcekit-lsp",
    name: "SourceKit-LSP",
    languages: "Swift",
    writes: [".build/"],
    missing:
      "SourceKit-LSP comes with Swift: install Xcode or its command line tools, or Swift from swift.org, then try again.",
    launches: [
      {
        name: "SourceKit-LSP",
        // /usr/bin's is the shim that offers to install Xcode's tools.
        knownPaths: [
          "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp",
          "/Library/Developer/CommandLineTools/usr/bin/sourcekit-lsp",
        ],
        pathCommand: "sourcekit-lsp",
        args: [],
        // Compiles and runs `Package.swift`.
        restrictedSafe: false,
      },
    ],
  },
  "ruby-lsp": {
    id: "ruby-lsp",
    name: "Ruby LSP",
    languages: "Ruby",
    writes: [".ruby-lsp/"],
    missing: "Ruby LSP isn't installed: run `gem install ruby-lsp`, then try again.",
    launches: [
      {
        name: "Ruby LSP",
        pathCommand: "ruby-lsp",
        probe: ["--version"],
        args: [],
        // Runs Bundler on the project's Gemfile, and loads add-ons from its gems.
        restrictedSafe: false,
      },
    ],
  },
  phpactor: {
    id: "phpactor",
    name: "Phpactor",
    languages: "PHP",
    missing:
      "Phpactor isn't installed: follow phpactor.readthedocs.io (it needs PHP), then try again.",
    launches: [
      {
        name: "Phpactor",
        pathCommand: "phpactor",
        args: ["language-server"],
        // `.phpactor.json` can name tools for it to run.
        restrictedSafe: false,
      },
    ],
  },
  csharp: {
    id: "csharp",
    name: "csharp-ls",
    languages: "C#",
    missing:
      "No C# language server is installed: run `dotnet tool install --global csharp-ls`, or put OmniSharp on PATH, then try again.",
    launches: [
      {
        name: "csharp-ls",
        pathCommand: "csharp-ls",
        // Where `dotnet tool install --global` puts it, often off PATH.
        knownPaths: ["~/.dotnet/tools/csharp-ls"],
        args: [],
        // Both evaluate the project through MSBuild, which can run its targets.
        restrictedSafe: false,
      },
      { name: "OmniSharp", pathCommand: "omnisharp", args: ["-lsp"], restrictedSafe: false },
    ],
  },
  kotlin: {
    id: "kotlin",
    name: "Kotlin",
    languages: "Kotlin",
    missing:
      "kotlin-language-server isn't installed: run `brew install kotlin-language-server`, then try again.",
    launches: [
      {
        name: "Kotlin",
        pathCommand: "kotlin-language-server",
        args: [],
        // Asks Gradle or Maven for the classpath, which runs build scripts.
        restrictedSafe: false,
      },
    ],
  },
  "elixir-ls": {
    id: "elixir-ls",
    name: "ElixirLS",
    languages: "Elixir",
    writes: [".elixir_ls/"],
    missing: "ElixirLS isn't installed: run `brew install elixir-ls`, then try again.",
    launches: [
      {
        name: "ElixirLS",
        pathCommand: "elixir-ls",
        args: [],
        // Compiles the project with Mix, macros and all.
        restrictedSafe: false,
      },
    ],
  },
  dart: {
    id: "dart",
    name: "Dart",
    languages: "Dart",
    missing: "Dart's language server comes with its SDK: install it from dart.dev, then try again.",
    launches: [
      {
        name: "Dart",
        pathCommand: "dart",
        probe: ["--version"],
        args: ["language-server", "--protocol=lsp"],
        // Analyzer plugins named in `analysis_options.yaml` run as code.
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
