import { describe, expect, it } from "vite-plus/test";

import { ProjectId } from "./baseSchemas.ts";
import {
  formatRootAddress,
  parseProjectRootId,
  parseRootAddress,
  projectRootId,
  projectRootKeys,
  RootKey,
} from "./projectRoots.ts";

const keys = ["app", "api", "api-2", "docs"].map((key) => RootKey.make(key));

describe("projectRootKeys", () => {
  it("slugs the project folder's basename and each folder's name, numbering repeats in order", () => {
    expect(
      projectRootKeys("/Users/me/Code/My App/", [
        { name: "API" },
        { name: "api" },
        { name: "Café Notes" },
        { name: "api-2" },
        { name: "🚀" },
        { name: "my app" },
        { name: ".config" },
      ]),
    ).toEqual(["my-app", "api", "api-2", "cafe-notes", "api-2-2", "root", "my-app-2", "config"]);
  });

  it("names a Windows project folder by its last segment", () => {
    expect(projectRootKeys("C:\\work\\Monorepo", [{ name: "monorepo" }])).toEqual([
      "monorepo",
      "monorepo-2",
    ]);
  });
});

describe("root addresses", () => {
  it("round-trips addresses with and without a root and an anchor", () => {
    for (const address of [
      { root: keys[1]!, path: "docs/Plan.md", anchor: "Goal" },
      { root: keys[2]!, path: "README.md", anchor: null },
      { root: keys[0]!, path: "", anchor: null },
      { root: null, path: "notes/Plan.md", anchor: "Open questions" },
      { root: null, path: "Plan", anchor: null },
    ]) {
      expect(parseRootAddress(formatRootAddress(address), keys)).toEqual(address);
    }
  });

  it("only reads a prefix as a root when it is exactly one of the keys", () => {
    expect(parseRootAddress("Note: subtitle", keys)).toEqual({
      root: null,
      path: "Note: subtitle",
      anchor: null,
    });
    expect(parseRootAddress("API:docs/Plan.md", keys).root).toBeNull();
    expect(parseRootAddress("web:Plan#Goal", keys)).toEqual({
      root: null,
      path: "web:Plan",
      anchor: "Goal",
    });
    expect(parseRootAddress(":Plan", keys).root).toBeNull();
    // The first colon decides; a later one is part of the path.
    expect(parseRootAddress("docs:Meeting: 11:00", keys)).toEqual({
      root: "docs",
      path: "Meeting: 11:00",
      anchor: null,
    });
    // A colon inside the anchor is not a prefix.
    expect(parseRootAddress("Plan#api:Goal", keys)).toEqual({
      root: null,
      path: "Plan",
      anchor: "api:Goal",
    });
  });
});

describe("project root ids", () => {
  it("round-trips ids whose project id holds a colon", () => {
    const projectId = ProjectId.make("project:abc/def");
    const id = projectRootId(projectId, keys[2]!);
    expect(id).toBe("project%3Aabc%2Fdef:api-2");
    expect(parseProjectRootId(id)).toEqual({ projectId, rootKey: "api-2" });
  });

  it("rejects ids that are not one project and one key", () => {
    for (const id of ["project", "a:b:c", ":api", "project:", "project:API", "project:%E0%A4%A"]) {
      expect(parseProjectRootId(id)).toBeNull();
    }
  });
});
