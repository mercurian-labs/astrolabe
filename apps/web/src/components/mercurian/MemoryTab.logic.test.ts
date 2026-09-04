import { describe, expect, it } from "vite-plus/test";

import { memoryTabRows } from "./MemoryTab.logic";

describe("memoryTabRows", () => {
  it("orders marked, hand, and unmarked changes with their attribution", () => {
    const rows = memoryTabRows({
      marked: [
        {
          oid: "a",
          title: "Remember it",
          turnId: "turn-1",
          authoredAt: "2026-09-04T10:00:00.000Z",
          diff: "marked",
        },
      ],
      hand: [
        { oid: "b", title: "Hand edit", authoredAt: "2026-09-04T11:00:00.000Z", diff: "hand" },
      ],
      unmarked: { diff: "unmarked" },
    });
    expect(rows.map(({ kind, attribution, turnId }) => ({ kind, attribution, turnId }))).toEqual([
      { kind: "marked", attribution: "Landed by the assistant", turnId: "turn-1" },
      { kind: "hand", attribution: "Committed by hand", turnId: null },
      { kind: "unmarked", attribution: "Held by the line snapshot", turnId: null },
    ]);
  });
});
