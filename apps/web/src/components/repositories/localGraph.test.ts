import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { focusedPane, type Arrangement } from "~/panes/arrangement";
import { leafWithTab, leaves, type SplitNode } from "~/panes/tree";
import type { PaneArrangementStore } from "~/panes/panesHost";
import {
  filePaneOf,
  followedPath,
  localGraphKey,
  localGraphOpener,
  openLocalGraph,
} from "./localGraph";
import { repositoryTabKey, type RepositoryFileTab } from "./repositoryTabs";

const checkout = {
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make("project"),
  cwd: "/repo",
};
const file = (path: string, cwd = checkout.cwd): RepositoryFileTab => ({
  kind: "file",
  ...checkout,
  cwd,
  path,
});
const key = (path: string, cwd?: string) => repositoryTabKey(file(path, cwd));
const FOLLOWING = localGraphKey(checkout);

const leaf = (id: string, tabs: string[], active = tabs[0] ?? "") => ({
  type: "leaf" as const,
  id,
  tabs,
  active,
});
const row = (...children: SplitNode[]): SplitNode => ({
  type: "branch",
  id: "row",
  direction: "row",
  children,
  weights: children.map(() => 1),
});
const arranged = (root: SplitNode, focused: string): Arrangement => ({ root, focused, seq: 10 });

describe("a following local graph", () => {
  it("shows the file in front of the focused pane", () => {
    const arrangement = arranged(
      row(leaf("p1", [key("a.ts")]), leaf("p2", [key("b.ts")]), leaf("p3", [FOLLOWING])),
      "p2",
    );
    expect(followedPath(arrangement, checkout, "a.ts")).toBe("b.ts");
  });

  it("keeps its file while focus moves into the graph, or onto something that is not a file", () => {
    const panes = row(
      leaf("p1", [key("a.ts")]),
      leaf("p2", [key("b.ts")]),
      leaf("p3", [FOLLOWING]),
    );
    expect(followedPath(arranged(panes, "p3"), checkout, "b.ts")).toBe("b.ts");
    const diff = repositoryTabKey({ kind: "diff", ...checkout, source: "working-tree" });
    const withDiff = row(leaf("p1", [key("a.ts")]), leaf("p2", [diff]), leaf("p3", [FOLLOWING]));
    expect(followedPath(arranged(withDiff, "p2"), checkout, "a.ts")).toBe("a.ts");
  });

  it("ignores another checkout's files, and takes a file in front once its own went back", () => {
    const panes = row(
      leaf("p1", [key("a.ts"), key("c.ts")], key("c.ts")),
      leaf("p2", [key("x.ts", "/worktree")]),
      leaf("p3", [FOLLOWING]),
    );
    expect(followedPath(arranged(panes, "p2"), checkout, "a.ts")).toBe("c.ts");
  });

  it("starts on a file in front after a reload, and keeps the last one when none is", () => {
    const panes = row(leaf("p1", [key("a.ts")]), leaf("p3", [FOLLOWING]));
    expect(followedPath(arranged(panes, "p3"), checkout, null)).toBe("a.ts");
    const alone = leaf("p3", [FOLLOWING]);
    expect(followedPath(arranged(alone, "p3"), checkout, "a.ts")).toBe("a.ts");
    expect(followedPath(arranged(alone, "p3"), checkout, null)).toBeNull();
  });
});

describe("opening a local graph", () => {
  it("splits it to the file's right, the file keeping the focus", () => {
    const before = arranged(leaf("p1", [key("a.ts"), key("b.ts")], key("b.ts")), "p1");
    const after = openLocalGraph(before, file("a.ts"));
    const [left, right] = leaves(after.root);
    expect(left?.active).toBe(key("a.ts"));
    expect(right?.tabs).toEqual([FOLLOWING]);
    expect(focusedPane(after).id).toBe(left?.id);
    expect(followedPath(after, checkout, null)).toBe("a.ts");
  });

  it("brings the checkout's graph forward rather than opening a second", () => {
    const other = key("b.ts");
    const before = arranged(
      row(leaf("p1", [key("a.ts")]), leaf("p2", [FOLLOWING, other], other)),
      "p2",
    );
    const after = openLocalGraph(before, file("a.ts"));
    expect(leaves(after.root)).toHaveLength(2);
    expect(leafWithTab(after.root, FOLLOWING)?.active).toBe(FOLLOWING);
    expect(focusedPane(after).id).toBe("p1");
  });

  it("splits out a graph that shared the file's pane, and pins one pinned elsewhere here", () => {
    const pinned = localGraphKey(checkout, "old.ts");
    const before = arranged(leaf("p1", [key("a.ts"), pinned], pinned), "p1");
    const after = openLocalGraph(before, file("a.ts"));
    const panes = leaves(after.root);
    expect(panes.map((pane) => pane.tabs)).toEqual([
      [key("a.ts")],
      [localGraphKey(checkout, "a.ts")],
    ]);
  });

  it("opens a separate graph for another checkout's file", () => {
    const before = arranged(
      row(leaf("p1", [key("a.ts", "/worktree")]), leaf("p2", [FOLLOWING])),
      "p1",
    );
    const after = openLocalGraph(before, file("a.ts", "/worktree"));
    expect(leaves(after.root)).toHaveLength(3);
    expect(leafWithTab(after.root, localGraphKey({ ...checkout, cwd: "/worktree" }))).toBeDefined();
  });
});

describe("a graph's file pane", () => {
  it("is where its file is in front, else the first pane without the graph", () => {
    const panes = row(
      leaf("p1", [key("z.ts")]),
      leaf("p2", [key("a.ts")]),
      leaf("p3", [FOLLOWING]),
    );
    expect(filePaneOf(arranged(panes, "p3"), FOLLOWING, checkout, "a.ts")).toBe("p2");
    expect(filePaneOf(arranged(panes, "p3"), FOLLOWING, checkout, "gone.ts")).toBe("p1");
    expect(filePaneOf(arranged(leaf("p3", [FOLLOWING]), "p3"), FOLLOWING, checkout, "a.ts")).toBe(
      null,
    );
  });
});

describe("the menu's Open local graph", () => {
  const store = (initial: Arrangement) => {
    let arrangement = initial;
    const panes: PaneArrangementStore = {
      getSnapshot: () => ({ arrangement, hostPaneId: null }),
      update: (change) => {
        arrangement = change(arrangement);
      },
      subscribe: () => () => {},
    };
    return { panes, current: () => arrangement };
  };

  it("opens the graph of the file in front of the focused pane", () => {
    const { panes, current } = store(arranged(leaf("p1", [key("a.ts")]), "p1"));
    localGraphOpener(panes)?.();
    expect(leaves(current().root).map((pane) => pane.tabs)).toEqual([[key("a.ts")], [FOLLOWING]]);
  });

  it("has nothing to open on anything but a repository file", () => {
    const diff = repositoryTabKey({ kind: "diff", ...checkout, source: "working-tree" });
    expect(localGraphOpener(store(arranged(leaf("p1", [diff]), "p1")).panes)).toBeNull();
    expect(localGraphOpener(store(arranged(leaf("p1", [FOLLOWING]), "p1")).panes)).toBeNull();
    expect(localGraphOpener(null)).toBeNull();
  });
});
