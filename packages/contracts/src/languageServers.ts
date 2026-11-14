import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DocumentChangeSetJson, DocumentClientId, DocumentLoadId } from "./documents.ts";

/**
 * Astrolabe: language servers run in the environment, per checkout: a language's primary server,
 * and the companions that join it on a file. The environment is their only LSP client and feeds
 * them its open documents; browsers speak LSP to its gateway over `languageServers.session` and
 * `languageServers.send`, one session per editor however many servers stand behind it.
 */

export const BuiltInLanguageServerId = Schema.Literals([
  "typescript",
  "basedpyright",
  "rust-analyzer",
  "gopls",
  "clangd",
  "jdtls",
  "json",
  "css",
  "html",
  "yaml",
  "bash",
  "dockerfile",
  "taplo",
  "lua",
  "marksman",
  "zls",
  "sourcekit-lsp",
  "ruby-lsp",
  "phpactor",
  "csharp",
  "kotlin",
  "elixir-ls",
  "dart",
  "ruff",
  "eslint",
  "tailwindcss",
]);
export type BuiltInLanguageServerId = typeof BuiltInLanguageServerId.Type;

/** A server someone added in settings: `custom:` and a slug of its name. */
export const CustomLanguageServerId = Schema.TemplateLiteral(["custom:", Schema.String]).check(
  Schema.isPattern(/^custom:[a-z0-9][a-z0-9-]{0,63}$/),
);
export type CustomLanguageServerId = typeof CustomLanguageServerId.Type;

export const LanguageServerId = Schema.Union([BuiltInLanguageServerId, CustomLanguageServerId]);
export type LanguageServerId = typeof LanguageServerId.Type;

export const isBuiltInLanguageServerId = Schema.is(BuiltInLanguageServerId);

/** Each primary server's file extensions, and the LSP language id it opens each with. */
const LANGUAGE_IDS: Readonly<
  Partial<Record<BuiltInLanguageServerId, Readonly<Record<string, string>>>>
> = {
  typescript: {
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascriptreact",
  },
  basedpyright: { py: "python", pyi: "python" },
  "rust-analyzer": { rs: "rust" },
  gopls: { go: "go" },
  clangd: {
    c: "c",
    // clangd reads a header's language from the compile commands, not this id.
    h: "cpp",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    "c++": "cpp",
    hh: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    "h++": "cpp",
    ipp: "cpp",
    tpp: "cpp",
    m: "objective-c",
    mm: "objective-cpp",
  },
  jdtls: { java: "java" },
  json: { json: "json", jsonc: "jsonc" },
  css: { css: "css", scss: "scss", less: "less" },
  html: { html: "html", htm: "html" },
  yaml: { yaml: "yaml", yml: "yaml" },
  bash: { sh: "shellscript", bash: "shellscript" },
  dockerfile: { dockerfile: "dockerfile" },
  taplo: { toml: "toml" },
  lua: { lua: "lua" },
  marksman: { md: "markdown", markdown: "markdown" },
  zls: { zig: "zig", zon: "zig" },
  "sourcekit-lsp": { swift: "swift" },
  "ruby-lsp": { rb: "ruby", rake: "ruby", gemspec: "ruby", ru: "ruby" },
  phpactor: { php: "php" },
  csharp: { cs: "csharp" },
  kotlin: { kt: "kotlin", kts: "kotlin" },
  "elixir-ls": { ex: "elixir", exs: "elixir" },
  dart: { dart: "dart" },
};

/**
 * Files whose name says what they are, read as this extension. JSON with comments goes by name
 * because servers call a comment an error in a file opened as plain JSON.
 */
const NAMED_FILES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\/)(docker|container)file(\.[^/]+)?$/, "dockerfile"],
  [/(^|\/)\.(bashrc|bash_profile|bash_aliases|bash_logout|profile)$/, "sh"],
  [/(^|\/)(gemfile|rakefile)$/, "rb"],
  [/(^|\/)([jt]sconfig([^/]*)|\.?devcontainer|\.eslintrc|\.oxlintrc|biome|turbo)\.json$/, "jsonc"],
  [/(^|\/)\.vscode\/[^/]+\.json$/, "jsonc"],
];

/** The extensions each companion joins the primary on, in the order they follow it. */
const COMPANION_EXTENSIONS: ReadonlyArray<readonly [BuiltInLanguageServerId, ReadonlySet<string>]> =
  [
    ["ruff", new Set(["py", "pyi"])],
    ["eslint", new Set(["ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx"])],
    ["tailwindcss", new Set(["ts", "tsx", "js", "jsx"])],
  ];

const SERVER_FOR_EXTENSION: ReadonlyMap<
  string,
  { readonly server: BuiltInLanguageServerId; readonly languageId: string }
> = new Map(
  Object.entries(LANGUAGE_IDS).flatMap(([server, extensions]) =>
    Object.entries(extensions).map(
      ([extension, languageId]) =>
        [extension, { server: server as BuiltInLanguageServerId, languageId }] as const,
    ),
  ),
);

export interface LanguageServerForPath {
  readonly server: BuiltInLanguageServerId;
  readonly languageId: string;
}

const extensionOf = (path: string) => {
  const lowered = path.toLowerCase();
  const named = NAMED_FILES.find(([pattern]) => pattern.test(lowered));
  if (named !== undefined) return named[1];
  const name = lowered.slice(lowered.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot + 1);
};

/** The extensions built-in servers read, for what lists them all. */
export const languageServerExtensions = () => [...SERVER_FOR_EXTENSION.keys()];

/**
 * The server that answers for a file by default, and the LSP language id it opens it with; null
 * for none. An environment's settings can change this: `languageServerRoutesForPath` is what
 * runs. Clients use it until their environment has said.
 */
export function languageServerForPath(path: string): LanguageServerForPath | null {
  const extension = extensionOf(path);
  return extension === null ? null : (SERVER_FOR_EXTENSION.get(extension) ?? null);
}

/** Every built-in server that can serve a file, primary first; a checkout may not use them all. */
export function languageServersForPath(path: string): ReadonlyArray<LanguageServerForPath> {
  const primary = languageServerForPath(path);
  if (primary === null) return [];
  const extension = extensionOf(path) ?? "";
  return [
    primary,
    ...COMPANION_EXTENSIONS.filter(([, extensions]) => extensions.has(extension)).map(
      ([server]) => ({ server, languageId: primary.languageId }),
    ),
  ];
}

/** Whether a server joins a primary on its files, rather than serving a language itself. */
export const isCompanionLanguageServer = (server: LanguageServerId) =>
  COMPANION_EXTENSIONS.some(([companion]) => companion === server);

/** The toolchain a server reads, which people can choose. */
export const languageServerToolchain = (
  server: LanguageServerId,
): LanguageServerToolchainKind | null => (server === "basedpyright" ? "python" : null);

/** The server leading a built-in's language by default: itself, or a companion's primary. */
export const languageServerLanguage = (server: BuiltInLanguageServerId) => {
  const joined = COMPANION_EXTENSIONS.find(([companion]) => companion === server)?.[1];
  const [extension] = joined ?? [];
  return extension === undefined ? server : (SERVER_FOR_EXTENSION.get(extension)?.server ?? server);
};

export const LanguageServerToolchainKind = Schema.Literals(["python"]);
export type LanguageServerToolchainKind = typeof LanguageServerToolchainKind.Type;

/** A server on a kind of file in one checkout, as its environment's settings have it. */
export const LanguageServerRoute = Schema.Struct({
  server: LanguageServerId,
  name: Schema.String,
  languageId: Schema.String,
  /** Turned off in settings: it doesn't run, and says so. */
  off: Schema.Boolean,
  /** The toolchain it reads, which people can choose. */
  toolchain: Schema.NullOr(LanguageServerToolchainKind),
});
export type LanguageServerRoute = typeof LanguageServerRoute.Type;

/** What serves each file extension in a checkout, primary first. */
export const LanguageServerRoutes = Schema.Struct({
  extensions: Schema.Record(Schema.String, Schema.Array(LanguageServerRoute)),
});
export type LanguageServerRoutes = typeof LanguageServerRoutes.Type;

export const LanguageServerRoutesInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerRoutesInput = typeof LanguageServerRoutesInput.Type;

export function languageServerRoutesForPath(
  path: string,
  routes: LanguageServerRoutes,
): ReadonlyArray<LanguageServerRoute> {
  const extension = extensionOf(path);
  return extension !== null && Object.hasOwn(routes.extensions, extension)
    ? (routes.extensions[extension] ?? [])
    : [];
}

/** The server a file's session binds to: the first one on, or the first to show as off. */
export const primaryLanguageServerRoute = (routes: ReadonlyArray<LanguageServerRoute>) =>
  routes.find((route) => !route.off) ?? routes[0] ?? null;

export const LanguageServerState = Schema.Literals([
  /** The project isn't trusted, and this server needs a download or runs its code. */
  "trust-needed",
  /** Turned off in settings, which is the way back. */
  "disabled",
  "downloading",
  "starting",
  "ready",
  /** Gave up after crashing too often, or could not start; `message` says why. */
  "failed",
  /** Not on this machine, and nothing here can install it; `message` says what to install. */
  "missing",
  /** Stopped on request; opening files does not start it again until it is restarted. */
  "stopped",
  /** Stopped to keep the environment inside its language-server memory budget. */
  "capped",
]);
export type LanguageServerState = typeof LanguageServerState.Type;

export const LanguageServerSource = Schema.Literals(["project", "path", "cache", "download"]);
export type LanguageServerSource = typeof LanguageServerSource.Type;

export const LanguageServerStatus = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  server: LanguageServerId,
  /** What runs, as people know it: "TypeScript 7.0.2". */
  name: Schema.String,
  state: LanguageServerState,
  source: Schema.NullOr(LanguageServerSource),
  /** An untrusted repository: our own build with the features that run repository code off. */
  restricted: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
  memoryBytes: Schema.NullOr(NonNegativeInt),
});
export type LanguageServerStatus = typeof LanguageServerStatus.Type;

export const LanguageServerTarget = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  server: LanguageServerId,
});
export type LanguageServerTarget = typeof LanguageServerTarget.Type;

const ENVIRONMENT_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ShortString = Schema.String.check(Schema.isMaxLength(4096));
const LanguageServerEnv = Schema.Record(
  Schema.String.check(Schema.isPattern(ENVIRONMENT_VARIABLE)),
  ShortString,
);
const LanguageServerJson = Schema.Record(Schema.String, Schema.Unknown);
const LanguageServerArgs = Schema.Array(ShortString).check(Schema.isMaxLength(100));

/** One server's settings at one scope; what's left out comes from the scope below. */
export const LanguageServerOverride = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  /** A path, or a name on PATH, in place of how the server is normally found. */
  binary: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
  /** In place of its usual arguments. */
  args: Schema.optionalKey(LanguageServerArgs),
  env: Schema.optionalKey(LanguageServerEnv),
  /** Merged over what the server is normally started with. */
  initializationOptions: Schema.optionalKey(LanguageServerJson),
  /** Merged over its answers to `workspace/configuration`. */
  settings: Schema.optionalKey(LanguageServerJson),
});
export type LanguageServerOverride = typeof LanguageServerOverride.Type;

/** Settings at one scope. `servers` and `order` are keyed by server id, checked as they're set. */
export const LanguageServerSettingsLayer = Schema.Struct({
  servers: Schema.Record(Schema.String, LanguageServerOverride),
  /** A language's servers, primary first, by the server that leads it by default. */
  order: Schema.Record(Schema.String, Schema.Array(BuiltInLanguageServerId)),
});
export type LanguageServerSettingsLayer = typeof LanguageServerSettingsLayer.Type;

/** A server someone added in settings. No code: it runs in trusted projects only. */
export const CustomLanguageServerFields = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  /** A path, or a name on PATH. */
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  args: LanguageServerArgs,
  env: LanguageServerEnv,
  /** Each file extension it serves, and the LSP language id it opens those files with. */
  languageIds: Schema.Record(Schema.String, TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  /** When set, it runs only in checkouts with one of these at their root. */
  rootFiles: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  /** Takes the default server's place on its extensions, or else runs beside it. */
  replaces: Schema.Boolean,
});
export type CustomLanguageServerFields = typeof CustomLanguageServerFields.Type;

export const CustomLanguageServer = Schema.Struct({
  id: CustomLanguageServerId,
  ...CustomLanguageServerFields.fields,
});
export type CustomLanguageServer = typeof CustomLanguageServer.Type;

export const LanguageServerSettingsScope = Schema.Literals(["machine", "project"]);
export type LanguageServerSettingsScope = typeof LanguageServerSettingsScope.Type;

export const LanguageServerSettingsChange = Schema.Union([
  /** Replaces a server's settings at a scope; an empty one clears them. */
  Schema.Struct({
    type: Schema.Literal("server"),
    scope: LanguageServerSettingsScope,
    server: LanguageServerId,
    override: LanguageServerOverride,
  }),
  /** Just whether it runs, keeping the rest of its settings. */
  Schema.Struct({
    type: Schema.Literal("enabled"),
    scope: LanguageServerSettingsScope,
    server: LanguageServerId,
    enabled: Schema.Boolean,
  }),
  /** Empty goes back to the language's usual order. */
  Schema.Struct({
    type: Schema.Literal("order"),
    scope: LanguageServerSettingsScope,
    language: BuiltInLanguageServerId,
    order: Schema.Array(BuiltInLanguageServerId),
  }),
  /** Adds a server, or edits the one `id` names. */
  Schema.Struct({
    type: Schema.Literal("custom"),
    id: Schema.NullOr(CustomLanguageServerId),
    server: CustomLanguageServerFields,
  }),
  Schema.Struct({ type: Schema.Literal("removeCustom"), id: CustomLanguageServerId }),
  /** This checkout's choice; null goes back to finding one automatically. */
  Schema.Struct({
    type: Schema.Literal("toolchain"),
    kind: LanguageServerToolchainKind,
    path: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
  }),
]);
export type LanguageServerSettingsChange = typeof LanguageServerSettingsChange.Type;

export const LanguageServerUpdateSettingsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  change: LanguageServerSettingsChange,
});
export type LanguageServerUpdateSettingsInput = typeof LanguageServerUpdateSettingsInput.Type;

export const LanguageServerToolchainsInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerToolchainsInput = typeof LanguageServerToolchainsInput.Type;

export const LanguageServerToolchainOption = Schema.Struct({
  path: Schema.String,
  /** ".venv", "pyenv 3.12.1". */
  label: Schema.String,
  /** Null when it can't be read without running it. */
  version: Schema.NullOr(Schema.String),
});
export type LanguageServerToolchainOption = typeof LanguageServerToolchainOption.Type;

export const LanguageServerRunContextInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** A file of the checkout, relative to it. */
  path: TrimmedNonEmptyString,
});
export type LanguageServerRunContextInput = typeof LanguageServerRunContextInput.Type;

export const LanguageServerShellFamily = Schema.Literals(["posix", "fish", "powershell", "cmd"]);
export type LanguageServerShellFamily = typeof LanguageServerShellFamily.Type;

/** What a client builds a file's run commands from. Running is running the project's code. */
export const LanguageServerRunContext = Schema.Struct({
  trusted: Schema.Boolean,
  /** The nearest manifest's folder, within the checkout; "" at its root. */
  root: Schema.String,
  /** The checkout's chosen or found interpreter, else the one to find on PATH. */
  python: Schema.String,
  /** How the environment's terminals read a command line. */
  shell: LanguageServerShellFamily,
  testRunner: Schema.NullOr(Schema.Literals(["vitest", "jest", "node", "vp"])),
  /** What runs a package's own binary: "npx", "pnpm exec". */
  packageRunner: Schema.String,
  buildTool: Schema.NullOr(Schema.Literals(["maven", "gradle"])),
  /** The project's wrapper where it has one: "./mvnw", "../gradlew", "mvn". */
  buildCommand: Schema.NullOr(Schema.String),
});
export type LanguageServerRunContext = typeof LanguageServerRunContext.Type;

/** A checkout's toolchain of one kind: what's here, what was chosen, and what servers get. */
export const LanguageServerToolchains = Schema.Struct({
  kind: LanguageServerToolchainKind,
  /** Null: found automatically. */
  selected: Schema.NullOr(Schema.String),
  /** `selected` is gone from disk, so `active` is what was found automatically instead. */
  selectedMissing: Schema.Boolean,
  /** Null: servers look for one themselves. Always null in a project that isn't trusted. */
  active: Schema.NullOr(LanguageServerToolchainOption),
  trusted: Schema.Boolean,
  options: Schema.Array(LanguageServerToolchainOption),
});
export type LanguageServerToolchains = typeof LanguageServerToolchains.Type;

/** Names across a checkout's files, from its running servers or, without any, its code index. */
export const ProjectSymbolsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** A wiki's folder has no code index. */
  projectId: Schema.optional(ProjectId),
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type ProjectSymbolsInput = typeof ProjectSymbolsInput.Type;

export const ProjectSymbol = Schema.Struct({
  name: Schema.String,
  /** A language's own word for it: `function`, `class`, `struct`. */
  kind: Schema.String,
  /** What holds it: a method's class. */
  container: Schema.NullOr(Schema.String),
  /** Repository-relative. */
  path: Schema.String,
  line: PositiveInt,
  /** From 1; lines from the code index name no column. */
  column: PositiveInt,
});
export type ProjectSymbol = typeof ProjectSymbol.Type;

export const ProjectSymbols = Schema.Struct({
  symbols: Schema.Array(ProjectSymbol),
  /** Only the first are listed. */
  truncated: Schema.Boolean,
});
export type ProjectSymbols = typeof ProjectSymbols.Type;

/** Where a setting came from: settings at either scope, or the checkout's own file. */
export const LanguageServerSettingSource = Schema.Literals(["machine", "project", "file"]);
export type LanguageServerSettingSource = typeof LanguageServerSettingSource.Type;

export const LanguageServerOverrideEntry = Schema.Struct({
  field: Schema.Literals(["enabled", "binary", "args", "env", "initializationOptions", "settings"]),
  source: LanguageServerSettingSource,
});
export type LanguageServerOverrideEntry = typeof LanguageServerOverrideEntry.Type;

/** What each language server would run for a checkout, without starting or downloading it. */
export const LanguageServerCheckInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerCheckInput = typeof LanguageServerCheckInput.Type;

export const LanguageServerCheck = Schema.Struct({
  server: LanguageServerId,
  /** The languages it serves: "C and C++". */
  languages: Schema.String,
  /** "rust-analyzer 1.99.0", or the bare name before a version is known. */
  name: Schema.String,
  /**
   * `download`: the first file of its language downloads it. `trust`: it won't start until the
   * project is trusted.
   */
  state: Schema.Literals(["found", "download", "trust", "missing"]),
  source: Schema.NullOr(LanguageServerSource),
  /** The binary that runs, when found. */
  executable: Schema.NullOr(Schema.String),
  /** Why it's missing, what downloading fetches, or what the checkout lacks for it. */
  message: Schema.NullOr(Schema.String),
  /** For a companion: whether this checkout uses it, and what says so. Null for a primary. */
  companion: Schema.NullOr(Schema.Struct({ active: Schema.Boolean, reason: Schema.String })),
  /** Turned off in settings. */
  off: Schema.Boolean,
  /** The server leading its language by default; null for one added in settings. */
  language: Schema.NullOr(BuiltInLanguageServerId),
  /** What settings change about it, and where each came from. */
  overrides: Schema.Array(LanguageServerOverrideEntry),
  /** The environment variables settings give it, by name: values can be secrets. */
  envNames: Schema.Array(Schema.String),
  /** Servers added in settings that take its place on some of its files. */
  replacedBy: Schema.Array(Schema.String),
});
export type LanguageServerCheck = typeof LanguageServerCheck.Type;

export const LanguageServerSettingsInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerSettingsInput = typeof LanguageServerSettingsInput.Type;

/**
 * What Settings edits, values and all. Environment values, arguments and JSON settings can hold
 * tokens, so this takes the maintain scope where `check` takes only read.
 */
export const LanguageServerSettings = Schema.Struct({
  machine: LanguageServerSettingsLayer,
  project: LanguageServerSettingsLayer,
  custom: Schema.Array(CustomLanguageServer),
});
export type LanguageServerSettings = typeof LanguageServerSettings.Type;

/** A checkout's own `.astrolabe/language-servers.json`. */
export const LanguageServerProjectFile = Schema.Struct({
  /** Repository-relative. */
  path: Schema.String,
  /** Read: it's there and the project is trusted. */
  read: Schema.Boolean,
  /** Why it's ignored, when it can't be used. */
  problem: Schema.NullOr(Schema.String),
});
export type LanguageServerProjectFile = typeof LanguageServerProjectFile.Type;

export const LanguageServerCheckResult = Schema.Struct({
  /** Whether the checkout's project is trusted on this environment. */
  trusted: Schema.Boolean,
  /** Each language's servers in the order they run, primary first. */
  servers: Schema.Array(LanguageServerCheck),
  projectFile: LanguageServerProjectFile,
  /** The environment's settings file can't be read: nothing it says applies. */
  settingsProblem: Schema.NullOr(Schema.String),
});
export type LanguageServerCheckResult = typeof LanguageServerCheckResult.Type;

/** A checkout, standing for every checkout of its repository: they share trust. */
export const LanguageServerTrustInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerTrustInput = typeof LanguageServerTrustInput.Type;

export const LanguageServerLogSource = Schema.Literals([
  "stderr",
  /** `window/logMessage`. */
  "log",
  /** `window/showMessage`, which the server means a person to see. */
  "message",
  /** The environment's own note: a start, an exit. */
  "environment",
]);
export type LanguageServerLogSource = typeof LanguageServerLogSource.Type;

export const LanguageServerLogLine = Schema.Struct({
  /** Milliseconds since the epoch. */
  at: NonNegativeInt,
  source: LanguageServerLogSource,
  /** The server's own severity, for `log` and `message`. */
  severity: Schema.optional(Schema.Literals(["error", "warning", "info", "log"])),
  text: Schema.String,
});
export type LanguageServerLogLine = typeof LanguageServerLogLine.Type;

/** One LSP message as JSON, cut when long. It can hold file contents: memory only, off by default. */
export const LanguageServerTraceEntry = Schema.Struct({
  at: NonNegativeInt,
  /** As the environment sees it: `sent` went to the server. */
  direction: Schema.Literals(["sent", "received"]),
  text: Schema.String,
});
export type LanguageServerTraceEntry = typeof LanguageServerTraceEntry.Type;

/** A server as a person debugging it wants it: its status, and the process behind it. */
export const LanguageServerInfo = Schema.Struct({
  ...LanguageServerStatus.fields,
  /** The last launch's: they stay after the process stops. */
  binary: Schema.NullOr(Schema.String),
  args: Schema.Array(Schema.String),
  /** `args` was withheld from a subscription that isn't `full`: a token often sits there. */
  argsHidden: Schema.Boolean,
  /** What the running server says it is. */
  version: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(NonNegativeInt),
  /** The running server's capabilities, as JSON. */
  capabilities: Schema.NullOr(Schema.String),
});
export type LanguageServerInfo = typeof LanguageServerInfo.Type;

const LanguageServerLogState = Schema.Struct({
  /** Null while no server runs for the target: it may have stopped for being idle. */
  info: Schema.NullOr(LanguageServerInfo),
  tracing: Schema.Boolean,
});

/** `trace` is empty unless the subscription is `full`: it carries servers' settings. */
export const LanguageServerLogItem = Schema.Union([
  /** What the environment has kept. */
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    state: LanguageServerLogState,
    lines: Schema.Array(LanguageServerLogLine),
    trace: Schema.Array(LanguageServerTraceEntry),
  }),
  /** What arrived since the last item, batched; `state` only when it changed. */
  Schema.Struct({
    type: Schema.Literal("batch"),
    state: Schema.optional(LanguageServerLogState),
    lines: Schema.Array(LanguageServerLogLine),
    trace: Schema.Array(LanguageServerTraceEntry),
  }),
]);
export type LanguageServerLogItem = typeof LanguageServerLogItem.Type;

export const LanguageServerLogsInput = Schema.Struct({
  ...LanguageServerTarget.fields,
  /** Arguments and the trace too, which can carry tokens: this asks for the maintain scope. */
  full: Schema.optionalKey(Schema.Boolean),
});
export type LanguageServerLogsInput = typeof LanguageServerLogsInput.Type;

/** A logs subscription that asks for what only maintainers may read. */
export const languageServerLogsFull = (input: unknown): boolean =>
  typeof input === "object" && input !== null && (input as { full?: unknown }).full === true;

export const LanguageServerSetTraceInput = Schema.Struct({
  ...LanguageServerTarget.fields,
  enabled: Schema.Boolean,
});
export type LanguageServerSetTraceInput = typeof LanguageServerSetTraceInput.Type;

/** Chosen by the client, unique per connection. */
export const LanguageServerSessionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const LanguageServerSessionInput = Schema.Struct({
  ...LanguageServerTarget.fields,
  sessionId: LanguageServerSessionId,
});
export type LanguageServerSessionInput = typeof LanguageServerSessionInput.Type;

export const LanguageServerSessionItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status"), status: LanguageServerStatus }),
  Schema.Struct({
    type: Schema.Literal("message"),
    /** One LSP message, as JSON. */
    message: Schema.String,
    /**
     * Set when the message's positions are in the document at this version of the environment's
     * copy (diagnostics); answers to requests are in the request's own coordinates.
     */
    version: Schema.optional(NonNegativeInt),
  }),
]);
export type LanguageServerSessionItem = typeof LanguageServerSessionItem.Type;

/** What a request's positions are relative to: the editor's document at its last LSP sync. */
export const LanguageServerDocumentState = Schema.Struct({
  loadId: DocumentLoadId,
  /** The environment version the editor's confirmed text is at. */
  version: NonNegativeInt,
  clientId: DocumentClientId,
  /** The editor's edits the environment has not confirmed, which the gateway lands first. */
  unconfirmed: Schema.Array(DocumentChangeSetJson).check(Schema.isMaxLength(1000)),
});
export type LanguageServerDocumentState = typeof LanguageServerDocumentState.Type;

const LANGUAGE_SERVER_MESSAGE_MAX_LENGTH = 1024 * 1024;

export const LanguageServerSendInput = Schema.Struct({
  sessionId: LanguageServerSessionId,
  message: Schema.String.check(Schema.isMaxLength(LANGUAGE_SERVER_MESSAGE_MAX_LENGTH)),
  document: Schema.optional(LanguageServerDocumentState),
});
export type LanguageServerSendInput = typeof LanguageServerSendInput.Type;

/** A send that lands edits on the environment's copy writes the file. */
export const languageServerSendWrites = (input: unknown): boolean => {
  if (typeof input !== "object" || input === null) return false;
  const document = (input as { readonly document?: { readonly unconfirmed?: unknown } }).document;
  if (Array.isArray(document?.unconfirmed) && document.unconfirmed.length > 0) return true;
  const message = (input as { readonly message?: unknown }).message;
  if (typeof message !== "string") return false;
  try {
    const parsed = JSON.parse(message) as { readonly method?: unknown };
    return typeof parsed.method === "string" && WRITING_METHODS.has(parsed.method);
  } catch {
    return false;
  }
};

export const DiagnosticSeverity = Schema.Literals(["error", "warning", "info", "hint"]);
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type;

/** Lines and columns count from 1; columns in UTF-16 code units, as LSP has them. */
export const FileDiagnostic = Schema.Struct({
  severity: DiagnosticSeverity,
  line: PositiveInt,
  column: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
  message: Schema.String,
  code: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});
export type FileDiagnostic = typeof FileDiagnostic.Type;

export const FileDiagnostics = Schema.Struct({
  path: Schema.String,
  /** The environment's version of the file the diagnostics are for. */
  version: NonNegativeInt,
  diagnostics: Schema.Array(FileDiagnostic),
  /** Only the first diagnostics are listed. */
  truncated: Schema.Boolean,
});
export type FileDiagnostics = typeof FileDiagnostics.Type;

/** Where a symbol is: lines and columns count from 1, columns in UTF-16 code units. */
export const CodeLocation = Schema.Struct({
  /** Repository-relative, or absolute for a file outside the checkout (a library's types). */
  path: Schema.String,
  line: PositiveInt,
  column: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
  /** The text of the location's first line, cut to 200 characters. */
  preview: Schema.String,
});
export type CodeLocation = typeof CodeLocation.Type;

export const CodeLocationKind = Schema.Literals([
  "definition",
  "declaration",
  "typeDefinition",
  "implementation",
  "references",
]);
export type CodeLocationKind = typeof CodeLocationKind.Type;

export const CodeLocations = Schema.Struct({
  locations: Schema.Array(CodeLocation),
  /** Only the first locations are listed. */
  truncated: Schema.Boolean,
});
export type CodeLocations = typeof CodeLocations.Type;

/** Text an applied edit wrote, in the file as it left it: lines from 1, columns from 0. */
export const LanguageServerEditPlace = Schema.Struct({
  path: Schema.String,
  line: PositiveInt,
  column: NonNegativeInt,
  endLine: PositiveInt,
  endColumn: NonNegativeInt,
});
export type LanguageServerEditPlace = typeof LanguageServerEditPlace.Type;

/**
 * A language server's edit the environment applied (a rename, a code action): the files it
 * changed, and the id that undoes it while the environment keeps it.
 */
export const LanguageServerAppliedEdit = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** Repository-relative. */
  files: Schema.Array(Schema.String),
  edits: NonNegativeInt,
  /** The first places it changed; `edits` counts them all. */
  places: Schema.Array(LanguageServerEditPlace),
});
export type LanguageServerAppliedEdit = typeof LanguageServerAppliedEdit.Type;

export const LanguageServerUndoEditInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type LanguageServerUndoEditInput = typeof LanguageServerUndoEditInput.Type;

export const LanguageServerUndoEditResult = Schema.Struct({
  /** Repository-relative: the files put back. */
  files: Schema.Array(Schema.String),
  /** Files left as they are: closed and changed since, so the edit can't be found in them. */
  skipped: Schema.Array(Schema.String),
});
export type LanguageServerUndoEditResult = typeof LanguageServerUndoEditResult.Type;

/** LSP requests whose answer the environment applies to files, so a send of one writes. */
const WRITING_METHODS = new Set([
  "textDocument/rename",
  "astrolabe/applyCodeAction",
  "astrolabe/runLensCommand",
]);
/** A checkout's problems: the files language servers have open, or had open since they started. */
export const LanguageServerProblemsInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerProblemsInput = typeof LanguageServerProblemsInput.Type;

export const LanguageServerProblemsItem = Schema.Union([
  /** Every file with problems now. */
  Schema.Struct({ type: Schema.Literal("snapshot"), files: Schema.Array(FileDiagnostics) }),
  /** One file's problems changed; an empty list means it has none now. */
  Schema.Struct({ type: Schema.Literal("file"), file: FileDiagnostics }),
]);
export type LanguageServerProblemsItem = typeof LanguageServerProblemsItem.Type;

export const LanguageServerErrorReason = Schema.Literals([
  /** No language server serves this file. */
  "unsupported",
  "trust-needed",
  "not-running",
  /** Refused input from Settings; the message says what's wrong. */
  "invalid",
  "failed",
  "timeout",
  /** The session is gone or never existed: open it again. */
  "no-session",
  "document",
]);
export type LanguageServerErrorReason = typeof LanguageServerErrorReason.Type;

export class LanguageServerError extends Schema.TaggedError<LanguageServerError>()(
  "LanguageServerError",
  {
    reason: LanguageServerErrorReason,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
