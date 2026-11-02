import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";

import {
  boundsOfSpan,
  excerptSpans,
  expandSpan,
  mapBounds,
  spanOfBounds,
  touchingGroups,
  updateSpans,
} from "./excerpts.ts";

const doc = (lines: number) =>
  Text.of(Array.from({ length: lines }, (_, index) => `line ${index + 1}`));

describe("excerptSpans", () => {
  // Rows 1-10, context 2.
  it("clamps a match on the first line to the file", () => {
    expect(excerptSpans([{ line: 1 }], 10)).toEqual([{ first: 1, last: 3, items: [0] }]);
  });

  it("merges excerpts that touch", () => {
    expect(excerptSpans([{ line: 1 }, { line: 6 }], 10)).toEqual([
      { first: 1, last: 8, items: [0, 1] },
    ]);
  });

  it("keeps excerpts apart with a hidden line between them", () => {
    expect(excerptSpans([{ line: 1 }, { line: 8 }], 10)).toEqual([
      { first: 1, last: 3, items: [0] },
      { first: 6, last: 10, items: [1] },
    ]);
  });

  it("merges adjacent lines with no context", () => {
    expect(excerptSpans([{ line: 5 }, { line: 4 }], 10, 0)).toEqual([
      { first: 4, last: 5, items: [1, 0] },
    ]);
  });

  it("covers a range of several lines", () => {
    expect(excerptSpans([{ line: 4, endLine: 6 }], 20, 1)).toEqual([
      { first: 3, last: 7, items: [0] },
    ]);
  });
});

describe("expandSpan and touchingGroups", () => {
  it("merges excerpts that grow into each other, and clamps at the file's ends", () => {
    // Context 1 around rows 3, 7 and 15: rows 2-4, 6-8 and 14-16.
    const spans = excerptSpans([{ line: 3 }, { line: 7 }, { line: 15 }], 16, 1);
    const grown = spans.map((span) => expandSpan(span, 16, 1, 1));
    expect(grown).toEqual([
      { first: 1, last: 5 },
      { first: 5, last: 9 },
      { first: 13, last: 16 },
    ]);
    expect(touchingGroups(grown)).toEqual([[0, 1]]);
  });

  it("leaves excerpts with lines between them alone", () => {
    expect(
      touchingGroups([
        { first: 1, last: 3 },
        { first: 5, last: 6 },
      ]),
    ).toEqual([]);
  });
});

describe("updateSpans", () => {
  it("keeps context the person added where new results overlap, and drops the rest", () => {
    const previous = [
      { first: 1, last: 12 },
      { first: 30, last: 34 },
    ];
    expect(updateSpans(previous, [{ first: 8, last: 12 }])).toEqual([
      { first: 1, last: 12, kept: [0] },
    ]);
  });
});

describe("mapBounds", () => {
  const text = doc(10);
  const bounds = boundsOfSpan(text, { first: 4, last: 6 });

  it("grows with lines inserted inside and moves with lines inserted above", () => {
    const inside = ChangeSet.of({ from: text.line(5).from, insert: "new\n" }, text.length);
    const afterInside = inside.apply(text);
    expect(spanOfBounds(afterInside, mapBounds(bounds, inside, afterInside))).toEqual({
      first: 4,
      last: 7,
    });
    const above = ChangeSet.of({ from: 0, insert: "a\nb\n" }, text.length);
    const afterAbove = above.apply(text);
    expect(spanOfBounds(afterAbove, mapBounds(bounds, above, afterAbove))).toEqual({
      first: 6,
      last: 8,
    });
  });

  it("keeps text typed at either edge inside", () => {
    const changes = ChangeSet.of(
      [
        { from: bounds.from, insert: "X" },
        { from: bounds.to, insert: "Y" },
      ],
      text.length,
    );
    const after = changes.apply(text);
    const mapped = mapBounds(bounds, changes, after);
    expect(after.sliceString(mapped.from, mapped.to)).toBe("Xline 4\nline 5\nline 6Y");
  });

  it("shrinks to one line when its text is deleted", () => {
    const changes = ChangeSet.of({ from: bounds.from, to: bounds.to + 1 }, text.length);
    const after = changes.apply(text);
    const mapped = mapBounds(bounds, changes, after);
    expect(spanOfBounds(after, mapped)).toEqual({ first: 4, last: 4 });
    expect(after.sliceString(mapped.from, mapped.to)).toBe("line 7");
  });
});
