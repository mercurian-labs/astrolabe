import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  PlanTurnId,
  type PlanDetail,
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

const technicalPlan = (
  id: string,
  sequence: number,
  parents: ReadonlyArray<string> = [],
): PlanTimelineItem => ({
  _tag: "technical-plan",
  ...commitFields(id, sequence, parents),
  repositoryId: MercurianRepositoryId.make("repository-1"),
  repositoryName: "astrolabe",
  sourceRevisionCommitId: MercurianCommitId.make("revision-1"),
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
    expect(state.detail?.inFlightTurn?.text).toBe("Hello");
    expect(state.detail?.inFlightTurn?.parentCommitId).toBe("commit-1");
  });

  it("folds away a delta replayed across the snapshot join", () => {
    // The server attaches its frame feed before it reads the snapshot, so a
    // delta the snapshot's partial text already contains can arrive again.
    const midTurn: PlanDetail = {
      ...snapshot,
      inFlightTurn: {
        turnId,
        parentCommitId: MercurianCommitId.make("commit-1"),
        text: "Hel",
        grounding: [],
      },
    };
    const state = fold([{ kind: "snapshot", snapshot: midTurn }, delta("Hel", 0), delta("lo", 3)]);
    expect(state.detail?.inFlightTurn?.text).toBe("Hello");
  });

  it("collects grounding once per item", () => {
    const item = { kind: "file-read" as const, label: "apps/server/src/ws.ts" };
    const state = fold([
      { kind: "snapshot", snapshot },
      started,
      { kind: "turn-grounding", turnId, item },
      { kind: "turn-grounding", turnId, item },
    ]);
    expect(state.detail?.inFlightTurn?.grounding).toEqual([item]);
  });

  it("raises the question and clears it when answered", () => {
    const asked = fold([
      { kind: "snapshot", snapshot },
      started,
      { kind: "turn-question", turnId, questions: [question] },
    ]);
    expect(asked.detail?.inFlightTurn?.questions).toEqual([question]);

    const answered = applyPlanStreamItem(asked, { kind: "turn-question-answered", turnId });
    expect(answered.detail?.inFlightTurn?.questions).toBeUndefined();
    expect(answered.detail?.inFlightTurn?.text).toBe("");
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
    expect(state.detail?.inFlightTurn).toBeUndefined();
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
    expect(midRevision.detail?.inFlightTurn).toBeDefined();

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
    expect(settledByCommit.detail?.inFlightTurn).toBeUndefined();

    const idempotent = applyPlanStreamItem(settledByCommit, { kind: "turn-settled", turnId });
    expect(idempotent.detail?.inFlightTurn).toBeUndefined();
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
      inFlightTurn: {
        turnId,
        parentCommitId: MercurianCommitId.make("commit-1"),
        text: "So far",
        grounding: [{ kind: "search", label: "subscribeTree" }],
      },
    };
    const state = fold([{ kind: "snapshot", snapshot: midTurn }]);
    expect(state.detail?.inFlightTurn?.text).toBe("So far");
    expect(state.detail?.inFlightTurn?.grounding).toHaveLength(1);
  });
});

const derivationTurnId = PlanTurnId.make("derivation-1");
const derivationStarted: PlanStreamItem = {
  kind: "derivation-started",
  derivation: {
    turnId: derivationTurnId,
    parentCommitId: MercurianCommitId.make("commit-1"),
    repositoryId: MercurianRepositoryId.make("repository-1"),
    repositoryName: "astrolabe",
    grounding: [],
  },
};

describe("applyPlanStreamItem derivation frames", () => {
  it("opens a derivation and routes grounding by turn id", () => {
    const replyGrounding = { kind: "search" as const, label: "reply search" };
    const derivationGrounding = { kind: "file-read" as const, label: "src/technical.ts" };
    const state = fold([
      { kind: "snapshot", snapshot },
      started,
      derivationStarted,
      { kind: "turn-grounding", turnId, item: replyGrounding },
      {
        kind: "turn-grounding",
        turnId: derivationTurnId,
        item: derivationGrounding,
      },
    ]);
    expect(state.detail?.inFlightTurn?.grounding).toEqual([replyGrounding]);
    expect(state.detail?.inFlightDerivation?.grounding).toEqual([derivationGrounding]);
  });

  it("clears on settle and carries a failure reason on failure", () => {
    const settled = fold([
      { kind: "snapshot", snapshot },
      derivationStarted,
      { kind: "derivation-settled", turnId: derivationTurnId },
    ]);
    expect(settled.detail?.inFlightDerivation).toBeUndefined();
    expect(settled.derivationFailure).toBeNull();

    const failed = fold([
      { kind: "snapshot", snapshot },
      derivationStarted,
      { kind: "derivation-failed", turnId: derivationTurnId, reason: "stopped" },
    ]);
    expect(failed.detail?.inFlightDerivation).toBeUndefined();
    expect(failed.derivationFailure).toBe("stopped");
  });

  it("appends the technical-plan record without changing plan text", () => {
    const state = fold([
      { kind: "snapshot", snapshot: { ...snapshot, planText: "# Plan" } },
      derivationStarted,
      {
        kind: "commit",
        sequence: 2,
        item: technicalPlan("technical-1", 2, ["commit-1"]),
      },
    ]);
    expect(state.detail?.planText).toBe("# Plan");
    expect(state.detail?.timeline.at(-1)?._tag).toBe("technical-plan");
    expect(state.detail?.inFlightDerivation).toBeUndefined();
  });

  it("joins a derivation already present on the snapshot", () => {
    const midDerivation: PlanDetail = {
      ...snapshot,
      inFlightDerivation: derivationStarted.derivation,
    };
    const state = fold([{ kind: "snapshot", snapshot: midDerivation }]);
    expect(state.detail?.inFlightDerivation?.repositoryName).toBe("astrolabe");
  });
});
