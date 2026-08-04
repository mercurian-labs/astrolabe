import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianProjectId,
  PlanId,
  type PlanDetail,
  type PlanStreamItem,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { applyPlanStreamItem, EMPTY_PLAN_STATE } from "./planReducer.ts";

const message = (id: string, sequence: number, text: string): PlanTimelineItem => ({
  _tag: "message",
  commitId: MercurianCommitId.make(id),
  sequence,
  authorKind: "human",
  text,
  createdAt: "2026-08-03T00:00:00.000Z",
});

const revision = (id: string, sequence: number): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: MercurianCommitId.make(id),
  sequence,
  authorKind: "human",
  createdAt: "2026-08-03T00:00:00.000Z",
});

const snapshot: PlanDetail = {
  plan: {
    planId: PlanId.make("plan-1"),
    projectId: MercurianProjectId.make("project-1"),
    title: "Reshape the sidebar",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  planText: "",
  timeline: [message("commit-1", 1, "Reshape the sidebar")],
  snapshotSequence: 1,
};

const fold = (items: ReadonlyArray<PlanStreamItem>) =>
  items.reduce(applyPlanStreamItem, EMPTY_PLAN_STATE);

describe("applyPlanStreamItem", () => {
  it("takes the snapshot as the whole planning space", () => {
    const state = fold([{ kind: "snapshot", snapshot }]);
    expect(state.detail).toEqual(snapshot);
    expect(state.synchronized).toBe(false);
  });

  it("ignores commits until a snapshot has landed", () => {
    const state = fold([{ kind: "commit", sequence: 2, item: message("commit-2", 2, "Later") }]);
    expect(state.detail).toBeNull();
  });

  it("appends a message without touching the artifact", () => {
    const state = fold([
      { kind: "snapshot", snapshot: { ...snapshot, planText: "# Approach" } },
      { kind: "commit", sequence: 2, item: message("commit-2", 2, "What about the tree?") },
    ]);
    expect(state.detail?.timeline.map((item) => item.commitId)).toEqual(["commit-1", "commit-2"]);
    expect(state.detail?.planText).toBe("# Approach");
    expect(state.detail?.snapshotSequence).toBe(2);
  });

  it("replaces the artifact when a revision carries new text", () => {
    const state = fold([
      { kind: "snapshot", snapshot },
      { kind: "commit", sequence: 2, item: revision("commit-2", 2), planText: "# Approach" },
    ]);
    expect(state.detail?.planText).toBe("# Approach");
    expect(state.detail?.timeline.map((item) => item._tag)).toEqual(["message", "plan-revision"]);
  });

  it("drops a commit the snapshot already accounts for", () => {
    // The echo of an edit this window just made, or an overlap after a resume:
    // folding it again would duplicate the row in the history.
    const state = fold([
      { kind: "snapshot", snapshot },
      { kind: "commit", sequence: 1, item: message("commit-1", 1, "Reshape the sidebar") },
    ]);
    expect(state.detail?.timeline).toHaveLength(1);
    expect(state.detail?.snapshotSequence).toBe(1);
  });

  it("flips synchronized without disturbing the space", () => {
    const state = fold([{ kind: "snapshot", snapshot }, { kind: "synchronized" }]);
    expect(state.synchronized).toBe(true);
    expect(state.detail).toEqual(snapshot);
  });

  it("re-snapshots onto an established space", () => {
    const replacement: PlanDetail = { ...snapshot, planText: "Fresh", snapshotSequence: 9 };
    const state = fold([
      { kind: "snapshot", snapshot },
      { kind: "synchronized" },
      { kind: "snapshot", snapshot: replacement },
    ]);
    expect(state.detail).toEqual(replacement);
    expect(state.synchronized).toBe(true);
  });
});
