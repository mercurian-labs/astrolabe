import { describe, expect, it } from "vite-plus/test";

import { SpringField } from "./springs.ts";

describe("SpringField", () => {
  it("settles to rest within a bounded number of frames, without overshoot", () => {
    const field = new SpringField(1, 3, 7, 0.005);
    field.setTarget(0, [10, -4, 2]);
    let frames = 0;
    let maxX = 0;
    while (field.step(1 / 60)) {
      frames += 1;
      maxX = Math.max(maxX, field.values[0] ?? 0);
      expect(frames).toBeLessThan(240);
    }
    expect(frames).toBeGreaterThan(10);
    expect(maxX).toBeLessThanOrEqual(10);
    expect([...field.values]).toEqual([10, -4, 2]);
    expect(field.settled).toBe(true);
  });

  it("is stable for long frames", () => {
    const field = new SpringField(1, 1, 11);
    field.setScalarTarget(0, 1);
    for (let frame = 0; frame < 20 && field.step(0.5); frame += 1);
    expect(field.settled).toBe(true);
    expect(field.values[0]).toBe(1);
  });

  it("does no work when nothing is aimed anywhere new", () => {
    const field = new SpringField(4, 1, 9);
    field.setScalarTarget(2, 0);
    expect(field.activeCount).toBe(0);
    expect(field.step(1 / 60)).toBe(false);
  });

  it("holds a dragged value in place and springs a displaced one back", () => {
    const field = new SpringField(2, 1, 9);
    field.hold(0, [5]);
    expect(field.settled).toBe(true);
    expect(field.values[0]).toBe(5);
    field.displace(1, [3]);
    expect(field.settled).toBe(false);
    while (field.step(1 / 60));
    expect(field.values[1]).toBe(0);
  });
});
