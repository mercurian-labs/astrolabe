import { describe, expect, it } from "vite-plus/test";

import {
  describeScriptDeclarations,
  projectsForRepository,
  repositoryIdsForProject,
  sortRepositoriesForPage,
} from "./RepositoriesPage.logic";

const repository = (name: string, hasGit = true) => ({
  repositoryId: name,
  name,
  path: `/code/${name}`,
  hasGit,
  scripts: [],
});

describe("sortRepositoriesForPage", () => {
  it("reads alphabetically, ignoring case", () => {
    const sorted = sortRepositoriesForPage([
      repository("zulu"),
      repository("Alpha"),
      repository("mike"),
    ]);
    expect(sorted.map((one) => one.name)).toEqual(["Alpha", "mike", "zulu"]);
  });
});

describe("describeScriptDeclarations", () => {
  it("says what a declaration declares, and nothing about running it", () => {
    const described = describeScriptDeclarations([
      {
        scriptId: "dev",
        name: "Dev",
        command: "pnpm dev",
        previewUrl: "http://localhost:3000",
        isSetup: false,
      },
      { scriptId: "install", name: "Install", command: "pnpm i", isSetup: true },
      { scriptId: "test", name: "Test", command: "pnpm test", previewUrl: "  ", isSetup: false },
    ]);

    expect(described.map((one) => one.badges)).toEqual([
      ["preview http://localhost:3000"],
      ["setup"],
      [],
    ]);
    expect(described[0]?.command).toBe("pnpm dev");
  });
});

describe("project memberships", () => {
  const links = [
    { projectId: "p1", repositoryId: "r1" },
    { projectId: "p1", repositoryId: "r2" },
    { projectId: "p2", repositoryId: "r2" },
  ];

  it("reads both directions of the same set", () => {
    expect(projectsForRepository(links, "r2")).toEqual(["p1", "p2"]);
    expect([...repositoryIdsForProject(links, "p1")]).toEqual(["r1", "r2"]);
    expect([...repositoryIdsForProject(links, "p3")]).toEqual([]);
  });
});
