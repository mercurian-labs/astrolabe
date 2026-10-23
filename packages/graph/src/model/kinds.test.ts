import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { shapeGauge, shapeReach } from "../render/shapes.ts";
import { kindLine, NodeShape, sourceLine } from "./kinds.ts";
import type { Memory } from "./memory.ts";
import { readingAt, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { noteSource, type ThreadRecord } from "./thread.ts";
import { buildUniverse } from "./universe.ts";
import { denseView } from "./view.ts";

describe("a note's kind, by shape", () => {
  // One file holding one note of each symbol kind.
  const memory: Memory = {
    id: "kinds",
    notes: [
      { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
      ...(
        [
          ["Shape", "class"],
          ["run", "method"],
          ["Input", "interface"],
          ["Mode", "enum"],
          ["Pick", "type"],
          ["draw", "function"],
          ["LIMIT", "constant"],
        ] as const
      ).map(([name, kind]) => ({
        id: `a.ts#${name}`,
        name,
        frontier: false,
        kind,
        parent: name === "run" ? "a.ts#Shape" : "a.ts",
      })),
    ],
    links: [],
    lenses: [],
  };

  it("gives every kind its shape in the dense view, and a container its ring", () => {
    const universe = buildUniverse("kinds", memory);
    const view = denseView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const shapeOf = (id: string) => view.nodeShape[universe.indexOf.get(id) ?? -1];
    expect(
      ["a.ts", "Shape", "run", "Input", "Mode", "Pick", "draw", "LIMIT"].map((name) =>
        shapeOf(name === "a.ts" ? name : `a.ts#${name}`),
      ),
    ).toEqual([
      NodeShape.container,
      NodeShape.roundedSquare,
      NodeShape.circle,
      NodeShape.diamond,
      NodeShape.hexagon,
      NodeShape.triangle,
      NodeShape.circle,
      NodeShape.square,
    ]);
  });

  it("draws a memory without kinds all in circles", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const reading = readingAt(almagest, ATLAS_THREAD, 6, { depth: 1, thisTurnOnly: false });
    const view = denseView({
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    expect(view.nodeShape.length).toBe(universe.nodes.length);
    expect(view.nodeShape.every((shape) => shape === NodeShape.circle)).toBe(true);
  });
});

describe("the shapes' geometry", () => {
  const shapes = Object.values(NodeShape);
  // Sampled on a fine grid over the quad: the points each shape covers.
  const covered = (shape: number) => {
    const points: Array<readonly [number, number]> = [];
    const step = 0.01;
    for (let x = -2; x <= 2; x += step) {
      for (let y = -2; y <= 2; y += step) if (shapeGauge(shape, x, y) <= 1) points.push([x, y]);
    }
    return { points, area: points.length * step * step };
  };

  it("reaches exactly as far as its farthest covered point", () => {
    for (const shape of shapes) {
      const reach = Math.max(...covered(shape).points.map(([x, y]) => Math.hypot(x, y)));
      expect(reach).toBeCloseTo(shapeReach(shape), 1);
      expect(reach).toBeLessThanOrEqual(shapeReach(shape) + 1e-9);
    }
  });

  it("matches the disc's weight: the square-ish shapes its area, the pointed ones a little less", () => {
    const disc = covered(NodeShape.circle).area;
    const ratio = (shape: number) => covered(shape).area / disc;
    expect(ratio(NodeShape.roundedSquare)).toBeCloseTo(1, 1);
    expect(ratio(NodeShape.hexagon)).toBeCloseTo(1, 1);
    for (const pointed of [NodeShape.diamond, NodeShape.triangle]) {
      expect(ratio(pointed)).toBeGreaterThan(0.7);
      expect(ratio(pointed)).toBeLessThan(0.95);
    }
    // A constant's square is small on purpose.
    expect(ratio(NodeShape.square)).toBeLessThan(0.7);
  });

  it("points the triangle up", () => {
    expect(shapeGauge(NodeShape.triangle, 0, 1.3)).toBeLessThan(1);
    expect(shapeGauge(NodeShape.triangle, 0, -1.3)).toBeGreaterThan(1);
  });
});

describe("the popover's rows", () => {
  it("says the kind in its shape's glyph, and a method's class", () => {
    expect(kindLine("interface")).toBe("◆ interface");
    expect(kindLine("method", "FlatRenderer")).toBe("● method of FlatRenderer");
    expect(kindLine("file")).toBe("◎ file");
  });

  it("says where the note was last defined, by the end of the checkpoint", () => {
    const thread: ThreadRecord = {
      id: "t",
      title: "t",
      memoryId: "kinds",
      turns: [
        {
          id: "1",
          label: "one",
          events: [
            {
              kind: "write",
              note: "a.ts#draw",
              group: "src/a.ts",
              range: { startLine: 3, endLine: 9 },
            },
          ],
        },
        {
          id: "2",
          label: "two",
          events: [
            {
              kind: "amend",
              note: "a.ts#draw",
              group: "src/a.ts",
              range: { startLine: 3, endLine: 14 },
            },
          ],
        },
      ],
    };
    const at = (checkpoint: number) => {
      const source = noteSource(thread, checkpoint, "a.ts#draw");
      return source === null ? null : sourceLine(source.path, source.range);
    };
    expect(at(0)).toBe("src/a.ts · lines 3–9");
    expect(at(1)).toBe("src/a.ts · lines 3–14");
    expect(noteSource(thread, 1, "a.ts#other")).toBeNull();
    expect(sourceLine("src/a.ts", { startLine: 5, endLine: 5 })).toBe("src/a.ts · line 5");
  });
});
