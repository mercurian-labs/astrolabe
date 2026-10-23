import { DEFAULT_RESOLVED_TRIGGERS } from "@t3tools/shared/keybindingTriggers";
import { describe, expect, it } from "vite-plus/test";

import {
  commandLineField,
  exLineOf,
  parseExCommand as parseWith,
  queryForField,
} from "./exCommands";

const parseExCommand = (line: string) => parseWith(line, DEFAULT_RESOLVED_TRIGGERS);

describe("the palette's ex line", () => {
  it("is the query after its leading colon", () => {
    expect(exLineOf(":q")).toBe("q");
    expect(exLineOf("::  e notes")).toBe("e notes");
    expect(exLineOf(":")).toBe("");
    expect(exLineOf("quit")).toBeNull();
    expect(exLineOf(">actions")).toBeNull();
  });

  it("shows the Command Palette's field without its colon, and switches on a leading : or >", () => {
    // Typing `:` or `>` first in Search: the query takes a colon, and the field shows what follows.
    for (const door of [":", ">"]) {
      const typed = queryForField(door, false, true);
      expect(commandLineField(typed, true)).toEqual({ commandLine: true, text: "" });
    }
    expect(queryForField(">sp", false, true)).toBe(":sp");
    // A `>` past the first character, or in a submenu, is only typed.
    expect(queryForField("a>b", false, true)).toBe("a>b");
    expect(queryForField(">", false, false)).toBe(">");
    // In the Command Palette a typed `>` or `:` is the line's own.
    expect(queryForField(">", true, true)).toBe(":>");
    // Typing on: the colon stays the query's, out of the field.
    const line = queryForField("sp", true, true);
    expect(line).toBe(":sp");
    expect(exLineOf(line)).toBe("sp");
    expect(commandLineField(line, true).text).toBe("sp");
    // Emptied (Backspace in the empty field clears the query), it is Search again.
    expect(commandLineField("", true)).toEqual({ commandLine: false, text: "" });
    // Only at the palette's root: a submenu's query is its own, colon and all.
    expect(commandLineField(":x", false)).toEqual({ commandLine: false, text: ":x" });
    expect(commandLineField("a:b", true)).toEqual({ commandLine: false, text: "a:b" });
  });

  it("reads each command by any abbreviation Vim accepts, with ! and an argument", () => {
    const names = (lines: string[]) => lines.map((line) => parseExCommand(line)?.command ?? null);
    expect(names(["q", "qu", "qui", "quit"])).toEqual(Array(4).fill("tab.close"));
    expect(names(["w", "write", "e", "edit", "b", "buf", "buffer"])).toEqual([
      "draft.write",
      "draft.write",
      "document.open",
      "document.open",
      "buffer.open",
      "buffer.open",
      "buffer.open",
    ]);
    expect(names(["sp", "split", "vs", "vsp", "vsplit", "noh", "nohlsearch"])).toEqual([
      "pane.splitDown",
      "pane.splitDown",
      "pane.splitRight",
      "pane.splitRight",
      "pane.splitRight",
      "search.clearHighlight",
      "search.clearHighlight",
    ]);
    expect(parseExCommand("q!")).toEqual({ command: "tab.close", bang: true, argument: "" });
    expect(parseExCommand("e  Daily notes ")).toEqual({
      command: "document.open",
      bang: false,
      argument: "Daily notes",
    });
    expect(parseExCommand("B release")).toMatchObject({
      command: "buffer.open",
      argument: "release",
    });
  });

  it("names none of them for an editor's own commands, short forms Vim gives elsewhere, or typos", () => {
    for (const line of [
      "s/one/two/",
      "%s/a/b/g",
      "12",
      "s",
      "v",
      "no",
      "wq",
      "quiet",
      "bug",
      "b2",
      "",
    ]) {
      expect(parseExCommand(line)).toBeNull();
    }
  });

  it("reads the aliases the keybindings give, a full name ahead of an abbreviation", () => {
    const triggers = [
      ...DEFAULT_RESOLVED_TRIGGERS,
      { kind: "alias" as const, command: "sidebar.toggle" as const, name: "sidebar", shortest: 2 },
      { kind: "alias" as const, command: "draft.write" as const, name: "wq", shortest: 2 },
      { kind: "alias" as const, command: "section.settings" as const, name: "s", shortest: 1 },
    ];
    expect(parseWith("si", triggers)?.command).toBe("sidebar.toggle");
    expect(parseWith("wq", triggers)?.command).toBe("draft.write");
    // `s` names the user's `:s` in full, not an abbreviation of `:sidebar` (which needs two).
    expect(parseWith("s", triggers)?.command).toBe("section.settings");
    expect(parseWith("q", [])).toBeNull();
  });
});
