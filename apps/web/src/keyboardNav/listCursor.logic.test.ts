import { describe, expect, it } from "vite-plus/test";

import { listMoveForKey, moveListCursor } from "./listCursor.logic";

describe("listMoveForKey", () => {
  it("steps with j, k and the arrows, and jumps with G, Home and End", () => {
    expect(listMoveForKey("j", false).move).toBe("next");
    expect(listMoveForKey("ArrowDown", false).move).toBe("next");
    expect(listMoveForKey("k", false).move).toBe("previous");
    expect(listMoveForKey("ArrowUp", false).move).toBe("previous");
    expect(listMoveForKey("G", false).move).toBe("last");
    expect(listMoveForKey("End", false).move).toBe("last");
    expect(listMoveForKey("Home", false).move).toBe("first");
  });

  it("jumps to the first row on gg, and forgets a lone g at any other key", () => {
    const first = listMoveForKey("g", false);
    expect(first).toEqual({ move: null, pendingG: true });
    expect(listMoveForKey("g", first.pendingG)).toEqual({ move: "first", pendingG: false });
    expect(listMoveForKey("x", true)).toEqual({ move: null, pendingG: false });
    expect(listMoveForKey("j", true)).toEqual({ move: "next", pendingG: false });
  });

  it("leaves other keys alone", () => {
    expect(listMoveForKey("Enter", false).move).toBeNull();
    expect(listMoveForKey(" ", false).move).toBeNull();
  });
});

describe("moveListCursor", () => {
  // A group header (not a row), two rows, a folded row, and a last row.
  const reachable = [false, true, true, false, true];

  it("steps over what cannot be reached", () => {
    expect(moveListCursor(reachable, 1, "next")).toBe(2);
    expect(moveListCursor(reachable, 2, "next")).toBe(4);
    expect(moveListCursor(reachable, 4, "previous")).toBe(2);
  });

  it("jumps to the first and last reachable rows", () => {
    expect(moveListCursor(reachable, 2, "first")).toBe(1);
    expect(moveListCursor(reachable, 1, "last")).toBe(4);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(moveListCursor(reachable, 4, "next")).toBeNull();
    expect(moveListCursor(reachable, 1, "previous")).toBeNull();
  });

  it("starts at an end with no row yet, and finds nothing in an empty list", () => {
    expect(moveListCursor(reachable, -1, "next")).toBe(1);
    expect(moveListCursor(reachable, -1, "previous")).toBe(4);
    expect(moveListCursor([], -1, "next")).toBeNull();
    expect(moveListCursor([false], -1, "first")).toBeNull();
  });
});
