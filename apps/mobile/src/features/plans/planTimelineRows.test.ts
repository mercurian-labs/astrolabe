import { describe, expect, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanTurnId,
  ThreadId,
  type PlanInFlightTurn,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { derivePlanTimelineRows } from "./planTimelineRows";

const id = (value: string) => MercurianCommitId.make(value);
const message = (
  commitId: string,
  sequence: number,
  parents: string[],
  overrides: Partial<Extract<PlanTimelineItem, { _tag: "message" }>> = {},
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(commitId),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  createdAt: "2026-08-20T00:00:00.000Z",
  text: commitId,
  ...overrides,
});

const inFlight = (parentCommitId: string, withQuestion = false): PlanInFlightTurn => ({
  turnId: PlanTurnId.make("turn"),
  parentCommitId: id(parentCommitId),
  text: "reply",
  grounding: [],
  ...(withQuestion
    ? {
        questions: [
          {
            id: "q1",
            header: "Choice",
            question: "Which one?",
            options: [{ label: "A", description: "First" }],
          },
        ],
      }
    : {}),
});

describe("derivePlanTimelineRows", () => {
  it("renders only the standing path through a fork", () => {
    const timeline = [
      message("root", 1, []),
      message("left", 2, ["root"]),
      message("right", 3, ["root"]),
    ];
    const rows = derivePlanTimelineRows({
      timeline,
      visibleCommitIds: new Set(["root", "left"]),
    });
    expect(rows.map((row) => row.key)).toEqual(["commit:root", "commit:left"]);
  });

  it("shows an in-flight turn only on its parent path", () => {
    const timeline = [message("left", 1, []), message("right", 2, [])];
    expect(
      derivePlanTimelineRows({
        timeline,
        visibleCommitIds: new Set(["left"]),
        inFlightTurn: inFlight("right"),
      }).some((row) => row.type === "in-flight-turn"),
    ).toBe(false);
    expect(
      derivePlanTimelineRows({
        timeline,
        visibleCommitIds: new Set(["right"]),
        inFlightTurn: inFlight("right", true),
      }).at(-1),
    ).toMatchObject({ type: "in-flight-turn", questionState: "awaiting" });
  });

  it("uses the revision, split, and spec-cause label ladders", () => {
    const fields = {
      parents: [] as const,
      published: false,
      authorKind: "assistant" as const,
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      { _tag: "plan-revision", commitId: id("plan"), sequence: 1, ...fields },
      {
        _tag: "plan-revision",
        commitId: id("split"),
        sequence: 2,
        ...fields,
        split: {
          repositoryId: MercurianRepositoryId.make("repo"),
          repositoryName: "server",
        },
      },
      {
        _tag: "spec-revision",
        commitId: id("spec"),
        sequence: 3,
        ...fields,
        cause: "refresh",
        issueId: "M-147",
      },
    ];
    expect(
      derivePlanTimelineRows({
        timeline,
        visibleCommitIds: new Set(["plan", "split", "spec"]),
      }).map((row) => (row.type === "effect" ? row.label : "")),
    ).toEqual(["The assistant revised the plan", "Plan for server", "Spec refreshed from M-147"]);
  });

  it("distinguishes awaiting, settled, and unanswered questions and marks interruption", () => {
    const question = inFlight("root", true).questions!;
    const rows = derivePlanTimelineRows({
      timeline: [
        message("unanswered", 1, [], {
          authorKind: "assistant",
          interrupted: true,
          question: { questions: question },
        }),
        message("answered", 2, ["unanswered"], {
          authorKind: "assistant",
          question: { questions: question, answers: { q1: "A" } },
        }),
      ],
      visibleCommitIds: new Set(["unanswered", "answered"]),
      inFlightTurn: inFlight("answered", true),
    });
    expect(rows).toMatchObject([
      { questionState: "unanswered", interrupted: true },
      { questionState: "answered", interrupted: false },
      { questionState: "awaiting" },
    ]);
  });

  it("carries the coding-session record shape", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      {
        _tag: "coding-session",
        commitId: id("session"),
        sequence: 1,
        parents: [],
        published: false,
        authorKind: "human",
        createdAt: "2026-08-20T00:00:00.000Z",
        repositoryId: MercurianRepositoryId.make("repo"),
        repositoryName: "server",
        planRevisionCommitId: id("rev"),
      },
    ];
    expect(
      derivePlanTimelineRows({
        timeline,
        visibleCommitIds: new Set(["session"]),
        codingSessions: [
          {
            commitId: id("session"),
            repositoryId: MercurianRepositoryId.make("repo"),
            threadId: ThreadId.make("thread"),
            branch: "feature/m-147",
            worktreePath: "/repo",
            baseRef: "main",
            startedAt: "2026-08-20T00:00:00.000Z",
            endedAt: null,
            outcome: null,
            prUrl: null,
          },
        ],
      })[0],
    ).toMatchObject({
      type: "coding-session",
      status: "Running",
      record: { branch: "feature/m-147" },
    });
  });
});
