import { describe, expect, it } from "vite-plus/test";

import {
  memoryMergeHomeOutcomeCopy,
  memoryMergeHomeRefusalCopy,
  memoryMergeHomeWalk,
  memoryTabRevertTarget,
  memoryTabRows,
  memoryTabUnreviewedCount,
} from "./MemoryTab.logic";

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

  it("walks unreviewed commits oldest-first and leaves unmarked last", () => {
    const walk = memoryMergeHomeWalk({
      marked: [
        {
          oid: "new",
          title: "New",
          turnId: "turn-2",
          authoredAt: "2026-09-04T12:00:00.000Z",
          diff: "new",
          reviewed: false,
        },
        {
          oid: "reviewed",
          title: "Reviewed",
          turnId: "turn-1",
          authoredAt: "2026-09-04T09:00:00.000Z",
          diff: "reviewed",
          reviewed: true,
        },
      ],
      hand: [
        {
          oid: "old",
          title: "Old",
          authoredAt: "2026-09-04T10:00:00.000Z",
          diff: "old",
          reviewed: false,
        },
      ],
      unmarked: { diff: "tail" },
      unreviewedCount: 3,
    });
    expect(walk.map(({ id }) => id)).toEqual(["old", "new", "unmarked"]);
  });

  it("states merge outcomes and typed refusals", () => {
    expect(memoryMergeHomeOutcomeCopy({ kind: "merged", commitOid: "1234567890" })).toContain(
      "12345678",
    );
    expect(memoryMergeHomeOutcomeCopy({ kind: "deferred-to-push" })).toContain(
      "ships with the pull request",
    );
    expect(
      memoryMergeHomeOutcomeCopy({ kind: "conflict", conflicts: [{ path: "Memory.md" }] }),
    ).toContain("Memory.md");
    expect(
      memoryMergeHomeRefusalCopy({ _tag: "MemoryReviewBlockedError", reason: "turn-active" }),
    ).toContain("active turn");
    expect(
      memoryMergeHomeRefusalCopy({ _tag: "MergeMemoryHomeBlockedError", reason: "git-too-old" }),
    ).toContain("Git 2.38");
    expect(
      memoryMergeHomeRefusalCopy({ _tag: "MergeMemoryHomeBlockedError", reason: "checkout-dirty" }),
    ).toContain("Commit or stash");
    expect(
      memoryMergeHomeRefusalCopy({ _tag: "MergeMemoryHomeBlockedError", reason: "main-missing" }),
    ).toContain("local memory home branch");
  });
});
