import { describe, expect, it } from "vite-plus/test";
import { dropZone, insertIndex, paneDropZone } from "./drag";

describe("drop zones", () => {
  it("names the edge the pointer is near, or the middle", () => {
    expect(dropZone(10, 200, 800, 400)).toBe("left");
    expect(dropZone(790, 200, 800, 400)).toBe("right");
    expect(dropZone(400, 20, 800, 400)).toBe("top");
    expect(dropZone(400, 390, 800, 400)).toBe("bottom");
    expect(dropZone(400, 200, 800, 400)).toBe("center");
  });

  it("weighs edges by share, so a wide pane still divides stacked near its top and bottom", () => {
    expect(dropZone(200, 60, 800, 400)).toBe("top");
    expect(dropZone(200, 380, 800, 400)).toBe("bottom");
    expect(dropZone(20, 60, 800, 400)).toBe("left");
  });
});

describe("dropping a tab on a pane", () => {
  // An 800 x 400 pane.
  it("joins the strip's tabs over its top 40px, else divides on the nearest half", () => {
    expect(paneDropZone(400, 20, 800, 400, 40)).toBe("center");
    expect(paneDropZone(10, 20, 800, 400, 40)).toBe("center");
    // Below the strip every point is in some half: there is no middle.
    expect(paneDropZone(400, 60, 800, 400, 40)).toBe("top");
    expect(paneDropZone(400, 390, 800, 400, 40)).toBe("bottom");
    expect(paneDropZone(300, 220, 800, 400, 40)).toBe("left");
    expect(paneDropZone(500, 220, 800, 400, 40)).toBe("right");
    // Measured below the strip, the content's middle is at 220, not 200.
    expect(paneDropZone(400, 210, 800, 400, 40)).toBe("top");
    // Down the left edge, below the strip, a tab divides the pane rather than joining it.
    expect(paneDropZone(20, 200, 800, 400, 40)).toBe("left");
  });
});

describe("where a tab joins a strip", () => {
  // Three 32px pills 2px apart along the strip, starting at 100: middles at 116, 150 and 184.
  const middles = [116, 150, 184];

  it("lands before the first tab whose middle is past the pointer", () => {
    expect(insertIndex(middles, 101)).toBe(0);
    expect(insertIndex(middles, 120)).toBe(1);
    expect(insertIndex(middles, 149)).toBe(1);
    expect(insertIndex(middles, 151)).toBe(2);
  });

  it("lands at the end past the last tab's middle, or in an empty strip", () => {
    expect(insertIndex(middles, 190)).toBe(3);
    expect(insertIndex([], 10)).toBe(0);
  });
});
