import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { edgeAttentions } from "./attention.ts";
import {
  applyFeatures,
  boundaryIndex,
  crossingText,
  dataFlowCounts,
  shownLinks,
  silhouettes,
} from "./features.ts";
import { edgeBetween } from "./level.ts";
import type { Boundaries, LinkKind, Memory, MemoryNote, NoteKind } from "./memory.ts";
import { threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { NO_FEATURES, type DesignFeatures } from "./settings.ts";
import { firstParagraph, noteText, type ThreadRecord } from "./thread.ts";
import { buildUniverse } from "./universe.ts";
import { denseView, deriveView, EdgeDirection, NodeFlag } from "./view.ts";

/**
 * A small codebase in two layers. src/model/a.ts: parse takes Input, gives
 * Shape, and throws ParseError; validate throws ParseError too; A, B, and C
 * implement Shape; f, g, and h call round in a cycle; hub calls eight
 * helpers. src/view/v.ts: render calls parse and catches ParseError; leak (in
 * the model) calls render, which the layers do not allow.
 */
const note = (id: string, kind: NoteKind, parent: string, extra: Partial<MemoryNote> = {}) => ({
  id,
  name: id.slice(id.indexOf("#") + 1),
  frontier: false,
  kind,
  parent,
  ...extra,
});
const A = "src/model/a.ts";
const V = "src/view/v.ts";
const helpers = Array.from({ length: 8 }, (_, n) => `${A}#help${n}`);
const memory: Memory = {
  id: "features",
  notes: [
    { id: "src", name: "src", frontier: false, kind: "folder" },
    { id: "src/model", name: "model", frontier: false, kind: "folder", parent: "src" },
    { id: "src/view", name: "view", frontier: false, kind: "folder", parent: "src" },
    { id: A, name: "a.ts", frontier: false, kind: "file", parent: "src/model" },
    { id: V, name: "v.ts", frontier: false, kind: "file", parent: "src/view" },
    note(`${A}#Input`, "interface", A),
    note(`${A}#Shape`, "interface", A),
    note(`${A}#ParseError`, "class", A),
    note(`${A}#parse`, "function", A, {
      signature: "function parse(input: Input): Shape",
      doc: "Reads a shape.\n\nThrows on bad input.",
    }),
    note(`${A}#validate`, "function", A),
    note(`${A}#leak`, "function", A),
    ...["A", "B", "C"].map((name) => note(`${A}#${name}`, "class", A)),
    ...["f", "g", "h"].map((name) => note(`${A}#${name}`, "function", A)),
    note(`${A}#hub`, "function", A),
    ...helpers.map((id) => note(id, "function", A)),
    note(`${V}#render`, "function", V),
  ],
  links: [
    ...(
      [
        ["parse", "Input", "accepts"],
        ["parse", "Shape", "returns"],
        ["parse", "ParseError", "throws"],
        ["validate", "ParseError", "throws"],
        ["A", "Shape", "implements"],
        ["B", "Shape", "implements"],
        ["C", "Shape", "implements"],
        ["f", "g", "calls"],
        ["g", "h", "calls"],
        ["h", "f", "calls"],
      ] as const
    ).map(([from, to, kind]) => ({ from: `${A}#${from}`, to: `${A}#${to}`, kind })),
    ...helpers.map((to) => ({ from: `${A}#hub`, to, kind: "calls" as LinkKind })),
    { from: `${V}#render`, to: `${A}#parse`, kind: "calls" },
    { from: `${V}#render`, to: `${A}#ParseError`, kind: "catches" },
    { from: `${A}#leak`, to: `${V}#render`, kind: "calls" },
  ],
  lenses: [
    {
      name: "Relationships",
      types: { calls: "Calls it.", implements: "Implements it." },
      edges: [{ from: `${A}#f`, type: "calls", to: `${A}#g` }],
    },
  ],
};
const boundaries: Boundaries = {
  layers: [
    { name: "model", paths: ["src/model"] },
    { name: "view", paths: ["src/view"] },
  ],
  allowed: [["view", "model"]],
};

/** The graph as a host with `features` would draw it. */
function graphWith(features: DesignFeatures | undefined, showLayers = false) {
  const applied = applyFeatures(memory, null, features ?? NO_FEATURES);
  const universe = buildUniverse("features", applied.memory);
  const layered = features?.boundaries === true ? boundaryIndex(universe, boundaries) : undefined;
  const input = {
    universe,
    lenses: applied.memory.lenses,
    shownLensSlots: [],
    reading: null,
    whole: true,
    pickedId: null,
    depth: 1,
    filters: NO_FILTERS,
    ...(features === undefined ? {} : { features }),
    ...(layered === undefined ? {} : { boundaries: layered, showLayers }),
  };
  const index = (id: string) => universe.indexOf.get(id) ?? -1;
  return {
    applied,
    universe,
    layered,
    view: deriveView(input),
    dense: denseView(input),
    index,
    edge: (a: string, b: string) => edgeBetween(universe, index(`${A}#${a}`), index(b)),
  };
}

describe("every design feature off", () => {
  it("leaves a memory without the new kinds untouched, object for object", () => {
    const { memory: same, thread } = applyFeatures(almagest, ATLAS_THREAD, NO_FEATURES);
    expect(same).toBe(almagest);
    expect(thread).toBe(ATLAS_THREAD);
  });

  it("draws exactly as today: the same attention, shapes, flags, glyphs, and regions", () => {
    const universe = buildUniverse(
      "almagest/thread",
      threadUniverse(almagest, ATLAS_THREAD),
      threadIndex(almagest, ATLAS_THREAD),
    );
    const input = {
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    };
    const today = denseView(input);
    const off = denseView({ ...input, features: NO_FEATURES });
    const state = { hover: -1, picked: -1, storyLit: true, play: null };
    expect(edgeAttentions(off, universe.edges, state)).toEqual(
      edgeAttentions(today, universe.edges, state),
    );
    expect(off.nodeShape).toEqual(today.nodeShape);
    expect(off.nodeFlags).toEqual(today.nodeFlags);
    expect(off.edgeDirection).toEqual(today.edgeDirection);
    expect(off.regions).toEqual(today.regions);
    expect(deriveView({ ...input, features: NO_FEATURES }).nodeGlyph).toEqual(
      deriveView(input).nodeGlyph,
    );
  });

  it("draws the code memory the same with every feature off as with none given", () => {
    const today = graphWith(undefined);
    const off = graphWith(NO_FEATURES);
    const state = { hover: -1, picked: -1, storyLit: true, play: null };
    expect(edgeAttentions(off.dense, off.universe.edges, state)).toEqual(
      edgeAttentions(today.dense, today.universe.edges, state),
    );
    expect(off.dense.nodeShape).toEqual(today.dense.nodeShape);
    expect(off.dense.nodeFlags).toEqual(today.dense.nodeFlags);
    expect(off.dense.edgeDirection).toEqual(today.dense.edgeDirection);
    expect(off.dense.regions).toEqual(today.dense.regions);
    expect(off.view.nodeGlyph).toEqual(today.view.nodeGlyph);
  });

  it("reads data flow as references and leaves failure flow out entirely", () => {
    const { applied, universe, dense, edge } = graphWith(undefined);
    const kinds = new Set(applied.memory.links.map((link) => link.kind));
    expect(kinds.has("accepts") || kinds.has("returns") || kinds.has("throws")).toBe(false);
    expect(kinds.has("catches")).toBe(false);
    expect(kinds.has("references")).toBe(true);
    const accepts = edge("parse", `${A}#Input`);
    expect(universe.edgeLinks[accepts]?.map((link) => link.kind)).toEqual(["references"]);
    expect((dense.edgeDirection[accepts] ?? 0) & EdgeDirection.data).toBe(0);
    // validate's only link was a throws: with failure flow off, it has no edge at all.
    expect(edge("validate", `${A}#ParseError`)).toBe(-1);
    expect([...dense.nodeFlags].some((flags) => (flags & NodeFlag.uncaught) !== 0)).toBe(false);
  });
});

describe("signatures", () => {
  it("gives the declaration and the doc's first paragraph, the latest event's over the note's", () => {
    const thread: ThreadRecord = {
      id: "t",
      title: "t",
      memoryId: "features",
      turns: [
        {
          id: "1",
          label: "one",
          events: [
            {
              kind: "write",
              note: `${A}#fresh`,
              signature: "function fresh(): void",
              doc: "New here.",
            },
          ],
        },
      ],
    };
    expect(noteText(thread, 0, `${A}#fresh`, "signature")).toBe("function fresh(): void");
    expect(noteText(thread, 0, `${A}#parse`, "signature")).toBeUndefined();
    expect(firstParagraph("Reads a shape.\n\nThrows on bad input.")).toBe("Reads a shape.");
    expect(firstParagraph("  One line\n  wrapped.\n\nTwo.")).toBe("One line wrapped.");
  });
});

describe("data flow", () => {
  it("marks accepts and returns edges, counts them on the type, and keys them in the Relationships lens", () => {
    const { applied, universe, dense, edge, index } = graphWith({
      ...NO_FEATURES,
      dataEdges: true,
    });
    const accepts = edge("parse", `${A}#Input`);
    const returns = edge("parse", `${A}#Shape`);
    expect((dense.edgeDirection[accepts] ?? 0) & EdgeDirection.data).toBe(EdgeDirection.data);
    expect((dense.edgeDirection[returns] ?? 0) & EdgeDirection.data).toBe(EdgeDirection.data);
    // A calls edge is not data flow.
    const calls = edge("f", `${A}#g`);
    expect((dense.edgeDirection[calls] ?? 0) & EdgeDirection.data).toBe(0);
    expect(dataFlowCounts(universe, index(`${A}#Input`), () => true)).toEqual({
      accepted: 1,
      returned: 0,
    });
    expect(dataFlowCounts(universe, index(`${A}#Shape`), () => true)).toEqual({
      accepted: 0,
      returned: 1,
    });
    const lens = applied.memory.lenses.find((each) => each.name === "Relationships");
    expect(Object.keys(lens?.types ?? {})).toEqual(
      expect.arrayContaining(["calls", "accepts", "returns"]),
    );
    expect(lens?.edges.some((each) => each.type === "accepts")).toBe(true);
    expect(lens?.edges.some((each) => each.type === "throws")).toBe(false);
  });
});

describe("failure flow", () => {
  it("marks throws and catches edges, and ticks a thrower nothing above catches", () => {
    const { dense, edge, index } = graphWith({ ...NO_FEATURES, failureEdges: true });
    const throws = edge("parse", `${A}#ParseError`);
    const catches = edgeBetween(
      graphWith({ ...NO_FEATURES, failureEdges: true }).universe,
      index(`${V}#render`),
      index(`${A}#ParseError`),
    );
    expect((dense.edgeDirection[throws] ?? 0) & EdgeDirection.failure).toBe(EdgeDirection.failure);
    expect((dense.edgeDirection[catches] ?? 0) & EdgeDirection.failure).toBe(EdgeDirection.failure);
    // validate throws and nothing calls it; parse throws but render, which calls it, catches.
    const uncaught = (id: string) => ((dense.nodeFlags[index(id)] ?? 0) & NodeFlag.uncaught) !== 0;
    expect(uncaught(`${A}#validate`)).toBe(true);
    expect(uncaught(`${A}#parse`)).toBe(false);
    expect(uncaught(`${V}#render`)).toBe(false);
  });
});

describe("boundaries", () => {
  it("marks a link across layers the declaration does not allow, and says so", () => {
    const { universe, layered, dense, index } = graphWith({ ...NO_FEATURES, boundaries: true });
    const leak = edgeBetween(universe, index(`${A}#leak`), index(`${V}#render`));
    const allowed = edgeBetween(universe, index(`${V}#render`), index(`${A}#parse`));
    expect((dense.edgeDirection[leak] ?? 0) & EdgeDirection.violation).toBe(
      EdgeDirection.violation,
    );
    expect((dense.edgeDirection[allowed] ?? 0) & EdgeDirection.violation).toBe(0);
    if (layered === undefined) throw new Error("no layers");
    expect(
      crossingText(
        boundaries,
        layered,
        universe,
        { from: `${A}#leak`, to: `${V}#render` },
        "exact",
      ),
    ).toBe("crosses model → view (not allowed)");
    expect(
      crossingText(
        boundaries,
        layered,
        universe,
        { from: `${A}#leak`, to: `${V}#render` },
        "heuristic",
      ),
    ).toBeNull();
    expect(
      crossingText(
        boundaries,
        layered,
        universe,
        { from: `${V}#render`, to: `${A}#parse` },
        "exact",
      ),
    ).toBeNull();
  });

  it("never counts a link resolved by name alone, nor lets the recognisers read it", () => {
    const guessed: Memory = {
      ...memory,
      links: [
        ...memory.links,
        { from: `${A}#validate`, to: `${V}#render`, kind: "calls", resolution: "heuristic" },
      ],
    };
    const universe = buildUniverse("guessed", guessed);
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const layered = boundaryIndex(universe, boundaries);
    const features = { ...NO_FEATURES, boundaries: true };
    const dense = denseView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
      features,
      boundaries: layered,
    });
    const violation = (a: string, b: string) =>
      (dense.edgeDirection[edgeBetween(universe, index(a), index(b))] ?? 0) &
      EdgeDirection.violation;
    expect(violation(`${A}#validate`, `${V}#render`)).toBe(0);
    expect(violation(`${A}#leak`, `${V}#render`)).toBe(EdgeDirection.violation);
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const shown = shownLinks(universe, view, () => true);
    expect(
      shown.links.some((link) => link.from === index(`${A}#validate`) && link.kind === "calls"),
    ).toBe(false);
  });

  it("draws the layers as named regions only at the survey level", () => {
    const survey = graphWith({ ...NO_FEATURES, boundaries: true }, true).dense.regions;
    const layers = survey.filter((region) => region.note < 0);
    expect(layers.map((region) => region.name)).toEqual(["model", "view"]);
    // Drawn last, over the folders.
    expect(survey.slice(-2)).toEqual(layers);
    expect(
      graphWith({ ...NO_FEATURES, boundaries: true }, false).dense.regions.some(
        (region) => region.note < 0,
      ),
    ).toBe(false);
  });
});

describe("silhouettes", () => {
  it("finds the hub, the strategy, and the cycle in the shown graph", () => {
    const { universe, view, index } = graphWith({ ...NO_FEATURES, silhouettes: true });
    const found = silhouettes(
      shownLinks(universe, view, () => true),
      (at) => universe.nodes[at]?.kind,
    );
    expect(found.map((shape) => shape.text)).toEqual([
      "hub",
      "strategy: 3 implementers",
      "cycle: 3",
    ]);
    const [hub, strategy, cycle] = found;
    expect(hub?.members[0]).toBe(index(`${A}#hub`));
    expect(hub?.members).toHaveLength(9);
    expect(strategy?.members[0]).toBe(index(`${A}#Shape`));
    expect(new Set(cycle?.members)).toEqual(
      new Set(["f", "g", "h"].map((n) => index(`${A}#${n}`))),
    );
  });

  it("finds nothing in a graph without those shapes", () => {
    const universe = buildUniverse("almagest", almagest);
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const found = silhouettes(
      shownLinks(universe, view, () => true),
      () => undefined,
    );
    expect(found.every((shape) => shape.kind !== "strategy")).toBe(true);
  });
});
