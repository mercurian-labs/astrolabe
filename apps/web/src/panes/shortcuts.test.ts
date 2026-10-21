import { describe, expect, it } from "vite-plus/test";

import { CONVERSATION, guestKey, surfaceKey } from "./arrangement";
import { panesShortcut } from "./shortcuts";

describe("shortcuts inside the panes", () => {
  it("takes the terminal shortcut, swallows the right panel's toggle, and maximizes the pane", () => {
    expect(panesShortcut("terminal.toggle", CONVERSATION)).toBe("toggle-terminal");
    expect(panesShortcut("rightPanel.toggle", CONVERSATION)).toBe("ignore");
    expect(panesShortcut("rightPanel.toggleMaximized", null)).toBe("toggle-maximized");
  });

  it("closes the focused pane's tab on the close shortcut, but never the conversation", () => {
    expect(panesShortcut("rightPanel.close", surfaceKey("diff"))).toBe("close-tab");
    expect(panesShortcut("rightPanel.close", "empty/3")).toBe("close-tab");
    expect(panesShortcut("rightPanel.close", CONVERSATION)).toBeNull();
  });

  it("toggles thread details only with a conversation in front, the host's or a guest's", () => {
    expect(panesShortcut("threadPanel.toggle", CONVERSATION)).toBeNull();
    expect(panesShortcut("threadPanel.toggle", guestKey("env-1:thread"))).toBeNull();
    expect(panesShortcut("threadPanel.toggle", surfaceKey("diff"))).toBe("ignore");
    expect(panesShortcut("threadPanel.toggle", null)).toBe("ignore");
  });

  it("leaves what T3 Code's record already turns into tabs to T3 Code", () => {
    expect(panesShortcut("diff.toggle", CONVERSATION)).toBeNull();
    expect(panesShortcut("terminal.new", surfaceKey("terminal:t1"))).toBeNull();
    expect(panesShortcut("preview.toggle", CONVERSATION)).toBeNull();
  });
});
