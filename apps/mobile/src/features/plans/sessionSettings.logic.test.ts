import { describe, expect, it } from "vite-plus/test";

import { codingSessionRuntimeModeChoices } from "./sessionSettings.logic";

const choices = [
  { mode: "approval-required" as const },
  { mode: "auto-accept-edits" as const },
  { mode: "auto" as const },
  { mode: "full-access" as const },
];

describe("coding session runtime mode choices", () => {
  it("leaves plain-thread choices byte-for-byte unchanged", () => {
    expect(codingSessionRuntimeModeChoices(choices, "full-access", false)).toBe(choices);
  });

  it("offers the three coding-session tiers", () => {
    expect(
      codingSessionRuntimeModeChoices(choices, "full-access", true).map((choice) => choice.mode),
    ).toEqual(["approval-required", "auto-accept-edits", "full-access"]);
  });

  it("keeps a legacy current Auto value visible until changed", () => {
    expect(
      codingSessionRuntimeModeChoices(choices, "auto", true).map((choice) => choice.mode),
    ).toEqual(["approval-required", "auto-accept-edits", "full-access", "auto"]);
  });
});
