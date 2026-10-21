import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { syntheticTree } from "../../fixtures/syntheticTree.ts";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import {
  closeContainer,
  edgeBetween,
  openContainer,
  revealNotes,
  shownCount,
  spanLevel,
  storyLevel,
} from "./level.ts";
import type { Memory } from "./memory.ts";
import { focusAtLevel, playFocus } from "./plays.ts";
import { readingAt, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { buildUniverse } from "./universe.ts";
import { deriveView, EdgeDirection, type ViewInput } from "./view.ts";

const tree = syntheticTree({ folders: 3, filesPerFolder: 4, symbolsPerFile: 8 });
const universe = buildUniverse("tree", tree);
const at = (id: string) => {
  const index = universe.indexOf.get(id);
  if (index === undefined) throw new Error(`no note ${id}`);
  return index;
};
const notes = universe.nodes.map((_, index) => index);
const leaves = notes.filter((index) => (universe.childrenOf[index] ?? []).length === 0);
const ids = (set: ReadonlySet<number>) => [...set].map((index) => universe.nodes[index]?.id);
const BIG = 10_000;

describe("the level follows the span", () => {
  it("opens one class to its methods when the story is inside it", () => {
    const closed = spanLevel(
      universe,
      leaves,
      [at("src/pkg0/mod0.ts#s0.m0"), at("src/pkg0/mod0.ts#s0.m1")],
      BIG,
    );
    expect(closed.has(at("src/pkg0/mod0.ts#s0"))).toBe(false);
    // Its siblings in the file, the file's siblings, and the other folders close.
    expect(closed.has(at("src/pkg0/mod0.ts#s4"))).toBe(true);
    expect(closed.has(at("src/pkg0/mod1.ts"))).toBe(true);
    expect(closed.has(at("src/pkg1"))).toBe(true);
    expect(closed.has(at("src/pkg0/mod0.ts"))).toBe(false);
  });

  it("shows two classes of one file as classes", () => {
    const closed = spanLevel(
      universe,
      leaves,
      [at("src/pkg0/mod0.ts#s0.m0"), at("src/pkg0/mod0.ts#s4.m1")],
      BIG,
    );
    expect(closed.has(at("src/pkg0/mod0.ts#s0"))).toBe(true);
    expect(closed.has(at("src/pkg0/mod0.ts#s4"))).toBe(true);
    expect(closed.has(at("src/pkg0/mod0.ts"))).toBe(false);
  });

  it("shows a story across files as files", () => {
    const closed = spanLevel(
      universe,
      leaves,
      [at("src/pkg0/mod0.ts#s1"), at("src/pkg0/mod2.ts#s3")],
      BIG,
    );
    expect(closed.has(at("src/pkg0/mod0.ts"))).toBe(true);
    expect(closed.has(at("src/pkg0/mod2.ts"))).toBe(true);
    expect(closed.has(at("src/pkg0"))).toBe(false);
    expect(closed.has(at("src/pkg2"))).toBe(true);
  });

  it("goes up a level when the shown things would not fit one frame", () => {
    const story = [at("src/pkg0/mod0.ts#s0.m0"), at("src/pkg0/mod0.ts#s4.m1")];
    // At the file's level: its 8 symbols, 3 sibling files, 2 other folders.
    const fileLevel = spanLevel(universe, leaves, story, BIG);
    expect(shownCount(universe, leaves, fileLevel)).toBe(13);
    // Too many for 10: up to the folder (4 files and 2 folders).
    const folderLevel = spanLevel(universe, leaves, story, 10);
    expect(folderLevel.has(at("src/pkg0/mod0.ts"))).toBe(true);
    expect(shownCount(universe, leaves, folderLevel)).toBe(6);
    // Too many even for that: the top (3 folders).
    expect(ids(spanLevel(universe, leaves, story, 4)).toSorted()).toEqual([
      "src/pkg0",
      "src/pkg1",
      "src/pkg2",
    ]);
  });

  it("closes nothing in a plain memory", () => {
    const plain = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    expect(
      storyLevel(plain, readingAt(almagest, ATLAS_THREAD, 5, { depth: 1, thisTurnOnly: false }), 4)
        .size,
    ).toBe(0);
  });
});

describe("drilling", () => {
  const story = [at("src/pkg0/mod0.ts#s1"), at("src/pkg0/mod2.ts#s3")];
  const files = spanLevel(universe, leaves, story, BIG);

  it("opens a closed container to its children and closes it again, round trip", () => {
    const file = at("src/pkg0/mod0.ts");
    const opened = openContainer(universe, files, file, leaves);
    expect(opened.has(file)).toBe(false);
    // Its classes close; its siblings stay closed.
    expect(opened.has(at("src/pkg0/mod0.ts#s0"))).toBe(true);
    expect(opened.has(at("src/pkg0/mod2.ts"))).toBe(true);
    expect(closeContainer(universe, opened, file)).toEqual(files);
  });

  it("reveals a symbol's notes by opening what holds them", () => {
    const method = at("src/pkg1/mod3.ts#s4.m0");
    const revealed = revealNotes(universe, files, [method], leaves);
    expect(shownCount(universe, [method], revealed)).toBe(1);
    for (const note of revealed) expect(note === method).toBe(false);
    expect(revealed.has(at("src/pkg1"))).toBe(false);
    expect(revealed.has(at("src/pkg1/mod3.ts"))).toBe(false);
    expect(revealed.has(at("src/pkg1/mod3.ts#s4"))).toBe(false);
  });
});

describe("a view with closed containers", () => {
  // Two files: a.ts holds f and g, b.ts holds h and a class K with method k.
  const memory: Memory = {
    id: "closing",
    notes: [
      { id: "src", name: "src", frontier: false, kind: "folder" },
      { id: "a.ts", name: "a.ts", frontier: false, kind: "file", parent: "src" },
      { id: "b.ts", name: "b.ts", frontier: false, kind: "file", parent: "src" },
      { id: "a.ts#f", name: "f", frontier: false, kind: "function", parent: "a.ts" },
      { id: "a.ts#g", name: "g", frontier: false, kind: "function", parent: "a.ts" },
      { id: "b.ts#h", name: "h", frontier: false, kind: "function", parent: "b.ts" },
      { id: "b.ts#K", name: "K", frontier: false, kind: "class", parent: "b.ts" },
      { id: "b.ts#K.k", name: "k", frontier: false, kind: "method", parent: "b.ts#K" },
    ],
    links: [
      { from: "a.ts#f", to: "b.ts#h", kind: "calls", resolution: "heuristic" },
      { from: "a.ts#g", to: "b.ts#h", kind: "calls", resolution: "heuristic" },
      { from: "a.ts#g", to: "b.ts#K.k", kind: "references", resolution: "exact" },
      { from: "a.ts#f", to: "a.ts#g", kind: "calls", resolution: "exact" },
    ],
    lenses: [],
  };
  const small = buildUniverse("closing", memory);
  const index = (id: string) => small.indexOf.get(id) ?? -1;
  const view = (closed: ReadonlyArray<string>) =>
    deriveView({
      universe: small,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
      closed: new Set(closed.map(index)),
    } satisfies ViewInput);
  const edgeOf = (shown: ReturnType<typeof view>, a: string, b: string) =>
    [...shown.edges].indexOf(edgeBetween(small, index(a), index(b)));

  it("drops a closed container's members and draws it as one node sized by them", () => {
    const shown = view(["a.ts"]);
    expect(shown.nodes.includes(index("a.ts"))).toBe(true);
    expect(shown.nodes.includes(index("a.ts#f"))).toBe(false);
    expect(shown.nodeMembers[shown.nodeAt.get(index("a.ts")) ?? -1]).toBe(2);
    expect(shown.holders.get(index("a.ts#g"))).toBe(index("a.ts"));
  });

  it("aggregates links to the shown level, with their count and dominant kind", () => {
    const shown = view(["a.ts", "b.ts"]);
    const between = edgeOf(shown, "a.ts", "b.ts");
    expect(between).toBeGreaterThanOrEqual(0);
    expect(shown.edgeLinkCount[between]).toBe(3);
    expect(shown.edgeLinkKind[between]).toBe("calls");
    // Not every link is a guess: the aggregate is not dashed.
    expect((shown.edgeDirection[between] ?? 0) & EdgeDirection.heuristic).toBe(0);
    // The link inside a.ts draws nothing.
    expect(shown.edges.length).toBe(1);
  });

  it("dashes an aggregate whose links are all guesses", () => {
    const shown = view(["a.ts", "b.ts#K"]);
    // a.ts closed, h shows, K closed: the two calls to h are both guesses.
    const toH = edgeOf(shown, "a.ts", "b.ts#h");
    expect(shown.edgeLinkCount[toH]).toBe(2);
    expect((shown.edgeDirection[toH] ?? 0) & EdgeDirection.heuristic).not.toBe(0);
  });

  it("attaches a link to the deepest shown thing on each side", () => {
    // a.ts open, b.ts closed: g's links end at b.ts; f → g draws as itself.
    const shown = view(["b.ts"]);
    expect(edgeOf(shown, "a.ts#g", "b.ts")).toBeGreaterThanOrEqual(0);
    expect(edgeOf(shown, "a.ts#f", "b.ts")).toBeGreaterThanOrEqual(0);
    expect(edgeOf(shown, "a.ts#f", "a.ts#g")).toBeGreaterThanOrEqual(0);
    // K closed inside an open b.ts: g → k ends at K.
    const inner = view(["b.ts#K"]);
    expect(edgeOf(inner, "a.ts#g", "b.ts#K")).toBeGreaterThanOrEqual(0);
    expect(edgeOf(inner, "a.ts#g", "b.ts#h")).toBeGreaterThanOrEqual(0);
  });

  it("draws every link as itself with nothing closed", () => {
    const shown = view([]);
    expect(shown.edges.length).toBe(4);
    expect([...shown.edgeLinkCount].every((count) => count === 1)).toBe(true);
  });

  it("draws a play at the level: its notes as their closed containers, its link as their edge", () => {
    const shown = view(["a.ts", "b.ts"]);
    const turn = {
      id: "t",
      label: "t",
      events: [{ kind: "link" as const, from: "a.ts#g", to: "b.ts#K.k" }],
    };
    const focus = focusAtLevel(playFocus(small, turn, 0), shown, small);
    expect(focus?.nodes.toSorted()).toEqual([index("a.ts"), index("b.ts")].toSorted());
    const edge = edgeBetween(small, index("a.ts"), index("b.ts"));
    expect(focus?.links.map((link) => link.edge)).toEqual([edge]);
    // Written from a.ts's side: forward when a.ts is the edge's a end.
    const forward = small.edges[edge]?.a === index("a.ts");
    expect(focus?.links[0]?.ways).toBe(forward ? EdgeDirection.forward : EdgeDirection.backward);
  });
});
