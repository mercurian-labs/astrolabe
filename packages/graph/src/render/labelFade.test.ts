import { describe, expect, it } from "vite-plus/test";

import { labelOpacity, prominentOpacity } from "./labelFade.ts";

const fade = { near: 100, far: 300, strength: 1 };

describe("labelOpacity", () => {
  it("fades with distance and returns as the camera comes closer", () => {
    const far = labelOpacity(250, fade, 1, 1, false);
    const near = labelOpacity(120, fade, 1, 1, false);
    expect(near).toBeGreaterThan(far);
    expect(labelOpacity(90, fade, 1, 1, false)).toBe(1);
    expect(labelOpacity(400, fade, 1, 1, false)).toBe(0);
    // At the far edge a label keeps what the strength leaves; past it, it is off.
    expect(labelOpacity(300, { ...fade, strength: 0.95 }, 1, 1, false)).toBeCloseTo(0.05);
    expect(labelOpacity(301, { ...fade, strength: 0.95 }, 1, 1, false)).toBe(0);
  });

  it("keeps every label at fade 0, and quiets receded notes", () => {
    expect(labelOpacity(10_000, { ...fade, strength: 0 }, 1, 1, false)).toBe(1);
    expect(labelOpacity(90, fade, 1, 0.3, false)).toBeLessThan(0.6);
  });

  it("holds a hovered or worked note's label whatever the distance, and hides hidden notes", () => {
    expect(labelOpacity(10_000, fade, 1, 0.2, true)).toBeGreaterThan(0.9);
    expect(labelOpacity(90, fade, 0, 1, true)).toBe(0);
  });

  it("draws a story note's label in full past the cutoff, easing back as the story falls", () => {
    const beyond = labelOpacity(400, fade, 1, 0.3, false);
    expect(beyond).toBe(0);
    expect(prominentOpacity(beyond, 1, 1)).toBe(1);
    expect(prominentOpacity(beyond, 1, 0.5)).toBe(0.5);
    expect(prominentOpacity(beyond, 1, 0)).toBe(0);
    expect(prominentOpacity(0.4, 0, 1)).toBe(0);
  });
});
