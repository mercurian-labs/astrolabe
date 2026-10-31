import {
  ProjectId,
  type CodeGraphLink,
  type CodeGraphNode,
  type CodeLocalGraph,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FILE_GRAPH_SETTINGS } from "@mercurian/graph/file";

import {
  DEFAULT_LOCAL_GRAPH_OPTIONS,
  DEFAULT_LOCAL_GRAPH_PANEL,
  expandFolder,
  expandedFor,
  folderNames,
  groupOf,
  importOf,
  localGraphInput,
  NO_EXPANSION,
  nodeAction,
  parseLocalGraphOptions,
  shownLocalGraph,
} from "./localGraphData";

const projectId = ProjectId.make("project");

const node = (id: string, extra: Partial<CodeGraphNode> = {}): CodeGraphNode => ({
  id,
  kind: "file",
  name: id.slice(id.lastIndexOf("/") + 1),
  path: id,
  depth: 1,
  lines: 10,
  test: false,
  changed: null,
  files: null,
  ...extra,
});

const link = (from: string, to: string, line: number | null = 1): CodeGraphLink => ({
  from,
  to,
  line,
  text: line === null ? null : `import "./${to}";`,
  resolution: "exact",
});

/**
 * `app.ts` imports `lib.ts` (line 3) and react; `app.test.ts` imports `app.ts`, and `harness.ts`
 * is reached only through the test. `src/ui` is a folded folder.
 */
const GRAPH: CodeLocalGraph = {
  center: "app.ts",
  nodes: [
    node("app.ts", { depth: 0, changed: "uncommitted" }),
    node("lib.ts"),
    node("dependency:react", { kind: "dependency", name: "react", path: null, lines: null }),
    node("app.test.ts", { test: true }),
    node("harness.ts", { depth: 2 }),
    node("src/ui", { kind: "folder", name: "ui", lines: null, files: 7 }),
  ],
  links: [
    link("app.ts", "lib.ts", 3),
    link("app.ts", "dependency:react", 1),
    link("app.test.ts", "app.ts", 2),
    link("harness.ts", "app.test.ts", 4),
    link("app.ts", "src/ui", null),
  ],
  usedByPending: false,
  status: {
    projectId,
    state: "ready",
    files: 6,
    totalFiles: 6,
    languages: ["typescript"],
    updatedAt: null,
    failure: null,
  },
};

const ids = (graph: ReturnType<typeof shownLocalGraph>) =>
  graph.data.nodes.map((each) => each.id).toSorted();

describe("a local graph as the renderer draws it", () => {
  it("keeps tests, hides dependencies, and counts them either way", () => {
    const shown = shownLocalGraph(GRAPH, DEFAULT_LOCAL_GRAPH_OPTIONS);
    expect(ids(shown)).toEqual(["app.test.ts", "app.ts", "harness.ts", "lib.ts", "src/ui"]);
    expect(shown.dependencies).toBe(1);
    const withDependencies = shownLocalGraph(GRAPH, {
      ...DEFAULT_LOCAL_GRAPH_OPTIONS,
      dependencies: true,
    });
    expect(ids(withDependencies)).toContain("dependency:react");
    expect(withDependencies.dependencies).toBe(1);
  });

  it("drops a hidden test's links, and what reached the centre only through it", () => {
    const shown = shownLocalGraph(GRAPH, { ...DEFAULT_LOCAL_GRAPH_OPTIONS, tests: false });
    expect(ids(shown)).toEqual(["app.ts", "lib.ts", "src/ui"]);
    expect(shown.data.links.map((each) => `${each.from}>${each.to}`).toSorted()).toEqual([
      "app.ts>lib.ts",
      "app.ts>src/ui",
    ]);
  });

  it("carries each node's kind, changed state and folded count, and never hides the centre", () => {
    const testCentre: CodeLocalGraph = {
      ...GRAPH,
      center: "app.test.ts",
      nodes: GRAPH.nodes.map((each) => (each.id === "app.test.ts" ? { ...each, depth: 0 } : each)),
    };
    const shown = shownLocalGraph(testCentre, { ...DEFAULT_LOCAL_GRAPH_OPTIONS, tests: false });
    expect(ids(shown)).toContain("app.test.ts");
    const byId = new Map(
      shownLocalGraph(GRAPH, DEFAULT_LOCAL_GRAPH_OPTIONS).data.nodes.map((each) => [each.id, each]),
    );
    expect(byId.get("app.ts")).toMatchObject({ changed: true, kind: "file", test: false });
    expect(byId.get("app.test.ts")).toMatchObject({ test: true });
    expect(byId.get("src/ui")).toMatchObject({ kind: "folder", files: 7, name: "ui" });
  });

  it("narrows to the files whose name holds a search, keeping the centre and their links", () => {
    const shown = shownLocalGraph(GRAPH, DEFAULT_LOCAL_GRAPH_OPTIONS, "  LI ");
    expect(ids(shown)).toEqual(["app.ts", "lib.ts"]);
    expect(shown.data.links).toEqual([{ from: "app.ts", to: "lib.ts", guessed: false }]);
    // A match the centre reaches only through a file the search drops still shows, on its own.
    expect(ids(shownLocalGraph(GRAPH, DEFAULT_LOCAL_GRAPH_OPTIONS, "harness"))).toEqual([
      "app.ts",
      "harness.ts",
    ]);
    expect(ids(shownLocalGraph(GRAPH, DEFAULT_LOCAL_GRAPH_OPTIONS, "nothing"))).toEqual(["app.ts"]);
  });

  it("tints a file with the first group whose words its path holds", () => {
    const groups = [
      { query: "", color: 5 },
      { query: "src ui", color: 2 },
      { query: "lib", color: 4 },
      { query: "LIB.ts", color: 1 },
    ];
    expect(groupOf("src/ui", groups)).toBe(2);
    expect(groupOf("ui", groups)).toBeNull();
    expect(groupOf("src/Lib.ts", groups)).toBe(4);
    expect(groupOf("app.ts", groups)).toBeNull();
    const byId = new Map(
      shownLocalGraph(GRAPH, { ...DEFAULT_LOCAL_GRAPH_OPTIONS, groups }).data.nodes.map((each) => [
        each.id,
        each.group,
      ]),
    );
    expect(byId.get("src/ui")).toBe(2);
    expect(byId.get("lib.ts")).toBe(4);
    expect(byId.get("app.ts")).toBeNull();
  });
});

describe("folder names", () => {
  it("are the fewest trailing parts of a path that no other folder ends in too", () => {
    const names = folderNames([
      "apps/web/src",
      "apps/server/src",
      "packages/contracts/src",
      "scripts",
      "apps/web/src/components",
    ]);
    expect(Object.fromEntries(names)).toEqual({
      "apps/web/src": "web/src",
      "apps/server/src": "server/src",
      "packages/contracts/src": "contracts/src",
      scripts: "scripts",
      "apps/web/src/components": "components",
    });
  });

  it("are the whole path when only it tells two apart, or when one ends the other", () => {
    expect(Object.fromEntries(folderNames(["apps/web/src", "packages/web/src", "src"]))).toEqual({
      "apps/web/src": "apps/web/src",
      "packages/web/src": "packages/web/src",
      src: "src",
    });
    expect(Object.fromEntries(folderNames(["../packages/ui/src", "apps/ui/src"]))).toEqual({
      "../packages/ui/src": "packages/ui/src",
      "apps/ui/src": "apps/ui/src",
    });
  });

  it("name the graph's folded folders apart, the hover card keeping the path", () => {
    const folders: CodeLocalGraph = {
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        node("apps/web/src", { kind: "folder", name: "src", lines: null, files: 975 }),
        node("apps/server/src", { kind: "folder", name: "src", lines: null, files: 751 }),
      ],
      links: [
        ...GRAPH.links,
        link("apps/web/src", "app.ts", null),
        link("apps/server/src", "app.ts", null),
      ],
    };
    const names = Object.fromEntries(
      shownLocalGraph(folders, DEFAULT_LOCAL_GRAPH_OPTIONS).data.nodes.map((each) => [
        each.id,
        each.name,
      ]),
    );
    expect(names).toMatchObject({
      "apps/web/src": "web/src",
      "apps/server/src": "server/src",
      "src/ui": "ui",
      "lib.ts": "lib.ts",
    });
  });
});

describe("a hovered node's import", () => {
  it("is the line its link to the centre is written on, whichever file holds it", () => {
    expect(importOf(GRAPH, "lib.ts")).toMatchObject({ from: "app.ts", line: 3 });
    expect(importOf(GRAPH, "app.test.ts")).toMatchObject({ from: "app.test.ts", line: 2 });
  });

  it("is the link a ring nearer for a node further out, and none for a folder", () => {
    expect(importOf(GRAPH, "harness.ts")).toMatchObject({ from: "harness.ts", to: "app.test.ts" });
    expect(importOf(GRAPH, "src/ui")).toBeNull();
    expect(importOf(GRAPH, "app.ts")).toBeNull();
  });
});

describe("folders and clicks", () => {
  it("open a folder by asking again with it expanded, until the centre moves", () => {
    const opened = expandFolder(NO_EXPANSION, "app.ts", "src/ui");
    const both = expandFolder(opened, "app.ts", "src/lib");
    const input = localGraphInput(
      { projectId, cwd: "/repo" },
      "app.ts",
      DEFAULT_LOCAL_GRAPH_OPTIONS,
      expandedFor(both, "app.ts"),
    );
    expect(input.expanded).toEqual(["src/lib", "src/ui"]);
    expect(input.dependencies).toBe(true);
    expect(expandedFor(both, "lib.ts")).toEqual([]);
    expect(expandFolder(both, "lib.ts", "src/x").folders).toEqual(["src/x"]);
  });

  it("open a file or a package's entry, expand a folder, and leave a dependency alone", () => {
    expect(nodeAction(node("lib.ts"))).toEqual({ kind: "open", path: "lib.ts" });
    expect(
      nodeAction(node("@acme/ui", { kind: "package", path: "packages/ui/src/index.ts" })),
    ).toEqual({
      kind: "open",
      path: "packages/ui/src/index.ts",
    });
    expect(nodeAction(node("src/ui", { kind: "folder" }))).toEqual({
      kind: "expand",
      folder: "src/ui",
    });
    expect(nodeAction(node("dependency:react", { kind: "dependency", path: null }))).toBeNull();
  });

  it("leave files outside the project closed, and still open folders there", () => {
    const outside = { outsideProject: true };
    expect(nodeAction(node("../web/src/view.ts", outside))).toBeNull();
    expect(
      nodeAction(node("@acme/ui", { ...outside, kind: "package", path: "../ui/src/index.ts" })),
    ).toBeNull();
    expect(nodeAction(node("../web/src", { ...outside, kind: "folder" }))).toEqual({
      kind: "expand",
      folder: "../web/src",
    });
  });
});

describe("stored options", () => {
  it("read back what was stored, and nothing malformed", () => {
    const options = {
      ...DEFAULT_LOCAL_GRAPH_OPTIONS,
      depth: 3,
      tests: false,
      groups: [{ query: "packages/", color: 3 }],
      settings: { ...DEFAULT_FILE_GRAPH_SETTINGS, arrows: true, linkDistance: 250 },
      panel: { ...DEFAULT_LOCAL_GRAPH_PANEL, open: true, forces: true },
    };
    expect(parseLocalGraphOptions(JSON.stringify(options))).toEqual(options);
    expect(parseLocalGraphOptions(JSON.stringify({ ...options, depth: 4 }))).toBeNull();
    expect(parseLocalGraphOptions("{")).toBeNull();
    expect(parseLocalGraphOptions("[]")).toBeNull();
  });

  it("read options stored before the filter panel, with its defaults", () => {
    const stored = { depth: 2, uses: true, usedBy: false, tests: true, dependencies: true };
    expect(parseLocalGraphOptions(JSON.stringify(stored))).toEqual({
      ...DEFAULT_LOCAL_GRAPH_OPTIONS,
      ...stored,
    });
  });

  it("keep the filters when the rest is malformed, each part falling back on its own", () => {
    const parsed = parseLocalGraphOptions(
      JSON.stringify({
        depth: 2,
        uses: true,
        usedBy: true,
        tests: false,
        dependencies: false,
        groups: [{ query: "ok", color: 1 }, { query: "bad colour", color: 9 }, "junk"],
        settings: { ...DEFAULT_FILE_GRAPH_SETTINGS, repelForce: 999 },
        panel: { open: true, groups: "yes" },
      }),
    );
    expect(parsed).toEqual({
      ...DEFAULT_LOCAL_GRAPH_OPTIONS,
      depth: 2,
      tests: false,
      groups: [{ query: "ok", color: 1 }],
      settings: DEFAULT_FILE_GRAPH_SETTINGS,
      panel: { ...DEFAULT_LOCAL_GRAPH_PANEL, open: true },
    });
  });
});
