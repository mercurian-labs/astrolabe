import { MercurianCommitId, MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { resolveForkHereInput, resolveLineOrigin } from "./ThreadSpaceChrome.logic";

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

describe("resolveLineOrigin", () => {
  const graph = buildPlanGraph([
    timelineMessage("root", [], 1),
    timelineMessage("fork-root", ["root"], 2),
    timelineMessage("nested-root", ["fork-root"], 3),
    timelineMessage("missing-parent", ["unavailable"], 4),
  ]);

  it("does not mark an initial line as forked", () => {
    expect(resolveLineOrigin(graph, null)).toBeNull();
    expect(resolveLineOrigin(graph, { lineRootCommitId: null })).toBeNull();
    expect(
      resolveLineOrigin(graph, { lineRootCommitId: MercurianCommitId.make("root") }),
    ).toBeNull();
  });

  it("keeps the same origin before and after the first fork turn binds its root", () => {
    expect(
      resolveLineOrigin(graph, {
        lineRootCommitId: null,
        forkParentCommitId: MercurianCommitId.make("root"),
      }),
    ).toBe("root");
    expect(
      resolveLineOrigin(graph, {
        lineRootCommitId: MercurianCommitId.make("fork-root"),
      }),
    ).toBe("root");
  });

  it("identifies the immediate origin of a nested fork", () => {
    expect(
      resolveLineOrigin(graph, {
        lineRootCommitId: MercurianCommitId.make("nested-root"),
      }),
    ).toBe("fork-root");
  });

  it("preserves origins absent from the rendered graph, including historical checkpoints", () => {
    expect(
      resolveLineOrigin(graph, {
        lineRootCommitId: MercurianCommitId.make("missing-parent"),
      }),
    ).toBe("unavailable");
    for (const origin of ["historical-coding-session", "former-plan-only-checkpoint"]) {
      expect(
        resolveLineOrigin(graph, {
          lineRootCommitId: null,
          forkParentCommitId: MercurianCommitId.make(origin),
        }),
      ).toBe(origin);
    }
  });
});
