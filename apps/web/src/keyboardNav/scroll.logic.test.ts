import { describe, expect, it } from "vite-plus/test";

import { canScroll, mainScrollArea, scrollDistance } from "./scroll.logic";

describe("mainScrollArea", () => {
  it("is the scroll area showing largest in the place", () => {
    // The chat column: its timeline, and a long draft in the composer.
    expect(
      mainScrollArea([
        { area: "composer", visibleArea: 600 * 120 },
        { area: "timeline", visibleArea: 600 * 700 },
      ]),
    ).toBe("timeline");
  });

  it("passes over one scrolled out of sight, and finds none in a place that does not scroll", () => {
    expect(
      mainScrollArea([
        { area: "offscreen", visibleArea: 0 },
        { area: "outline", visibleArea: 200 * 300 },
      ]),
    ).toBe("outline");
    expect(mainScrollArea([{ area: "offscreen", visibleArea: 0 }])).toBeNull();
    expect(mainScrollArea([])).toBeNull();
  });
});

describe("canScroll", () => {
  const page = { scrollHeight: 3000, clientHeight: 800 };

  it("goes down until the end and up until the top", () => {
    expect(canScroll({ ...page, scrollTop: 0 }, "down")).toBe(true);
    expect(canScroll({ ...page, scrollTop: 0 }, "up")).toBe(false);
    expect(canScroll({ ...page, scrollTop: 1200 }, "up")).toBe(true);
    expect(canScroll({ ...page, scrollTop: 2200 }, "down")).toBe(false);
  });

  it("counts a fraction of a pixel short of either end as there", () => {
    expect(canScroll({ ...page, scrollTop: 2199.5 }, "down")).toBe(false);
    expect(canScroll({ ...page, scrollTop: 0.5 }, "up")).toBe(false);
  });
});

describe("scrollDistance", () => {
  it("is half the area's height, signed by direction, and never nothing", () => {
    const position = { scrollTop: 0, scrollHeight: 3000, clientHeight: 801 };
    expect(scrollDistance(position, "down")).toBe(401);
    expect(scrollDistance(position, "up")).toBe(-401);
    expect(scrollDistance({ ...position, clientHeight: 1 }, "down")).toBe(1);
  });
});
