import { describe, expect, it } from "vite-plus/test";

import { pairKey } from "./memory.ts";
import { readingAt, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { SMALL_MEMORY, SMALL_THREAD } from "./testMemory.ts";
import { buildUniverse } from "./universe.ts";
import { denseView, EdgeKind, Emphasis, NodeFlag, type ViewInput } from "./view.ts";

const universe = buildUniverse("small", threadUniverse(SMALL_MEMORY, SMALL_THREAD));
const at = (checkpoint: number, overrides: Partial<ViewInput> = {}) =>
  denseView({
    universe,
    lenses: SMALL_MEMORY.lenses,
    shownLensSlots: [],
    reading: readingAt(SMALL_MEMORY, SMALL_THREAD, checkpoint, { depth: 1, thisTurnOnly: false }),
    whole: false,
    pickedId: null,
    depth: 1,
    filters: NO_FILTERS,
    ...overrides,
  });
const node = (id: string) => universe.indexOf.get(id) ?? -1;
const edge = (a: string, b: string) => universe.edgeIndexOf.get(pairKey(a, b)) ?? -1;
const shownIds = (view: ReturnType<typeof at>) =>
  universe.nodes.filter((_, index) => view.nodeVisible[index] === 1).map((each) => each.id);

describe("deriveView", () => {
  it("shows the reading: worked notes in front and glowing, neighbors receded, the rest hidden", () => {
    const view = at(0);
    expect(shownIds(view)).toEqual(["A", "B", "R"]);
    expect(view.nodeEmphasis[node("A")]).toBe(Emphasis.front);
    expect(view.nodeGlow[node("A")]).toBe(1);
    expect(view.nodeEmphasis[node("B")]).toBeCloseTo(Emphasis.around);
    expect(view.nodeFlags[node("R")]! & NodeFlag.frontier).toBeTruthy();
    expect(view.risen).toEqual([node("A")]);
  });

  it("settles earlier turns behind the current one", () => {
    const view = at(1);
    expect(view.nodeEmphasis[node("A")]).toBeCloseTo(Emphasis.earlier);
    expect(view.nodeGlow[node("A")]).toBe(0);
    expect(view.nodeFlags[node("B")]! & NodeFlag.amended).toBeTruthy();
    expect(view.edgeKind[edge("B", "D")]).toBe(EdgeKind.new);
    expect(view.edgeCurrent[edge("B", "D")]).toBe(1);
    expect(at(2).edgeCurrent[edge("B", "D")]).toBe(0);
  });

  it("marks new notes, breaks removed links, and hides links not yet made", () => {
    expect(at(1).edgeVisible[edge("C", "New Idea")]).toBe(0);
    const view = at(2);
    expect(view.nodeFlags[node("R")]! & NodeFlag.frontier).toBe(0);
    expect(view.nodeFlags[node("R")]! & NodeFlag.new).toBeTruthy();
    expect(view.edgeKind[edge("A", "B")]).toBe(EdgeKind.broken);
    expect(view.edgeVisible[edge("A", "B")]).toBe(1);
    expect(view.nodeFlags[node("New Idea")]! & NodeFlag.frontier).toBeTruthy();
  });

  it("shows every note present at the checkpoint for the whole memory", () => {
    const view = at(1, { whole: true });
    expect(shownIds(view)).toEqual(["A", "B", "C", "D", "E", "F", "Lonely", "R"]);
    expect(view.nodeEmphasis[node("A")]).toBeCloseTo(Emphasis.earlier);
  });

  it("brings a picked note and its neighbors forward, like a read", () => {
    const view = at(0, { pickedId: "E" });
    expect(shownIds(view)).toEqual(["A", "B", "D", "E", "F", "R"]);
    expect(view.focus?.index).toBe(node("E"));
    expect(view.focus?.neighbors.toSorted()).toEqual([node("B"), node("D"), node("F")].toSorted());
    expect(view.nodeFlags[node("E")]! & NodeFlag.picked).toBeTruthy();
  });

  it("tints what a shown lens places, and draws its edges only while it is on", () => {
    const off = at(0, { whole: true });
    expect(off.nodeSlot[node("A")]).toBe(-1);
    expect(off.edgeVisible[edge("A", "F")]).toBe(0);
    const on = at(0, { whole: true, shownLensSlots: [0] });
    expect(on.nodeSlot[node("A")]).toBe(0);
    expect(on.nodeSlot[node("C")]).toBe(-1);
    expect(on.edgeSlot[edge("A", "B")]).toBe(0);
    expect(on.edgeVisible[edge("A", "F")]).toBe(1);
  });

  it("narrows by search within the view, and hides frontier and orphans", () => {
    const searched = at(1, { whole: true, filters: { ...NO_FILTERS, search: "lonely" } });
    expect(shownIds(searched)).toEqual(["Lonely"]);
    const hidden = at(1, {
      whole: true,
      filters: { search: "", hideFrontier: true, hideOrphans: true },
    });
    expect(shownIds(hidden)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(hidden.edgeVisible[edge("A", "R")]).toBe(0);
  });

  it("shows the whole memory at rest emphasis when there is no thread", () => {
    const view = denseView({
      universe: buildUniverse("plain", SMALL_MEMORY),
      lenses: SMALL_MEMORY.lenses,
      shownLensSlots: [],
      reading: null,
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    expect(view.shownNodes).toBe(SMALL_MEMORY.notes.length);
    expect(view.risen).toEqual([]);
  });
});
