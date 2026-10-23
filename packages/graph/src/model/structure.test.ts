import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { EdgeAttention, edgeAttentions } from "./attention.ts";
import { edgeBetween } from "./level.ts";
import type { Memory } from "./memory.ts";
import { readingAt, threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import type { ThreadRecord } from "./thread.ts";
import { buildUniverse } from "./universe.ts";
import { denseView } from "./view.ts";

// a.ts holds f, g, and k; b.ts holds h. f calls g and g calls h before the turn; the turn amends f and links k to f.
const memory: Memory = {
  id: "structure",
  notes: [
    { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
    { id: "b.ts", name: "b.ts", frontier: false, kind: "file" },
    { id: "a.ts#f", name: "f", frontier: false, kind: "function", parent: "a.ts" },
    { id: "a.ts#g", name: "g", frontier: false, kind: "function", parent: "a.ts" },
    { id: "a.ts#k", name: "k", frontier: false, kind: "function", parent: "a.ts" },
    { id: "b.ts#h", name: "h", frontier: false, kind: "function", parent: "b.ts" },
  ],
  links: [
    { from: "a.ts#f", to: "a.ts#g", kind: "calls", resolution: "exact" },
    { from: "a.ts#g", to: "b.ts#h", kind: "calls", resolution: "exact" },
  ],
  lenses: [],
};
const thread: ThreadRecord = {
  id: "t",
  title: "t",
  memoryId: "structure",
  turns: [
    {
      id: "t0",
      label: "t0",
      events: [
        { kind: "read", note: "a.ts#g" },
        { kind: "read", note: "b.ts#h" },
        { kind: "amend", note: "a.ts#f" },
        { kind: "link", from: "a.ts#k", to: "a.ts#f", linkKind: "calls" },
      ],
    },
  ],
};
const universe = buildUniverse(
  "structure",
  threadUniverse(memory, thread),
  threadIndex(memory, thread),
);
const index = (id: string) => universe.indexOf.get(id) ?? -1;
const reading = readingAt(memory, thread, 0, { depth: 0, thisTurnOnly: false });
const at = (closed: ReadonlyArray<string>, opened: ReadonlyArray<string>) =>
  denseView({
    universe,
    lenses: [],
    shownLensSlots: [],
    reading,
    whole: false,
    pickedId: null,
    depth: 0,
    filters: NO_FILTERS,
    closed: new Set(closed.map(index)),
    opened: new Set(opened.map(index)),
  });
const edge = (a: string, b: string) => edgeBetween(universe, index(a), index(b));
const attention = (view: ReturnType<typeof at>, storyLit: boolean) =>
  edgeAttentions(view, universe.edges, { hover: -1, picked: -1, storyLit, play: null });

describe("structure inside an opened container", () => {
  it("lights exactly the edges that stood among what shows inside it, and nothing outside", () => {
    const open = at(["b.ts"], ["a.ts"]);
    expect(open.edgeStructure[edge("a.ts#f", "a.ts#g")]).toBe(1);
    // An edge to something outside the container stays dark.
    expect(open.edgeStructure[edge("a.ts#g", "b.ts")]).toBe(0);
    const lit = attention(open, false);
    expect(lit[edge("a.ts#f", "a.ts#g")]).toBeCloseTo(EdgeAttention.structure);
    expect(lit[edge("a.ts#g", "b.ts")]).toBe(0);
  });

  it("keeps a link the turn made inside at its story level, not structure", () => {
    const open = at(["b.ts"], ["a.ts"]);
    const made = edge("a.ts#k", "a.ts#f");
    expect(open.edgeStructure[made]).toBe(0);
    expect(attention(open, true)[made]).toBe(EdgeAttention.storyNew);
    expect(attention(open, false)[made]).toBe(0);
  });

  it("drops the structure when the container closes", () => {
    const closed = at(["a.ts", "b.ts"], []);
    expect([...closed.edgeStructure].every((flag) => flag === 0)).toBe(true);
  });

  it("leaves a memory without containers as it was", () => {
    const plain = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const view = denseView({
      universe: plain,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, 5, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
      opened: new Set([0, 1, 2]),
    });
    expect([...view.edgeStructure].every((flag) => flag === 0)).toBe(true);
  });
});
