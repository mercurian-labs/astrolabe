import { describe, expect, it } from "vite-plus/test";

import { vimKeycaps, vimKeyNotation, vimMappingDraftIssue } from "./VimrcSettings.logic";

const press = (
  key: string,
  modifiers: Partial<Record<"ctrl" | "alt" | "meta" | "shift", true>> = {},
) => ({
  key,
  ctrlKey: modifiers.ctrl === true,
  altKey: modifiers.alt === true,
  metaKey: modifiers.meta === true,
  shiftKey: modifiers.shift === true,
});

describe("vimKeyNotation", () => {
  it("names held and special keys in Vim notation", () => {
    const linux = { mac: false };
    expect(vimKeyNotation(press("d", { ctrl: true }), linux)).toBe("<C-d>");
    expect(vimKeyNotation(press("D", { ctrl: true, shift: true }), linux)).toBe("<C-S-D>");
    expect(vimKeyNotation(press("x", { alt: true }), linux)).toBe("<A-x>");
    expect(vimKeyNotation(press(" "), linux)).toBe("<Space>");
    expect(vimKeyNotation(press("F2"), linux)).toBe("<F2>");
    expect(vimKeyNotation(press("PageDown"), linux)).toBe("<PageDown>");
    expect(vimKeyNotation(press("Escape", { ctrl: true }), linux)).toBe("<C-Esc>");
    expect(vimKeyNotation(press("ArrowUp", { shift: true, alt: true }), linux)).toBe("<A-S-Up>");
  });

  it("leaves typing, the field's own keys, and Cmd to the field", () => {
    const mac = { mac: true };
    expect(vimKeyNotation(press("j"), mac)).toBeNull();
    expect(vimKeyNotation(press("J", { shift: true }), mac)).toBeNull();
    expect(vimKeyNotation(press("<"), mac)).toBeNull();
    expect(vimKeyNotation(press("Backspace"), mac)).toBeNull();
    expect(vimKeyNotation(press("Tab", { shift: true }), mac)).toBeNull();
    expect(vimKeyNotation(press("Enter"), mac)).toBeNull();
    expect(vimKeyNotation(press("Escape"), mac)).toBeNull();
    expect(vimKeyNotation(press("v", { meta: true }), mac)).toBeNull();
    expect(vimKeyNotation(press("Control", { ctrl: true }), mac)).toBeNull();
    // Option types a character on a Mac, as Vim there reads it.
    expect(vimKeyNotation(press("∂", { alt: true }), mac)).toBeNull();
    expect(vimKeyNotation(press("d", { ctrl: true }), mac)).toBe("<C-d>");
  });
});

describe("vimKeycaps", () => {
  it("shows bracketed keys as one keycap each", () => {
    expect(vimKeycaps("jk")).toEqual(["j", "k"]);
    expect(vimKeycaps("<C-d>")).toEqual(["C-d"]);
    expect(vimKeycaps("<Space>w<")).toEqual(["Space", "w", "<"]);
  });
});

describe("vimMappingDraftIssue", () => {
  const mappings = [
    { mode: "insert" as const, keys: "jk" },
    { mode: "normal" as const, keys: "H" },
  ];
  const draft = { mode: "normal" as const, keys: "L", does: "$", recursive: false };

  it("accepts a mapping, and the row being edited keeping its keys", () => {
    expect(vimMappingDraftIssue(draft, mappings, null)).toBeNull();
    expect(
      vimMappingDraftIssue({ ...draft, keys: "H", does: "0" }, mappings, mappings[1]!),
    ).toBeNull();
  });

  it("stops empty or spaced keys, an empty right side, moded ex maps, and a second mapping", () => {
    expect(vimMappingDraftIssue({ ...draft, keys: "" }, mappings, null)).toMatch(/keys/);
    expect(vimMappingDraftIssue({ ...draft, keys: "a b" }, mappings, null)).toMatch(/<Space>/);
    expect(vimMappingDraftIssue({ ...draft, does: " " }, mappings, null)).toMatch(/sends/);
    expect(vimMappingDraftIssue({ ...draft, keys: ":W" }, mappings, null)).toMatch(/All/);
    expect(vimMappingDraftIssue({ ...draft, keys: ":W", mode: "all" }, mappings, null)).toBeNull();
    expect(vimMappingDraftIssue({ ...draft, keys: "H" }, mappings, null)).toBe(
      "H is already mapped in Normal.",
    );
  });
});
