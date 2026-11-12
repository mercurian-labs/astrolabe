import type {
  CustomLanguageServer,
  CustomLanguageServerFields,
  LanguageServerCheck,
  LanguageServerOverride,
  LanguageServerOverrideEntry,
  LanguageServerSettingSource,
} from "@t3tools/contracts";

/**
 * Astrolabe: what's typed into Settings → Language servers, as the environment takes it. Every
 * field is checked here, so a bad one shows beside itself and nothing reaches a running server.
 */

export interface ServerFormFields {
  readonly binary: string;
  /** One per line. */
  readonly args: string;
  /** `NAME=value`, one per line. */
  readonly env: string;
  readonly initializationOptions: string;
  readonly settings: string;
}

export type ServerFormErrors = Partial<Record<keyof ServerFormFields, string>>;

export interface CustomFormFields {
  readonly name: string;
  readonly command: string;
  readonly args: string;
  readonly env: string;
  /** `extension language-id`, one per line; a bare extension's language id is itself. */
  readonly extensions: string;
  /** One per line. */
  readonly rootFiles: string;
  readonly replaces: boolean;
}

export type CustomFormErrors = Partial<Record<keyof CustomFormFields, string>>;

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXTENSION = /^[a-z0-9][a-z0-9+_-]*$/;

type Parsed<A> = { readonly value: A } | { readonly error: string };

const parseEnv = (text: string): Parsed<Record<string, string>> => {
  const env: Array<[string, string]> = [];
  for (const line of lines(text)) {
    const at = line.indexOf("=");
    const name = at < 0 ? line : line.slice(0, at);
    if (at < 0 || !ENV_NAME.test(name)) return { error: `"${line}" isn't NAME=value.` };
    env.push([name, line.slice(at + 1)]);
  }
  return { value: Object.fromEntries(env) };
};

const parseObject = (text: string): Parsed<Record<string, unknown> | undefined> => {
  if (text.trim() === "") return { value: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { error: cause instanceof SyntaxError ? cause.message : "This isn't valid JSON." };
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? { value: parsed as Record<string, unknown> }
    : { error: "This must be a JSON object." };
};

const COMMAND_ERROR = "Use a name on PATH or a full path.";
const commandIsValid = (command: string) =>
  !/[\\/]/.test(command) || /^(?:~\/|\/|[A-Za-z]:[\\/])/.test(command);

const json = (value: unknown) => (value === undefined ? "" : JSON.stringify(value, null, 2));
const envText = (env: Readonly<Record<string, string>> | undefined) =>
  Object.entries(env ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");

export const serverFormFields = (override: LanguageServerOverride | undefined) => ({
  binary: override?.binary ?? "",
  args: (override?.args ?? []).join("\n"),
  env: envText(override?.env),
  initializationOptions: json(override?.initializationOptions),
  settings: json(override?.settings),
});

/** The settings to store, or each field's problem; `enabled` stays as it was at that scope. */
export function parseServerForm(
  fields: ServerFormFields,
  enabled: boolean | undefined,
): { readonly override: LanguageServerOverride } | { readonly errors: ServerFormErrors } {
  const binary = fields.binary.trim();
  const args = lines(fields.args);
  const env = parseEnv(fields.env);
  const initializationOptions = parseObject(fields.initializationOptions);
  const settings = parseObject(fields.settings);
  const errors: ServerFormErrors = {
    ...(commandIsValid(binary) ? {} : { binary: COMMAND_ERROR }),
    ...("error" in env ? { env: env.error } : {}),
    ...("error" in initializationOptions
      ? { initializationOptions: initializationOptions.error }
      : {}),
    ...("error" in settings ? { settings: settings.error } : {}),
  };
  if (
    Object.keys(errors).length > 0 ||
    "error" in env ||
    "error" in initializationOptions ||
    "error" in settings
  ) {
    return { errors };
  }
  return {
    override: {
      ...(enabled === undefined ? {} : { enabled }),
      ...(binary === "" ? {} : { binary }),
      ...(args.length === 0 ? {} : { args }),
      ...(Object.keys(env.value).length === 0 ? {} : { env: env.value }),
      ...(initializationOptions.value === undefined
        ? {}
        : { initializationOptions: initializationOptions.value }),
      ...(settings.value === undefined ? {} : { settings: settings.value }),
    },
  };
}

export const EMPTY_CUSTOM_FORM: CustomFormFields = {
  name: "",
  command: "",
  args: "",
  env: "",
  extensions: "",
  rootFiles: "",
  replaces: false,
};

export const customFormFields = (custom: CustomLanguageServer): CustomFormFields => ({
  name: custom.name,
  command: custom.command,
  args: custom.args.join("\n"),
  env: envText(custom.env),
  extensions: Object.entries(custom.languageIds)
    .map(([extension, languageId]) => `${extension} ${languageId}`)
    .join("\n"),
  rootFiles: custom.rootFiles.join("\n"),
  replaces: custom.replaces,
});

export function parseCustomForm(
  fields: CustomFormFields,
): { readonly server: CustomLanguageServerFields } | { readonly errors: CustomFormErrors } {
  const name = fields.name.trim();
  const command = fields.command.trim();
  const env = parseEnv(fields.env);
  const extensions = lines(fields.extensions).map((line) => {
    const [extension = "", languageId] = line.split(/\s+/);
    const bare = extension.replace(/^\./, "").toLowerCase();
    return [bare, languageId ?? bare] as const;
  });
  const badExtension = extensions.find(([extension]) => !EXTENSION.test(extension));
  const rootFiles = lines(fields.rootFiles);
  const badRootFile = rootFiles.find(
    (file) => file.startsWith("/") || file.split(/[\\/]/).includes(".."),
  );
  const errors: CustomFormErrors = {
    ...(name === "" ? { name: "Give it a name." } : {}),
    ...(command === ""
      ? { command: "Say what to run." }
      : commandIsValid(command)
        ? {}
        : { command: COMMAND_ERROR }),
    ...("error" in env ? { env: env.error } : {}),
    ...(extensions.length === 0 ? { extensions: "List at least one file extension." } : {}),
    ...(badExtension === undefined
      ? {}
      : { extensions: `"${badExtension[0]}" isn't a file extension.` }),
    ...(badRootFile === undefined
      ? {}
      : { rootFiles: `"${badRootFile}" must be a file inside the checkout.` }),
  };
  if (Object.keys(errors).length > 0 || "error" in env) return { errors };
  return {
    server: {
      name,
      command,
      args: lines(fields.args),
      env: env.value,
      languageIds: Object.fromEntries(extensions),
      rootFiles,
      replaces: fields.replaces,
    },
  };
}

const FIELD_LABELS: Record<LanguageServerOverrideEntry["field"], string> = {
  enabled: "On or off",
  binary: "Binary",
  args: "Arguments",
  env: "Environment",
  initializationOptions: "Initialization options",
  settings: "Settings",
};

const SOURCE_LABELS: Record<LanguageServerSettingSource, string> = {
  machine: "all projects",
  project: "this project",
  file: ".astrolabe/language-servers.json",
};

/** "Arguments from this project, Settings from all projects". */
export const describeOverrides = (check: Pick<LanguageServerCheck, "overrides">) =>
  check.overrides
    .map(({ field, source }) => `${FIELD_LABELS[field]} from ${SOURCE_LABELS[source]}`)
    .join(", ");

/** The language's servers with `server` a place earlier or later, primary first. */
export function moved<Id>(servers: ReadonlyArray<Id>, server: Id, by: -1 | 1): ReadonlyArray<Id> {
  const from = servers.indexOf(server);
  const to = from + by;
  if (from < 0 || to < 0 || to >= servers.length) return servers;
  const next = [...servers];
  next[from] = servers[to]!;
  next[to] = server;
  return next;
}
