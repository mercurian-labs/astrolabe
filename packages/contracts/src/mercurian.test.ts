import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanStreamItem,
  PlanReconstruction,
  type PlanTimelineItem,
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
  "line-runtimes",
  "turn-started",
  "turn-delta",
  "turn-grounding",
  "turn-question",
  "turn-question-answered",
  "turn-settled",
  "turn-refused",
  "memory-amendment-failed",
  "memory-merge-home-conflict",
] as const;

type _PlanTimelineTagsAreExact = Assert<
  Equal<(typeof PLAN_TIMELINE_TAGS)[number], PlanTimelineItem["_tag"]>
>;
type _PlanStreamKindsAreExact = Assert<
  Equal<(typeof PLAN_STREAM_KINDS)[number], (typeof PlanStreamItem.Type)["kind"]>
>;

const decodeWorktreeSlotStreamItem = Schema.decodeUnknownSync(WorktreeSlotStreamItem);
const decodePlanStreamItem = Schema.decodeUnknownSync(PlanStreamItem);

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
    expect(decodeWorktreeSlotStreamItem(item)).toEqual(item);
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
      "line-runtimes",
      "turn-started",
      "turn-delta",
      "turn-grounding",
      "turn-question",
      "turn-question-answered",
      "turn-settled",
      "turn-refused",
      "memory-amendment-failed",
      "memory-merge-home-conflict",
    ]);
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
    expect(decodePlanStreamItem(frame)).toEqual(frame);

    const runtimeFrame = {
      kind: "line-runtimes" as const,
      lineRuntimes: [
        {
          planId: "plan" as never,
          lineRootCommitId: MercurianCommitId.make("line"),
          threadId: ThreadId.make("line-thread"),
          homeRepositoryId: MercurianRepositoryId.make("repo"),
          branch: "mercurian/line",
          worktreePath: "/tmp/line",
          unreachableRepositories: [],
          snapshotOid: null,
          snapshotKind: null,
          departedRef: null,
          branchMovement: null,
        },
      ],
    };
    expect(decodePlanStreamItem(runtimeFrame)).toEqual(runtimeFrame);

    for (const groundingKind of ["command", "edit"] as const) {
      const groundingFrame = {
        kind: "turn-grounding" as const,
        turnId: "turn" as never,
        item: { kind: groundingKind, label: "action" },
      };
      expect(decodePlanStreamItem(groundingFrame)).toEqual(groundingFrame);
    }

    const started = {
      kind: "turn-started" as const,
      turnId: "turn" as never,
      parentCommitId: MercurianCommitId.make("parent"),
      phase: "waiting-for-slot" as const,
    };
    expect(decodePlanStreamItem(started)).toEqual(started);
  });
});

const decodeReconstruction = Schema.decodeUnknownSync(PlanReconstruction);
const encodeReconstruction = Schema.encodeSync(PlanReconstruction);

describe("session reconstruction evidence", () => {
  const record = {
    id: "record",
    planId: "plan",
    sessionStartMessageCommitId: "query",
    throughCommitId: "parent",
    verbatimFromCommitId: "query",
    version: 1,
    compacted: { throughCommitId: "parent", summary: "\n Exact rendition. \n" },
  };
  it("preserves summary whitespace through encoding and decoding", () => {
    const decoded = decodeReconstruction(record);
    expect(encodeReconstruction(decoded)).toEqual(record);
  });
  it("requires both the rendition and its historical endpoint", () => {
    expect(() =>
      decodeReconstruction({
        ...record,
        compacted: { summary: "summary" },
      }),
    ).toThrow();
    expect(() =>
      decodeReconstruction({
        ...record,
        compacted: { throughCommitId: "parent" },
      }),
    ).toThrow();
  });
});
