import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import {
  drawnRadius,
  layoutSpan,
  layoutUniverse,
  medianNearestNeighbour,
} from "../layout/forceLayout.ts";
import { GatheringCache } from "../layout/gatheredReading.ts";
import type { Point } from "../layout/gathering.ts";
import { readingAt, threadUniverse } from "../model/reading.ts";
import { NO_FILTERS } from "../model/search.ts";
import { DEFAULT_SETTINGS } from "../model/settings.ts";
import { buildUniverse } from "../model/universe.ts";
import { denseView } from "../model/view.ts";
import {
  clampView,
  densityDistance,
  densityView,
  densityZoom,
  fitDistance,
  fitZoom,
  flatToScreen,
  flatToWorld,
  flatViewAt,
  orthoScale,
  orthoZoomFor,
  zoomFlatAt,
  FOLLOW_CONE,
  FOLLOW_ROOM,
  followFlatView,
  followView,
  READING_PIXELS,
  readingFrame,
  viewAt,
  zoomLimits,
  type CameraView,
} from "./camera.ts";
import { classifyInView } from "./inView.ts";

const view: CameraView = {
  position: new Vector3(0, 0, 100),
  target: new Vector3(0, 0, 0),
  zoom: 1,
};

describe("followView", () => {
  it("stays put when the risen notes are already forward", () => {
    expect(followView(view, [new Vector3(5, 5, 40)])).toBeNull();
  });

  it("turns just enough to bring them to the edge of the cone, keeping distance and target", () => {
    const next = followView(view, [new Vector3(50, 0, 0)]);
    expect(next).not.toBeNull();
    if (next === null) return;
    const offset = next.position.clone().sub(next.target);
    expect(offset.length()).toBeCloseTo(100);
    expect(next.target.equals(view.target)).toBe(true);
    expect(offset.angleTo(new Vector3(1, 0, 0))).toBeCloseTo(FOLLOW_CONE, 5);
  });
});

describe("followView at the edge of the web", () => {
  it("stays put for a note at the target", () => {
    expect(followView(view, [new Vector3(0.5, 0, 0)])).toBeNull();
  });

  it("steps back rather than let a far note pass behind the camera", () => {
    const next = followView(view, [new Vector3(0, 0, 90)]);
    expect(next).not.toBeNull();
    expect(next?.position.z).toBeCloseTo(90 * FOLLOW_ROOM);
  });
});

describe("followFlatView", () => {
  it("pans only as far as needed", () => {
    const flat: CameraView = { position: new Vector3(0, 0, 500), target: new Vector3(), zoom: 2 };
    expect(followFlatView(flat, [new Vector3(10, 0, 0)], 20)).toBeNull();
    const next = followFlatView(flat, [new Vector3(50, 0, 0)], 20);
    expect(next?.target.x).toBeCloseTo(30);
    expect(next?.position.z).toBe(500);
  });
});

describe("viewAt", () => {
  it("starts and lands exactly, and keeps distance through a turn", () => {
    const to: CameraView = { position: new Vector3(100, 0, 0), target: new Vector3(), zoom: 1 };
    expect(viewAt(view, to, 0).position.distanceTo(view.position)).toBeCloseTo(0);
    expect(viewAt(view, to, 1).position.distanceTo(to.position)).toBeCloseTo(0);
    expect(viewAt(view, to, 0.5).position.length()).toBeCloseTo(100);
  });
});

describe("the reading density", () => {
  it("spans one link distance over 96 pixels at the target plane", () => {
    const distance = densityDistance(40, 800, 40);
    // At that distance, the view's height in world units is 800 px' worth.
    const worldHeight = 2 * distance * Math.tan((20 * Math.PI) / 180);
    expect((40 / worldHeight) * 800).toBeCloseTo(READING_PIXELS);
    const zoom = densityZoom(40, 800, 600);
    expect((40 / (600 / zoom)) * 800).toBeCloseTo(READING_PIXELS);
  });

  it("frames a target at that distance along the camera's direction", () => {
    const next = densityView(new Vector3(10, 0, 0), new Vector3(0, 0, 5), 200);
    expect(next.position.toArray()).toEqual([10, 0, 200]);
    expect(next.target.toArray()).toEqual([10, 0, 0]);
  });
});

describe("clampView", () => {
  const limits = { minDistance: 50, maxDistance: 400, minZoom: 0.5, maxZoom: 8 };

  it("pulls a perspective view back inside its distance limits, keeping direction", () => {
    const tooFar: CameraView = { position: new Vector3(0, 0, 800), target: new Vector3(), zoom: 1 };
    expect(clampView(tooFar, limits, false)?.position.toArray()).toEqual([0, 0, 400]);
    const tooNear: CameraView = { position: new Vector3(0, 30, 0), target: new Vector3(), zoom: 1 };
    expect(clampView(tooNear, limits, false)?.position.toArray()).toEqual([0, 50, 0]);
    expect(clampView(view, limits, false)).toBeNull();
  });

  it("clamps an orthographic zoom", () => {
    const zoomed: CameraView = {
      position: new Vector3(0, 0, 500),
      target: new Vector3(),
      zoom: 16,
    };
    expect(clampView(zoomed, limits, true)?.zoom).toBe(8);
    expect(clampView({ ...zoomed, zoom: 2 }, limits, true)).toBeNull();
  });
});

describe("framing the gathered reading", () => {
  const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
  const layout = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
  const { linkDistance, nodeSize } = DEFAULT_SETTINGS;
  const context = {
    memory: almagest,
    thread: ATLAS_THREAD,
    universe,
    layout,
    settings: DEFAULT_SETTINGS,
    thisTurnOnly: false,
    filters: NO_FILTERS,
  };
  const gatherings = new GatheringCache();
  const origin: Point = [0, 0, 0];
  const frameAt = (checkpoint: number) => {
    const gathering = gatherings.at(context, checkpoint);
    const view = denseView({
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, checkpoint, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const members = [...gathering.positions.keys()];
    const places = members.map((index) => gathering.positions.get(index) ?? origin);
    const radius = (index: number) =>
      drawnRadius(view.nodeDegree[index] ?? 0, nodeSize, layoutSpan(layout, linkDistance), 34);
    const frame = readingFrame(places, (slot) => radius(members[slot] ?? -1));
    return { frame, members, places, radius };
  };

  it("measures the density span and target where the reading settles, not at the notes' homes", () => {
    const { frame, members, places } = frameAt(0);
    expect(members).toHaveLength(14);
    expect(frame).not.toBeNull();
    if (frame === null) return;
    const settled = medianNearestNeighbour(new Float32Array(places.flat()));
    expect(frame.span).toBeCloseTo(settled);
    const homes = new Float32Array(
      members.flatMap((index) => [...layout.positions.subarray(index * 3, index * 3 + 3)]),
    );
    expect(frame.span).not.toBeCloseTo(medianNearestNeighbour(homes), 0);
    // Every settled note lies within the extent of the target.
    for (const place of places) {
      expect(frame.target.distanceTo(new Vector3(...place))).toBeLessThanOrEqual(frame.extent);
    }
  });

  it("holds every gathered note in view at the reading density, at every checkpoint and viewport", () => {
    for (const [width, height] of [
      [1400, 800],
      [700, 900],
    ] as const) {
      for (let checkpoint = 0; checkpoint < ATLAS_THREAD.turns.length; checkpoint += 1) {
        const { frame, members, places, radius } = frameAt(checkpoint);
        if (frame === null) throw new Error("the reading is empty");
        const span = Math.max(frame.span, 0.5 * linkDistance);
        const distance = Math.max(
          densityDistance(span, height, 40),
          fitDistance(frame.extent, width, height, 40),
        );
        const view = densityView(frame.target, new Vector3(), distance);
        const camera = new PerspectiveCamera(40, width / height, 0.5, 20000);
        camera.position.copy(view.position);
        camera.lookAt(view.target);
        const inView = new Uint8Array(universe.nodes.length);
        const slotOf = new Map(members.map((index, slot) => [index, slot]));
        const count = classifyInView(
          camera,
          universe.nodes.length,
          (index, out) => out.set(...(places[slotOf.get(index) ?? -1] ?? origin)),
          radius,
          (index) => slotOf.has(index),
          distance + 4 * span,
          inView,
          0,
        );
        expect({ checkpoint, width, count }).toEqual({ checkpoint, width, count: members.length });
      }
    }
  });

  it("extends the far zoom limit to the fit, so a narrow viewport's frame is never clamped back in", () => {
    const [width, height] = [100, 900];
    const checkpoint = ATLAS_THREAD.turns.length - 1;
    const { frame, members, places, radius } = frameAt(checkpoint);
    if (frame === null) throw new Error("the reading is empty");
    const span = Math.max(frame.span, 0.5 * linkDistance);
    const density = densityDistance(span, height, 40);
    const fit = fitDistance(frame.extent, width, height, 40);
    expect(fit).toBeGreaterThan(4 * density);
    const limits = zoomLimits({
      densityDistance: density,
      densityZoom: 2,
      fitDistance: fit,
      fitZoom: 0.1,
    });
    expect(limits.maxDistance).toBe(fit);
    expect(limits.minDistance).toBe(density / 4);
    expect(limits.minZoom).toBe(0.1);
    expect(limits.maxZoom).toBe(8);

    // The framed view sits inside the limits, so clamping leaves it where it is...
    const framed = densityView(frame.target, new Vector3(), Math.max(density, fit));
    expect(clampView(framed, limits, false)).toBeNull();
    // ...and from there every gathered note is in view.
    const camera = new PerspectiveCamera(40, width / height, 0.5, 20000);
    camera.position.copy(framed.position);
    camera.lookAt(framed.target);
    const slotOf = new Map(members.map((index, slot) => [index, slot]));
    const count = classifyInView(
      camera,
      universe.nodes.length,
      (index, out) => out.set(...(places[slotOf.get(index) ?? -1] ?? origin)),
      radius,
      (index) => slotOf.has(index),
      Infinity,
      new Uint8Array(universe.nodes.length),
      0,
    );
    expect(count).toBe(members.length);
  });

  it("keeps the density's limits when the reading fits inside them", () => {
    const limits = zoomLimits({
      densityDistance: 500,
      densityZoom: 2,
      fitDistance: 300,
      fitZoom: 5,
    });
    expect(limits).toEqual({ minDistance: 125, maxDistance: 2000, minZoom: 0.5, maxZoom: 8 });
  });

  it("stands back past the density only as far as a large reading needs", () => {
    expect(fitDistance(0, 1400, 800, 40)).toBe(0);
    const tall = fitDistance(100, 1400, 800, 40);
    expect(tall).toBeCloseTo((100 * 1.1) / Math.sin((20 * Math.PI) / 180));
    // A portrait viewport is limited by its width.
    expect(fitDistance(100, 400, 800, 40)).toBeGreaterThan(tall);
    expect(fitZoom(0, 200, 100)).toBe(Infinity);
    expect(fitZoom(50, 200, 100)).toBeCloseTo(100 / 110);
  });
});

describe("the flat view across renderer families", () => {
  const [width, height] = [800, 600];
  const project = (camera: OrthographicCamera, x: number, y: number) => {
    const ndc = new Vector3(x, y, 0).project(camera);
    return [((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height];
  };

  it("draws every world point at the same pixel under the Atlas flat camera and a flat view", () => {
    const half = 300;
    const camera = new OrthographicCamera(
      (-half * width) / height,
      (half * width) / height,
      half,
      -half,
      0.1,
      5000,
    );
    camera.zoom = 2.5;
    camera.position.set(40, -12, 100);
    camera.lookAt(40, -12, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const view = { x: 40, y: -12, scale: orthoScale(camera.zoom, 2 * half, height) };
    for (const [x, y] of [
      [40, -12],
      [90, 30],
      [-60, -80],
    ] as const) {
      const [sx, sy] = project(camera, x, y);
      const [fx, fy] = flatToScreen(view, width, height, x, y);
      expect(fx).toBeCloseTo(sx ?? 0, 4);
      expect(fy).toBeCloseTo(sy ?? 0, 4);
    }
    // And back: the zoom that spans the view's scale is the camera's.
    expect(orthoZoomFor(view.scale, 2 * half, height)).toBeCloseTo(2.5);
  });

  it("maps a pixel to its world point and back, and zooms about the pointer", () => {
    const view = { x: 10, y: 20, scale: 3 };
    const [wx, wy] = flatToWorld(view, width, height, 123, 456);
    const [sx, sy] = flatToScreen(view, width, height, wx, wy);
    expect(sx).toBeCloseTo(123);
    expect(sy).toBeCloseTo(456);
    const zoomed = zoomFlatAt(view, width, height, 123, 456, 6);
    const [zx, zy] = flatToScreen(zoomed, width, height, wx, wy);
    expect(zx).toBeCloseTo(123);
    expect(zy).toBeCloseTo(456);
    expect(zoomed.scale).toBe(6);
  });

  it("eases a flat flight from one view to another, scale moving geometrically", () => {
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: 100, y: 50, scale: 4 };
    expect(flatViewAt(from, to, 0)).toEqual(from);
    expect(flatViewAt(from, to, 1)).toEqual(to);
    expect(flatViewAt(from, to, 0.5).scale).toBeCloseTo(2);
  });
});
