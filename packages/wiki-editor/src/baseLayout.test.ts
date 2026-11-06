import { describe, expect, it } from "vite-plus/test";

import { parseCellText } from "./baseLayout";

describe("parseCellText", () => {
  it("keeps the type the cell held: a number, a list, or text", () => {
    expect(parseCellText("12", 3)).toBe(12);
    expect(parseCellText("twelve", 3)).toBe("twelve");
    expect(parseCellText("a, b ,, c", ["x"])).toEqual(["a", "b", "c"]);
    expect(parseCellText("12", "open")).toBe("12");
  });

  it("removes the property when emptied", () => {
    expect(parseCellText("  ", "open")).toBeNull();
  });
});
