import { MercurianCommitId, ProviderDriverKind, type PlanTimelineItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { standingModelChoice } from "./PlanModelChoice.logic";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const id = (value: string) => MercurianCommitId.make(value);

const message = (
  commitId: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  ranUnder?: Extract<PlanTimelineItem, { readonly _tag: "message" }>["ranUnder"],
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

const derive = (timeline: ReadonlyArray<PlanTimelineItem>, from: string) => {
  const graph = buildPlanGraph(timeline);
  return standingModelChoice(
    graph,
    new Map(timeline.map((item) => [item.commitId, item])),
    id(from),
  );
};

describe("standingModelChoice", () => {
  it("takes the nearest ancestor record", () => {
    const timeline = [
      message("root", 1, [], { provider: claude, model: "opus", followedDefault: false }),
      message("middle", 2, ["root"], {
        provider: codex,
        model: "gpt-5.4",
        followedDefault: false,
      }),
      message("tip", 3, ["middle"]),
    ];
    expect(derive(timeline, "tip")).toEqual({
      _tag: "override",
      selection: { provider: codex, model: "gpt-5.4" },
    });
  });

  it("inherits the choice at a fork point", () => {
    const timeline = [
      message("root", 1, [], { provider: claude, model: "opus", followedDefault: false }),
      message("left", 2, ["root"]),
      message("right", 3, ["root"]),
    ];
    expect(derive(timeline, "right")).toEqual({
      _tag: "override",
      selection: { provider: claude, model: "opus" },
    });
  });

  it("follows the default when history has no record", () => {
    expect(derive([message("root", 1, [])], "root")).toEqual({ _tag: "follow-default" });
  });

  it("keeps follow-default mode when its record names an earlier concrete pair", () => {
    expect(
      derive(
        [
          message("root", 1, [], {
            provider: claude,
            model: "opus",
            followedDefault: true,
          }),
        ],
        "root",
      ),
    ).toEqual({ _tag: "follow-default" });
  });
});
