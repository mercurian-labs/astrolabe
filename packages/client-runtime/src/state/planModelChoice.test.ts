import { describe, expect, it } from "@effect/vitest";
import { MercurianCommitId, ProviderDriverKind, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./planGraph.ts";
import { standingModelChoice } from "./planModelChoice.ts";

const id = (value: string) => MercurianCommitId.make(value);
const message = (
  commitId: string,
  sequence: number,
  parents: string[],
  ranUnder?: Extract<PlanTimelineItem, { _tag: "message" }>["ranUnder"],
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(commitId),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  createdAt: "2026-08-17T00:00:00.000Z",
  text: commitId,
  ...(ranUnder === undefined ? {} : { ranUnder }),
});

describe("standingModelChoice", () => {
  it("inherits the nearest choice along the first-parent path", () => {
    const timeline = [
      message("root", 1, [], { provider: ProviderDriverKind.make("claudeAgent"), model: "opus" }),
      message("left", 2, ["root"]),
      message("right", 3, ["root"], {
        provider: ProviderDriverKind.make("codex"),
        model: "gpt-5.4",
      }),
    ];
    const graph = buildPlanGraph(timeline);
    const items = new Map(timeline.map((item) => [item.commitId, item]));
    expect(standingModelChoice(graph, items, id("left"))).toEqual({
      provider: "claudeAgent",
      model: "opus",
    });
    expect(standingModelChoice(graph, items, id("right"))).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
  });

  it("returns none for an unstamped history", () => {
    const timeline = [message("root", 1, [])];
    expect(
      standingModelChoice(
        buildPlanGraph(timeline),
        new Map(timeline.map((item) => [item.commitId, item])),
        id("root"),
      ),
    ).toBeNull();
  });
});
