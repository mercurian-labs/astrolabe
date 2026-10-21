import type { ServerConfigStreamEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createKeybindingsUpdateToastController,
  KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS,
} from "./KeybindingsUpdateToast.logic";

function keybindingsEvent(
  overrides: Partial<Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }>> = {},
): Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }> {
  return {
    version: 1,
    type: "keybindingsUpdated",
    payload: {
      keybindings: [],
      issues: [],
    },
    ...overrides,
  };
}

describe("keybindings update toast policy", () => {
  it("coalesces repeated successful reload notifications during the cooldown", () => {
    let now = 1_000;
    const controller = createKeybindingsUpdateToastController({
      now: () => now,
    });

    expect(controller.handle(keybindingsEvent())).toEqual({ _tag: "Success" });

    now += KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS - 1;
    expect(controller.handle(keybindingsEvent())).toBeNull();

    now += 1;
    expect(controller.handle(keybindingsEvent())).toEqual({ _tag: "Success" });
  });

  it("surfaces keybinding configuration issues", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle(
        keybindingsEvent({
          payload: {
            keybindings: [],
            issues: [
              {
                kind: "keybindings.malformed-config",
                message: "Expected JSON array",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      _tag: "InvalidConfiguration",
      message: "Expected JSON array",
    });
  });

  it("ignores unrelated server config notifications", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle({
        version: 1,
        type: "settingsUpdated",
        payload: { settings: {} as never },
      }),
    ).toBeNull();
  });

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
