import { describe, expect, it } from "@effect/vitest";

import { globPattern, mergeChange, watched, watchersOf } from "./watchedFiles.ts";

describe("watched files", () => {
  it("reads LSP globs", () => {
    const matches = (glob: string, path: string) => globPattern(glob).test(path);
    expect(matches("**/*.ts", "/repo/src/a.ts")).toBe(true);
    expect(matches("**/*.ts", "/repo/src/a.tsx")).toBe(false);
    expect(matches("/repo/**/*", "/repo/a.ts")).toBe(true);
    expect(matches("/repo/*.{ts,json}", "/repo/tsconfig.json")).toBe(true);
    expect(matches("/repo/*.{ts,json}", "/repo/src/a.ts")).toBe(false);
    expect(matches("/repo/file[0-9].?s", "/repo/file1.js")).toBe(true);
    expect(matches("/repo/file[!0-9].ts", "/repo/file1.ts")).toBe(false);
    // TypeScript 7 lowercases the paths it watches on a case-insensitive file system.
    expect(matches("/users/me/repo/**/*", "/Users/me/repo/src/a.ts")).toBe(true);
  });

  it("matches a registration's watchers by path and by the kinds of change they want", () => {
    const watchers = watchersOf({
      watchers: [
        { globPattern: "/repo/src/**/*.ts" },
        { globPattern: { baseUri: "file:///repo/docs", pattern: "*.md" }, kind: 1 },
        { globPattern: { baseUri: { uri: "file:///repo", name: "repo" }, pattern: "*.json" } },
        { globPattern: 7 },
      ],
    });
    expect(watchers).toHaveLength(3);
    expect(watched(watchers, ["/repo/src/a.ts"], "deleted")).toBe(true);
    expect(watched(watchers, ["/repo/docs/a.md"], "created")).toBe(true);
    expect(watched(watchers, ["/repo/docs/a.md"], "changed")).toBe(false);
    expect(watched(watchers, ["/elsewhere/package.json", "/repo/package.json"], "changed")).toBe(
      true,
    );
    expect(watched(watchers, ["/repo/README.md"], "changed")).toBe(false);
  });

  it("tells a server of a burst's net change to a file", () => {
    expect(mergeChange("created", "changed")).toBe("created");
    expect(mergeChange("created", "deleted")).toBe(null);
    expect(mergeChange("deleted", "created")).toBe("changed");
    expect(mergeChange("changed", "deleted")).toBe("deleted");
    expect(mergeChange(undefined, "changed")).toBe("changed");
  });
});
