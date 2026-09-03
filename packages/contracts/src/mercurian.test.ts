import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import {
  CodingSessionBlockedError,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianStartCodingSessionInput,
  PlanId,
  PlanStreamItem,
  type PlanTimelineItem,
  ProviderInstanceId,
  WorktreeSlotStreamItem,
} from "./index.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const PLAN_TIMELINE_TAGS = ["message", "plan-revision", "spec-revision", "coding-session"] as const;
const PLAN_STREAM_KINDS = [
  "snapshot",
  "commit",
  "synchronized",
  "coding-sessions",
  "turn-started",
  "turn-delta",
  "turn-grounding",
  "turn-question",
  "turn-question-answered",
  "turn-settled",
  "turn-refused",
  "implement-started",
  "implement-analyzed",
  "implement-ready",
  "implement-cancelled",
  "implement-failed",
  "memory-amendment-proposed",
  "memory-amendment-failed",
  "memory-amendment-cancelled",
] as const;

type _PlanTimelineTagsAreExact = Assert<
  Equal<(typeof PLAN_TIMELINE_TAGS)[number], PlanTimelineItem["_tag"]>
>;
type _PlanStreamKindsAreExact = Assert<
  Equal<(typeof PLAN_STREAM_KINDS)[number], (typeof PlanStreamItem.Type)["kind"]>
>;

describe("coding-session contracts", () => {
  it("round-trips project-scoped slot members", () => {
    const item = {
      kind: "snapshot" as const,
      snapshot: {
        slots: [
          {
            slotId: "project:slot-1",
            projectId: MercurianProjectId.make("project"),
            path: "/worktrees/project/slot-1",
            currentLineRootCommitId: MercurianCommitId.make("line"),
            members: [
              {
                repositoryId: MercurianRepositoryId.make("repository"),
                relativePath: "apps/repository",
                currentBranch: "mercurian/line",
              },
            ],
            leased: true,
            createdAt: "2026-08-31T12:00:00.000Z",
            lastUsedAt: "2026-08-31T12:00:00.000Z",
          },
        ],
      },
    };
    expect(Schema.decodeUnknownSync(WorktreeSlotStreamItem)(item)).toEqual(item);
  });

  it("pins plan history and stream discriminants without session-activity members", () => {
    expect(PLAN_TIMELINE_TAGS).toEqual([
      "message",
      "plan-revision",
      "spec-revision",
      "coding-session",
    ]);
    expect(PLAN_STREAM_KINDS).toEqual([
      "snapshot",
      "commit",
      "synchronized",
      "coding-sessions",
      "turn-started",
      "turn-delta",
      "turn-grounding",
      "turn-question",
      "turn-question-answered",
      "turn-settled",
      "turn-refused",
      "implement-started",
      "implement-analyzed",
      "implement-ready",
      "implement-cancelled",
      "implement-failed",
      "memory-amendment-proposed",
      "memory-amendment-failed",
      "memory-amendment-cancelled",
    ]);
  });

  it("round-trips an exact-instance start payload", () => {
    const input = {
      planId: PlanId.make("plan"),
      parentCommitId: MercurianCommitId.make("ready"),
      repositoryId: MercurianRepositoryId.make("repo"),
      baseRef: "main",
      startFromOrigin: true,
      runtimeMode: "full-access" as const,
      modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5.6" },
    };
    expect(Schema.decodeUnknownSync(MercurianStartCodingSessionInput)(input)).toEqual(input);
  });

  it("round-trips keyed side-fact frames and typed refusals", () => {
    const frame = {
      kind: "coding-sessions" as const,
      sessions: [
        {
          commitId: MercurianCommitId.make("session"),
          repositoryId: MercurianRepositoryId.make("repo"),
          threadId: ThreadId.make("thread"),
          branch: "mercurian/plan-12345678",
          worktreePath: "/tmp/session",
          baseRef: "main",
          startedAt: "2026-08-14T00:00:00.000Z",
          endedAt: null,
          outcome: null,
          prUrl: null,
          settledCommitOid: null,
          partial: false,
          snapshotOid: null,
          snapshotKind: null,
          departedRef: null,
          branchMovement: null,
        },
      ],
    };
    expect(Schema.decodeUnknownSync(PlanStreamItem)(frame)).toEqual(frame);
    expect(
      Schema.decodeUnknownSync(CodingSessionBlockedError)(
        new CodingSessionBlockedError({ reason: "model-unavailable" }),
      ).reason,
    ).toBe("model-unavailable");
    for (const reason of [
      "not-ready",
      "repository-mismatch",
      "repository-not-in-project",
      "repository-not-git",
      "base-ref-missing",
      "no-instance",
      "model-unavailable",
      "pool-at-capacity",
      "line-branch-missing",
    ] as const) {
      expect(new CodingSessionBlockedError({ reason }).message).not.toContain(reason);
    }
  });
});
