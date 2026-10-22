import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { resolveShortcutCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";

/** Empties the page as a test ends. */
function cleanup(): Disposable {
  return { [Symbol.dispose]: () => document.body.replaceChildren() };
}

const ctrl = (key: string) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
});

/** The command Ctrl+`key` runs with focus on `html`'s `[data-target]` (or its first element). */
function commandOn(
  html: string,
  key: string,
  { platform = "MacIntel", terminalFocus = false } = {},
) {
  document.body.innerHTML = html;
  const target =
    document.body.querySelector("[data-target]") ?? document.body.firstElementChild ?? null;
  return resolveShortcutCommand(ctrl(key), DEFAULT_RESOLVED_KEYBINDINGS, {
    platform,
    context: { editableFocus: isEditableFocused(target), terminalFocus },
  });
}

describe("Ctrl+H/J/K/L", () => {
  it("move between regions from what takes no typing: a row, a tab, the page", () => {
    using _cleanup = cleanup();
    expect(commandOn('<div role="button" tabindex="0">row</div>', "h")).toBe("focus.left");
    expect(commandOn('<div role="tab" tabindex="0">tab</div>', "j")).toBe("focus.down");
    expect(commandOn("<p>text</p>", "k")).toBe("focus.up");
    expect(commandOn("<button>go</button>", "l")).toBe("focus.right");
  });

  it("stay the field's, the editor's, and the terminal's while typing there", () => {
    using _cleanup = cleanup();
    expect(commandOn("<input />", "h")).toBeNull();
    expect(commandOn("<textarea></textarea>", "l")).toBeNull();
    // A CodeMirror editor, Vim or not: its content is contenteditable.
    expect(
      commandOn(
        '<div class="cm-editor"><div class="cm-scroller"><div class="cm-content" contenteditable="true" data-target></div></div></div>',
        "h",
      ),
    ).toBeNull();
    expect(commandOn('<div contenteditable="true">note</div>', "k")).toBeNull();
    expect(commandOn("<div>terminal</div>", "j", { terminalFocus: true })).toBeNull();
  });

  it("leave Ctrl+K to the keyboard menu and Ctrl+J to the terminal where mod is Ctrl", () => {
    using _cleanup = cleanup();
    expect(commandOn("<p>text</p>", "k", { platform: "Win32" })).toBe("whichKey.open");
    expect(commandOn("<p>text</p>", "j", { platform: "Linux x86_64" })).toBe("terminal.toggle");
    expect(commandOn("<p>text</p>", "h", { platform: "Win32" })).toBe("focus.left");
  });
});

describe("Ctrl+D/U", () => {
  it("scroll from what takes no typing, and stay the editor's and the terminal's", () => {
    using _cleanup = cleanup();
    expect(commandOn('<div role="button" tabindex="0">row</div>', "d")).toBe("scroll.down");
    expect(commandOn("<p>text</p>", "u")).toBe("scroll.up");
    // Vim's Ctrl-D and Ctrl-U in the composer and notes, never shadowed.
    expect(
      commandOn('<div class="cm-content" contenteditable="true" data-target></div>', "d"),
    ).toBeNull();
    expect(commandOn("<input />", "u")).toBeNull();
    expect(commandOn("<div>terminal</div>", "d", { terminalFocus: true })).toBeNull();
  });

  it("leave Ctrl+D to the diff and Ctrl+U to Usage where mod is Ctrl", () => {
    using _cleanup = cleanup();
    expect(commandOn("<p>text</p>", "d", { platform: "Win32" })).toBe("diff.toggle");
    expect(commandOn("<p>text</p>", "u", { platform: "Linux x86_64" })).toBe("usage.open");
  });
});
