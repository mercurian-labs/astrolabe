import { describe, expect, it } from "vite-plus/test";

import { folderReach } from "./workspaceFolders.ts";

describe("folderReach", () => {
  it.each([
    ["claudeAgent", true, "edit"],
    ["codex", true, "edit"],
    ["cursor", true, "shell"],
    ["cursor", false, "edit"],
    ["antigravity", false, "none"],
  ] as const)("%s with its sandbox %s reaches a folder to %s", (driver, sandboxed, reach) => {
    expect(folderReach(driver, sandboxed)).toBe(reach);
  });
});
