import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { pairKey, type Memory } from "./memory.ts";
import { beadLanes } from "../render/beads.ts";
import {
  describePlays,
  memoryBefore,
  playEdge,
  playFocus,
  playTree,
  removalsIn,
  selectedIn,
  turnMoves,
  turnVisits,
  selectPlay,
  type PlaySelection,
} from "./plays.ts";
import { readingAt, threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { SMALL_MEMORY, SMALL_THREAD } from "./testMemory.ts";
import type { ThreadEvent, ThreadRecord, ThreadTurn } from "./thread.ts";
import { buildUniverse } from "./universe.ts";
import { denseView, deriveView, EdgeDirection, EdgeKind } from "./view.ts";

const playsAt = (checkpoint: number) => {
  const turn = ATLAS_THREAD.turns[checkpoint];
  if (turn === undefined) throw new Error(`the thread has no checkpoint ${checkpoint}`);
  return describePlays(turn, memoryBefore(almagest, ATLAS_THREAD, checkpoint));
};
const texts = (checkpoint: number) => playsAt(checkpoint).map((play) => play.text);

describe("describePlays", () => {
  it("reads each event aloud, in order", () => {
    expect(texts(0)).toEqual(["read Atlas Graph"]);
    expect(texts(2)).toEqual([
      "amended Atlas Graph",
      "amended Visual Language",
      "linked Atlas Graph to Design Lab",
    ]);
    expect(texts(5)).toEqual([
      "read Git Mirroring",
      "wrote PR Review",
      "linked PR Review to Merges",
      "linked PR Review to Threads",
    ]);
    expect(texts(6)).toEqual([
      "amended Checkpoint Graph",
      "unlinked Publishing from Checkpoint Graph",
    ]);
  });

  it("says a link to a note nobody has written reaches toward a red link", () => {
    expect(texts(7)).toEqual([
      "read Atlas Editor",
      "reached toward Depth of Field from Atlas Graph",
    ]);
    expect(playsAt(7)[1]).toMatchObject({
      kind: "reach",
      notes: ["Atlas Graph", "Depth of Field"],
    });
  });

  it("names notes from the memory, and a name it does not hold as written", () => {
    const memory = new Map([["a", { id: "a", name: "Alpha", frontier: false }]]);
    const turn = {
      id: "t",
      label: "t",
      events: [
        { kind: "write" as const, note: "b" },
        { kind: "link" as const, from: "a", to: "b" },
        { kind: "link" as const, from: "a", to: "c" },
      ],
    };
    expect(describePlays(turn, memory).map((play) => play.text)).toEqual([
      "wrote b",
      "linked Alpha to b",
      "reached toward c from Alpha",
    ]);
  });
});

describe("naming a turn's own notes", () => {
  it("names a note the turn writes, and a link to it, by the name the turn gives", () => {
    const before = new Map([["src/a.ts", { id: "src/a.ts", name: "rest", frontier: false }]]);
    const turn = {
      id: "t",
      label: "t",
      events: [
        { kind: "link" as const, from: "src/a.ts", to: "src/new.ts" },
        { kind: "write" as const, note: "src/new.ts", name: "reading" },
        { kind: "amend" as const, note: "src/a.ts" },
        { kind: "amend" as const, note: "src/b.ts", name: "view" },
        { kind: "link" as const, from: "src/new.ts", to: "src/a.ts" },
      ],
    };
    expect(describePlays(turn, before).map((play) => play.text)).toEqual([
      // Linked before it was written in the turn: a reach, named as the turn names it.
      "reached toward reading from rest",
      "wrote reading",
      "amended rest",
      "amended view",
      "linked reading to rest",
    ]);
  });

  it("falls back to the id for a written note the turn gives no name", () => {
    const turn = { id: "t", label: "t", events: [{ kind: "write" as const, note: "src/c.ts" }] };
    expect(describePlays(turn, new Map()).map((play) => play.text)).toEqual(["wrote src/c.ts"]);
  });
});

describe("playFocus", () => {
  const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
  const turn = ATLAS_THREAD.turns[5];
  if (turn === undefined) throw new Error("the thread has no turn 6");

  it("focuses a note play on its note, and a link play on both ends, its edge, and its way", () => {
    expect(playFocus(universe, turn, 1)).toEqual({
      kind: "note",
      nodes: [universe.indexOf.get("PR Review")],
      links: [],
    });
    const link = playFocus(universe, turn, 2);
    const edge = universe.edgeIndexOf.get(pairKey("PR Review", "Merges")) ?? -1;
    expect(link?.links[0]?.edge).toBe(edge);
    expect(link?.nodes).toEqual([
      universe.indexOf.get("PR Review"),
      universe.indexOf.get("Merges"),
    ]);
    const from = universe.indexOf.get("PR Review");
    expect(link?.links[0]?.ways).toBe(
      universe.edges[edge]?.a === from ? EdgeDirection.forward : EdgeDirection.backward,
    );
    expect(playFocus(universe, turn, 9)).toBeNull();
  });
});

describe("a selected play draws its own edge", () => {
  const within = (events: ReadonlyArray<ThreadEvent>) => {
    const thread = {
      ...SMALL_THREAD,
      turns: [{ id: "t0", label: "Both orders", events: [...events] }],
    };
    const universe = buildUniverse("small/thread", threadUniverse(SMALL_MEMORY, thread));
    const view = denseView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(SMALL_MEMORY, thread, 0, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const turn = thread.turns[0];
    if (turn === undefined) throw new Error("the thread has no turn");
    const play = (index: number) => playFocus(universe, turn, index);
    return { universe, view, play };
  };

  it("draws a link then unlink in one turn by the selected play, and the checkpoint's once cleared", () => {
    const { universe, view, play } = within([
      { kind: "link", from: "C", to: "F" },
      { kind: "unlink", from: "C", to: "F" },
    ]);
    const edge = universe.edgeIndexOf.get(pairKey("C", "F")) ?? -1;
    expect(edge).toBeGreaterThanOrEqual(0);
    // At the checkpoint the pair was never linked: nothing is drawn.
    expect(playEdge(view, null, edge)).toEqual({ visible: 0, kind: view.edgeKind[edge] });
    const link = play(0);
    expect(link?.kind).toBe("link");
    expect(playEdge(view, link, edge)).toEqual({ visible: 1, kind: EdgeKind.new });
    expect(beadLanes(view, false, link)).toEqual([{ edge, ways: link?.links[0]?.ways }]);
    const unlink = play(1);
    expect(unlink?.kind).toBe("unlink");
    expect(playEdge(view, unlink, edge)).toEqual({ visible: 1, kind: EdgeKind.broken });
    expect(beadLanes(view, false, unlink)).toEqual([]);
  });

  it("draws an unlink then link in one turn by the selected play, and the checkpoint's once cleared", () => {
    const { universe, view, play } = within([
      { kind: "unlink", from: "A", to: "B" },
      { kind: "link", from: "A", to: "B" },
    ]);
    const edge = universe.edgeIndexOf.get(pairKey("A", "B")) ?? -1;
    // At the checkpoint the link stands again, marked new.
    expect(playEdge(view, null, edge)).toEqual({ visible: 1, kind: EdgeKind.new });
    const unlink = play(0);
    expect(playEdge(view, unlink, edge)).toEqual({ visible: 1, kind: EdgeKind.broken });
    expect(beadLanes(view, true, unlink)).toEqual([]);
    const link = play(1);
    expect(playEdge(view, link, edge)).toEqual({ visible: 1, kind: EdgeKind.new });
    expect(beadLanes(view, false, link)).toHaveLength(1);
    // Every other edge is drawn as the checkpoint has it.
    const other = universe.edgeIndexOf.get(pairKey("B", "C")) ?? -1;
    expect(playEdge(view, unlink, other)).toEqual(playEdge(view, null, other));
  });

  it("lights only the notes of a link whose pair the universe has no edge for", () => {
    const { universe, play } = within([{ kind: "read", note: "A" }]);
    const turn = {
      id: "t",
      label: "t",
      events: [{ kind: "link" as const, from: "A", to: "Nowhere" }],
    };
    const focus = playFocus(universe, turn, 0);
    expect(focus?.links).toEqual([]);
    expect(focus?.nodes).toEqual([universe.indexOf.get("A")]);
    expect(play(0)?.kind).toBe("note");
  });
});

describe("selectPlay", () => {
  it("clears a selection for good when the reading moves, so coming back shows none", () => {
    let selection: PlaySelection = null;
    selection = selectPlay(selection, { type: "select", reading: "almagest/2", index: 1 });
    expect(selectedIn(selection, "almagest/2")).toBe(1);
    selection = selectPlay(selection, { type: "reading", reading: "almagest/3" });
    expect(selection).toBeNull();
    selection = selectPlay(selection, { type: "reading", reading: "almagest/2" });
    expect(selectedIn(selection, "almagest/2")).toBeNull();
  });

  it("hides a selection from another reading before it is cleared, and clears on request", () => {
    const selection = selectPlay(null, { type: "select", reading: "almagest/2", index: 0 });
    expect(selectedIn(selection, "almagest/3")).toBeNull();
    expect(selectPlay(selection, { type: "reading", reading: "almagest/2" })).toBe(selection);
    expect(
      selectPlay(selection, { type: "select", reading: "almagest/2", index: null }),
    ).toBeNull();
  });
});

describe("playTree", () => {
  // A codebase before the turn: one folder, two files, a class in one.
  const before = new Map(
    [
      { id: "src", name: "src", frontier: false, kind: "folder" as const },
      { id: "src/a.ts", name: "a.ts", frontier: false, kind: "file" as const, parent: "src" },
      { id: "src/b.ts", name: "b.ts", frontier: false, kind: "file" as const, parent: "src" },
      { id: "src/a.ts#A", name: "A", frontier: false, kind: "class" as const, parent: "src/a.ts" },
      {
        id: "src/b.ts#helper",
        name: "helper",
        frontier: false,
        kind: "function" as const,
        parent: "src/b.ts",
      },
    ].map((note) => [note.id, note]),
  );
  const turn: ThreadTurn = {
    id: "t",
    label: "a turn",
    events: [
      {
        kind: "write",
        note: "src/a.ts#A.run",
        name: "run",
        noteKind: "method",
        parent: "src/a.ts#A",
      },
      { kind: "amend", note: "src/a.ts#A" },
      { kind: "link", from: "src/a.ts#A.run", to: "src/b.ts#helper", linkKind: "calls" },
      { kind: "amend", note: "src/b.ts" },
      { kind: "amend", note: "src/b.ts#helper" },
      { kind: "link", from: "src/a.ts#A.run", to: "src/a.ts#A", linkKind: "references" },
      { kind: "link", from: "src/b.ts", to: "src/a.ts", linkKind: "imports" },
    ],
  };
  const tree = playTree(turn, before);

  it("groups plays by file, then symbol, with each link under its source", () => {
    expect(tree?.map((group) => [group.name, group.counts])).toEqual([
      ["a.ts", "wrote 1, amended 1, linked 2"],
      ["b.ts", "amended 1, linked 1"],
    ]);
    const [a, b] = tree ?? [];
    expect(a?.symbols.map((symbol) => symbol.text)).toEqual(["wrote run", "amended A"]);
    expect(a?.symbols[0]?.links.map((leaf) => leaf.text)).toEqual([
      "→ helper (calls)",
      "→ A (references)",
    ]);
    // The file's own amend never shows; its import sits under the file itself.
    expect(
      b?.symbols.map((symbol) => [symbol.text, symbol.links.map((leaf) => leaf.text)]),
    ).toEqual([
      ["amended helper", []],
      ["b.ts", ["→ a.ts (imports)"]],
    ]);
  });

  it("selects a symbol's move, a link alone, or every play of a file", () => {
    const [a, b] = tree ?? [];
    expect(a?.symbols[0]?.pick).toBe(0);
    expect(a?.symbols[0]?.links[0]?.play).toBe(2);
    expect(a?.plays).toEqual([0, 1, 2, 5]);
    expect(b?.plays).toEqual([4, 6]);
    // A symbol with no move of its own selects its links.
    expect(b?.symbols[1]?.pick).toBe(6);
  });

  it("marks each symbol row with its kind's shape glyph, after the story's", () => {
    const [a, b] = tree ?? [];
    expect(a?.symbols.map((symbol) => [symbol.glyph, symbol.kindGlyph, symbol.text])).toEqual([
      ["+", "●", "wrote run"],
      ["~", "■", "amended A"],
    ]);
    expect(b?.symbols.map((symbol) => symbol.kindGlyph)).toEqual(["●", "◎"]);
  });

  it("keeps a plain memory's turn flat", () => {
    const plain = ATLAS_THREAD.turns[5];
    if (plain === undefined) throw new Error("the thread has no turn 6");
    expect(playTree(plain, memoryBefore(almagest, ATLAS_THREAD, 5))).toBeNull();
  });

  it("draws several selected plays together: every note, every link", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const almagestTurn = ATLAS_THREAD.turns[5];
    if (almagestTurn === undefined) throw new Error("the thread has no turn 6");
    const one = playFocus(universe, almagestTurn, 1);
    const link = playFocus(universe, almagestTurn, 2);
    const both = playFocus(universe, almagestTurn, [1, 2]);
    expect(both?.kind).toBe("many");
    expect(new Set(both?.nodes)).toEqual(new Set([...(one?.nodes ?? []), ...(link?.nodes ?? [])]));
    expect(both?.links).toEqual(link?.links);
  });
});

describe("what a play did, as a glyph", () => {
  it("prefixes written and amended notes in the play rows, and a removal's unlink", () => {
    const turn: ThreadTurn = {
      id: "t",
      label: "t",
      events: [
        { kind: "read", note: "A" },
        { kind: "write", note: "N", name: "New" },
        { kind: "amend", note: "B" },
        { kind: "unlink", from: "C", to: "D" },
        { kind: "unlink", from: "B", to: "C" },
      ],
    };
    const removals = removalsIn(turn, new Set(["C"]), (id) => (id === "C" ? 0 : 2));
    // C's last unlink in the turn removes it.
    expect([...removals]).toEqual([[4, "C"]]);
    expect(describePlays(turn, new Map(), removals).map((play) => play.glyph)).toEqual([
      "",
      "+",
      "~",
      "",
      "×",
    ]);
    // A note with a link left is not removed.
    expect(removalsIn(turn, new Set(["C"]), () => 1).size).toBe(0);
  });

  it("carries the checkpoint's glyph on the map's label, and only for that checkpoint", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const at = (checkpoint: number) =>
      deriveView({
        universe,
        lenses: [],
        shownLensSlots: [],
        reading: readingAt(almagest, ATLAS_THREAD, checkpoint, { depth: 1, thisTurnOnly: false }),
        whole: false,
        pickedId: null,
        depth: 1,
        filters: NO_FILTERS,
      });
    const glyphOf = (checkpoint: number, id: string) => {
      const view = at(checkpoint);
      return view.nodeGlyph[view.nodeAt.get(universe.indexOf.get(id) ?? -1) ?? -1];
    };
    expect(glyphOf(5, "PR Review")).toBe("+");
    // The next checkpoint's turn did not write it: its label is plain again.
    expect(glyphOf(6, "PR Review")).toBe("");
  });

  it("lists a turn's moves in play order, at the level shown", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const turn = ATLAS_THREAD.turns[5];
    if (turn === undefined) throw new Error("the thread has no turn 6");
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, 5, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const moves = turnMoves(turn, universe, view);
    expect(moves.map((move) => move.play)).toEqual(turn.events.map((_, play) => play));
    expect(moves.map((move) => move.verb)).toEqual(["read", "write", "link", "link"]);
    const link = moves[2];
    expect(link?.to).toBe(universe.indexOf.get("Merges"));
  });
});

describe("the cursor's visits", () => {
  it("are the plays themselves in a plain memory, in their words", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    const turn = ATLAS_THREAD.turns[5];
    if (turn === undefined) throw new Error("the thread has no turn 6");
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, 5, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const visits = turnVisits(
      turn,
      universe,
      turnMoves(turn, universe, view),
      memoryBefore(almagest, ATLAS_THREAD, 5),
    );
    expect(visits.map((visit) => visit.label)).toEqual([
      "read Git Mirroring",
      "+ wrote PR Review",
      "linked PR Review to Merges",
      "linked PR Review to Threads",
    ]);
  });

  it("visit each shown thing once, combining what happened inside a closed container", () => {
    const memory: Memory = {
      id: "visits",
      notes: [
        { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
        { id: "b.ts", name: "b.ts", frontier: false, kind: "file" },
        { id: "a.ts#f", name: "f", frontier: false, kind: "function", parent: "a.ts" },
        { id: "a.ts#g", name: "g", frontier: false, kind: "function", parent: "a.ts" },
        { id: "b.ts#h", name: "h", frontier: false, kind: "function", parent: "b.ts" },
      ],
      links: [],
      lenses: [],
    };
    const thread: ThreadRecord = {
      id: "t",
      title: "t",
      memoryId: "visits",
      turns: [
        {
          id: "t0",
          label: "t0",
          events: [
            { kind: "write", note: "a.ts#f", name: "f", parent: "a.ts" },
            { kind: "link", from: "a.ts#f", to: "b.ts#h", linkKind: "calls" },
            { kind: "write", note: "a.ts#g", name: "g", parent: "a.ts" },
            { kind: "amend", note: "a.ts#g" },
            { kind: "link", from: "a.ts#g", to: "b.ts#h", linkKind: "calls" },
          ],
        },
      ],
    };
    const universe = buildUniverse(
      "visits",
      threadUniverse(memory, thread),
      threadIndex(memory, thread),
    );
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(memory, thread, 0, { depth: 0, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 0,
      filters: NO_FILTERS,
      closed: new Set([index("a.ts"), index("b.ts")]),
    });
    const turn = thread.turns[0];
    if (turn === undefined) throw new Error("no turn");
    const visits = turnVisits(
      turn,
      universe,
      turnMoves(turn, universe, view),
      memoryBefore(memory, thread, 0),
    );
    expect(visits.map((visit) => [visit.label, visit.plays])).toEqual([
      ["◎ wrote 2, amended 1 in a.ts", [0, 2, 3]],
      ["linked f to h, +1 more", [1, 4]],
    ]);
    expect(visits[0]?.verb).toBe("write");
    expect(visits[0]?.note).toBe(index("a.ts"));
  });
});
