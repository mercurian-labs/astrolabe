import { describe, expect, it, vi } from "vite-plus/test";

import { FrameTimer, handover, releaseRenderer } from "./renderer.ts";

describe("handover", () => {
  it("carries a paused follow through every switch, and the flat view only between flat renderers", () => {
    const view = { x: 4, y: -2, scale: 1.5 };
    // Paused in Lean, then to 3D: the view cannot carry, the pause does.
    const toThreeD = handover({ view, following: false }, false);
    expect(toThreeD).toEqual({ view: null, following: false });
    // The 3D renderer, still paused, leaves no flat view; on to Pixi, still paused.
    const toPixi = handover({ view: null, following: toThreeD?.following ?? true }, true);
    expect(toPixi).toEqual({ view: null, following: false });
    // Flat to flat carries both.
    expect(handover({ view, following: true }, true)).toEqual({ view, following: true });
    expect(handover(null, true)).toBeNull();
  });
});

describe("releaseRenderer", () => {
  it("disposes the renderer, then forces its WebGL context lost, then drops its canvas", () => {
    const order: Array<string> = [];
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    releaseRenderer({
      dispose: vi.fn(() => order.push("dispose")),
      forceContextLoss: vi.fn(() => order.push("forceContextLoss")),
      domElement: canvas,
    });
    expect(order).toEqual(["dispose", "forceContextLoss"]);
    expect(canvas.isConnected).toBe(false);
  });
});

describe("FrameTimer", () => {
  it("keeps the render call and the preparation apart, over the last 60 frames", () => {
    const timer = new FrameTimer();
    timer.record();
    for (let frame = 0; frame < 70; frame += 1) timer.add(frame < 10 ? 100 : 2, 5);
    expect(timer.render).toEqual([2, 2]);
    expect(timer.prep).toEqual([5, 5]);
    const bench = timer.stop();
    expect(bench.frames).toBe(70);
    expect(bench.maxMs).toBe(100);
    expect(bench.prepMeanMs).toBe(5);
  });
});
