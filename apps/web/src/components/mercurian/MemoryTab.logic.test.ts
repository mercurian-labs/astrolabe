import { describe, expect, it } from "vite-plus/test";

import { memoryTabRevertTarget, memoryTabRows, memoryTabUnreviewedCount } from "./MemoryTab.logic";

describe("memoryTabRows", () => {
  it("orders marked, hand, and unmarked changes with their attribution", () => {
    const changes = {
      marked: [
        {
          oid: "a",
          title: "Remember it",
          turnId: "turn-1",
          authoredAt: "2026-09-04T10:00:00.000Z",
          diff: "marked",
          reviewed: true,
        },
      ],
      hand: [
        {
          oid: "b",
          title: "Hand edit",
          authoredAt: "2026-09-04T11:00:00.000Z",
          diff: "hand",
          reviewed: false,
        },
      ],
      unmarked: { diff: "unmarked" },
      unreviewedCount: 2,
    };
    const rows = memoryTabRows(changes);
    expect(rows.map(({ kind, attribution, turnId }) => ({ kind, attribution, turnId }))).toEqual([
      { kind: "marked", attribution: "Landed by the assistant", turnId: "turn-1" },
      { kind: "hand", attribution: "Committed by hand", turnId: null },
      { kind: "unmarked", attribution: "Held by the line snapshot", turnId: null },
    ]);
    expect(rows.map(({ reviewed }) => reviewed)).toEqual([true, false, false]);
    expect(memoryTabUnreviewedCount(changes)).toBe(2);
    expect(rows.map(memoryTabRevertTarget)).toEqual([
      { kind: "commit", commitOid: "a" },
      { kind: "commit", commitOid: "b" },
      { kind: "unmarked" },
    ]);
  });
});
