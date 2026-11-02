import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { openingDiffBase, pickDiffBase } from "./fileDiffBase";

const turn = (text: string, running = false) => ({
  text,
  hash: "start",
  turn: { threadId: ThreadId.make("thread:agent"), running },
});

describe("openingDiffBase", () => {
  it("opens on the turn while the file has changes from it, and on HEAD otherwise", () => {
    expect(openingDiffBase(turn("before\n"), "after\n")).toBe("turn");
    expect(openingDiffBase(turn("same\n"), "same\n")).toBe("head");
  });

  it("opens on a running turn before its write has been read back", () => {
    expect(openingDiffBase(turn("same\n", true), "same\n")).toBe("turn");
  });
});

describe("pickDiffBase", () => {
  it("uses HEAD without a turn base, even when the turn was picked", () => {
    expect(pickDiffBase(null, null, undefined)).toBe("head");
    expect(pickDiffBase("turn", null, "turn")).toBe("head");
  });

  it("keeps the base picked in the header over the one the file opened on", () => {
    expect(pickDiffBase("head", turn("before\n"), "turn")).toBe("head");
    expect(pickDiffBase("turn", turn("same\n"), "head")).toBe("turn");
    expect(pickDiffBase(null, turn("before\n"), "turn")).toBe("turn");
  });

  it("waits for the turn base before picking, unless one was picked", () => {
    expect(pickDiffBase(null, undefined, undefined)).toBeUndefined();
    expect(pickDiffBase("head", undefined, undefined)).toBe("head");
  });
});
