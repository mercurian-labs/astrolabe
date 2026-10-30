import {
  ProjectId,
  type CodeGraphLink,
  type CodeGraphNode,
  type CodeLocalGraph,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_LOCAL_GRAPH_OPTIONS,
  expandFolder,
  expandedFor,
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
    expect(byId.get("app.ts")).toMatchObject({ changed: true, kind: "file" });
    expect(byId.get("src/ui")).toMatchObject({ kind: "folder", files: 7, name: "ui" });
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
});

describe("stored options", () => {
  it("read back what was stored, and nothing malformed", () => {
    const options = { ...DEFAULT_LOCAL_GRAPH_OPTIONS, depth: 3, tests: false };
    expect(parseLocalGraphOptions(JSON.stringify(options))).toEqual(options);
    expect(parseLocalGraphOptions(JSON.stringify({ ...options, depth: 4 }))).toBeNull();
    expect(parseLocalGraphOptions("{")).toBeNull();
  });
});
