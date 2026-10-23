import { describe, expect, it } from "vite-plus/test";

import { cssToHex } from "./theme.ts";

/** A context that paints what a browser would for a few known values. */
function fakeContext(paint: Record<string, [number, number, number, number]>) {
  let fill = "#000";
  let pixel: [number, number, number, number] = [0, 0, 0, 0];
  return {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      if (typeof value === "string" && value in paint) fill = value;
    },
    clearRect() {
      pixel = [0, 0, 0, 0];
    },
    fillRect() {
      pixel = paint[fill] ?? [0, 0, 0, 255];
    },
    getImageData() {
      return { data: Uint8ClampedArray.from(pixel) } as unknown as ImageData;
    },
  };
}

describe("cssToHex", () => {
  it("turns a painted colour into sRGB hex, whatever syntax the host wrote it in", () => {
    const context = fakeContext({
      "#000": [0, 0, 0, 255],
      "oklch(27.4% 0.006 286.033)": [39, 39, 42, 255],
      "#f8f7f3": [248, 247, 243, 255],
    });
    expect(cssToHex("oklch(27.4% 0.006 286.033)", context)).toBe("#27272a");
    expect(cssToHex("#f8f7f3", context)).toBe("#f8f7f3");
  });

  it("returns null when nothing was painted", () => {
    const context = fakeContext({ "#000": [0, 0, 0, 255] });
    const broken = { ...context, fillRect() {} };
    expect(cssToHex("nonsense", broken)).toBeNull();
  });
});
