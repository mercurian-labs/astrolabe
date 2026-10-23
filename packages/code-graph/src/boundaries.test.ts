import { describe, expect, it } from "vite-plus/test";

import { layerOf, parseBoundaries, violations } from "./boundaries.ts";
import type { CodeEdge, CodeSymbol } from "./model/code.ts";
import type { Boundaries } from "./model/graph.ts";

const FILE = JSON.stringify({
  layers: [
    { name: "model", paths: ["src/model"] },
    { name: "render", paths: ["./src/render/"] },
    { name: "shell", paths: ["src/index.ts"] },
  ],
  allowed: [
    ["render", "model"],
    ["shell", "render"],
  ],
});

const parsed = (text: string, root = "") => {
  const result = parseBoundaries(text, root);
  if ("error" in result) throw new Error(result.error);
  return result.boundaries;
};

describe("parseBoundaries", () => {
  it("reads layers and allowed pairs, with paths made repository-relative", () => {
    expect(parsed(FILE, "apps/graph")).toEqual({
      layers: [
        { name: "model", paths: ["apps/graph/src/model"] },
        { name: "render", paths: ["apps/graph/src/render"] },
        { name: "shell", paths: ["apps/graph/src/index.ts"] },
      ],
      allowed: [
        ["render", "model"],
        ["shell", "render"],
      ],
    });
  });

  it("refuses what does not hold together", () => {
    const errorOf = (value: unknown) => {
      const result = parseBoundaries(typeof value === "string" ? value : JSON.stringify(value), "");
      return "error" in result ? result.error : null;
    };
    expect(errorOf("{ not json")).toMatch(/^not JSON/);
    expect(errorOf({ layers: [] })).toMatch(/expected/);
    expect(errorOf({ layers: [{ name: "a" }], allowed: [] })).toMatch(/needs paths/);
    expect(
      errorOf({
        layers: [
          { name: "a", paths: ["x"] },
          { name: "a", paths: ["y"] },
        ],
        allowed: [],
      }),
    ).toMatch(/named twice/);
    expect(errorOf({ layers: [{ name: "a", paths: ["../x"] }], allowed: [] })).toMatch(/bad path/);
    expect(errorOf({ layers: [{ name: "a", paths: ["/x"] }], allowed: [] })).toMatch(/bad path/);
    expect(errorOf({ layers: [{ name: "a", paths: ["x"] }], allowed: [["a", "b"]] })).toMatch(
      /unknown layer/,
    );
    expect(errorOf({ layers: [{ name: "a", paths: ["x"] }], allowed: [["a"]] })).toMatch(/pair/);
  });
});

describe("layers and violations", () => {
  const boundaries: Boundaries = parsed(FILE);
  const symbol = (id: string, path: string): CodeSymbol => ({
    id,
    name: id,
    kind: "function",
    path,
    range: { startLine: 1, endLine: 1 },
    hash: "",
  });
  const symbols = new Map(
    [
      symbol("view", "src/model/view.ts"),
      symbol("reading", "src/model/reading.ts"),
      symbol("draw", "src/render/draw.ts"),
      symbol("index", "src/index.ts"),
      symbol("script", "scripts/run.ts"),
    ].map((found) => [found.id, found]),
  );
  const edge = (from: string, to: string): CodeEdge => ({
    from,
    to,
    kind: "calls",
    resolution: "exact",
  });

  it("puts a path in the layer with the longest matching prefix", () => {
    expect(layerOf(boundaries, "src/model/view.ts")).toBe("model");
    expect(layerOf(boundaries, "src/index.ts")).toBe("shell");
    expect(layerOf(boundaries, "src/modelling.ts")).toBeNull();
    expect(layerOf(boundaries, "scripts/run.ts")).toBeNull();
  });

  it("flags a link into another layer that no allowed pair names, and only that", () => {
    const found = violations(
      boundaries,
      [
        edge("view", "reading"), // inside one layer
        edge("draw", "view"), // render → model, allowed
        edge("view", "draw"), // model → render, not allowed
        edge("index", "view"), // shell → model, not allowed
        edge("script", "view"), // outside every layer
        edge("draw", "frontier:missing"),
      ],
      symbols,
    );
    expect(found.map((crossing) => `${crossing.from} → ${crossing.to}`)).toEqual([
      "view → draw",
      "index → view",
    ]);
  });
});
