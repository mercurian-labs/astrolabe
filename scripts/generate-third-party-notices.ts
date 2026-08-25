#!/usr/bin/env node

// Builds the THIRD-PARTY-NOTICES.md that ships inside every distributed artifact.
//
// The file is generated at build time rather than committed: a checked-in copy drifts
// silently as dependencies move, and a stale notices file is a compliance defect that
// nothing in CI would catch.
//
// The output is deliberately a superset of what any single artifact bundles. Enumerating
// the exact module set inlined into a given bundle is fragile, and over-attribution costs
// nothing while under-attribution is the failure that matters.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

export class ThirdPartyNoticesError extends Schema.TaggedErrorClass<ThirdPartyNoticesError>()(
  "ThirdPartyNoticesError",
  {
    operation: Schema.Literals(["read", "write"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} third-party notices file '${this.filePath}'.`;
  }
}

/** Vendored source we carry in-tree, which no dependency walk would ever surface. */
export const vendoredComponents = [
  {
    title: "T3 Code",
    description:
      "This software is derived from T3 Code. The inherited code remains under this license.",
    licensePath: "NOTICE.md",
  },
  {
    title: "libghostty-vt",
    description: "Terminal emulation, vendored under native/libghostty-vt.",
    licensePath: "native/libghostty-vt/LICENSE",
  },
  {
    title: "Nerd Fonts glyphs",
    description: "Terminal glyph set, vendored under apps/web/src/terminal/ghostty/fonts.",
    licensePath: "apps/web/src/terminal/ghostty/fonts/LICENSE",
  },
  {
    title: "Expo modules (650 Industries, Inc.)",
    description:
      "Native module scaffolding derived from Expo, vendored under apps/mobile/modules/t3-composer-editor.",
    licensePath: "apps/mobile/modules/t3-composer-editor/LICENSE",
  },
  {
    title: "Bluesky PBC markdown text view",
    description:
      "Native markdown text rendering derived from Bluesky's social-app, vendored under apps/mobile/modules/t3-markdown-text.",
    licensePath: "apps/mobile/modules/t3-markdown-text/LICENSE",
  },
] as const;

/** Workspace-local packages are first-party; they are not third-party notices. */
const firstPartyScopes = ["@t3tools/", "@mercurian/"];
const firstPartyNames = ["t3"];

const licenseFileNames = ["LICENSE", "LICENCE", "NOTICE", "COPYING"];

export interface NoticeEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly licenseText: string | undefined;
}

// Only the fields a notice needs. Real manifests carry far more, and the license field is
// polymorphic across the registry's history: a SPDX string, a {type} object, or the long
// deprecated `licenses` array.
const PackageManifestSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  license: Schema.optional(Schema.Unknown),
  licenses: Schema.optional(Schema.Unknown),
});

const decodePackageManifest = Schema.decodeEffect(Schema.fromJsonString(PackageManifestSchema));

const isFirstParty = (name: string): boolean =>
  firstPartyNames.includes(name) || firstPartyScopes.some((scope) => name.startsWith(scope));

const readLicenseDeclaration = (manifest: {
  readonly license?: unknown;
  readonly licenses?: unknown;
}): string => {
  const { license, licenses } = manifest;
  if (typeof license === "string") return license;
  if (typeof license === "object" && license !== null) {
    const type = (license as Record<string, unknown>)["type"];
    if (typeof type === "string") return type;
  }
  if (globalThis.Array.isArray(licenses)) {
    const types = licenses
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof entry === "object" && entry !== null
            ? (entry as Record<string, unknown>)["type"]
            : undefined,
      )
      .filter((type): type is string => typeof type === "string");
    if (types.length > 0) return types.join(" OR ");
  }
  return "UNKNOWN";
};

/** Reads a file, treating any failure as absence — an unreadable license file is not fatal. */
const readOptionalFile = (
  filePath: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(filePath).pipe(Effect.option);
  });

const readDirectoryOrEmpty = (
  directory: string,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
  });

const readPackageLicenseText = (
  packageDir: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const entries = yield* readDirectoryOrEmpty(packageDir);
    const match = entries.find((entry) => {
      const upper = entry.toUpperCase();
      return licenseFileNames.some(
        (candidate) => upper === candidate || upper.startsWith(`${candidate}.`),
      );
    });
    if (match === undefined) return Option.none();
    return yield* readOptionalFile(path.join(packageDir, match));
  });

const readPackageEntry = (
  packageDir: string,
): Effect.Effect<Option.Option<NoticeEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const manifest = yield* readOptionalFile(path.join(packageDir, "package.json"));
    if (Option.isNone(manifest)) return Option.none();

    const parsed = yield* decodePackageManifest(manifest.value).pipe(Effect.option);
    if (Option.isNone(parsed)) return Option.none();

    const { name, version } = parsed.value;
    if (name === undefined || version === undefined) return Option.none();
    if (isFirstParty(name)) return Option.none();

    const licenseText = yield* readPackageLicenseText(packageDir);
    return Option.some({
      name,
      version,
      license: readLicenseDeclaration(parsed.value),
      licenseText: Option.getOrUndefined(licenseText),
    });
  });

/**
 * Enumerates every installed package under the pnpm virtual store, deduplicated by
 * name@version — the same package appears once per peer-dependency variant.
 */
export const collectInstalledPackages = (
  rootDir: string,
): Effect.Effect<ReadonlyArray<NoticeEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const storeDir = path.join(rootDir, "node_modules", ".pnpm");
    const storeEntries = yield* readDirectoryOrEmpty(storeDir);

    const packageDirs: Array<string> = [];
    for (const storeEntry of storeEntries) {
      if (storeEntry.startsWith(".")) continue;
      const nestedRoot = path.join(storeDir, storeEntry, "node_modules");
      for (const nested of yield* readDirectoryOrEmpty(nestedRoot)) {
        if (nested.startsWith(".")) continue;
        if (nested.startsWith("@")) {
          const scopeDir = path.join(nestedRoot, nested);
          for (const scoped of yield* readDirectoryOrEmpty(scopeDir)) {
            packageDirs.push(path.join(scopeDir, scoped));
          }
        } else {
          packageDirs.push(path.join(nestedRoot, nested));
        }
      }
    }

    const entries = yield* Effect.forEach(packageDirs, readPackageEntry, { concurrency: 32 });
    const deduplicated = new Map<string, NoticeEntry>();
    for (const entry of entries) {
      if (Option.isNone(entry)) continue;
      const key = `${entry.value.name}@${entry.value.version}`;
      const existing = deduplicated.get(key);
      // Peer-dependency variants of one package are not identical on disk: pnpm materializes
      // the license file in some and not others. Keep whichever copy carries the text, or the
      // notice silently disappears based on directory iteration order.
      if (existing !== undefined && existing.licenseText !== undefined) continue;
      deduplicated.set(key, entry.value);
    }

    return [...deduplicated.values()].sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
    );
  });

export const renderThirdPartyNotices = (
  vendored: ReadonlyArray<{
    readonly title: string;
    readonly description: string;
    readonly text: string;
  }>,
  packages: ReadonlyArray<NoticeEntry>,
): string => {
  const lines: Array<string> = [
    "# Third-Party Notices",
    "",
    "This software incorporates the third-party components listed below. Each remains",
    "subject to its own license terms, reproduced here in satisfaction of those terms.",
    "",
  ];

  if (vendored.length > 0) {
    lines.push("## Vendored components", "");
    for (const component of vendored) {
      lines.push(
        `### ${component.title}`,
        "",
        component.description,
        "",
        "```",
        component.text.trimEnd(),
        "```",
        "",
      );
    }
  }

  lines.push("## Packages", "");
  for (const entry of packages) {
    lines.push(`### ${entry.name}@${entry.version}`, "", `License: ${entry.license}`, "");
    if (entry.licenseText !== undefined) {
      lines.push("```", entry.licenseText.trimEnd(), "```", "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
};

interface GenerateOptions {
  readonly rootDir?: string | undefined;
}

export const generateThirdPartyNotices = (
  outPath: string,
  options: GenerateOptions = {},
): Effect.Effect<
  { readonly packageCount: number; readonly outPath: string },
  ThirdPartyNoticesError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rootDir = options.rootDir ?? process.cwd();

    const vendored: Array<{ title: string; description: string; text: string }> = [];
    for (const component of vendoredComponents) {
      const licensePath = path.join(rootDir, component.licensePath);
      const text = yield* readOptionalFile(licensePath);
      if (Option.isNone(text)) {
        return yield* new ThirdPartyNoticesError({
          operation: "read",
          filePath: licensePath,
          cause: new Error("Vendored license file is missing."),
        });
      }
      vendored.push({
        title: component.title,
        description: component.description,
        text: text.value,
      });
    }

    const packages = yield* collectInstalledPackages(rootDir);
    const rendered = renderThirdPartyNotices(vendored, packages);
    const resolvedOut = path.isAbsolute(outPath) ? outPath : path.join(rootDir, outPath);

    yield* fs
      .writeFileString(resolvedOut, rendered)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThirdPartyNoticesError({ operation: "write", filePath: resolvedOut, cause }),
        ),
      );

    return { packageCount: packages.length, outPath: resolvedOut };
  });

export const generateThirdPartyNoticesCommand = Command.make(
  "generate-third-party-notices",
  {
    out: Flag.string("out").pipe(
      Flag.withDescription("Path the notices file is written to."),
      Flag.withDefault("THIRD-PARTY-NOTICES.md"),
    ),
    root: Flag.string("root").pipe(
      Flag.withDescription("Workspace root used to resolve node_modules and vendored licenses."),
      Flag.optional,
    ),
  },
  ({ out, root }) =>
    generateThirdPartyNotices(out, { rootDir: Option.getOrUndefined(root) }).pipe(
      Effect.tap(({ packageCount, outPath }) =>
        Console.log(`Wrote ${outPath} covering ${packageCount} packages.`),
      ),
    ),
).pipe(Command.withDescription("Generate the third-party notices shipped in release artifacts."));

if (import.meta.main) {
  Command.run(generateThirdPartyNoticesCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
