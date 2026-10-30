import {
  CodeIndexError,
  EnvironmentId,
  ProjectId,
  type CodeGraphNode,
  type CodeIndexStatus,
  type CodeLocalGraph,
  type CodeLocalGraphInput,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { activateTab, openTab, type Arrangement } from "~/panes/arrangement";
import { PanesHostContext, type PaneArrangementStore, type PaneTabs } from "~/panes/panesHost";
import { leaves } from "~/panes/tree";
import { render } from "../../../test/render";
import { importLineHighlight, importLineKey } from "./importLineHighlight";
import { localGraphKey } from "./localGraph";
import RepositoryGraphView from "./RepositoryGraphView";
import { repositoryTabKey, type RepositoryGraphTab } from "./repositoryTabs";
import "~/index.css";

// The local graph's view with the code index's answers given here and the renderer replaced by a
// row of buttons, one per node it is handed: clicks and hovers go through its real callbacks.

interface Answer {
  readonly data?: CodeLocalGraph;
  readonly failure?: unknown;
}

const mocks = vi.hoisted(() => ({
  requests: [] as Array<{ readonly input: CodeLocalGraphInput }>,
  answer: (_input: CodeLocalGraphInput): Answer => ({}),
  /** One answer per request, as a query atom holds one value until it reads again. */
  answers: new Map<string, Answer>(),
  /** The repository's index status as its subscription last reported it. */
  status: null as CodeIndexStatus | null,
  refreshes: 0,
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => mocks.status,
}));
vi.mock("~/state/codeIndex", () => ({ codeIndexEnvironment: { status: () => ({}) } }));

vi.mock("~/state/codeLocalGraph", () => ({
  codeLocalGraphEnvironment: {
    localGraph: (target: { readonly input: CodeLocalGraphInput }) => target,
  },
}));

vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (target: { readonly input: CodeLocalGraphInput } | null) => {
    if (target === null) {
      return { data: null, failure: null, error: null, refresh: () => {}, dataUpdatedAt: 0 };
    }
    mocks.requests.push(target);
    const key = JSON.stringify(target.input);
    const answer = mocks.answers.get(key) ?? mocks.answer(target.input);
    mocks.answers.set(key, answer);
    const { data = null, failure = null } = answer;
    return {
      data,
      failure,
      error: failure === null ? null : "failed",
      refresh: () => {
        mocks.refreshes += 1;
      },
      dataUpdatedAt: 1,
      isPending: false,
      isSuccess: data !== null,
    };
  },
}));

vi.mock("@mercurian/graph/file", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mercurian/graph/file")>()),
  FileGraph: ({
    graph,
    onOpen,
    onHover,
  }: {
    readonly graph: {
      readonly nodes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    };
    readonly onOpen: (id: string, modifier: boolean) => void;
    readonly onHover: (hover: { id: string; x: number; y: number } | null) => void;
  }) => (
    <div>
      {graph.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={(event) => onOpen(node.id, event.metaKey || event.ctrlKey)}
          onMouseEnter={() => onHover({ id: node.id, x: 20, y: 20 })}
          onMouseLeave={() => onHover(null)}
        >
          {`node ${node.name}`}
        </button>
      ))}
    </div>
  ),
}));

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("project");
const checkout = { environmentId, projectId, cwd: "/repo" };
const fileKey = (path: string) => repositoryTabKey({ kind: "file", ...checkout, path });
const FOLLOWING: RepositoryGraphTab = { kind: "graph", ...checkout, path: null };

const node = (id: string, extra: Partial<CodeGraphNode> = {}): CodeGraphNode => ({
  id,
  kind: "file",
  name: id.slice(id.lastIndexOf("/") + 1),
  path: id,
  depth: 1,
  lines: 12,
  test: false,
  changed: null,
  files: null,
  ...extra,
});

function graphOf(center: string, extra: Partial<CodeLocalGraph> = {}): CodeLocalGraph {
  return {
    center,
    nodes: [
      node(center, { depth: 0 }),
      node("lib.ts", { changed: "branch", lines: 40 }),
      node("src/ui", { kind: "folder", name: "ui", lines: null, files: 7 }),
    ],
    links: [
      {
        from: center,
        to: "lib.ts",
        line: 3,
        text: 'import { lib } from "./lib";',
        resolution: "exact",
      },
      { from: center, to: "src/ui", line: null, text: null, resolution: "exact" },
    ],
    usedByPending: false,
    status: {
      projectId,
      state: "ready",
      files: 100,
      totalFiles: 100,
      languages: ["typescript"],
      updatedAt: null,
      failure: null,
    },
    ...extra,
  };
}

/** A pane arrangement held for one test, as a section's panes hold theirs. */
function panesWith(initial: Arrangement) {
  let arrangement = initial;
  const listeners = new Set<() => void>();
  const store: PaneArrangementStore = {
    getSnapshot: () => ({ arrangement, hostPaneId: null }),
    update: (change) => {
      arrangement = change(arrangement);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const tabs: PaneTabs = {
    Label: ({ children }) => children({ title: "", icon: null }),
    close: () => {},
    NewTab: () => null,
    place: () => {},
    Overlay: () => null,
    reservesTopRight: false,
  };
  return { host: { controller: store, tabs }, store, current: () => arrangement };
}

/** Two panes: files on the left (`a.ts` in front), the following graph on the right. */
function filesAndGraph(): Arrangement {
  return {
    root: {
      type: "branch",
      id: "row",
      direction: "row",
      children: [
        {
          type: "leaf",
          id: "p1",
          tabs: [fileKey("a.ts"), fileKey("b.ts")],
          active: fileKey("a.ts"),
        },
        {
          type: "leaf",
          id: "p2",
          tabs: [localGraphKey(checkout)],
          active: localGraphKey(checkout),
        },
      ],
      weights: [1, 1],
    },
    focused: "p1",
    seq: 3,
  };
}

function setup(answer: (input: CodeLocalGraphInput) => Answer) {
  mocks.requests.length = 0;
  mocks.answers.clear();
  mocks.answer = answer;
  mocks.status = null;
  mocks.refreshes = 0;
  importLineHighlight.set(null);
  return panesWith(filesAndGraph());
}

function graphView(host: ReturnType<typeof panesWith>["host"]) {
  return (
    <PanesHostContext.Provider value={host}>
      <div style={{ width: 640, height: 420, display: "flex" }}>
        <RepositoryGraphView tabKey={localGraphKey(checkout)} tab={FOLLOWING} />
      </div>
    </PanesHostContext.Provider>
  );
}

const lastRequest = () => mocks.requests.at(-1)?.input;

describe("a following local graph", () => {
  it("shows the focused file, asks again with a folder opened or folded, and folded on a new file", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    await using _screen = await render(graphView(panes.host));
    await expect.element(page.getByRole("button", { name: "node ui" })).toBeVisible();
    expect(lastRequest()).toMatchObject({ path: "a.ts", expanded: [] });

    await userEvent.click(page.getByRole("button", { name: "node ui" }));
    await vi.waitFor(() =>
      expect(lastRequest()).toMatchObject({ path: "a.ts", expanded: ["src/ui"] }),
    );
    await userEvent.click(page.getByRole("button", { name: "Fold folders" }));
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ path: "a.ts", expanded: [] }));
    await userEvent.click(page.getByRole("button", { name: "node ui" }));

    panes.store.update((arrangement) => ({
      ...arrangement,
      root: {
        ...arrangement.root,
        ...(arrangement.root.type === "branch"
          ? {
              children: arrangement.root.children.map((child) =>
                child.type === "leaf" && child.id === "p1"
                  ? { ...child, active: fileKey("b.ts") }
                  : child,
              ),
            }
          : {}),
      },
    }));
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ path: "b.ts", expanded: [] }));
  });

  it("reads nothing new while it is behind another tab", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    await using _screen = await render(graphView(panes.host));
    await expect.element(page.getByRole("button", { name: "node ui" })).toBeVisible();
    // A file goes in front of the graph in its pane, then focus moves to another file.
    panes.store.update((arrangement) => openTab(arrangement, fileKey("c.ts"), "p2", false));
    panes.store.update((arrangement) => activateTab(arrangement, fileKey("b.ts")));
    expect(mocks.requests.every((request) => request.input.path === "a.ts")).toBe(true);
    panes.store.update((arrangement) => activateTab(arrangement, localGraphKey(checkout), false));
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ path: "b.ts" }));
  });

  it("opens a clicked file in the file's pane, which takes the focus", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    await using _screen = await render(graphView(panes.host));
    await userEvent.click(page.getByRole("button", { name: "node lib.ts" }));
    const [files] = leaves(panes.current().root);
    expect(files?.active).toBe(fileKey("lib.ts"));
    expect(panes.current().focused).toBe("p1");
  });

  it("names a hovered file's import and lights that line in the file that writes it", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    await using _screen = await render(graphView(panes.host));
    await userEvent.hover(page.getByRole("button", { name: "node lib.ts" }));
    await expect.element(page.getByText("a.ts, line 3")).toBeVisible();
    await expect.element(page.getByText('import { lib } from "./lib";')).toBeVisible();
    await expect.element(page.getByText("40 lines · changed on this branch")).toBeVisible();
    expect(importLineHighlight.get()).toEqual({
      file: importLineKey({ ...checkout, path: "a.ts" }),
      line: 3,
    });
    await userEvent.unhover(page.getByRole("button", { name: "node lib.ts" }));
    await vi.waitFor(() => expect(importLineHighlight.get()).toBeNull());
  });

  it("says what uses the file is still being indexed, with its progress", async () => {
    const panes = setup((input) => ({
      data: graphOf(input.path, {
        usedByPending: true,
        status: { ...graphOf(input.path).status, state: "indexing", files: 40, totalFiles: 100 },
      }),
    }));
    await using _screen = await render(graphView(panes.host));
    await expect
      .element(
        page.getByText(
          "Indexing 40 of 100 files: the files that use this one show once it finishes.",
        ),
      )
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Graph settings" }));
    await expect.element(page.getByText("Used by · indexing 40%")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Close graph settings" }));
    await expect
      .element(page.getByRole("region", { name: "Graph settings" }))
      .not.toBeInTheDocument();
  });

  it("filters from its settings panel, narrows by a search, and restores the defaults", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    await using _screen = await render(graphView(panes.host));
    await expect.element(page.getByRole("button", { name: "node ui" })).toBeVisible();
    await expect
      .element(page.getByRole("region", { name: "Graph settings" }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Graph settings" }));
    const panel = page.getByRole("region", { name: "Graph settings" });
    await expect.element(panel).toBeVisible();

    await userEvent.click(panel.getByRole("switch", { name: "Used by" }));
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ path: "a.ts", usedBy: false }));
    await userEvent.fill(panel.getByRole("searchbox", { name: "Search files" }), "lib");
    await expect.element(page.getByRole("button", { name: "node ui" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "node lib.ts" })).toBeVisible();

    await userEvent.click(panel.getByRole("button", { name: "Restore default settings" }));
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ path: "a.ts", usedBy: true }));
    await expect.element(page.getByRole("button", { name: "node ui" })).toBeVisible();
    await expect.element(panel.getByRole("searchbox", { name: "Search files" })).toHaveValue("");
    await userEvent.click(page.getByRole("button", { name: "Graph settings" }));
    await expect.element(panel).not.toBeInTheDocument();
  });

  it("reads the graph again when the index finishes, not at each step of its progress", async () => {
    const panes = setup((input) => ({ data: graphOf(input.path) }));
    const indexing: CodeIndexStatus = {
      ...graphOf("a.ts").status,
      state: "indexing",
      files: 10,
      totalFiles: 100,
    };
    mocks.status = indexing;
    await using screen = await render(graphView(panes.host));
    await expect.element(page.getByRole("button", { name: "node ui" })).toBeVisible();

    mocks.status = { ...indexing, files: 60 };
    await screen.rerender(graphView(panes.host));
    expect(mocks.refreshes).toBe(0);

    mocks.status = { ...indexing, state: "ready", files: 100, updatedAt: "2026-10-30T08:00:00Z" };
    await screen.rerender(graphView(panes.host));
    await vi.waitFor(() => expect(mocks.refreshes).toBe(1));
  });

  it("points to Settings when the repository's index is off", async () => {
    const panes = setup(() => ({ failure: new CodeIndexError({ message: "off", reason: "off" }) }));
    await using screen = await render(graphView(panes.host));
    await userEvent.click(page.getByRole("button", { name: "Turn it on in Settings → Projects" }));
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe("/settings/projects"),
    );
  });
});
