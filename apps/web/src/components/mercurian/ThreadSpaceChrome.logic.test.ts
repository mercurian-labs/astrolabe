import { MercurianCommitId, MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { resolveForkHereInput } from "./ThreadSpaceChrome.logic";

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
