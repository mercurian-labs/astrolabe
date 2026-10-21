import type { KeybindingRule } from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { codeMirrorKey, markdownEditorKeys } from "./editorKeybindings";
import { resolveShortcutCommand } from "./keybindings";

describe("the Markdown editors' keys from the keybindings", () => {
  it("writes shortcuts in CodeMirror's notation", () => {
    const key = (value: string) => codeMirrorKey(parseKeybindingShortcut(value)!);
    expect(key("mod+shift+k")).toBe("Mod-Shift-k");
    expect(key("ctrl+alt+arrowup")).toBe("Ctrl-Alt-ArrowUp");
    expect(key("mod+space")).toBe("Mod-Space");
    expect(key("f5")).toBe("F5");
  });

  it("gives each formatting command the shortcuts whose condition holds in that editor", () => {
    expect(markdownEditorKeys(DEFAULT_RESOLVED_KEYBINDINGS, { composer: false })).toEqual({
      bold: ["Mod-b"],
      italic: ["Mod-i"],
      code: ["Mod-e"],
      strikethrough: ["Mod-Shift-x"],
      highlight: ["Mod-Shift-h"],
      link: ["Mod-Shift-k"],
    });
    const rules: KeybindingRule[] = [
      { key: "mod+shift+b", command: "markdown.bold", when: "!composerFocus" },
      { key: "mod+alt+b", command: "markdown.bold", when: "composerFocus" },
    ];
    const keybindings = compileResolvedKeybindingsConfig(rules);
    expect(markdownEditorKeys(keybindings, { composer: true }).bold).toEqual(["Mod-Alt-b"]);
    expect(markdownEditorKeys(keybindings, { composer: false }).bold).toEqual(["Mod-Shift-b"]);
    // A command with no binding has no key at all.
    expect(markdownEditorKeys(keybindings, { composer: false }).link).toEqual([]);
  });

  it("leaves mod+shift+k to the editor's link while one has focus, and to the PR number elsewhere", () => {
    const event = { key: "k", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
    const resolve = (editorFocus: boolean) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "MacIntel",
        context: { editorFocus },
      });
    expect(resolve(true)).toBe("markdown.link");
    expect(resolve(false)).toBe("pullRequest.copyNumber");
  });
});
