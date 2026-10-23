import { describe, expect, it } from "vite-plus/test";

import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import almagest from "../../fixtures/almagest.json";
import { pairKey } from "./memory.ts";
import { readingAt, threadUniverse } from "./reading.ts";
import { SMALL_MEMORY, SMALL_THREAD } from "./testMemory.ts";
import type { ThreadRecord } from "./thread.ts";

const sorted = (set: ReadonlySet<string>) => [...set].toSorted();
const options = { depth: 1, thisTurnOnly: false };

describe("readingAt", () => {
  it("raises a read note with its neighbors receded", () => {
    const reading = readingAt(SMALL_MEMORY, SMALL_THREAD, 0, options);
    expect(sorted(reading.now)).toEqual(["A"]);
    expect(sorted(reading.earlier)).toEqual([]);
    expect(sorted(reading.around)).toEqual(["B", "R"]);
    expect(reading.noteMarks.size).toBe(0);
    expect(reading.state.byId.get("R")?.frontier).toBe(true);
  });

  it("reaches further with more depth", () => {
    const reading = readingAt(SMALL_MEMORY, SMALL_THREAD, 0, { ...options, depth: 2 });
    expect(sorted(reading.around)).toEqual(["B", "C", "E", "R"]);
  });

  it("keeps earlier turns behind the current one and marks what the turn did", () => {
    const reading = readingAt(SMALL_MEMORY, SMALL_THREAD, 1, options);
    expect(sorted(reading.now)).toEqual(["B", "D"]);
    expect(sorted(reading.earlier)).toEqual(["A"]);
    expect(reading.noteMarks.get("B")).toEqual({ mark: "amended", turn: 1 });
    expect(reading.linkMarks.get(pairKey("B", "D"))).toMatchObject({ mark: "new", turn: 1 });
    expect(reading.state.pairByKey.has(pairKey("B", "D"))).toBe(true);
  });

  it("fills a red link where it stands, breaks a removed link, and reaches a new red link", () => {
    const reading = readingAt(SMALL_MEMORY, SMALL_THREAD, 2, options);
    expect(reading.state.byId.get("R")?.frontier).toBe(false);
    expect(reading.noteMarks.get("R")).toEqual({ mark: "new", turn: 2 });
    expect(reading.state.byId.get("New Idea")?.frontier).toBe(true);
    expect(reading.linkMarks.get(pairKey("C", "New Idea"))).toMatchObject({ mark: "new" });
    expect(reading.linkMarks.get(pairKey("A", "B"))).toMatchObject({ mark: "broken", turn: 2 });
    expect(reading.state.pairByKey.has(pairKey("A", "B"))).toBe(false);
    // Earlier marks persist beside the current turn's.
    expect(reading.noteMarks.get("B")?.mark).toBe("amended");
  });

  it("marks a link the turn added both ways as new both ways", () => {
    const thread = {
      ...SMALL_THREAD,
      turns: [
        {
          id: "t0",
          label: "Link C and F both ways",
          events: [
            { kind: "link" as const, from: "C", to: "F" },
            { kind: "link" as const, from: "F", to: "C" },
          ],
        },
        { id: "t1", label: "Link F to A", events: [{ kind: "link" as const, from: "F", to: "A" }] },
      ],
    };
    const reading = readingAt(SMALL_MEMORY, thread, 1, options);
    expect(reading.linkMarks.get(pairKey("C", "F"))).toMatchObject({ turn: 0, both: true });
    expect(reading.linkMarks.get(pairKey("A", "F"))).toMatchObject({
      from: "F",
      to: "A",
      both: false,
    });
  });

  it("keeps new only the ways a link still stands after the turn takes one back", () => {
    const turn = (events: ThreadRecord["turns"][number]["events"]) => ({
      ...SMALL_THREAD,
      turns: [{ id: "t0", label: "Link and unlink", events }],
    });
    const both = readingAt(
      SMALL_MEMORY,
      turn([
        { kind: "link", from: "C", to: "F" },
        { kind: "link", from: "F", to: "C" },
        { kind: "unlink", from: "F", to: "C" },
      ]),
      0,
      options,
    );
    expect(both.linkMarks.get(pairKey("C", "F"))).toMatchObject({
      mark: "new",
      from: "C",
      to: "F",
      both: false,
    });
    const undone = readingAt(
      SMALL_MEMORY,
      turn([
        { kind: "link", from: "C", to: "F" },
        { kind: "unlink", from: "C", to: "F" },
      ]),
      0,
      options,
    );
    expect(undone.linkMarks.has(pairKey("C", "F"))).toBe(false);
    // A link that stood before the turn, linked again and then removed, is broken.
    const removed = readingAt(
      SMALL_MEMORY,
      turn([
        { kind: "link", from: "A", to: "B" },
        { kind: "unlink", from: "A", to: "B" },
      ]),
      0,
      options,
    );
    expect(removed.linkMarks.get(pairKey("A", "B"))).toMatchObject({ mark: "broken" });
  });

  it("derives each checkpoint from the record up to it, and nothing after", () => {
    const early = readingAt(SMALL_MEMORY, SMALL_THREAD, 1, options);
    expect(early.state.byId.has("New Idea")).toBe(false);
    expect(early.state.pairByKey.has(pairKey("A", "B"))).toBe(true);
    expect(early.state.byId.get("R")?.frontier).toBe(true);
  });

  it("narrows to the checkpoint's own turn", () => {
    const reading = readingAt(SMALL_MEMORY, SMALL_THREAD, 2, { ...options, thisTurnOnly: true });
    expect(reading.earlier.size).toBe(0);
    expect(reading.noteMarks.has("B")).toBe(false);
    expect(reading.noteMarks.get("R")?.mark).toBe("new");
    // The removed link's far end stays in view where the link stood.
    expect(reading.now.has("A") && reading.now.has("B")).toBe(true);
  });

  it("clamps the checkpoint to the record", () => {
    expect(readingAt(SMALL_MEMORY, SMALL_THREAD, 99, options).checkpoint).toBe(2);
    expect(readingAt(SMALL_MEMORY, SMALL_THREAD, -3, options).checkpoint).toBe(0);
  });
});

describe("a note written, then amended", () => {
  const thread = {
    ...SMALL_THREAD,
    turns: [
      { id: "t0", label: "Read A", events: [{ kind: "read" as const, note: "A" }] },
      {
        id: "t1",
        label: "Write a note, and touch it again",
        events: [
          { kind: "write" as const, note: "Fresh" },
          { kind: "amend" as const, note: "Fresh" },
        ],
      },
      { id: "t2", label: "Amend it", events: [{ kind: "amend" as const, note: "Fresh" }] },
    ],
  };

  it("is new at the checkpoint that wrote it, even if that turn amended it too", () => {
    for (const thisTurnOnly of [false, true]) {
      const reading = readingAt(SMALL_MEMORY, thread, 1, { depth: 1, thisTurnOnly });
      expect(reading.noteMarks.get("Fresh")).toEqual({ mark: "new", turn: 1 });
    }
  });

  it("is amended at the checkpoint of a later amendment, with or without this turn only", () => {
    for (const thisTurnOnly of [false, true]) {
      const reading = readingAt(SMALL_MEMORY, thread, 2, { depth: 1, thisTurnOnly });
      expect(reading.noteMarks.get("Fresh")).toEqual({ mark: "amended", turn: 2 });
    }
  });
});

describe("threadUniverse", () => {
  it("labels and groups a written note as its write and later amends say, else by its id", () => {
    const thread: ThreadRecord = {
      ...SMALL_THREAD,
      turns: [
        {
          id: "t0",
          label: "Write two notes",
          events: [
            { kind: "write", note: "src/a.ts#function:run", name: "run", group: "src/a.ts" },
            { kind: "write", note: "Bare" },
            { kind: "link", from: "Bare", to: "Red" },
          ],
        },
        {
          id: "t1",
          label: "Rename it",
          events: [{ kind: "amend", note: "src/a.ts#function:run", name: "start" }],
        },
      ],
    };
    const notes = new Map(
      threadUniverse(SMALL_MEMORY, thread).notes.map((note) => [note.id, note]),
    );
    expect(notes.get("src/a.ts#function:run")).toMatchObject({
      name: "start",
      group: "src/a.ts",
      frontier: false,
    });
    expect(notes.get("Bare")).toMatchObject({ name: "Bare", frontier: false });
    expect(notes.get("Red")).toMatchObject({ name: "Red", frontier: true });
  });

  it("holds every note and link the thread ever reaches, removed links included", () => {
    const universe = threadUniverse(SMALL_MEMORY, SMALL_THREAD);
    expect(universe.notes.some((note) => note.id === "New Idea")).toBe(true);
    const keys = universe.links.map((link) => `${link.from}>${link.to}`);
    expect(keys).toContain("A>B");
    expect(keys).toContain("B>D");
    expect(keys).toContain("C>New Idea");
  });
});

describe("the almagest thread fixture", () => {
  it("exercises every surfacing rule in one playback", () => {
    const last = ATLAS_THREAD.turns.length - 1;
    const final = readingAt(almagest, ATLAS_THREAD, last, options);
    const marks = [...final.noteMarks.values()].map((mark) => mark.mark);
    const linkMarks = [...final.linkMarks.values()].map((mark) => mark.mark);
    expect(marks).toContain("amended");
    expect(marks).toContain("new");
    expect(linkMarks).toContain("new");
    expect(linkMarks).toContain("broken");
    // PR Review was a red link and is filled in place.
    expect(almagest.notes.find((note) => note.id === "PR Review")?.frontier).toBe(true);
    expect(final.state.byId.get("PR Review")?.frontier).toBe(false);
    // Red links reached toward appear as frontier notes.
    expect(final.state.byId.get("Depth of Field")?.frontier).toBe(true);
    expect(ATLAS_THREAD.turns.length).toBeGreaterThanOrEqual(10);
    for (let checkpoint = 0; checkpoint <= last; checkpoint += 1) {
      expect(readingAt(almagest, ATLAS_THREAD, checkpoint, options).now.size).toBeGreaterThan(0);
    }
  });
});

describe("links of several kinds on one pair", () => {
  const thread: ThreadRecord = {
    id: "kinds",
    title: "kinds",
    memoryId: "small",
    turns: [
      {
        id: "t0",
        label: "link two ways of meaning",
        events: [
          { kind: "link", from: "C", to: "F", linkKind: "calls" },
          { kind: "link", from: "C", to: "F", linkKind: "references" },
        ],
      },
      {
        id: "t1",
        label: "unlink one",
        events: [{ kind: "unlink", from: "C", to: "F", linkKind: "calls" }],
      },
      {
        id: "t2",
        label: "unlink the other",
        events: [{ kind: "unlink", from: "C", to: "F", linkKind: "references" }],
      },
    ],
  };
  const at = (checkpoint: number) => readingAt(SMALL_MEMORY, thread, checkpoint, options);
  const calls = { from: "C", to: "F", kind: "calls" as const };
  const references = { from: "C", to: "F", kind: "references" as const };

  it("keeps the connection and the remaining kind after one kind is unlinked", () => {
    expect(at(0).state.outgoing.get("C")?.has("F")).toBe(true);
    expect([at(0).linkStands(calls), at(0).linkStands(references)]).toEqual([true, true]);
    const one = at(1);
    expect(one.state.outgoing.get("C")?.has("F")).toBe(true);
    expect([one.linkStands(calls), one.linkStands(references)]).toEqual([false, true]);
    // Still linked: the pair is not broken.
    expect(one.linkMarks.get(pairKey("C", "F"))?.mark).not.toBe("broken");
    const none = at(2);
    expect(none.state.outgoing.get("C")?.has("F")).toBe(false);
    expect(none.linkMarks.get(pairKey("C", "F"))?.mark).toBe("broken");
  });

  it("holds every kind in the thread universe", () => {
    const kinds = threadUniverse(SMALL_MEMORY, thread)
      .links.filter((link) => link.from === "C" && link.to === "F")
      .map((link) => link.kind);
    expect(kinds.toSorted()).toEqual(["calls", "references"]);
  });
});
