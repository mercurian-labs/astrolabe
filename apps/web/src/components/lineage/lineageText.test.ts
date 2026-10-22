import { describe, expect, it } from "vite-plus/test";

import type { LineageTurn } from "./lineageLayout";
import { agoLabel, labelStatus, turnFacts } from "./lineageText";

const now = Date.UTC(2026, 9, 20, 12);
const hoursAgo = (hours: number) => now - hours * 3_600_000;

describe("labelStatus", () => {
  it("says where a thread stands, when an idle one last moved, and how far behind it is", () => {
    expect(labelStatus({ state: "running", lastActiveAt: now, behind: 0 }, now)).toBe("running");
    expect(labelStatus({ state: "waiting", lastActiveAt: now, behind: 2 }, now)).toBe(
      "waiting on you · 2 behind",
    );
    expect(labelStatus({ state: "idle", lastActiveAt: hoursAgo(3), behind: 12 }, now)).toBe(
      "idle · 3h ago · 12 behind",
    );
    expect(labelStatus({ state: "not started", lastActiveAt: now, behind: 0 }, now)).toBe(
      "not started",
    );
    expect(agoLabel(now - 1_000, now)).toBe("just now");
  });
});

describe("turnFacts", () => {
  const turn: LineageTurn = {
    runId: "r1",
    messageId: "m1",
    at: hoursAgo(26),
    running: false,
    label: "Find the bug",
    completedAt: hoursAgo(25),
    model: "claude-opus-5-5",
    reply: "Found it",
    additions: 1200,
    deletions: 34,
    files: 3,
  };

  it("tells what a turn changed, its model and when it ended", () => {
    expect(turnFacts(turn, now)).toBe("3 files +1.2k −34 · Claude Opus 5.5 · 1d ago");
    expect(
      turnFacts({ ...turn, files: 0, model: null, running: true, completedAt: null }, now),
    ).toBe("asked 1d ago");
  });
});
