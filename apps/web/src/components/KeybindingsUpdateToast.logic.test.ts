import type { ServerConfigStreamEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createKeybindingsUpdateToastController } from "./KeybindingsUpdateToast.logic";

describe("keybindings update toast policy", () => {
  it("warns of a vimrc's lines it cannot apply once, then reports later saves as updates", () => {
    const controller = createKeybindingsUpdateToastController({ now: () => 1_000 });
    const vimrcEvent = (
      issues: Extract<
        ServerConfigStreamEvent,
        { type: "vimrcUpdated" }
      >["payload"]["vimrc"]["issues"],
    ): ServerConfigStreamEvent => ({
      version: 1,
      type: "vimrcUpdated",
      payload: { vimrc: { text: "", issues } },
    });
    const issues = [
      { kind: "vimrc.invalid-line" as const, line: 3, message: "Not supported here: let" },
      { kind: "vimrc.invalid-line" as const, line: 5, message: "No such mapping: q" },
    ];

    expect(controller.handle(vimrcEvent(issues))).toEqual({
      _tag: "InvalidVimrc",
      message: "Line 3: Not supported here: let (and 1 more line)",
    });
    expect(controller.handle(vimrcEvent(issues))).toEqual({ _tag: "VimrcSuccess" });
    expect(controller.handle(vimrcEvent(issues.slice(1)))).toEqual({
      _tag: "InvalidVimrc",
      message: "Line 5: No such mapping: q",
    });
  });
});
