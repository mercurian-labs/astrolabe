import {
  MercurianCommitId,
  MessageId,
  PlanId,
  PlanTurnId,
  ThreadId,
  type MercurianThreadPlanLink,
  type PlanLineRuntimeRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import {
  resolveForkHereInput,
  resolveLineInFlightTurn,
  resolveLineTip,
} from "./ThreadSpaceChrome.logic";

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

describe("resolveForkHereInput", () => {
  const graph = buildPlanGraph([
    timelineMessage("root", [], 1),
    timelineMessage("message-2", ["root"], 2),
  ]);

  it("uses the recorded message commit's parent and seeds its text", () => {
    expect(
      resolveForkHereInput(graph, {
        id: MessageId.make("message-2"),
        text: "try a different approach",
      }),
    ).toEqual({
      parentCommitId: MercurianCommitId.make("root"),
      seedText: "try a different approach",
    });
  });

  it("does not offer Fork here for an unrecorded message or a root without a parent", () => {
    expect(
      resolveForkHereInput(graph, {
        id: MessageId.make("optimistic-message"),
        text: "not recorded yet",
      }),
    ).toBeNull();
    expect(
      resolveForkHereInput(graph, {
        id: MessageId.make("root"),
        text: "root",
      }),
    ).toBeNull();
  });
});

describe("line ownership", () => {
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
