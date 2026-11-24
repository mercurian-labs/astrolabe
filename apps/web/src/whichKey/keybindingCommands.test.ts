import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { shortcutForCommand } from "./keybindingCommands";

describe("shortcutForCommand", () => {
  it("skips an unassigned default for the command's other shortcut", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "mod+j", command: "terminal.toggle" },
      { key: "mod+k", command: "terminal.toggle", when: "false" },
    ]);
    expect(shortcutForCommand(keybindings, "terminal.toggle")?.key).toBe("j");
  });

  it("finds nothing once every shortcut is unassigned", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "mod+k", command: "whichKey.open", when: "false" },
    ]);
    expect(shortcutForCommand(keybindings, "whichKey.open")).toBe(null);
  });
});
