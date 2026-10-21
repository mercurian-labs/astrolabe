import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vite-plus/test";

import {
  distanceToSegment,
  pickNearest,
  pickNearestIn,
  PointerTracker,
  projectInto,
  projectNode,
  PICK_SLOP,
  ScreenNodes,
} from "./picking.ts";

describe("pickNearest", () => {
  it("picks within 1.3× the drawn radius and nothing beyond", () => {
    const nodes = [{ x: 100, y: 100, radius: 10, depth: 0.5 }];
    expect(pickNearest(nodes, 100 + 10 * PICK_SLOP - 0.1, 100)).toBe(0);
    expect(pickNearest(nodes, 100 + 10 * PICK_SLOP + 0.1, 100)).toBe(-1);
  });

  it("prefers the node nearer the camera where two overlap, and skips hidden ones", () => {
    const nodes = [
      { x: 100, y: 100, radius: 10, depth: 0.8 },
      null,
      { x: 104, y: 100, radius: 10, depth: 0.2 },
    ];
    expect(pickNearest(nodes, 101, 100)).toBe(2);
  });
});

describe("projectNode", () => {
  it("lands the center in the middle and measures the drawn radius", () => {
    const camera = new PerspectiveCamera(40, 2, 0.5, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const screen = projectNode(camera, 0, 0, 0, 5, 800, 400);
    expect(screen?.x).toBeCloseTo(400);
    expect(screen?.y).toBeCloseTo(200);
    // 5 units at distance 100 under a 40° field of view on a 400px-tall canvas.
    const expected = (5 / (100 * Math.tan((20 * Math.PI) / 180))) * 200;
    expect(screen?.radius).toBeCloseTo(expected, 3);
  });

  it("returns null behind the camera", () => {
    const camera = new PerspectiveCamera(40, 1, 0.5, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(projectNode(camera, 0, 0, 200, 1, 100, 100)).toBeNull();
  });
});

describe("distanceToSegment", () => {
  it("measures to the nearest point, clamped to the ends", () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distanceToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});

describe("pickNearestIn", () => {
  it("picks like pickNearest from reused screen slots, skipping nodes not shown", () => {
    const nodes = new ScreenNodes(3);
    nodes.set(0, 100, 100, 10, 0.8);
    nodes.set(2, 104, 100, 10, 0.2);
    expect(pickNearestIn(nodes, 101, 100)).toBe(2);
    nodes.shown[2] = 0;
    expect(pickNearestIn(nodes, 101, 100)).toBe(0);
    expect(pickNearestIn(nodes, 100 + 10 * PICK_SLOP + 0.1, 100)).toBe(-1);
  });

  it("projects into a slot as projectNode does, and hides a node behind the camera", () => {
    const camera = new PerspectiveCamera(40, 2, 0.5, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const nodes = new ScreenNodes(2);
    projectInto(nodes, 0, camera, 3, -2, 0, 5, 800, 400);
    const expected = projectNode(camera, 3, -2, 0, 5, 800, 400);
    expect(nodes.x[0]).toBeCloseTo(expected?.x ?? NaN, 3);
    expect(nodes.radius[0]).toBeCloseTo(expected?.radius ?? NaN, 3);
    projectInto(nodes, 1, camera, 0, 0, 200, 1, 800, 400);
    expect(nodes.shown[1]).toBe(0);
  });
});

describe("PointerTracker", () => {
  it("counts a pointer event as a move only when the pointer's position changed", () => {
    const tracker = new PointerTracker();
    expect(tracker.moved(10, 20)).toBe(true);
    // A note gliding under a still pointer: the pointer event repeats its place, and is no move.
    expect(tracker.moved(10, 20)).toBe(false);
    expect(tracker.moved(11, 20)).toBe(true);
    tracker.reset();
    expect(tracker.moved(11, 20)).toBe(true);
  });
});
