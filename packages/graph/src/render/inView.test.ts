import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { classifyInView, classifyInViewRect, flatViewRect } from "./inView.ts";

describe("classifyInView", () => {
  const camera = new PerspectiveCamera(40, 1, 0.5, 5000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  const points = [
    new Vector3(0, 0, 0), // in front, centred
    new Vector3(0, 0, 200), // behind the camera
    new Vector3(0, 0, -500), // 600 deep, past fade-far at 300
    new Vector3(38, 0, 0), // just outside the frustum edge, inside the margin
    new Vector3(400, 0, 0), // far off to the side
    new Vector3(0, 10, 0), // in front but hidden by the view
  ];
  const classify = () => {
    const out = new Uint8Array(points.length);
    const count = classifyInView(
      camera,
      points.length,
      (index, target) => target.copy(points[index] ?? new Vector3()),
      () => 1,
      (index) => index !== 5,
      300,
      out,
    );
    return { out: [...out], count };
  };

  it("keeps what the camera can see and drops what is behind it or past fade-far", () => {
    const { out, count } = classify();
    expect(out).toEqual([1, 0, 0, 1, 0, 0]);
    expect(count).toBe(2);
  });

  it("keeps a node with no cut in view past fade-far", () => {
    const out = new Uint8Array(points.length);
    classifyInView(
      camera,
      points.length,
      (index, target) => target.copy(points[index] ?? new Vector3()),
      () => 1,
      (index) => index !== 5,
      (index) => (index === 2 ? Infinity : 300),
      out,
    );
    expect([...out]).toEqual([1, 0, 1, 1, 0, 0]);
  });
});

describe("classifyInViewRect", () => {
  const points = [
    new Vector3(0, 0, 0), // centred
    new Vector3(52, 0, 0), // just past the right edge, inside the margin
    new Vector3(0, 70, 0), // well above
    new Vector3(-58, 0, 0), // past the margin, but its disc reaches in
    new Vector3(0, 0, 900), // depth does not matter in the flat reading
    new Vector3(5, 5, 0), // in view but hidden
  ];
  const radii = [1, 1, 1, 4, 1, 1];

  it("keeps a node whose disc meets the shown rectangle widened by the margin, at any depth", () => {
    // A 100 × 100 px canvas at 1 px per unit around the origin shows x and y in −50…50.
    const rect = flatViewRect({ x: 0, y: 0, scale: 1 }, 100, 100);
    expect(rect).toEqual({ minX: -50, maxX: 50, minY: -50, maxY: 50 });
    const out = new Uint8Array(points.length);
    const count = classifyInViewRect(
      points.length,
      (index, target) => target.copy(points[index] ?? new Vector3()),
      (index) => radii[index] ?? 1,
      (index) => index !== 5,
      rect,
      out,
    );
    expect([...out]).toEqual([1, 1, 0, 1, 1, 0]);
    expect(count).toBe(4);
  });

  it("follows the flat view's centre and scale", () => {
    const rect = flatViewRect({ x: 100, y: -20, scale: 2 }, 400, 200);
    expect(rect).toEqual({ minX: 0, maxX: 200, minY: -70, maxY: 30 });
  });
});
