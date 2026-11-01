import { describe, expect, it } from "vite-plus/test";

import { recentChats } from "./recentChats";

const open = (...keys: string[]) => new Set(keys);

describe("recentChats", () => {
  it("puts the chats on screen first and keeps the rest in the order they were shown", () => {
    expect(recentChats(["a", "b", "c"], ["c"], open("a", "b", "c"))).toEqual(["c", "a", "b"]);
  });

  it("keeps the same list when nothing changed", () => {
    const recent = ["a", "b"];
    expect(recentChats(recent, ["a"], open("a", "b"))).toBe(recent);
  });

  it("drops closed chats", () => {
    expect(recentChats(["a", "b", "c"], ["a"], open("a", "c"))).toEqual(["a", "c"]);
  });

  it("lets go of the least recently shown chat past the cap", () => {
    const recent = ["e", "d", "c", "b", "a"];
    expect(recentChats(recent, ["f"], open("a", "b", "c", "d", "e", "f"), 5)).toEqual([
      "f",
      "e",
      "d",
      "c",
      "b",
    ]);
  });

  it("keeps every chat on screen, even past the cap", () => {
    expect(recentChats(["x"], ["a", "b", "c"], open("a", "b", "c", "x"), 2)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
