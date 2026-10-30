import type { KeybindingRule } from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  codeMirrorKey,
  editorFindKeys,
  editorHunkKeys,
  markdownEditorKeys,
} from "./editorKeybindings";
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

describe("the find bar's keys from the keybindings", () => {
  it("opens with mod+f in an editor, and with whatever a user binds instead", () => {
    expect(editorFindKeys(DEFAULT_RESOLVED_KEYBINDINGS)).toEqual(["Mod-f"]);
    const rules: KeybindingRule[] = [
      { key: "mod+shift+f", command: "search.find", when: "editorFocus" },
      { key: "alt+f", command: "search.find", when: "composerFocus" },
    ];
    // A binding only the composer reaches does not open a find bar, which the composer has not.
    expect(editorFindKeys(compileResolvedKeybindingsConfig(rules))).toEqual(["Mod-Shift-f"]);
  });

  it("leaves mod+f to thread find wherever an editor does not take it first", () => {
    const event = { key: "f", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    const resolve = (editorFocus: boolean) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "MacIntel",
        context: { editorFocus },
      });
    // The composer is an editor without a find bar: mod+f there still finds in the thread.
    expect(resolve(true)).toBe("chat.find");
    expect(resolve(false)).toBe("chat.find");
  });
});

describe("a code file's change keys from the keybindings", () => {
  it("binds Zed's keys by default, and whatever a user binds instead", () => {
    expect(editorHunkKeys(DEFAULT_RESOLVED_KEYBINDINGS)).toEqual({
      toggle: ["Mod-'"],
      expandAll: ["Mod-Shift-'"],
      restore: ["Mod-Alt-z"],
      next: ["Mod-F8"],
      previous: ["Mod-Shift-F8"],
    });
    const rules: KeybindingRule[] = [
      { key: "alt+]", command: "hunk.next", when: "editorFocus" },
      { key: "alt+[", command: "hunk.previous", when: "!editorFocus" },
    ];
    const keys = editorHunkKeys(compileResolvedKeybindingsConfig(rules));
    // A binding an editor never has focus for does not reach it.
    expect(keys).toMatchObject({ next: ["Alt-]"], previous: [], toggle: [] });
  });
});
