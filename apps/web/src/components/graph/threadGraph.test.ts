import type { CodeGraphView } from "@t3tools/client-runtime/codeGraphViews";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_CODE_GRAPH_OPTIONS, rootsKey } from "../codeGraph/codeGraphData";
import { ownExpansion, threadGraphShown } from "./threadGraph";
import { INITIAL_THREAD_GRAPH } from "./threadGraphStore";

const step = (focus: string[], extra: Partial<CodeGraphView["steps"][number]> = {}) => ({
  caption: focus.join(" and "),
  focus,
  links: [],
  level: "file" as const,
  depth: 0 as const,
  expandNeighbours: [],
  showContents: [],
  ...extra,
});

const STORY: CodeGraphView = {
  id: "call-1",
  title: "How a turn starts",
  roots: ["src/ws.ts", "src/orchestrator.ts"],
  steps: [
    step(["src/ws.ts"]),
    step(["src/orchestrator.ts"], { level: "symbol", depth: 1, showContents: ["src/ws.ts"] }),
  ],
};

const shown = (state = INITIAL_THREAD_GRAPH, changed = ["b.ts", "a.ts"]) =>
  threadGraphShown({ state, views: [STORY], changed, options: DEFAULT_CODE_GRAPH_OPTIONS });

describe("a thread's Graph tab", () => {
  it("grows from the changed files, then from where the reader re-rooted it", () => {
    expect(shown().roots).toEqual(["b.ts", "a.ts"]);
    expect(shown(INITIAL_THREAD_GRAPH, []).roots).toBeNull();
    expect(shown({ ...INITIAL_THREAD_GRAPH, roots: ["lib.ts"] }).roots).toEqual(["lib.ts"]);
  });

  it("draws a view's step over all its steps' nodes, at the step's level and depth", () => {
    const second = shown({ ...INITIAL_THREAD_GRAPH, view: { id: "call-1", step: 1 } });
    expect(second).toMatchObject({
      roots: ["src/ws.ts", "src/orchestrator.ts"],
      stepIndex: 1,
      expansionKey: "call-1:1",
      options: { level: "symbol", depth: 1 },
      expansion: { contents: ["src/ws.ts"] },
    });
    // A step past the end is the last; a view no longer in the thread shows the changes.
    expect(shown({ ...INITIAL_THREAD_GRAPH, view: { id: "call-1", step: 9 } }).stepIndex).toBe(1);
    expect(shown({ ...INITIAL_THREAD_GRAPH, view: { id: "gone", step: 0 } }).roots).toEqual([
      "b.ts",
      "a.ts",
    ]);
  });

  it("keeps the reader's expansions per step, on top of the step's own, and apart from them", () => {
    const state = {
      ...INITIAL_THREAD_GRAPH,
      view: { id: "call-1", step: 1 },
      expansion: {
        key: "call-1:1",
        expansion: { neighbours: ["src/orchestrator.ts"], contents: [], collapsed: [] },
      },
    };
    const drawn = shown(state);
    expect(drawn.expansion).toEqual({
      neighbours: ["src/orchestrator.ts"],
      contents: ["src/ws.ts"],
      collapsed: [],
    });
    expect(ownExpansion(drawn.step, drawn.expansion)).toEqual(drawn.own);
    // Another step, or the changes, start without them.
    expect(shown({ ...state, view: { id: "call-1", step: 0 } }).own.neighbours).toEqual([]);
    expect(shown({ ...state, view: null }).expansionKey).toBe(rootsKey(["b.ts", "a.ts"]));
  });
});
