import { describe, expect, it } from "vite-plus/test";

import { parseKeybindingShortcut, splitKeybindingValue } from "./keybindings.ts";

describe("splitKeybindingValue", () => {
  it("splits an ordinary shortcut into its tokens", () => {
    expect(splitKeybindingValue("mod+shift+d")).toEqual(["mod", "shift", "d"]);
  });

  it("reads a trailing run of separators as the plus key", () => {
    expect(splitKeybindingValue("mod++")).toEqual(["mod", "+"]);
    expect(splitKeybindingValue("+")).toEqual(["+"]);
  });

  it("normalizes case and surrounding space, so display and parsing agree", () => {
    expect(splitKeybindingValue(" Mod + K ")).toEqual(["mod", "k"]);
  });

  it("keeps interior gaps, which is what makes them parse as invalid", () => {
    expect(splitKeybindingValue("mod++k")).toEqual(["mod", "", "k"]);
    expect(parseKeybindingShortcut("mod++k")).toBeNull();
  });

  it("agrees with the parser about which token is the key", () => {
    const tokens = splitKeybindingValue("mod++");
    expect(parseKeybindingShortcut("mod++")?.key).toBe(tokens[tokens.length - 1]);
  });
});
