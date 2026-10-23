import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vite-plus/test";

import { labelGrowth } from "./labelFade.ts";
import { NodeState, prominentGrowth } from "./nodeState.ts";
import { pickNearest, PICK_SLOP, projectNode } from "./picking.ts";

describe("a hover or pick grows a note; the story never does", () => {
  it("draws a hovered note 1.4 times its radius and a prominent label 1.3 times, easing between", () => {
    const state = new NodeState(2);
    state.radius.hold(0, [5]);
    state.radius.hold(1, [5]);
    state.grow.hold(0, [1]);
    expect(state.drawnRadius(0)).toBeCloseTo(7);
    expect(state.baseRadius(0)).toBeCloseTo(5);
    // An ordinary note keeps its radius, so the no-overlap rule holds for it.
    expect(state.drawnRadius(1)).toBe(5);
    expect(prominentGrowth(0.5)).toBeCloseTo(1.2);
    expect(labelGrowth(1)).toBeCloseTo(1.3);
    expect(labelGrowth(0)).toBe(1);
    expect(labelGrowth(0.5)).toBeCloseTo(1.15);
  });

  it("keeps a story note (prominent, not hovered) at its radius", () => {
    const state = new NodeState(1);
    state.radius.hold(0, [5]);
    state.prominence.hold(0, [1]);
    expect(state.drawnRadius(0)).toBe(5);
  });

  it("picks a hovered note by its grown radius", () => {
    const camera = new PerspectiveCamera(40, 1, 0.5, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const state = new NodeState(1);
    state.radius.hold(0, [5]);
    const screen = () => [projectNode(camera, 0, 0, 0, state.drawnRadius(0), 400, 400)];
    const base = screen()[0]?.radius ?? 0;
    // Just past the ordinary hit radius: missed at rest, hit once the note is prominent.
    const x = 200 + base * PICK_SLOP * 1.2;
    expect(pickNearest(screen(), x, 200)).toBe(-1);
    state.grow.hold(0, [1]);
    expect(pickNearest(screen(), x, 200)).toBe(0);
  });
});
