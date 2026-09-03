import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  PlanTurnId,
  type PlanDetail,
  type PlanCodingSessionRecord,
  type PlanQuestion,
  type PlanStreamItem,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { applyPlanStreamItem, EMPTY_PLAN_STATE } from "./planReducer.ts";

const commitFields = (id: string, sequence: number, parents: ReadonlyArray<string>) => ({
  commitId: MercurianCommitId.make(id),
  sequence,
  parents: parents.map((parentId) => MercurianCommitId.make(parentId)),
  published: false,
  authorKind: "human" as const,
  createdAt: "2026-08-03T00:00:00.000Z",
});

const message = (
  id: string,
  sequence: number,
  text: string,
  parents: ReadonlyArray<string> = [],
): PlanTimelineItem => ({ _tag: "message", ...commitFields(id, sequence, parents), text });

const revision = (
  id: string,
  sequence: number,
  parents: ReadonlyArray<string> = [],
): PlanTimelineItem => ({ _tag: "plan-revision", ...commitFields(id, sequence, parents) });

const snapshot: PlanDetail = {
  plan: {
    planId: PlanId.make("plan-1"),
    projectId: MercurianProjectId.make("project-1"),
    title: "Reshape the sidebar",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  planText: "",
  spec: null,
  timeline: [message("commit-1", 1, "Reshape the sidebar")],
  snapshotSequence: 1,
  codingSessions: [],
  inFlightTurns: [],
};

const fold = (items: ReadonlyArray<PlanStreamItem>) =>
  items.reduce(applyPlanStreamItem, EMPTY_PLAN_STATE);

const session: PlanCodingSessionRecord = {
  commitId: MercurianCommitId.make("session-1"),
  repositoryId: MercurianRepositoryId.make("repo-1"),
  threadId: "thread-1" as PlanCodingSessionRecord["threadId"],
  branch: "mercurian/sidebar-12345678",
  worktreePath: "/tmp/sidebar",
  baseRef: "main",
  startedAt: "2026-08-03T01:00:00.000Z",
  endedAt: null,
  outcome: null,
  prUrl: null,
  settledCommitOid: null,
  partial: false,
  snapshotOid: null,
  snapshotKind: null,
  departedRef: null,
  branchMovement: null,
};

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

  it("replaces the spec when a spec revision carries the path projection", () => {
    const spec = {
      revisionCommitId: MercurianCommitId.make("commit-2"),
      document: {
        goal: "Sidebar behavior",
        acceptanceCriteria: "The sidebar stays visible.",
      },
    };
    const state = fold([
      { kind: "snapshot", snapshot },
      {
        kind: "commit",
        sequence: 2,
        item: {
          _tag: "spec-revision",
          ...commitFields("commit-2", 2, ["commit-1"]),
          cause: "direct",
        },
        spec,
      },
    ]);
    expect(state.detail?.spec).toEqual(spec);
    expect(state.detail?.timeline.map((item) => item._tag)).toEqual(["message", "spec-revision"]);
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

  it("carries the commit's own graph facts through the fold", () => {
    // The explorer reads the history's shape off this same state; a commit
    // that arrives as an event has to be as complete as one in the snapshot.
    const state = fold([
      { kind: "snapshot", snapshot },
      { kind: "commit", sequence: 2, item: message("commit-2", 2, "Later", ["commit-1"]) },
    ]);
    const appended = state.detail?.timeline.at(-1);
    expect(appended?.parents).toEqual(["commit-1"]);
    expect(appended?.published).toBe(false);
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

  it("replaces coding-session side facts from snapshots and keyed frames", () => {
    const fromSnapshot = fold([
      { kind: "snapshot", snapshot: { ...snapshot, codingSessions: [session] } },
    ]);
    expect(fromSnapshot.codingSessions.get(session.commitId)).toEqual(session);

    const ended = {
      ...session,
      endedAt: "2026-08-03T02:00:00.000Z",
      outcome: "completed" as const,
      snapshotOid: "snapshot-1",
      snapshotKind: "settled" as const,
      departedRef: "refs/heads/sibling",
      branchMovement: { kind: "added" as const, count: 1 },
      lineBranchMissingOid: "1234567890abcdef",
    };
    const replaced = applyPlanStreamItem(fromSnapshot, {
      kind: "coding-sessions",
      sessions: [ended],
    });
    const replayed = applyPlanStreamItem(replaced, {
      kind: "coding-sessions",
      sessions: [ended],
    });
    expect(replayed.codingSessions.size).toBe(1);
    expect(replayed.codingSessions.get(session.commitId)).toEqual(ended);
    expect(replayed.detail?.codingSessions).toEqual([ended]);
    expect(replayed.codingSessions.get(session.commitId)?.lineBranchMissingOid).toBe(
      "1234567890abcdef",
    );
  });

  it("accepts a session frame before its leaf and keeps plan text unchanged", () => {
    const state = fold([
      { kind: "snapshot", snapshot: { ...snapshot, planText: "# Keep me" } },
      { kind: "coding-sessions", sessions: [session] },
      {
        kind: "commit",
        sequence: 2,
        item: {
          _tag: "coding-session",
          ...commitFields("session-1", 2, ["commit-1"]),
          repositoryId: session.repositoryId,
          repositoryName: "server",
          planRevisionCommitId: MercurianCommitId.make("revision-1"),
        },
      },
      { kind: "synchronized" },
      { kind: "coding-sessions", sessions: [session] },
    ]);
    expect(state.detail?.planText).toBe("# Keep me");
    expect(state.detail?.snapshotSequence).toBe(2);
    expect(state.detail?.timeline.at(-1)?._tag).toBe("coding-session");
    expect(state.codingSessions.size).toBe(1);
  });
});

const turnId = PlanTurnId.make("turn-1");
const started: PlanStreamItem = {
  kind: "turn-started",
  turnId,
  parentCommitId: MercurianCommitId.make("commit-1"),
};
const delta = (textDelta: string, offset?: number): PlanStreamItem => ({
  kind: "turn-delta",
  turnId,
  textDelta,
  ...(offset === undefined ? {} : { offset }),
});
const question: PlanQuestion = {
  id: "q1",
  header: "Scope",
  question: "Which surface first?",
  options: [
    { label: "Web", description: "The browser app" },
    { label: "Mobile", description: "The phone app" },
  ],
};

describe("applyPlanStreamItem turn frames", () => {
  it("opens the in-flight turn and streams deltas into it", () => {
    const state = fold([{ kind: "snapshot", snapshot }, started, delta("Hel", 0), delta("lo", 3)]);
    expect(state.detail?.inFlightTurns[0]?.text).toBe("Hello");
    expect(state.detail?.inFlightTurns[0]?.parentCommitId).toBe("commit-1");
  });

  it("folds away a delta replayed across the snapshot join", () => {
    // The server attaches its frame feed before it reads the snapshot, so a
    // delta the snapshot's partial text already contains can arrive again.
    const midTurn: PlanDetail = {
      ...snapshot,
      inFlightTurns: [
        {
          turnId,
          parentCommitId: MercurianCommitId.make("commit-1"),
          text: "Hel",
          grounding: [],
        },
      ],
    };
    const state = fold([{ kind: "snapshot", snapshot: midTurn }, delta("Hel", 0), delta("lo", 3)]);
    expect(state.detail?.inFlightTurns[0]?.text).toBe("Hello");
  });

  it("collects grounding once per item", () => {
    const item = { kind: "file-read" as const, label: "apps/server/src/ws.ts" };
    const state = fold([
      { kind: "snapshot", snapshot },
      started,
      { kind: "turn-grounding", turnId, item },
      { kind: "turn-grounding", turnId, item },
    ]);
    expect(state.detail?.inFlightTurns[0]?.grounding).toEqual([item]);
  });

  it("raises the question and clears it when answered", () => {
    const asked = fold([
      { kind: "snapshot", snapshot },
      started,
      { kind: "turn-question", turnId, questions: [question] },
    ]);
    expect(asked.detail?.inFlightTurns[0]?.questions).toEqual([question]);

    const answered = applyPlanStreamItem(asked, { kind: "turn-question-answered", turnId });
    expect(answered.detail?.inFlightTurns[0]?.questions).toBeUndefined();
    expect(answered.detail?.inFlightTurns[0]?.text).toBe("");
  });

  it("closes the turn on turn-settled and appends the commit as the record", () => {
    const state = fold([
      { kind: "snapshot", snapshot },
      started,
      delta("Partial", 0),
      { kind: "turn-settled", turnId },
      {
        kind: "commit",
        sequence: 2,
        item: {
          _tag: "message",
          ...commitFields("commit-2", 2, ["commit-1"]),
          authorKind: "assistant",
          text: "Partial",
          interrupted: true,
        },
      },
    ]);
    expect(state.detail?.inFlightTurns).toHaveLength(0);
    expect(state.detail?.timeline).toHaveLength(2);
  });

  it("lets the settled commit close the turn when it outruns turn-settled", () => {
    // Frames and commit events ride different feeds; either order must
    // converge. A mid-turn plan revision is an assistant commit too and
    // closes nothing.
    const midRevision = fold([
      { kind: "snapshot", snapshot },
      started,
      {
        kind: "commit",
        sequence: 2,
        item: {
          _tag: "plan-revision",
          ...commitFields("commit-2", 2, ["commit-1"]),
          authorKind: "assistant",
        },
        planText: "# Plan",
      },
    ]);
    expect(midRevision.detail?.inFlightTurns).toHaveLength(1);

    const settledByCommit = applyPlanStreamItem(midRevision, {
      kind: "commit",
      sequence: 3,
      item: {
        _tag: "message",
        ...commitFields("commit-3", 3, ["commit-2"]),
        authorKind: "assistant",
        text: "Done",
      },
    });
    expect(settledByCommit.detail?.inFlightTurns).toHaveLength(0);

    const idempotent = applyPlanStreamItem(settledByCommit, { kind: "turn-settled", turnId });
    expect(idempotent.detail?.inFlightTurns).toHaveLength(0);
    expect(idempotent.detail?.timeline).toHaveLength(3);
  });

  it("surfaces a refusal and clears it when a turn starts", () => {
    const refused = fold([
      { kind: "snapshot", snapshot },
      { kind: "turn-refused", reason: "no-instance" },
    ]);
    expect(refused.turnRefusal).toBe("no-instance");

    const cleared = applyPlanStreamItem(refused, started);
    expect(cleared.turnRefusal).toBeNull();
  });

  it("joins mid-turn from the snapshot's own in-flight state", () => {
    const midTurn: PlanDetail = {
      ...snapshot,
      inFlightTurns: [
        {
          turnId,
          parentCommitId: MercurianCommitId.make("commit-1"),
          text: "So far",
          grounding: [{ kind: "search", label: "subscribeTree" }],
        },
      ],
    };
    const state = fold([{ kind: "snapshot", snapshot: midTurn }]);
    expect(state.detail?.inFlightTurns[0]?.text).toBe("So far");
    expect(state.detail?.inFlightTurns[0]?.grounding).toHaveLength(1);
  });
});

describe("applyPlanStreamItem concurrent turns", () => {
  const otherTurnId = PlanTurnId.make("turn-2");
  const forkSnapshot: PlanDetail = {
    ...snapshot,
    timeline: [
      message("commit-1", 1, "Reshape the sidebar"),
      message("commit-2", 2, "Reply", ["commit-1"]),
      message("commit-3", 3, "Branch A", ["commit-2"]),
      message("commit-4", 4, "Branch B", ["commit-2"]),
    ],
    snapshotSequence: 4,
  };
  const startedA: PlanStreamItem = {
    kind: "turn-started",
    turnId,
    parentCommitId: MercurianCommitId.make("commit-3"),
  };
  const startedB: PlanStreamItem = {
    kind: "turn-started",
    turnId: otherTurnId,
    parentCommitId: MercurianCommitId.make("commit-4"),
  };

  it("streams interleaved deltas into their own turns, never across", () => {
    const state = fold([
      { kind: "snapshot", snapshot: forkSnapshot },
      startedA,
      startedB,
      delta("A-text", 0),
      { kind: "turn-delta", turnId: otherTurnId, textDelta: "B-text", offset: 0 },
    ]);
    const turns = state.detail?.inFlightTurns ?? [];
    expect(turns).toHaveLength(2);
    expect(turns.find((turn) => turn.turnId === turnId)?.text).toBe("A-text");
    expect(turns.find((turn) => turn.turnId === otherTurnId)?.text).toBe("B-text");
  });

  it("settles one turn and leaves the other streaming", () => {
    const state = fold([
      { kind: "snapshot", snapshot: forkSnapshot },
      startedA,
      startedB,
      { kind: "turn-settled", turnId },
    ]);
    const turns = state.detail?.inFlightTurns ?? [];
    expect(turns.map((turn) => turn.turnId)).toEqual([otherTurnId]);
  });

  it("lets a settled commit close only the branch it descends from", () => {
    // Branch A's reply settles as a commit — walking its first parents finds
    // turn A's opening parent; turn B keeps streaming untouched.
    const state = fold([
      { kind: "snapshot", snapshot: forkSnapshot },
      startedA,
      startedB,
      {
        kind: "commit",
        sequence: 5,
        item: {
          _tag: "plan-revision",
          ...commitFields("revision-a", 5, ["commit-3"]),
          authorKind: "assistant",
        },
        planText: "# Branch A plan",
      },
      {
        kind: "commit",
        sequence: 6,
        item: {
          _tag: "message",
          ...commitFields("reply-a", 6, ["revision-a"]),
          authorKind: "assistant",
          text: "Done on A",
        },
      },
    ]);
    const turns = state.detail?.inFlightTurns ?? [];
    expect(turns.map((turn) => turn.turnId)).toEqual([otherTurnId]);
    expect(state.detail?.timeline.at(-1)?.commitId).toBe("reply-a");
  });

  it("a question pauses only its own turn", () => {
    const state = fold([
      { kind: "snapshot", snapshot: forkSnapshot },
      startedA,
      startedB,
      { kind: "turn-question", turnId, questions: [question] },
    ]);
    const turns = state.detail?.inFlightTurns ?? [];
    expect(turns.find((turn) => turn.turnId === turnId)?.questions).toEqual([question]);
    expect(turns.find((turn) => turn.turnId === otherTurnId)?.questions).toBeUndefined();
  });
});

describe("applyPlanStreamItem historical split revisions", () => {
  it("appends a split commit without changing plan text", () => {
    const split = {
      _tag: "plan-revision" as const,
      ...commitFields("split-1", 2, ["commit-1"]),
      split: {
        repositoryId: MercurianRepositoryId.make("repo-1"),
        repositoryName: "server",
      },
    };
    const state = fold([
      {
        kind: "snapshot",
        snapshot: { ...snapshot, planText: "# Parent plan" },
      },
      { kind: "commit", sequence: 2, item: split },
    ]);
    expect(state.detail?.planText).toBe("# Parent plan");
    expect(state.detail?.timeline.at(-1)).toEqual(split);
  });
});

describe("applyPlanStreamItem memory amendments", () => {
  const amendment = {
    turnId,
    title: "Record the composer boundary",
    changes: [{ path: "Composer.md", before: null, after: "# Composer\n" }],
    patch: "diff --git a/Composer.md b/Composer.md",
    placements: [],
  };

  it("folds only the live reply's proposal and clears it on a newer turn", () => {
    const proposed = fold([
      { kind: "snapshot", snapshot },
      started,
      { kind: "memory-amendment-proposed", proposal: amendment },
    ]);
    expect(proposed.detail?.memoryAmendmentProposal).toEqual(amendment);
    expect(
      applyPlanStreamItem(proposed, {
        kind: "turn-started",
        turnId: PlanTurnId.make("newer-turn"),
        parentCommitId: MercurianCommitId.make("commit-1"),
      }).detail?.memoryAmendmentProposal,
    ).toBeUndefined();

    const stale = fold([
      { kind: "snapshot", snapshot },
      { kind: "memory-amendment-proposed", proposal: amendment },
    ]);
    expect(stale.detail?.memoryAmendmentProposal).toBeUndefined();
  });

  it("clears only a turn-matched cancellation", () => {
    const joined = fold([
      { kind: "snapshot", snapshot: { ...snapshot, memoryAmendmentProposal: amendment } },
    ]);
    const stale = applyPlanStreamItem(joined, {
      kind: "memory-amendment-cancelled",
      turnId: PlanTurnId.make("other-turn"),
    });
    expect(stale.detail?.memoryAmendmentProposal).toEqual(amendment);
    expect(
      applyPlanStreamItem(stale, { kind: "memory-amendment-cancelled", turnId }).detail
        ?.memoryAmendmentProposal,
    ).toBeUndefined();
  });

  it("closes a standing proposal when its stamped human commit lands", () => {
    const state = fold([
      { kind: "snapshot", snapshot: { ...snapshot, memoryAmendmentProposal: amendment } },
      {
        kind: "commit",
        sequence: 2,
        item: {
          _tag: "message",
          ...commitFields("commit-2", 2, ["commit-1"]),
          text: amendment.title,
          memoryAmendment: {
            title: amendment.title,
            memoryCommitSha: "abc123",
            notes: ["Composer"],
          },
        },
      },
    ]);
    expect(state.detail?.memoryAmendmentProposal).toBeUndefined();
  });
});
