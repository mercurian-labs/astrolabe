import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { describe, expect, it } from "vite-plus/test";

import { buildCodingSessionBranchName } from "./branch.ts";

describe("coding-session branch names", () => {
  it("sanitizes and truncates the title with an eight-character token", () => {
    const branch = buildCodingSessionBranchName(
      "  Coding sessions: draft, leaf commit, worktree birth — and a very long suffix  ",
      "A1B2C3D4FFEEDDCC",
    );
    expect(branch).toMatch(/^mercurian\/[a-z0-9-]+-a1b2c3d4$/u);
    expect(branch.length).toBeLessThanOrEqual(71);
    expect(isTemporaryWorktreeBranch(branch)).toBe(false);
  });

  it("uses the token to keep sibling attempts distinct", () => {
    expect(buildCodingSessionBranchName("Implement it", "11111111")).not.toBe(
      buildCodingSessionBranchName("Implement it", "22222222"),
    );
  });

  it("replaces title slashes without introducing consecutive dashes", () => {
    const branch = buildCodingSessionBranchName(
      "Add a /uptime endpoint to the timekeeper service that reports…",
      "EF9E727A",
    );
    expect(branch).toMatch(/^mercurian\/[a-z0-9-]+-[0-9a-f]{8}$/u);
    expect(branch).not.toContain("--");
  });
});
