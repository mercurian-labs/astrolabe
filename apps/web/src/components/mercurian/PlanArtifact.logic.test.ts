import { describe, expect, it } from "vite-plus/test";

import { lastPlanRevision } from "./PlanArtifact.logic";

const message = (createdAt: string) =>
  ({ _tag: "message", authorKind: "human", createdAt }) as const;
const revision = (authorKind: "human" | "assistant", createdAt: string) =>
  ({ _tag: "plan-revision", authorKind, createdAt }) as const;

describe("lastPlanRevision", () => {
  it("has nothing to attribute on a plan born blank", () => {
    expect(lastPlanRevision([message("2026-08-03T00:00:00.000Z")])).toBeNull();
  });

  it("reads the latest revision, not the latest commit", () => {
    const attribution = lastPlanRevision([
      message("2026-08-03T00:00:00.000Z"),
      revision("human", "2026-08-03T00:01:00.000Z"),
      message("2026-08-03T00:02:00.000Z"),
    ]);
    expect(attribution).toEqual({ authorKind: "human", createdAt: "2026-08-03T00:01:00.000Z" });
  });

  it("keeps both parties' edits attributable", () => {
    const attribution = lastPlanRevision([
      revision("human", "2026-08-03T00:01:00.000Z"),
      revision("assistant", "2026-08-03T00:02:00.000Z"),
    ]);
    expect(attribution?.authorKind).toBe("assistant");
  });
});
