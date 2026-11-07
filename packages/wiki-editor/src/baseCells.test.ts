import { describe, expect, it } from "vite-plus/test";

import { cellParts, rowDocument } from "./baseCells";

describe("rowDocument", () => {
  it("opens a canvas by its file, at any depth, as it does a base", () => {
    expect(rowDocument({ file: "Board.canvas" })).toBe("Board.canvas");
    expect(rowDocument({ file: "maps/Board.canvas" })).toBe("maps/Board.canvas");
    expect(rowDocument({ file: "Tasks.base" })).toBe("Tasks.base");
    expect(rowDocument({ file: "Photo.png" })).toBeNull();
  });
});

describe("cellParts", () => {
  it("opens the notes a cell links, with their aliases, and keeps the text around them", () => {
    expect(cellParts("By [[Venkat|V]] and [[Alpha#Intro]]")).toEqual([
      { kind: "text", text: "By " },
      { kind: "link", name: "Venkat", text: "V" },
      { kind: "text", text: " and " },
      { kind: "link", name: "Alpha", text: "Alpha" },
    ]);
  });

  it("reads a typed link as its display text, or beside the name when it's only types", () => {
    expect(cellParts("[[Auth|the flow @depends_on]] [[Auth#Top|@blocks]] [[Sam|\\@sam]]")).toEqual([
      { kind: "link", name: "Auth", text: "the flow depends_on" },
      { kind: "text", text: " " },
      { kind: "link", name: "Auth", text: "Auth blocks" },
      { kind: "text", text: " " },
      { kind: "link", name: "Sam", text: "@sam" },
    ]);
  });

  it("joins a list, and shows empty values as nothing", () => {
    expect(cellParts(["[[Beta]]", 2, true, null])).toEqual([
      { kind: "link", name: "Beta", text: "Beta" },
      { kind: "text", text: ", " },
      { kind: "text", text: "2" },
      { kind: "text", text: ", " },
      { kind: "text", text: "Yes" },
    ]);
    expect(cellParts(null)).toEqual([]);
  });

  it("reads an ISO time as a date, and leaves other text alone", () => {
    const [part] = cellParts("2026-10-30T12:00:00.000Z");
    expect(part?.kind).toBe("text");
    expect(part?.kind === "text" && part.text).not.toBe("2026-10-30T12:00:00.000Z");
    expect(cellParts("2026-10-30")).toEqual([{ kind: "text", text: "2026-10-30" }]);
  });
});
