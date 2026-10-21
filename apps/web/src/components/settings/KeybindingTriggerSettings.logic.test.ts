import type { KeybindingRule } from "@t3tools/contracts";
import { resolveKeybindingRules } from "@t3tools/shared/keybindingTriggers";
import { describe, expect, it } from "vite-plus/test";

import {
  buildKeybindingTriggerRows,
  triggerAddInputs,
  triggerDraftConflicts,
  triggerDraftIssue,
  triggerEditInputs,
  triggerRowActions,
} from "./KeybindingTriggerSettings.logic";

const triggersOf = (rules: KeybindingRule[]) =>
  resolveKeybindingRules(rules).keybindingTriggers.triggers;
const rowsFor = (rules: KeybindingRule[]) => buildKeybindingTriggerRows(triggersOf(rules));
const rowOf = (rules: KeybindingRule[], command: string, key: string) =>
  rowsFor(rules).find((row) => row.command === command && row.key === key);

describe("the Keybindings table's menu keys and aliases", () => {
  it("shows defaults, user rules, and defaults a removal took away", () => {
    expect(rowOf([], "section.wikis", "menu g w")?.source).toBe("Default");
    expect(rowOf([], "tab.close", ":q[uit]")?.source).toBe("Default");
    const rules: KeybindingRule[] = [
      { key: "menu g w", command: "-section.wikis" },
      { key: "menu x", command: "chat.new" },
    ];
    expect(rowOf(rules, "section.wikis", "menu g w")?.source).toBe("Removed");
    expect(rowOf(rules, "chat.new", "menu x")?.source).toBe("Custom");
    // An overridden default is not shown as removed.
    expect(
      rowOf([{ key: "menu z", command: "sidebar.toggle" }], "sidebar.toggle", "menu s s"),
    ).toBe(undefined);
  });

  it("labels menu keys without menu, and aliases without their colon", () => {
    expect(rowOf([], "chatTab.next", "menu t ]")?.label).toBe("t ]");
    expect(rowOf([], "tab.close", ":q[uit]")?.label).toBe("q[uit]");
    expect(
      rowOf([{ key: "menu space x", command: "chat.new" }], "chat.new", "menu space x")?.label,
    ).toBe("Space x");
  });

  it("flags a sequence another command shares or leads into", () => {
    const rules: KeybindingRule[] = [
      { key: "menu g", command: "chat.new" },
      { key: ":quit", command: "sidebar.toggle" },
    ];
    expect(rowOf(rules, "chat.new", "menu g")?.conflicts).toContain("Section: Threads");
    expect(rowOf(rules, "sidebar.toggle", ":quit")?.conflicts).toEqual(["Close Tab or Pane Tab"]);
    expect(triggerDraftConflicts(triggersOf([]), "chat.new", "menu t")).toContain("Chat Tab: Next");
    expect(triggerDraftConflicts(triggersOf([]), "chat.new", "menu")).toEqual([]);
  });

  it("writes an edited default with the command's other defaults of its kind", () => {
    const row = rowOf([], "section.wikis", "menu g w")!;
    expect(triggerEditInputs(row, "menu g x")).toEqual([
      { command: "section.wikis", key: "menu w w" },
      { command: "section.wikis", key: "menu g x" },
    ]);
    const custom = rowOf([{ key: "menu x", command: "chat.new" }], "chat.new", "menu x")!;
    expect(triggerEditInputs(custom, "menu y")).toEqual([
      { command: "chat.new", key: "menu y", replace: { command: "chat.new", key: "menu x" } },
    ]);
  });

  it("adds a trigger beside the command's defaults, or beside its user rules alone", () => {
    expect(triggerAddInputs(rowsFor([]), "section.wikis", "menu x")).toEqual([
      { command: "section.wikis", key: "menu g w" },
      { command: "section.wikis", key: "menu w w" },
      { command: "section.wikis", key: "menu x" },
    ]);
    // Only defaults of the new rule's kind: the command's alias defaults stay in code.
    expect(triggerAddInputs(rowsFor([]), "tab.close", "menu x")).toEqual([
      { command: "tab.close", key: "menu x" },
    ]);
    const custom = rowsFor([{ key: "menu x", command: "section.wikis" }]);
    expect(triggerAddInputs(custom, "section.wikis", "menu y")).toEqual([
      { command: "section.wikis", key: "menu y" },
    ]);
    // A removed default stays removed.
    const removed = rowsFor([{ key: "menu g w", command: "-section.wikis" }]);
    expect(triggerAddInputs(removed, "section.wikis", "menu y")).toEqual([
      { command: "section.wikis", key: "menu w w" },
      { command: "section.wikis", key: "menu y" },
    ]);
  });

  it("removes a default with a removal rule, restores it, and resets the last user rule", () => {
    expect(triggerRowActions(rowOf([], "tab.close", ":q[uit]")!)).toEqual([
      {
        label: "Remove q[uit]",
        destructive: true,
        change: { type: "upsert", input: { command: "-tab.close", key: ":q[uit]" } },
      },
    ]);
    const removed = rowOf([{ key: ":q[uit]", command: "-tab.close" }], "tab.close", ":q[uit]")!;
    expect(triggerRowActions(removed)[0]).toMatchObject({
      label: "Restore default q[uit]",
      change: { type: "remove", target: { command: "-tab.close", key: ":q[uit]" } },
    });
    const custom = rowOf([{ key: ":x", command: "tab.close" }], "tab.close", ":x")!;
    expect(triggerRowActions(custom)[0]?.label).toBe("Reset x to default");
    const added = rowOf([{ key: "menu x", command: "chat.new" }], "chat.new", "menu x")!;
    expect(triggerRowActions(added)[0]?.label).toBe("Remove x");
  });

  it("resets an edited default along with the copies the edit wrote beside it", () => {
    // Editing `g w` to `g x` writes `w w` too, so that it survives the user rule.
    const rules = triggerEditInputs(rowOf([], "section.wikis", "menu g w")!, "menu g x");
    const edited = rowOf([...rules], "section.wikis", "menu g x")!;
    expect(triggerRowActions(edited)).toEqual([
      {
        label: "Reset g x to default",
        change: {
          type: "remove",
          target: { command: "section.wikis", key: "menu g x" },
          also: [{ command: "section.wikis", key: "menu w w" }],
        },
      },
    ]);
  });

  it("checks a draft key against its kind", () => {
    expect(triggerDraftIssue("menu", "menu g w")).toBeNull();
    expect(triggerDraftIssue("alias", ":wq")).toBeNull();
    expect(triggerDraftIssue("alias", "menu g")).toBe("Not this kind of key");
    expect(triggerDraftIssue("alias", ":w1")).toMatch(/^Invalid alias/);
    expect(triggerDraftIssue("menu", "")).toBe("Unassigned");
  });
});
