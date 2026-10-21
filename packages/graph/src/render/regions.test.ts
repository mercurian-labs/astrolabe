import { describe, expect, it } from "vite-plus/test";

import {
  REGION_FILL_ALPHA,
  REGION_FILL_SHARE,
  REGION_REFERENCE,
  REGION_RIM_ALPHA,
  REGION_RIM_SHARE,
  regionTints,
} from "./regions.ts";

/** CIE L* of `#rrggbb` blended `alpha` of the way toward `ink`, in encoded sRGB, as the canvas blends. */
function lightnessOf(paper: string, ink: string, alpha: number): number {
  const parse = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((each) => each / 255);
  };
  const from = parse(paper);
  const to = parse(ink);
  const [r, g, b] = from
    .map((channel, at) => channel + alpha * ((to[at] ?? 0) - channel))
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  return y > 216 / 24_389 ? 116 * Math.cbrt(y) - 16 : (24_389 / 27) * y;
}

const step = (paper: string, ink: string, alpha: number) =>
  Math.abs(lightnessOf(paper, ink, alpha) - lightnessOf(paper, ink, 0));

describe("region tints", () => {
  it("keeps the playground's light look as the reference", () => {
    const tints = regionTints(REGION_REFERENCE.paper, REGION_REFERENCE.ink);
    expect(tints.fill).toBeCloseTo(REGION_FILL_ALPHA, 4);
    expect(tints.rim).toBeCloseTo(REGION_RIM_ALPHA, 4);
  });

  it("gives a dark palette the same lightness step from its paper, fill and rim alike", () => {
    const dark = { paper: "#121416", ink: "#ece6d8" };
    const tints = regionTints(dark.paper, dark.ink);
    const reference = REGION_REFERENCE;
    expect(step(dark.paper, dark.ink, tints.fill)).toBeCloseTo(
      step(reference.paper, reference.ink, REGION_FILL_ALPHA),
      2,
    );
    expect(step(dark.paper, dark.ink, tints.rim)).toBeCloseTo(
      step(reference.paper, reference.ink, REGION_RIM_ALPHA),
      2,
    );
    // Near black, the eye reads a small lift as more: the same step takes less ink.
    expect(tints.rim).toBeLessThan(REGION_RIM_ALPHA);
    expect(tints.fill).toBeLessThan(REGION_FILL_ALPHA);
  });

  it("keeps a low-contrast palette's fill and rim to a share of its distance, never opaque ink", () => {
    const low = { paper: "#808080", ink: "#8c8c8c" };
    const tints = regionTints(low.paper, low.ink);
    const whole = step(low.paper, low.ink, 1);
    expect(tints.fill).toBeLessThan(1);
    expect(tints.rim).toBeLessThan(1);
    expect(step(low.paper, low.ink, tints.fill)).toBeCloseTo(REGION_FILL_SHARE * whole, 2);
    expect(step(low.paper, low.ink, tints.rim)).toBeCloseTo(REGION_RIM_SHARE * whole, 2);
    // Paper and ink the same: nothing to draw.
    expect(regionTints("#808080", "#808080")).toEqual({ fill: 0, rim: 0 });
  });
});
