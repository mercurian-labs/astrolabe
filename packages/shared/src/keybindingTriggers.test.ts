import type { KeybindingRule } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_RESOLVED_KEYBINDINGS, mergeWithDefaultKeybindings } from "./keybindings.ts";
import {
  DEFAULT_RESOLVED_TRIGGERS,
  formatAlias,
  keybindingRuleIssue,
  parseAlias,
  parseMenuKeys,
  resolveKeybindingRules,
} from "./keybindingTriggers.ts";

const triggersOf = (rules: KeybindingRule[], command: string) =>
  resolveKeybindingRules(rules).keybindingTriggers.triggers.filter(
    (trigger) => trigger.command === command,
  );
const shortcutsOf = (rules: KeybindingRule[], command: string) =>
  resolveKeybindingRules(rules).keybindings.filter((binding) => binding.command === command);

describe("trigger parsing", () => {
  it("reads menu keys, with space by name", () => {
    expect(parseMenuKeys("menu g w")).toEqual(["g", "w"]);
    expect(parseMenuKeys("menu  t ]")).toEqual(["t", "]"]);
    expect(parseMenuKeys("Menu space x")).toEqual([" ", "x"]);
    expect(parseMenuKeys("menu")).toBeNull();
    expect(parseMenuKeys("menu gw")).toBeNull();
    expect(parseMenuKeys("leader g w")).toBeNull();
    expect(parseMenuKeys("mod+k")).toBeNull();
  });

  it("reads an alias in Vim's notation", () => {
    expect(parseAlias(":q[uit]")).toEqual({ name: "quit", shortest: 1 });
    expect(parseAlias(":vs[plit]")).toEqual({ name: "vsplit", shortest: 2 });
    expect(parseAlias(":Grep")).toEqual({ name: "grep", shortest: 4 });
    expect(parseAlias(":q[uit")).toBeNull();
    expect(parseAlias(":12")).toBeNull();
    expect(parseAlias("q")).toBeNull();
    expect(formatAlias({ name: "nohlsearch", shortest: 3 })).toBe(":noh[lsearch]");
    expect(formatAlias({ name: "grep", shortest: 4 })).toBe(":grep");
  });

  it("reports malformed menu and alias rules, and leaves plain shortcuts to upstream", () => {
    expect(keybindingRuleIssue({ key: "mod+k", command: "whichKey.open" })).toBeUndefined();
    expect(keybindingRuleIssue({ key: "menu g w", command: "section.wikis" })).toBeNull();
    expect(keybindingRuleIssue({ key: ":q[uit]", command: "tab.close" })).toBeNull();
    expect(keybindingRuleIssue({ key: "-mod+n", command: "-chat.new" })).toMatch(/shortcut/);
    expect(keybindingRuleIssue({ key: "mod+n", command: "-chat.new" })).toBeNull();
    expect(keybindingRuleIssue({ key: "menu gw", command: "section.wikis" })).toBe(
      'Invalid menu keys "menu gw": write "menu" and then single keys, spaced (menu g w)',
    );
    expect(keybindingRuleIssue({ key: "menu", command: "section.wikis" })).toMatch(
      /^Invalid menu keys/,
    );
    expect(keybindingRuleIssue({ key: ":q1", command: "tab.close" })).toMatch(/^Invalid alias/);
    expect(
      keybindingRuleIssue({ key: "menu g w", command: "section.wikis", when: "editorFocus" }),
    ).toBe("Menu keys and aliases take no `when`");
    // `leader …` is no kind of its own: it is left to upstream's shortcut check, which rejects it.
    expect(keybindingRuleIssue({ key: "leader g w", command: "section.wikis" })).toBeUndefined();
  });
});

describe("resolveKeybindingRules", () => {
  it("gives the defaults of every kind for an empty file", () => {
    const resolved = resolveKeybindingRules([]);
    expect(resolved.keybindings).toEqual(DEFAULT_RESOLVED_KEYBINDINGS);
    expect(resolved.keybindingTriggers).toEqual({
      triggers: DEFAULT_RESOLVED_TRIGGERS,
      unboundCommands: [],
    });
  });

  it("overrides per command and kind: a shortcut leaves the menu keys alone", () => {
    const rules: KeybindingRule[] = [{ key: "mod+alt+s", command: "sidebar.toggle" }];
    expect(shortcutsOf(rules, "sidebar.toggle").map((binding) => binding.shortcut.key)).toEqual([
      "s",
    ]);
    expect(triggersOf(rules, "sidebar.toggle")).toEqual([
      { kind: "menu", command: "sidebar.toggle", sequence: ["s", "s"] },
    ]);
  });

  it("a menu rule replaces only that command's default menu keys", () => {
    const rules: KeybindingRule[] = [{ key: "menu x", command: "section.wikis" }];
    expect(triggersOf(rules, "section.wikis")).toEqual([
      { kind: "menu", command: "section.wikis", sequence: ["x"] },
    ]);
    // Its other commands' defaults, and the default shortcut kinds, stay.
    expect(triggersOf(rules, "wiki.findDocument")).toHaveLength(1);
    expect(triggersOf([{ key: ":wq", command: "draft.write" }], "draft.write")).toEqual([
      { kind: "alias", command: "draft.write", name: "wq", shortest: 2 },
    ]);
  });

  it("removes a default menu sequence with a -command rule, keeping its siblings", () => {
    const rules: KeybindingRule[] = [{ key: "menu g w", command: "-section.wikis" }];
    expect(triggersOf(rules, "section.wikis")).toEqual([
      { kind: "menu", command: "section.wikis", sequence: ["w", "w"] },
    ]);
  });

  it("removes an alias by its full name", () => {
    expect(triggersOf([{ key: ":quit", command: "-tab.close" }], "tab.close")).toEqual([]);
    expect(triggersOf([{ key: ":q[uit]", command: "-tab.close" }], "tab.close")).toEqual([]);
  });

  it("removes a default shortcut and reports the command as unbound", () => {
    const rules: KeybindingRule[] = [{ key: "mod+u", command: "-usage.open" }];
    const resolved = resolveKeybindingRules(rules);
    expect(shortcutsOf(rules, "usage.open")).toEqual([]);
    expect(resolved.keybindingTriggers.unboundCommands).toEqual(["usage.open"]);
    // A client's own merge keeps it unbound.
    expect(
      mergeWithDefaultKeybindings(resolved.keybindings, resolved.keybindingTriggers.unboundCommands)
        .length,
    ).toBe(resolved.keybindings.length);
  });

  it("removes one of a command's shortcuts, matching when only if the removal gives one", () => {
    const one = resolveKeybindingRules([{ key: "mod+shift+o", command: "-chat.new" }]);
    expect(
      one.keybindings.filter((binding) => binding.command === "chat.new").map((b) => b.shortcut),
    ).toHaveLength(1);
    expect(one.keybindingTriggers.unboundCommands).toEqual([]);
    const mismatched = resolveKeybindingRules([
      { key: "mod+shift+o", command: "-chat.new", when: "terminalFocus" },
    ]);
    expect(mismatched.keybindings.filter((binding) => binding.command === "chat.new")).toHaveLength(
      2,
    );
  });

  it("removes user rules too, and ignores menu and alias rules among shortcuts", () => {
    const rules: KeybindingRule[] = [
      { key: "menu x", command: "chat.new" },
      { key: "menu x", command: "-chat.new" },
    ];
    expect(triggersOf(rules, "chat.new")).toEqual([]);
    expect(shortcutsOf(rules, "chat.new")).toHaveLength(2);
  });
});
