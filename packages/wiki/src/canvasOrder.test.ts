import { describe, expect, it } from "vite-plus/test";

import { canvasData } from "./canvas.ts";
import {
  canvasLayerOf,
  canvasOrderKeyBetween,
  canvasOrderKeysBetween,
  canvasStack,
  isCanvasOrderKey,
} from "./canvasOrder.ts";

const card = (id: string, z?: string) => ({
  id,
  type: "text",
  text: id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...(z === undefined ? {} : { astrolabe: { z } }),
});
const group = (id: string, width: number, z?: string) => ({
  id,
  type: "group",
  x: 0,
  y: 0,
  width,
  height: 100,
  ...(z === undefined ? {} : { astrolabe: { z } }),
});
const edge = (id: string, z?: string) => ({
  id,
  fromNode: "a",
  toNode: "b",
  ...(z === undefined ? {} : { astrolabe: { z } }),
});
const stroke = (id: string, z?: string) => ({
  id,
  type: "stroke",
  x: 0,
  y: 0,
  points: [0, 0, 5, 5],
  ...(z === undefined ? {} : { astrolabe: { z } }),
});

const stacked = (document: unknown) => {
  const { sections, content } = canvasStack(canvasData(document));
  return {
    sections: sections.map((node) => node.id),
    content: content.map((layer) => `${layer.kind}:${canvasLayerOf(layer).id}`),
  };
};

describe("canvasStack", () => {
  it("stacks a file without keys as boards always have: largest section first, then arrows, cards, drawings", () => {
    expect(
      stacked({
        nodes: [card("a"), group("small", 200), group("big", 900), card("b"), group("tie", 200)],
        edges: [edge("e1"), edge("e2")],
        astrolabe: { drawings: [stroke("s1"), stroke("s2")] },
      }),
    ).toEqual({
      sections: ["big", "small", "tie"],
      content: ["arrow:e1", "arrow:e2", "card:a", "card:b", "drawing:s1", "drawing:s2"],
    });
  });

  it("sorts what has a key by it, kinds sharing one order, and keeps a key-less one above its file neighbour", () => {
    expect(
      stacked({
        nodes: [
          card("a", "a5"),
          card("new"),
          card("b", "a1"),
          group("g", 100, "a1"),
          group("h", 900),
        ],
        edges: [edge("a", "a7")],
        astrolabe: { drawings: [stroke("a", "a3")] },
      }),
    ).toEqual({
      // A section without a key keeps its place by size until it has one.
      sections: ["h", "g"],
      content: ["card:b", "drawing:a", "card:a", "card:new", "arrow:a"],
    });
  });

  it("ignores a key it couldn't order by, as though there were none", () => {
    // Read as a key, "a10" would sort after "a1"; but a fraction can't end in 0.
    expect(
      stacked({ nodes: [card("a", "a10"), card("b", "a1"), card("c", "?")], edges: [] }).content,
    ).toEqual(["card:a", "card:b", "card:c"]);
  });
});

describe("canvas order keys", () => {
  it("always fits a key between two, or past either end, however often", () => {
    let low: string | null = null;
    let high: string | null = null;
    const seen: string[] = [];
    for (let round = 0; round < 200; round++) {
      const front = canvasOrderKeyBetween(high, null);
      const back = canvasOrderKeyBetween(null, low ?? front);
      expect(isCanvasOrderKey(front)).toBe(true);
      expect(isCanvasOrderKey(back)).toBe(true);
      expect(back < front).toBe(true);
      seen.push(front, back);
      high = front;
      low = back;
    }
    const between = canvasOrderKeyBetween(low, high);
    expect(low! < between && between < high!).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
    // Two hundred trips to either end leave keys a few characters long.
    expect(Math.max(high!.length, low!.length)).toBeLessThanOrEqual(4);
  });

  it("spreads many keys in order between two, short enough for a big board", () => {
    const keys = canvasOrderKeysBetween(null, null, 4000);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(4000);
    expect(keys.every(isCanvasOrderKey)).toBe(true);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
    const inside = canvasOrderKeysBetween("a1", "a2", 3);
    expect(inside.every((key) => key > "a1" && key < "a2" && isCanvasOrderKey(key))).toBe(true);
  });

  it("refuses neighbours out of order", () => {
    expect(() => canvasOrderKeyBetween("a2", "a1")).toThrow();
    expect(() => canvasOrderKeyBetween("a1", "a1")).toThrow();
  });
});
