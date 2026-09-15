import { assert, it } from "@effect/vitest";

import { formatCliCommand } from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    [
      "/home/theo/.npm/_npx/abc123/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      "npx @mercurian/astrolabe serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\@mercurian\\astrolabe\\dist\\bin.mjs",
      "npx @mercurian/astrolabe serve",
    ],
    [
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      "pnpm dlx @mercurian/astrolabe serve",
    ],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      "pnpm dlx @mercurian/astrolabe serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\@mercurian\\astrolabe\\dist\\bin.mjs",
      "pnpm dlx @mercurian/astrolabe serve",
    ],
    [
      "/home/theo/.bun/install/cache/astrolabe@0.0.31/dist/bin.mjs",
      "bunx @mercurian/astrolabe serve",
    ],
    [
      "/tmp/bunx-1000-t3@latest/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      "bunx @mercurian/astrolabe serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-t3@latest\\node_modules\\@mercurian\\astrolabe\\dist\\bin.mjs",
      "bunx @mercurian/astrolabe serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/@mercurian/astrolabe/dist/bin.mjs",
    "/home/theo/Code/work/t3code/apps/server/dist/bin.mjs",
    "/home/theo/.astrolabe/runtime/0.0.31/node_modules/@mercurian/astrolabe/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "astrolabe serve",
    );
  }
});

it("re-suggests the prerelease channel only for prerelease builds", () => {
  for (const [version, expected] of [
    ["0.0.31-nightly.20260729", "npx @mercurian/astrolabe@nightly serve"],
    ["0.0.31-preview.20260729.1", "npx @mercurian/astrolabe@preview serve"],
    ["0.0.31-foo-preview.20260729.1", "npx @mercurian/astrolabe serve"],
    ["0.0.31", "npx @mercurian/astrolabe serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/@mercurian/astrolabe/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx @mercurian/astrolabe@nightly serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-t3@latest/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx @mercurian/astrolabe serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/@mercurian/astrolabe/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "astrolabe serve",
  );
});
