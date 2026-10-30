import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { EdgeAttention } from "./model/attention.ts";
import type { FileGraphData } from "./model/fileGraph.ts";
import type { FlatDrawer, FlatFrame } from "./render/flat/drawer.ts";
import type { FrameClock } from "./render/scheduler.ts";

// The file graph as Repositories drives it, on the lean renderer's own controller drawing into a
// recording drawer (happy-dom has no WebGL), its frames run by hand.

const harness = vi.hoisted(() => {
  let pending: ((now: number) => void) | null = null;
  const state = { now: 1000, last: null as FlatFrame | null };
  const clock = {
    request: (callback: (now: number) => void) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  /** Draw frames until the renderer asks for none (or `limit` frames pass); returns how many. */
  const run = (limit = 4000) => {
    let frames = 0;
    while (pending !== null && frames < limit) {
      const callback = pending;
      pending = null;
      state.now += 16;
      callback(state.now);
      frames += 1;
    }
    return frames;
  };
  return { state, clock, run, idle: () => pending === null };
});

vi.mock("./render/lean/LeanRenderer.ts", async () => {
  const { FlatRenderer } = await import("./render/flat/FlatRenderer.ts");
  const drawer: FlatDrawer = {
    setGraph: () => {},
    setLabelFont: () => {},
    draw: (frame) => {
      harness.state.last = frame;
      return 1;
    },
    resize: () => {},
    drawCalls: 1,
    edgesDrawn: 0,
    gl: null,
    memory: () => ({ textures: null, buffers: null }),
    dispose: () => {},
  };
  return {
    createLeanRenderer: (host: HTMLElement, callbacks: never) =>
      new FlatRenderer(host, callbacks, "lean", () => drawer, {
        clock: harness.clock as FrameClock,
      }),
  };
});

const { FileGraph } = await import("./FileGraph.tsx");

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every element reports a pane's size while the returned handle lives. */
function paneSized(width: number, height: number) {
  const descriptors = (["clientWidth", "clientHeight"] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of [
    ["clientWidth", width],
    ["clientHeight", height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
  return {
    [Symbol.dispose]() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor !== undefined)
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
      }
    },
  };
}

function mounted(graph: FileGraphData) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (next: FileGraphData) =>
    act(() => root.render(createElement(FileGraph, { graph: next, onOpen: () => {} })));
  show(graph);
  return {
    show,
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const node = (id: string) => ({ id, name: id, kind: "file" as const, changed: false, files: null });

const GRAPH: FileGraphData = {
  center: "app.ts",
  nodes: ["app.ts", "a.ts", "b.ts", "a1.ts", "main.ts"].map(node),
  links: [
    { from: "app.ts", to: "a.ts", guessed: false },
    { from: "app.ts", to: "b.ts", guessed: false },
    { from: "a.ts", to: "a1.ts", guessed: false },
    { from: "main.ts", to: "app.ts", guessed: false },
  ],
};

/** The edge attention each link drew at, by "from>to". */
function drawnLinks(): Map<string, number> {
  const frame = harness.state.last;
  const drawn = new Map<string, number>();
  if (frame === null) return drawn;
  for (const slot of frame.edgeStyle.lit) {
    const edge = frame.universe.edges[slot];
    const a = frame.universe.nodes[edge?.a ?? -1]?.id;
    const b = frame.universe.nodes[edge?.b ?? -1]?.id;
    if (a !== undefined && b !== undefined) {
      drawn.set([a, b].sort().join(">"), frame.edgeStyle.values[slot * 2 + 1] ?? 0);
    }
  }
  return drawn;
}

describe("a file graph", () => {
  it("settles and stops drawing, every link drawn at rest", () => {
    using _pane = paneSized(700, 500);
    using _now = vi.spyOn(performance, "now").mockImplementation(() => harness.state.now);
    using _graph = mounted(GRAPH);
    const frames = harness.run();
    expect(frames).toBeGreaterThan(0);
    expect(harness.idle()).toBe(true);
    expect(harness.run()).toBe(0);

    const links = drawnLinks();
    expect(links.size).toBe(GRAPH.links.length);
    // The centre's own links read stronger; the rest still draw.
    expect(links.get(["a.ts", "a1.ts"].sort().join(">"))).toBeCloseTo(EdgeAttention.localRest);
    expect(links.get(["app.ts", "a.ts"].sort().join(">"))).toBeCloseTo(EdgeAttention.touched);
  });

  it("draws a new graph whole when the centre moves, and rests again", () => {
    using _pane = paneSized(700, 500);
    using _now = vi.spyOn(performance, "now").mockImplementation(() => harness.state.now);
    using graph = mounted(GRAPH);
    harness.run();
    graph.show({ ...GRAPH, center: "a.ts" });
    harness.run();
    expect(harness.idle()).toBe(true);
    const frame = harness.state.last;
    const shown = frame?.universe.nodes.filter((_, slot) => frame.view.nodeVisible[slot] === 1);
    expect(shown?.map((each) => each.id).sort()).toEqual(GRAPH.nodes.map((each) => each.id).sort());
    expect(drawnLinks().size).toBe(GRAPH.links.length);
  });
});
