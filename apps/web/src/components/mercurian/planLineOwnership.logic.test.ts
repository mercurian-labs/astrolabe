import {
  MercurianCommitId,
  PlanId,
  PlanTurnId,
  ThreadId,
  type MercurianThreadPlanLink,
  type PlanLineRuntimeRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { resolveLineInFlightTurn } from "./ThreadSpaceChrome.logic";
import { lineThreadIdForCommit, resolveLineTip } from "./planLineOwnership.logic";

const timelineMessage = (commitId: string, parents: string[], sequence: number) => ({
  _tag: "message" as const,
  commitId: MercurianCommitId.make(commitId),
  sequence,
  parents: parents.map((parent) => MercurianCommitId.make(parent)),
  published: false,
  authorKind: "human" as const,
  createdAt: "2026-09-04T00:00:00.000Z" as never,
  text: commitId,
});

describe("plan line ownership", () => {
  it("uses the fork parent as the tip of a pending line", () => {
    const runtime = {
      threadId: ThreadId.make("thread-pending"),
      lineRootCommitId: null,
      forkParentCommitId: MercurianCommitId.make("parent"),
    } as PlanLineRuntimeRecord;

    expect(resolveLineTip(null, buildPlanGraph([]), runtime, [])).toBe("parent");
  });

  it("uses the newest commit owned by a rooted line when a sibling line is newer", () => {
    const graph = buildPlanGraph([
      timelineMessage("R", [], 1),
      timelineMessage("A", ["R"], 2),
      timelineMessage("F", ["R"], 3),
      timelineMessage("G", ["F"], 4),
    ]);
    const planId = PlanId.make("plan-1");
    const originRuntime = {
      threadId: ThreadId.make("thread-origin"),
      lineRootCommitId: MercurianCommitId.make("R"),
    } as PlanLineRuntimeRecord;
    const forkRuntime = {
      threadId: ThreadId.make("thread-fork"),
      lineRootCommitId: MercurianCommitId.make("F"),
    } as PlanLineRuntimeRecord;
    const detail = { plan: { planId }, lineRuntimes: [originRuntime, forkRuntime] };

    expect(resolveLineTip(detail, graph, originRuntime, [])).toBe("A");
    expect(resolveLineTip(detail, graph, forkRuntime, [])).toBe("G");
    expect(
      lineThreadIdForCommit({
        commitId: MercurianCommitId.make("G"),
        detail,
        graph,
        threadPlanLinks: [],
      }),
    ).toBe("thread-fork");
  });

  it("uses known line roots when a fork is recorded before the origin line continues", () => {
    const graph = buildPlanGraph([
      timelineMessage("R", [], 1),
      timelineMessage("F", ["R"], 2),
      timelineMessage("A", ["R"], 3),
      timelineMessage("B", ["A"], 4),
    ]);
    const planId = PlanId.make("plan-1");
    const originRuntime = {
      threadId: ThreadId.make("thread-origin"),
      lineRootCommitId: MercurianCommitId.make("R"),
    } as PlanLineRuntimeRecord;
    const forkRuntime = {
      threadId: ThreadId.make("thread-fork"),
      lineRootCommitId: MercurianCommitId.make("F"),
    } as PlanLineRuntimeRecord;
    const threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink> = [
      {
        planId,
        threadId: forkRuntime.threadId,
        lineRootCommitId: forkRuntime.lineRootCommitId,
      },
    ];
    const detail = {
      plan: { planId },
      lineRuntimes: [originRuntime],
      inFlightTurns: [
        {
          turnId: PlanTurnId.make("turn-fork"),
          parentCommitId: MercurianCommitId.make("F"),
          text: "fork reply",
          grounding: [],
        },
        {
          turnId: PlanTurnId.make("turn-origin"),
          parentCommitId: MercurianCommitId.make("B"),
          text: "origin reply",
          grounding: [],
        },
      ],
    };

    expect(resolveLineInFlightTurn(detail, graph, originRuntime, threadPlanLinks)?.turnId).toBe(
      "turn-origin",
    );
    expect(
      resolveLineInFlightTurn(
        { ...detail, inFlightTurns: [detail.inFlightTurns[0]!] },
        graph,
        originRuntime,
        threadPlanLinks,
      ),
    ).toBeUndefined();
    expect(resolveLineInFlightTurn(detail, graph, forkRuntime, threadPlanLinks)?.turnId).toBe(
      "turn-fork",
    );
    expect(resolveLineTip(detail, graph, originRuntime, threadPlanLinks)).toBe("B");
    expect(resolveLineTip(detail, graph, forkRuntime, threadPlanLinks)).toBe("F");
  });
});
