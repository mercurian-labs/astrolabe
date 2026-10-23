import type { KeybindingRule } from "@t3tools/contracts";
import { resolveKeybindingRules } from "@t3tools/shared/keybindingTriggers";
import { describe, expect, it } from "vite-plus/test";

import { buildKeybindingRows } from "./KeybindingsSettings.logic";
import {
  buildKeybindingCommandRows,
  commandRowActions,
  filterKeybindingCommandRows,
  visibleKinds,
  type KeybindingKindFilter,
} from "./KeybindingsTable.logic";
import { buildKeybindingTriggerRows } from "./KeybindingTriggerSettings.logic";

function allRows(rules: KeybindingRule[] = []) {
  const resolved = resolveKeybindingRules(rules);
  return buildKeybindingCommandRows(
    buildKeybindingRows(resolved.keybindings),
    buildKeybindingTriggerRows(resolved.keybindingTriggers.triggers),
  );
}

function table(rules: KeybindingRule[] = [], query = "", filter: KeybindingKindFilter = "all") {
  return filterKeybindingCommandRows(allRows(rules), { query, filter, platform: "MacIntel" });
}

const rowFor = (rows: ReturnType<typeof table>, command: string) =>
  rows.find((row) => row.command === command);

describe("the Keybindings table's rows", () => {
  it("gives each command one row, its bindings of each kind in their own cell", () => {
    const rows = table();
    expect(rows.filter((row) => row.command === "section.wikis")).toHaveLength(1);
    const wikis = rowFor(rows, "section.wikis")!;
    expect(wikis.shortcuts).toEqual([]);
    expect(wikis.menu.map((row) => row.label)).toEqual(["g w", "w w"]);
    expect(wikis.alias).toEqual([]);
    const close = rowFor(rows, "tab.close")!;
    expect(close.alias.map((row) => row.label)).toEqual(["q[uit]"]);
    // Upstream's commands with only shortcuts still have their row.
    expect(rowFor(rows, "terminal.toggle")?.shortcuts.length).toBeGreaterThan(0);
    // The Command Palette has mod+p and the menu's `:`; the file picker only the menu's `f`.
    const palette = rowFor(rows, "commandLine.open")!;
    expect(palette.shortcuts.map((row) => row.key)).toEqual(["mod+p"]);
    expect(palette.menu.map((row) => row.label)).toEqual([":"]);
    expect(rowFor(rows, "filePicker.toggle")?.shortcuts).toEqual([]);
  });

  it("keeps a removed default in its cell, and marks the row custom", () => {
    const rows = table([{ key: "menu g w", command: "-section.wikis" }]);
    const wikis = rowFor(rows, "section.wikis")!;
    expect(wikis.menu.map((row) => [row.label, row.source])).toEqual([
      ["w w", "Default"],
      ["g w", "Removed"],
    ]);
    expect(wikis.badge).toBe("Custom");
    expect(rowFor(rows, "section.threads")?.badge).toBeNull();
  });

  it("finds a row by its label or by any key, as the cell shows it or the file writes it", () => {
    const commands = (query: string) => table([], query).map((row) => row.command);
    expect(commands("t ]")).toContain("chatTab.next");
    expect(commands("menu t ]")).toContain("chatTab.next");
    expect(commands("q[uit]")).toEqual(["tab.close"]);
    expect(commands("⌘P")).toContain("commandLine.open");
    expect(commands("mod+p")).toEqual(["commandLine.open"]);
    expect(commands("chat tab: next")).toEqual(["chatTab.next"]);
  });

  it("narrows to the commands with a binding of the kind filtered, and searches only that kind", () => {
    const aliases = table([], "", "alias");
    expect(aliases.every((row) => row.alias.length > 0)).toBe(true);
    expect(aliases.map((row) => row.command)).toContain("tab.close");
    expect(rowFor(aliases, "section.wikis")).toBeUndefined();
    expect(table([], "t ]", "shortcut").map((row) => row.command)).not.toContain("chatTab.next");
    expect(visibleKinds("all")).toEqual(["shortcut", "menu", "alias"]);
    expect(visibleKinds("menu")).toEqual(["menu"]);
  });

  it("filtering keeps the row objects so unchanged rows skip rendering", () => {
    const rows = allRows();
    const filter = (query: string, kind: KeybindingKindFilter = "all") =>
      filterKeybindingCommandRows(rows, { query, filter: kind, platform: "MacIntel" });
    for (const filtered of [filter("terminal"), filter("", "alias"), filter("close", "shortcut")]) {
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThan(rows.length);
      for (const row of filtered) expect(rows).toContain(row);
    }
    expect(filter("  ")).toBe(rows);
  });

  it("lists each binding's actions in the row's menu, for the kinds shown", () => {
    const rows = table([
      { key: "menu g w", command: "-section.wikis" },
      { key: "mod+shift+w", command: "tab.close" },
    ]);
    const labels = (command: string, filter: KeybindingKindFilter = "all") =>
      commandRowActions(rowFor(rows, command)!, visibleKinds(filter), "MacIntel").map(
        (action) => action.label,
      );
    expect(labels("section.wikis")).toEqual(["Remove w w", "Restore default g w"]);
    // A user's own shortcut can be removed; upstream's defaults cannot.
    expect(labels("tab.close")).toEqual(["Remove ⇧⌘W", "Remove q[uit]"]);
    expect(labels("tab.close", "alias")).toEqual(["Remove q[uit]"]);
    expect(labels("terminal.toggle")).toEqual([]);
  });
});
