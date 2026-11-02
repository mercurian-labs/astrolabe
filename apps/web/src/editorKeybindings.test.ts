import type { KeybindingRule } from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  codeEditorKeys,
  codeMirrorKey,
  editorFindKeys,
  editorHunkKeys,
  fileSaveKeys,
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

describe("the outline picker's key", () => {
  it("is mod+shift+o in a file or note with an outline, and a new thread everywhere else", () => {
    const event = { key: "o", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
    const resolve = (outlineFocus: boolean) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "MacIntel",
        context: { editorFocus: outlineFocus, outlineFocus },
      });
    expect(resolve(true)).toBe("outline.open");
    expect(resolve(false)).toBe("chat.new");
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

describe("a code file's keys from the keybindings", () => {
  /** What a Mac keypress (`mod` is Cmd) runs in a code file, a wiki note, and elsewhere. */
  function resolveIn(shortcut: string) {
    const parsed = parseKeybindingShortcut(shortcut)!;
    const event = {
      key: parsed.key,
      metaKey: parsed.modKey || parsed.metaKey,
      ctrlKey: parsed.ctrlKey,
      shiftKey: parsed.shiftKey,
      altKey: parsed.altKey,
    };
    const resolve = (context: { editorFocus: boolean; codeEditorFocus: boolean }) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "MacIntel",
        context,
      });
    return {
      code: resolve({ editorFocus: true, codeEditorFocus: true }),
      note: resolve({ editorFocus: true, codeEditorFocus: false }),
      elsewhere: resolve({ editorFocus: false, codeEditorFocus: false }),
    };
  }

  it("gives the editor its keys in a code file, and the app keeps them everywhere else", () => {
    expect(resolveIn("mod+d")).toEqual({
      code: "code.selectNextOccurrence",
      note: "diff.toggle",
      elsewhere: "diff.toggle",
    });
    expect(resolveIn("mod+/")).toMatchObject({
      code: "code.toggleComment",
      elsewhere: "commandPalette.toggle",
    });
    expect(resolveIn("mod+[")).toMatchObject({
      code: "code.indentLess",
      elsewhere: "navigation.back",
    });
    expect(resolveIn("mod+]")).toMatchObject({
      code: "code.indentMore",
      elsewhere: "navigation.forward",
    });
    expect(resolveIn("mod+shift+l")).toMatchObject({
      code: "code.selectAllOccurrences",
      elsewhere: "composer.previousWorktree",
    });
  });

  it("keeps italic and link in a wiki note, where a code file expands the selection and deletes the line", () => {
    expect(resolveIn("mod+i")).toEqual({
      code: "code.expandSelection",
      note: "markdown.italic",
      elsewhere: null,
    });
    expect(resolveIn("mod+shift+k")).toEqual({
      code: "code.deleteLine",
      note: "markdown.link",
      elsewhere: "pullRequest.copyNumber",
    });
  });

  it("leaves Usage, the keyboard menu and the Command Palette to the app in a code file", () => {
    expect(resolveIn("mod+u").code).toBe("usage.open");
    expect(resolveIn("mod+k").code).toBe("whichKey.open");
    expect(resolveIn("mod+p").code).toBe("commandLine.open");
  });

  it("binds each code command to the shortcuts that hold in a code file, and no others", () => {
    const keys = codeEditorKeys(DEFAULT_RESOLVED_KEYBINDINGS);
    expect(keys).toMatchObject({
      selectNextOccurrence: ["Mod-d"],
      skipOccurrence: ["Mod-Shift-d"],
      selectAllOccurrences: ["Mod-Shift-l"],
      addCursorAbove: ["Mod-Alt-ArrowUp"],
      expandSelection: ["Mod-i"],
      toggleComment: ["Mod-/"],
      indentLess: ["Mod-["],
      moveLineDown: ["Alt-ArrowDown"],
      copyLineUp: ["Alt-Shift-ArrowUp"],
      deleteLine: ["Mod-Shift-k"],
      fold: ["Mod-Alt-["],
      sortLines: [],
    });
    const rules: KeybindingRule[] = [
      { key: "mod+'", command: "code.toggleComment", when: "codeEditorFocus" },
      { key: "alt+s", command: "code.sortLines", when: "codeEditorFocus" },
      { key: "alt+j", command: "code.joinLines", when: "terminalFocus" },
    ];
    const custom = codeEditorKeys(compileResolvedKeybindingsConfig(rules));
    expect(custom).toMatchObject({ toggleComment: ["Mod-'"], sortLines: ["Alt-s"], joinLines: [] });
  });

  it("leaves the wiki's formatting keys as they were", () => {
    const keys = markdownEditorKeys(DEFAULT_RESOLVED_KEYBINDINGS, { composer: false });
    expect(keys).toMatchObject({ italic: ["Mod-i"], link: ["Mod-Shift-k"] });
  });
});

describe("a code file's save keys from the keybindings", () => {
  it("saves with mod+s in a code file, and with whatever a user binds instead", () => {
    expect(fileSaveKeys(DEFAULT_RESOLVED_KEYBINDINGS)).toEqual(["Mod-s"]);
    const rules: KeybindingRule[] = [
      { key: "mod+alt+s", command: "file.save", when: "codeEditorFocus" },
      { key: "ctrl+s", command: "file.save", when: "composerFocus" },
    ];
    // A binding only the composer reaches does not save a file.
    expect(fileSaveKeys(compileResolvedKeybindingsConfig(rules))).toEqual(["Mod-Alt-s"]);
  });

  it("leaves mod+s to the composer's stash outside a code file", () => {
    const event = { key: "s", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    const resolve = (codeEditorFocus: boolean) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "MacIntel",
        context: { editorFocus: true, codeEditorFocus },
      });
    expect(resolve(true)).toBe("file.save");
    expect(resolve(false)).toBe("composer.stash");
  });
});
