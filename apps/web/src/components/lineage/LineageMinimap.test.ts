import { describe, expect, it } from "vite-plus/test";

import { minimapBox, minimapScroll } from "./LineageMinimap";

describe("the minimap's box and scroll", () => {
  it("boxes the part a scroll area shows, scaled to the strip, or all of it when it fits", () => {
    // A 2000px drawing seen 400px at a time from 1000px, on a 200px strip.
    expect(minimapBox(1000, 2000, 400, 200)).toEqual({ start: 100, size: 40 });
    expect(minimapBox(0, 300, 400, 200)).toEqual({ start: 0, size: 200 });
  });

  it("centres the view on the point pressed, held inside the content", () => {
    expect(minimapScroll(0.5, 2000, 400)).toBe(800);
    expect(minimapScroll(0.02, 2000, 400)).toBe(0);
    expect(minimapScroll(1.4, 2000, 400)).toBe(1600);
    expect(minimapScroll(0.5, 300, 400)).toBe(0);
  });
});
