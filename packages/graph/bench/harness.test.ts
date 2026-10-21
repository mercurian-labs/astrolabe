import { describe, expect, it } from "vite-plus/test";

import type { AtlasGraphHandle } from "../src/AtlasGraph.tsx";
import type { BenchDriver } from "../src/render/probe.ts";
import type { RendererStats } from "../src/render/renderer.ts";
import { REFERENCE_CHECKPOINT, reset, type BenchHost, type BenchState } from "./harness.ts";

/**
 * A graph with the view state a reset must bring back, behaving as the real
 * renderers do: a pan or zoom pauses following and drops the hover, fit
 * reframes without resuming following, a pick moves the camera to the note,
 * and a mode switch hands the paused state to the next renderer.
 */
function fakeGraph() {
  const view = { following: true, hovering: false, picked: -1, camera: "reading frame" };
  const stats: RendererStats = {
    mode: "flat",
    drawCalls: 1,
    renderMs: [0, 0],
    prepMs: [0, 0],
    framesLastSecond: 0,
    totalFrames: 1,
    animating: false,
    inView: 0,
    slots: 0,
    shown: 0,
    labels: 0,
    radiusPx: [0, 0, 0],
    edgePx: [0, 0],
    beads: 0,
  };
  const takeCamera = (camera: string) => {
    view.following = false;
    view.hovering = false;
    view.camera = camera;
  };
  const driver: BenchDriver = {
    view: () => ({ following: view.following, hovering: view.hovering, picked: view.picked }),
    sample: () => {},
    pan: (dx, dy) => takeCamera(`panned ${dx},${dy}`),
    zoom: (_x, _y, factor) => takeCamera(`zoomed ${factor}`),
    hover: (x) => {
      view.hovering = x >= 0;
    },
    screenOf: () => [0, 0],
    inView: () => [],
    gpuTiming: false,
    memory: () => ({ textures: null, buffers: null }),
  };
  const handle: AtlasGraphHandle = {
    fit: () => {
      view.camera = view.picked >= 0 ? `on ${view.picked}` : "reading frame";
    },
    resumeFollowing: () => {
      view.following = true;
      view.camera = "reading frame";
    },
    reveal: () => {},
    stats: () => stats,
    bench: () => Promise.resolve(null),
    // A pick lives in React state: it clears on the next commit, not at once.
    clearPick: () => {
      queueMicrotask(() => {
        view.picked = -1;
      });
    },
    driver: () => driver,
  };
  let state: BenchState = {
    mode: "flat",
    size: 600,
    memoryVersion: 0,
    mount: 0,
    reading: "whole",
    checkpoint: 0,
    turnRunning: false,
  };
  const host: BenchHost = {
    handle: () => handle,
    show: (next) => {
      state = next;
      return Promise.resolve();
    },
    get state() {
      return state;
    },
    thread: () => ({ id: "t", title: "t", memoryId: "m", turns: [] }),
    viewport: [1400, 900],
  };
  const pick = (index: number) => {
    view.picked = index;
    view.camera = `on ${index}`;
  };
  return { host, driver, pick, snapshot: () => ({ ...view, state: { ...state } }) };
}

describe("reset", () => {
  const histories: Record<string, (graph: ReturnType<typeof fakeGraph>) => Promise<void>> = {
    "nothing ran": async () => {},
    "a pan": async ({ driver }) => driver.pan(40, -20),
    "a zoom, then a mode switch": async ({ driver, host }) => {
      driver.zoom(700, 450, 1.4);
      await host.show({ ...host.state, mode: "pixi" });
    },
    "a hover and a pick": async ({ driver, pick }) => {
      driver.hover(300, 200);
      pick(12);
    },
    "a story": async ({ host }) =>
      host.show({ ...host.state, reading: "thread", checkpoint: 4, turnRunning: true }),
  };

  it("leaves the same state whatever ran before", async () => {
    const after = [];
    for (const [name, history] of Object.entries(histories)) {
      const graph = fakeGraph();
      await history(graph);
      await reset(graph.host, "flat", 600, 0);
      after.push({ name, snapshot: graph.snapshot() });
    }
    const first = after[0]?.snapshot;
    for (const { name, snapshot } of after) expect(snapshot, name).toEqual(first);
    expect(first).toMatchObject({
      following: true,
      hovering: false,
      picked: -1,
      camera: "reading frame",
      state: {
        mode: "flat",
        reading: "thread",
        checkpoint: REFERENCE_CHECKPOINT,
        turnRunning: false,
      },
    });
  });
});
