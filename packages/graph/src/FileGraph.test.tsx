import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import type { FileGraphHandle, FileGraphProps } from "./FileGraph.tsx";
import type { FileGraphData, FileGraphNode } from "./model/fileGraph.ts";
import { DEFAULT_FILE_GRAPH_SETTINGS, type FileGraphSettings } from "./model/fileGraphSettings.ts";
import type { FileGraphFrame } from "./render/file/FileGraphRenderer.ts";

// The file graph as Repositories drives it, its frames handed to a recording drawer (happy-dom has
// no WebGL) and run by hand.

const harness = vi.hoisted(() => {
  let pending: ((now: number) => void) | null = null;
  const state = { now: 1000, frames: [] as Array<FileGraphFrame> };
  const clock = {
    request: (callback: (now: number) => void) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  /** Draw frames until the graph asks for none (or `limit` frames pass); returns how many. */
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

vi.mock("./render/scheduler.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/scheduler.ts")>()),
  browserClock: harness.clock,
}));

vi.mock("./render/file/pixiFileDrawer.ts", () => ({
  createPixiFileDrawer: () => ({
    resize: () => {},
    draw: (frame: FileGraphFrame) => harness.state.frames.push(frame),
    dispose: () => {},
  }),
}));

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

function mounted(graph: FileGraphData, settings: FileGraphSettings = DEFAULT_FILE_GRAPH_SETTINGS) {
  harness.state.frames.length = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onOpen = vi.fn<FileGraphProps["onOpen"]>();
  const onHover = vi.fn<NonNullable<FileGraphProps["onHover"]>>();
  const ref = createRef<FileGraphHandle>();
  const show = (next: FileGraphData, nextSettings = settings) =>
    act(() =>
      root.render(
        createElement(FileGraph, { graph: next, settings: nextSettings, onOpen, onHover, ref }),
      ),
    );
  show(graph);
  const canvas = () => host.querySelector(".file-graph") as HTMLElement;
  return {
    show,
    onOpen,
    onHover,
    ref,
    /** A pointer event at a point of the frame. */
    pointer: (type: string, x: number, y: number, init: PointerEventInit = {}) =>
      act(() => {
        canvas().dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            button: 0,
            ...init,
          }),
        );
      }),
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const last = () => harness.state.frames.at(-1) ?? null;

/** Where a node is drawn in the last frame, in CSS pixels. */
function screenOf(id: string) {
  const frame = last();
  const node = frame?.nodes.find((each) => each.id === id);
  if (frame === null || node === undefined) throw new Error(`${id} is not drawn`);
  const { camera } = frame;
  return {
    x: (node.x - camera.x) * camera.zoom + frame.width / 2,
    y: (node.y - camera.y) * camera.zoom + frame.height / 2,
  };
}

const drawn = (id: string) => last()?.nodes.find((each) => each.id === id);

const node = (id: string, extra: Partial<FileGraphNode> = {}): FileGraphNode => ({
  id,
  name: id,
  kind: "file",
  changed: false,
  test: false,
  files: null,
  group: null,
  ...extra,
});

const GRAPH: FileGraphData = {
  center: "app.ts",
  nodes: ["app.ts", "a.ts", "b.ts", "a1.ts", "main.ts"].map((id) => node(id)),
  links: [
    { from: "app.ts", to: "a.ts", guessed: false },
    { from: "app.ts", to: "b.ts", guessed: false },
    { from: "a.ts", to: "a1.ts", guessed: false },
    { from: "main.ts", to: "app.ts", guessed: false },
  ],
};

describe("a file graph", () => {
  it("settles and stops drawing, every link drawn at rest, the centre in the accent", () => {
    using _pane = paneSized(700, 500);
    using _graph = mounted(GRAPH);
    harness.run();
    expect(harness.idle()).toBe(true);
    const frames = harness.state.frames.length;
    expect(frames).toBeGreaterThan(0);
    expect(harness.run()).toBe(0);
    expect(harness.state.frames).toHaveLength(frames);

    const frame = last();
    expect(frame?.links).toHaveLength(GRAPH.links.length);
    expect(frame?.links.every((link) => link.alpha === 1 && !link.arrow)).toBe(true);
    expect(new Set(frame?.links.map((link) => link.color)).size).toBe(1);
    const centre = drawn("app.ts");
    expect(centre?.fill).not.toBe(drawn("a.ts")?.fill);
    expect(drawn("b.ts")?.fill).toBe(drawn("a.ts")?.fill);
    // The centre has the most links, so it is the largest.
    expect(centre?.radius).toBeGreaterThan(drawn("b.ts")?.radius ?? Infinity);
  });

  it("keeps its picture when handed an equal graph, as a host reading again does", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const frames = harness.state.frames.length;
    graph.show({ ...GRAPH, nodes: GRAPH.nodes.map((each) => ({ ...each })) });
    expect(harness.run()).toBe(0);
    expect(harness.state.frames).toHaveLength(frames);
  });

  it("repaints in place when only how a node looks changes, as a group's colour does", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const before = last();
    graph.show({
      ...GRAPH,
      nodes: GRAPH.nodes.map((each) => (each.id === "b.ts" ? { ...each, group: 0 } : each)),
    });
    expect(harness.run()).toBe(1);
    const after = last();
    expect(after?.nodes.map(({ x, y }) => [x, y])).toEqual(before?.nodes.map(({ x, y }) => [x, y]));
    expect(drawn("b.ts")?.fill).not.toBe(drawn("a.ts")?.fill);
  });

  it("draws a new graph whole when the centre moves, framed, and rests again", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    graph.show({ ...GRAPH, center: "a.ts" });
    harness.run();
    expect(harness.idle()).toBe(true);
    const frame = last();
    expect(frame?.nodes.map((each) => each.id).toSorted()).toEqual(
      GRAPH.nodes.map((each) => each.id).toSorted(),
    );
    expect(frame?.links).toHaveLength(GRAPH.links.length);
    for (const each of GRAPH.nodes) {
      const at = screenOf(each.id);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(700);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(500);
    }
  });

  it("grows around the same file without moving what it kept to a new frame", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const camera = last()?.camera;
    graph.show({
      ...GRAPH,
      nodes: [...GRAPH.nodes, node("b1.ts")],
      links: [...GRAPH.links, { from: "b.ts", to: "b1.ts", guessed: false }],
    });
    // The new file finds its place as the forces run, then the graph rests.
    expect(harness.run()).toBeGreaterThan(1);
    expect(harness.idle()).toBe(true);
    expect(last()?.camera).toEqual(camera);
    expect(drawn("b1.ts")).toBeDefined();
  });

  it("unfolds a folder's files where the folder stood", () => {
    using _pane = paneSized(700, 500);
    const folded: FileGraphData = {
      ...GRAPH,
      nodes: [...GRAPH.nodes, node("src/ui", { kind: "folder", files: 2 })],
      links: [...GRAPH.links, { from: "app.ts", to: "src/ui", guessed: false }],
    };
    using graph = mounted(folded);
    harness.run();
    const folder = drawn("src/ui");
    graph.show({
      ...GRAPH,
      nodes: [...GRAPH.nodes, node("src/ui/a.tsx"), node("src/ui/b.tsx")],
      links: [
        ...GRAPH.links,
        { from: "app.ts", to: "src/ui/a.tsx", guessed: false },
        { from: "app.ts", to: "src/ui/b.tsx", guessed: false },
      ],
    });
    harness.run(1);
    for (const id of ["src/ui/a.tsx", "src/ui/b.tsx"]) {
      const at = drawn(id);
      expect(
        Math.hypot((at?.x ?? 0) - (folder?.x ?? 0), (at?.y ?? 0) - (folder?.y ?? 0)),
      ).toBeLessThan(50);
    }
    harness.run();
    expect(harness.idle()).toBe(true);
  });

  it("draws plain dots, a folded folder lighter, and changed files amber only when asked", () => {
    using _pane = paneSized(700, 500);
    const changed: FileGraphData = {
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes.map((each) =>
          each.id === "app.ts" || each.id === "b.ts" ? { ...each, changed: true } : each,
        ),
        node("src/ui", { kind: "folder", files: 9 }),
      ],
      links: [...GRAPH.links, { from: "app.ts", to: "src/ui", guessed: false }],
    };
    using graph = mounted(changed);
    harness.run();
    const file = drawn("a.ts")?.fill;
    const accent = drawn("app.ts")?.fill;
    expect(drawn("b.ts")?.fill).toBe(file);
    expect(drawn("src/ui")?.fill).not.toBe(file);

    graph.show(changed, { ...DEFAULT_FILE_GRAPH_SETTINGS, changedFiles: true });
    harness.run();
    expect(drawn("b.ts")?.fill).not.toBe(file);
    expect(drawn("b.ts")?.fill).not.toBe(accent);
    expect(drawn("a.ts")?.fill).toBe(file);
    // The centre stays in the accent, changed or not.
    expect(drawn("app.ts")?.fill).toBe(accent);
  });

  it("hides a crowded label at rest until a hover or the zoom makes room, then rests", () => {
    using _pane = paneSized(700, 500);
    const leaves = Array.from({ length: 30 }, (_, at) => `feature-${at}/someLongFileName.ts`);
    const crowded: FileGraphData = {
      center: "hub.ts",
      nodes: [
        node("hub.ts"),
        node("apps/web/src", { kind: "folder", files: 500 }),
        ...leaves.map((id) => node(id)),
      ],
      links: ["apps/web/src", ...leaves].map((from) => ({ from, to: "hub.ts", guessed: false })),
    };
    using graph = mounted(crowded);
    harness.run();
    const shown = () => (last()?.nodes ?? []).filter((each) => each.labelAlpha > 0.5).length;
    expect(drawn("hub.ts")?.labelAlpha).toBe(1);
    expect(drawn("apps/web/src")?.labelAlpha).toBe(1);
    const hidden = leaves.find((id) => drawn(id)?.labelAlpha === 0);
    expect(hidden).toBeDefined();
    const atRest = shown();

    const at = screenOf(hidden ?? "");
    graph.pointer("pointermove", at.x, at.y);
    harness.run();
    expect(drawn(hidden ?? "")?.labelAlpha).toBe(1);
    expect(drawn("hub.ts")?.labelAlpha).toBe(1);
    graph.pointer("pointerleave", 0, 0);
    harness.run();
    expect(drawn(hidden ?? "")?.labelAlpha).toBe(0);

    const centre = screenOf("hub.ts");
    const wheel = new WheelEvent("wheel", { deltaY: -600, bubbles: true });
    Object.defineProperties(wheel, {
      clientX: { value: centre.x },
      clientY: { value: centre.y },
      ctrlKey: { value: false },
    });
    act(() => {
      document.querySelector(".file-graph")?.dispatchEvent(wheel);
    });
    harness.run();
    expect(harness.idle()).toBe(true);
    expect(shown()).toBeGreaterThan(atRest);
    expect(last()?.nodes.every((each) => each.labelAlpha === 0 || each.labelAlpha === 1)).toBe(
      true,
    );
  });

  it("lights a hovered node, its neighbours and their links, fades the rest, and names it", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const accent = drawn("app.ts")?.fill;
    const at = screenOf("a.ts");
    graph.pointer("pointermove", at.x, at.y);
    expect(graph.onHover).toHaveBeenLastCalledWith({ id: "a.ts", x: at.x, y: at.y });
    harness.run();
    expect(harness.idle()).toBe(true);

    for (const id of ["a.ts", "a1.ts", "app.ts"]) {
      expect(drawn(id)?.fill).toBe(accent);
      expect(drawn(id)?.alpha).toBe(1);
    }
    for (const id of ["b.ts", "main.ts"]) expect(drawn(id)?.alpha).toBeLessThan(0.5);
    const links = last()?.links ?? [];
    expect(links.filter((link) => link.color === accent)).toHaveLength(2);
    expect(links.filter((link) => link.alpha < 0.5)).toHaveLength(2);

    graph.pointer("pointerleave", 0, 0);
    expect(graph.onHover).toHaveBeenLastCalledWith(null);
    harness.run();
    expect(last()?.nodes.every((each) => each.alpha === 1)).toBe(true);
  });

  it("opens a clicked file, in a new tab with ⌘ held, and never after a drag", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const at = screenOf("b.ts");
    graph.pointer("pointerdown", at.x, at.y);
    graph.pointer("pointerup", at.x, at.y);
    expect(graph.onOpen).toHaveBeenLastCalledWith("b.ts", false);
    graph.pointer("pointerdown", at.x, at.y, { metaKey: true });
    graph.pointer("pointerup", at.x, at.y, { metaKey: true });
    expect(graph.onOpen).toHaveBeenLastCalledWith("b.ts", true);

    graph.onOpen.mockClear();
    graph.pointer("pointerdown", at.x, at.y);
    graph.pointer("pointermove", at.x + 60, at.y + 40);
    harness.run(5);
    expect(harness.idle()).toBe(false);
    graph.pointer("pointerup", at.x + 60, at.y + 40);
    harness.run();
    expect(harness.idle()).toBe(true);
    expect(graph.onOpen).not.toHaveBeenCalled();
    // The dragged file moved towards where it was let go.
    expect(screenOf("b.ts").x).toBeGreaterThan(at.x + 10);
  });

  it("pans with a drag on the paper and zooms at the pointer with the wheel", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    const before = last()?.camera;
    graph.pointer("pointerdown", 5, 5);
    graph.pointer("pointermove", 105, 5);
    graph.pointer("pointerup", 105, 5);
    harness.run();
    const panned = last()?.camera;
    expect(panned?.x).toBeCloseTo((before?.x ?? 0) - 100 / (before?.zoom ?? 1));
    expect(graph.onOpen).not.toHaveBeenCalled();

    const at = screenOf("main.ts");
    const wheel = new WheelEvent("wheel", { deltaY: -200, bubbles: true });
    // happy-dom's WheelEvent drops a mouse event's fields.
    Object.defineProperties(wheel, {
      clientX: { value: at.x },
      clientY: { value: at.y },
      ctrlKey: { value: false },
    });
    act(() => {
      document.querySelector(".file-graph")?.dispatchEvent(wheel);
    });
    harness.run();
    expect(last()?.camera.zoom).toBeGreaterThan(panned?.zoom ?? Infinity);
    const after = screenOf("main.ts");
    expect(after.x).toBeCloseTo(at.x);
    expect(after.y).toBeCloseTo(at.y);
  });

  it("replays its layout on Animate and rests again", () => {
    using _pane = paneSized(700, 500);
    using graph = mounted(GRAPH);
    harness.run();
    act(() => graph.ref.current?.animate());
    expect(harness.run()).toBeGreaterThan(10);
    expect(harness.idle()).toBe(true);
  });
});
