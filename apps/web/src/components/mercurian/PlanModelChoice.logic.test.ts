import { ProviderDriverKind, type PlanTimelineItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { commitId as id, message, planRevision, specRevision } from "../../test/fixtures/timeline";

import { buildPlanGraph } from "./PlanGraph.logic";
import { standingModelChoice } from "./PlanModelChoice.logic";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");

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
      message("root", { ranUnder: { provider: claude, model: "opus" } }),
      message("middle", {
        sequence: 2,
        parents: ["root"],
        ranUnder: {
          provider: codex,
          model: "gpt-5.4",
        },
      }),
      message("tip", { sequence: 3, parents: ["middle"] }),
    ];
    expect(derive(timeline, "tip")).toEqual({ provider: codex, model: "gpt-5.4" });
  });

  it("inherits the choice at a fork point", () => {
    const timeline = [
      message("root", { ranUnder: { provider: claude, model: "opus" } }),
      message("left", { sequence: 2, parents: ["root"] }),
      message("right", { sequence: 3, parents: ["root"] }),
    ];
    expect(derive(timeline, "right")).toEqual({ provider: claude, model: "opus" });
  });

  it("carries options from the nearest ancestor across a fork with mixed history", () => {
    const triple = {
      provider: codex,
      model: "gpt-5.4",
      options: [{ id: "effort", value: "high" }],
    } as const;
    const timeline = [
      message("root", { ranUnder: { provider: claude, model: "opus" } }),
      message("middle", { sequence: 2, parents: ["root"], ranUnder: triple }),
      message("left", { sequence: 3, parents: ["middle"] }),
      message("right", { sequence: 4, parents: ["middle"] }),
    ];

    expect(derive(timeline, "right")).toEqual(triple);
  });

  it("walks past interleaved spec and plan revisions", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      message("root", { ranUnder: { provider: codex, model: "gpt-5.4" } }),
      specRevision("spec", {
        sequence: 2,
        parents: ["root"],
        createdAt: "2026-08-17T00:01:00.000Z",
      }),
      planRevision("plan", {
        sequence: 3,
        parents: ["spec"],
        createdAt: "2026-08-17T00:02:00.000Z",
      }),
    ];

    expect(derive(timeline, "plan")).toEqual({ provider: codex, model: "gpt-5.4" });
  });

  it("returns none when history has no record", () => {
    expect(derive([message("root")], "root")).toBeNull();
  });
});
