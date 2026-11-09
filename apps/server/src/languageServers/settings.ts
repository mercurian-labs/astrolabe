import {
  type BuiltInLanguageServerId,
  type CustomLanguageServer,
  CustomLanguageServer as CustomLanguageServerSchema,
  type CustomLanguageServerFields,
  type LanguageServerId,
  type LanguageServerOverride,
  LanguageServerOverride as LanguageServerOverrideSchema,
  type LanguageServerOverrideEntry,
  languageServerExtensions,
  languageServersForPath,
  languageServerToolchain,
  type LanguageServerRoute,
  type LanguageServerRoutes,
  type LanguageServerSettingSource,
  type LanguageServerSettingsLayer,
  LanguageServerSettingsLayer as LanguageServerSettingsLayerSchema,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { parseJson, stringifyJson } from "./json.ts";
import type { LanguageServerSpec, Launch } from "./registry.ts";

/**
 * What people set about language servers, per environment: `language-server-settings.json` beside
 * the trust file, read by the environment because the servers run there. A checkout can add its
 * own servers' settings (`PROJECT_FILE`), but only ever what settings and options say.
 */

/** A checkout's own settings, read only in a trusted project. */
export const PROJECT_FILE = ".astrolabe/language-servers.json";

const SettingsFile = Schema.Struct({
  machine: LanguageServerSettingsLayerSchema,
  /** By the project's trust key: every checkout of a repository shares them. */
  projects: Schema.Record(Schema.String, LanguageServerSettingsLayerSchema),
  custom: Schema.Array(CustomLanguageServerSchema),
  /** By checkout. */
  toolchains: Schema.Record(
    Schema.String,
    Schema.Struct({ python: Schema.optionalKey(Schema.String) }),
  ),
});
export type LanguageServerSettingsFile = typeof SettingsFile.Type;

const decodeFile = Schema.decodeUnknownOption(SettingsFile);
const isOverride = Schema.is(LanguageServerOverrideSchema);

export const EMPTY_LAYER: LanguageServerSettingsLayer = { servers: {}, order: {} };
const EMPTY_FILE: LanguageServerSettingsFile = {
  machine: EMPTY_LAYER,
  projects: {},
  custom: [],
  toolchains: {},
};

/**
 * Writes wait on each other. An unreadable file applies nothing and takes no writes: replacing it
 * would lose what someone can still fix by hand.
 */
export const makeLanguageServerSettings = Effect.fn("LanguageServers.makeSettings")(
  function* (options: { readonly file: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    // Only a file that isn't there is empty: one we can't read still holds someone's settings.
    const stored = yield* fileSystem.readFileString(options.file).pipe(
      Effect.map((text) => decodeFile(parseJson(text))),
      Effect.catch((error) =>
        Effect.succeed(error.reason._tag === "NotFound" ? Option.some(EMPTY_FILE) : Option.none()),
      ),
    );
    const problem = Option.isNone(stored)
      ? `${options.file} can't be read, so none of it applies. Fix or remove it, then restart.`
      : null;
    let settings = Option.getOrElse(stored, () => EMPTY_FILE);
    const writes = yield* Semaphore.make(1);
    return {
      get: () => settings,
      problem: () => problem,
      /** Stores `change`'s answer; fails, changing nothing, when it can't be written. */
      update: <E>(
        change: (
          current: LanguageServerSettingsFile,
        ) => Effect.Effect<LanguageServerSettingsFile, E>,
      ) =>
        writes.withPermit(
          Effect.gen(function* () {
            if (problem !== null) return yield* Effect.fail(problem);
            const next = yield* change(settings);
            yield* writeFileStringAtomically({
              filePath: options.file,
              contents: stringifyJson(next),
            }).pipe(Effect.mapError(() => "The language server settings could not be saved."));
            settings = next;
          }),
        ),
    };
  },
);

export type LanguageServerSettingsStore = Effect.Success<
  ReturnType<typeof makeLanguageServerSettings>
>;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `over` on `base`: objects merge key by key, and anything else replaces. */
export const mergeJson = (base: unknown, over: unknown): unknown => {
  if (!isObject(base) || !isObject(over)) return over;
  return Object.fromEntries([
    ...Object.entries(base),
    ...Object.entries(over).map(([key, value]) => [
      key,
      Object.hasOwn(base, key) ? mergeJson(base[key], value) : value,
    ]),
  ]);
};

export interface EffectiveSettings extends LanguageServerOverride {
  readonly off: boolean;
  /** What differs from the server's defaults, and where each came from. */
  readonly overrides: ReadonlyArray<LanguageServerOverrideEntry>;
}

const OVERRIDE_FIELDS = [
  "enabled",
  "binary",
  "args",
  "env",
  "initializationOptions",
  "settings",
] as const;

/** A server's settings across scopes, the last the most specific. */
export const effectiveSettings = (
  layers: ReadonlyArray<{
    readonly source: LanguageServerSettingSource;
    readonly override: LanguageServerOverride | undefined;
  }>,
): EffectiveSettings => {
  const present = layers.flatMap(({ override }) => override ?? []);
  const overrides = layers.flatMap(({ source, override }) =>
    OVERRIDE_FIELDS.flatMap((field) =>
      override?.[field] === undefined ? [] : [{ field, source }],
    ),
  );
  const last = <Field extends keyof LanguageServerOverride>(field: Field) =>
    present.findLast((override) => override[field] !== undefined)?.[field];
  const merged = <Value extends Readonly<Record<string, unknown>>>(
    field: "env" | "initializationOptions" | "settings",
  ) => {
    const parts = present.flatMap((override) => override[field] ?? []);
    return parts.length === 0 ? undefined : (parts.reduce(mergeJson, {}) as Value);
  };
  const enabled = last("enabled");
  const binary = last("binary");
  const args = last("args");
  const env = merged<Readonly<Record<string, string>>>("env");
  const initializationOptions = merged("initializationOptions");
  const settings = merged("settings");
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(binary === undefined ? {} : { binary }),
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(initializationOptions === undefined ? {} : { initializationOptions }),
    ...(settings === undefined ? {} : { settings }),
    off: enabled === false,
    overrides,
  };
};

const hasSeparator = (command: string) => /[\\/]/.test(command);

/** A name on PATH or a full path: a relative one would mean a different file per checkout. */
export const isRunnableCommand = (command: string) =>
  !hasSeparator(command) || /^(?:~\/|\/|[A-Za-z]:[\\/])/.test(command);

/** Runs what a person named: nothing is probed, and only a trusted project runs it. */
const chosenLaunch = (
  name: string,
  command: string,
  base: Pick<Launch, "args" | "initializationOptions" | "settings">,
): Launch => ({
  name,
  chosen: true,
  ...(hasSeparator(command) ? { knownPaths: [command] } : { pathCommand: command }),
  args: base.args,
  ...(base.initializationOptions === undefined
    ? {}
    : { initializationOptions: base.initializationOptions }),
  ...(base.settings === undefined ? {} : { settings: base.settings }),
  restrictedSafe: false,
});

/** The server as settings have it, still with placeholders for what the checkout fills in. */
export const withSettings = (
  spec: LanguageServerSpec,
  { binary, args, env, initializationOptions, settings }: EffectiveSettings,
): LanguageServerSpec => {
  // The last launch is the plain one: the rest are for a toolchain the checkout may lack.
  const last = spec.launches.at(-1);
  const launches =
    binary === undefined
      ? spec.launches
      : [chosenLaunch(last?.name ?? spec.name, binary, last ?? { args: [] })];
  // Someone's arguments can do anything, so what was safe without them is no longer known safe.
  const changed = args !== undefined || env !== undefined;
  return {
    ...spec,
    launches: launches.map((launch) => ({
      ...launch,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env: { ...launch.env, ...env } }),
      ...(initializationOptions === undefined
        ? {}
        : {
            initializationOptions: mergeJson(
              launch.initializationOptions ?? {},
              initializationOptions,
            ),
          }),
      ...(settings === undefined
        ? {}
        : {
            settings: mergeJson(launch.settings ?? {}, settings) as Record<string, unknown>,
          }),
      restrictedSafe: launch.restrictedSafe && !changed,
    })),
  };
};

/** A server added in settings, as the registry would write it. */
export const customSpec = (custom: CustomLanguageServer): LanguageServerSpec => ({
  id: custom.id,
  name: custom.name,
  languages: Object.keys(custom.languageIds)
    .map((extension) => `.${extension}`)
    .join(", "),
  missing: `${custom.command} wasn't found. Check its command in Settings.`,
  joins: !custom.replaces,
  ...(custom.rootFiles.length === 0
    ? {}
    : { activation: { files: custom.rootFiles, packages: [], description: "root file" } }),
  launches: [
    {
      ...chosenLaunch(custom.name, custom.command, { args: custom.args }),
      ...(Object.keys(custom.env).length === 0 ? {} : { env: custom.env }),
    },
  ],
});

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 56);

/** An id for a new server, from its name and unlike the ones already here. */
export const customServerId = (
  name: string,
  known: ReadonlyArray<CustomLanguageServer>,
): CustomLanguageServer["id"] => {
  const base = slugOf(name) || "server";
  const taken = new Set<string>(known.map((custom) => custom.id));
  for (let suffix = 1; ; suffix++) {
    const id = `custom:${suffix === 1 ? base : `${base}-${suffix}`}` as const;
    if (!taken.has(id)) return id;
  }
};

const EXTENSION = /^[a-z0-9][a-z0-9+_-]*$/;

/** A person's server as it is kept, or what's wrong with it. */
export const normalizeCustomServer = (
  fields: CustomLanguageServerFields,
): CustomLanguageServerFields | { readonly problem: string } => {
  if (!isRunnableCommand(fields.command)) {
    return { problem: "The command must be a name on PATH or a full path." };
  }
  const languageIds = Object.fromEntries(
    Object.entries(fields.languageIds).map(([extension, languageId]) => [
      extension.trim().replace(/^\./, "").toLowerCase(),
      languageId,
    ]),
  );
  const extensions = Object.keys(languageIds);
  if (extensions.length === 0) return { problem: "List at least one file extension." };
  const bad = extensions.find((extension) => !EXTENSION.test(extension));
  if (bad !== undefined) return { problem: `"${bad}" isn't a file extension.` };
  const rootFile = fields.rootFiles.find(
    (file) => file.startsWith("/") || file.split(/[\\/]/).includes(".."),
  );
  if (rootFile !== undefined) {
    return { problem: `"${rootFile}" must be a file inside the checkout.` };
  }
  return { ...fields, languageIds };
};

/** The servers a language can be ordered among: its default primary's language. */
export const orderOf = (
  language: BuiltInLanguageServerId,
  layers: readonly [LanguageServerSettingsLayer, LanguageServerSettingsLayer],
): ReadonlyArray<BuiltInLanguageServerId> => {
  const [machine, project] = layers;
  return project.order[language] ?? machine.order[language] ?? [];
};

/**
 * What serves each extension in a checkout. A server `isActive` denies is left out: the checkout
 * doesn't use it, so it can't lead a language either. An off server stays, to show as off.
 */
export const routesFor = (input: {
  readonly specs: Readonly<Partial<Record<BuiltInLanguageServerId, LanguageServerSpec>>>;
  readonly custom: ReadonlyArray<CustomLanguageServer>;
  readonly orderOf: (language: BuiltInLanguageServerId) => ReadonlyArray<BuiltInLanguageServerId>;
  readonly isOff: (server: LanguageServerId) => boolean;
  readonly isActive: (server: LanguageServerId) => boolean;
}): LanguageServerRoutes => {
  const customs = input.custom.filter((custom) => input.isActive(custom.id));
  const extensions = new Set([
    ...languageServerExtensions(),
    ...customs.flatMap((custom) => Object.keys(custom.languageIds)),
  ]);
  const route = (
    server: LanguageServerId,
    name: string,
    languageId: string,
    toolchain: LanguageServerRoute["toolchain"],
  ): LanguageServerRoute => ({ server, name, languageId, off: input.isOff(server), toolchain });
  return {
    extensions: Object.fromEntries(
      [...extensions].flatMap((extension) => {
        const defaults = languageServersForPath(`file.${extension}`);
        const leader = defaults[0]?.server;
        const order = leader === undefined ? [] : input.orderOf(leader);
        const rank = (server: BuiltInLanguageServerId) => {
          const at = order.indexOf(server);
          return at < 0 ? order.length : at;
        };
        const builtIn = defaults
          .filter(({ server }) => input.specs[server] !== undefined && input.isActive(server))
          .toSorted((a, b) => rank(a.server) - rank(b.server))
          .map(({ server, languageId }) => {
            const spec = input.specs[server]!;
            return route(server, spec.name, languageId, languageServerToolchain(server));
          });
        const on = customs.flatMap((custom) =>
          Object.hasOwn(custom.languageIds, extension)
            ? [{ custom, languageId: custom.languageIds[extension]! }]
            : [],
        );
        const toRoute = ({ custom, languageId }: (typeof on)[number]) =>
          route(custom.id, custom.name, languageId, null);
        const replacing = on.filter(({ custom }) => custom.replaces).map(toRoute);
        const joining = on.filter(({ custom }) => !custom.replaces).map(toRoute);
        const kept =
          replacing.length === 0 ? builtIn : builtIn.filter(({ server }) => server !== leader);
        const routes = [...replacing, ...kept, ...joining];
        return routes.length === 0 ? [] : [[extension, routes] as const];
      }),
    ),
  };
};

export interface ProjectFileSettings {
  readonly servers: Readonly<Record<string, LanguageServerOverride>>;
}

/** The checkout's file, or what's wrong with it. Anything but settings and options is refused. */
export const parseProjectFile = (
  text: string,
  isServer: (server: string) => boolean,
): ProjectFileSettings | { readonly problem: string } => {
  const parsed = parseJson(text);
  if (parsed === null) return { problem: `${PROJECT_FILE} isn't valid JSON.` };
  if (!isObject(parsed) || !isObject(parsed.servers)) {
    return { problem: `${PROJECT_FILE} needs a "servers" object.` };
  }
  const extra = Object.keys(parsed).find((key) => key !== "servers");
  if (extra !== undefined) return { problem: `${PROJECT_FILE} can't set "${extra}".` };
  for (const [server, entry] of Object.entries(parsed.servers)) {
    if (!isServer(server)) {
      return { problem: `${PROJECT_FILE} names "${server}", which isn't a language server here.` };
    }
    if (!isObject(entry)) return { problem: `${PROJECT_FILE}: "${server}" must be an object.` };
    const field = Object.keys(entry).find(
      (key) => key !== "settings" && key !== "initializationOptions",
    );
    if (field !== undefined) {
      return {
        problem: `${PROJECT_FILE} can't set "${field}" of ${server}: only settings and initializationOptions.`,
      };
    }
    if (!isOverride(entry)) {
      return {
        problem: `${PROJECT_FILE}: settings and initializationOptions of ${server} must be objects.`,
      };
    }
  }
  return { servers: parsed.servers as ProjectFileSettings["servers"] };
};
