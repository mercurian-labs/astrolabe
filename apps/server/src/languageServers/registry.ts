import type { LanguageServerId } from "@t3tools/contracts";

/**
 * Language servers as data: which to run for a checkout, where its binary comes from, its
 * licence, and whether it is safe in a repository that isn't trusted. The resolver reads these;
 * no server has install code of its own.
 */

/** Licences we download; a server under any other (MPL included) has to be on PATH. */
export const LICENCE_ALLOWLIST = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

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

/** The project's own toolchain package, and the major versions this launch is for. */
export interface Toolchain {
  readonly package: string;
  readonly minMajor?: number;
  readonly maxMajor?: number;
}

export interface Launch {
  /** Shown as "<name> <toolchain or package version>". */
  readonly name: string;
  readonly toolchain?: Toolchain;
  /** In the project, relative to the checkout; `{toolchain}` is the toolchain's folder. */
  readonly projectBinary?: { readonly path: string; readonly runWith: "node" | "native" };
  /** A command found on PATH. */
  readonly pathCommand?: string;
  readonly npm?: NpmSource;
  readonly args: ReadonlyArray<string>;
  /** `{toolchain}` is replaced by the toolchain's folder. */
  readonly initializationOptions?: unknown;
  /** Runs no repository code (plugins, build scripts), so restricted repositories may use it. */
  readonly restrictedSafe: boolean;
}

export interface LanguageServerSpec {
  readonly id: LanguageServerId;
  /** Tried in order: the first whose toolchain matches decides, downloading if it must. */
  readonly launches: ReadonlyArray<Launch>;
}

const TYPESCRIPT_NATIVE = "@typescript/typescript-{platform}-{arch}";

export const LANGUAGE_SERVERS: Readonly<Record<LanguageServerId, LanguageServerSpec>> = {
  typescript: {
    id: "typescript",
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
};

/** Whether an SPDX expression allows us to download: one allowed side of an OR, all of an AND. */
export const licenceAllowed = (expression: unknown): boolean => {
  if (typeof expression !== "string") return false;
  const bare = expression.replaceAll(/[()]/g, "").trim();
  return bare
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((licence) => LICENCE_ALLOWLIST.has(licence.trim())),
    );
};

export const fillPlatform = (text: string, platform: string, arch: string) =>
  text.replaceAll("{platform}", platform).replaceAll("{arch}", arch);
