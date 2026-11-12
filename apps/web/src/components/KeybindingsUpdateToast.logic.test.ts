import { describe, expect, it } from "vite-plus/test";
import type { ServerConfigStreamEvent } from "@t3tools/contracts";

import { createKeybindingsUpdateToastController } from "./KeybindingsUpdateToast.logic";

function keybindingsUpdated(issueMessages: ReadonlyArray<string>): ServerConfigStreamEvent {
  return {
    version: 1,
    type: "keybindingsUpdated",
    payload: {
      keybindings: [],
      issues: issueMessages.map((message, index) => ({
        kind: "keybindings.invalid-entry" as const,
        message,
        index,
      })),
    },
  };
}

describe("keybindings update toast", () => {
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

  it("shows one warning when a save and the file watcher report the same issue", () => {
    let currentTime = 0;
    const controller = createKeybindingsUpdateToastController({ now: () => currentTime });
    const invalid = { _tag: "InvalidConfiguration", message: "unknown command" };

    expect(controller.handle(keybindingsUpdated(["unknown command"]))).toEqual(invalid);
    currentTime = 100;
    expect(controller.handle(keybindingsUpdated(["unknown command"]))).toBeNull();

    currentTime = 200;
    expect(controller.handle(keybindingsUpdated(["bad shortcut"]))).toEqual({
      _tag: "InvalidConfiguration",
      message: "bad shortcut",
    });

    currentTime = 5_000;
    expect(controller.handle(keybindingsUpdated(["bad shortcut"]))).toEqual({
      _tag: "InvalidConfiguration",
      message: "bad shortcut",
    });
    currentTime = 5_100;
    expect(controller.handle(keybindingsUpdated([]))).toEqual({ _tag: "Success" });
    currentTime = 5_200;
    expect(controller.handle(keybindingsUpdated([]))).toBeNull();
  });
});
