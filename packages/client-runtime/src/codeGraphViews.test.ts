import { type OrchestrationV2TurnItem, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { clampStep, codeGraphViews } from "./codeGraphViews.ts";

const at = DateTime.makeUnsafe("2026-11-01T00:00:00Z");

const call = (
  id: string,
  ordinal: number,
  toolName: string,
  input: unknown,
  extra: Partial<Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>> = {},
): OrchestrationV2TurnItem => ({
  type: "dynamic_tool",
  id: TurnItemId.make(id),
  threadId: ThreadId.make("thread"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed",
  title: null,
  startedAt: at,
  completedAt: at,
  updatedAt: at,
  toolName,
  input,
  output: { steps: 1, unknown: [] },
  ...extra,
});

const STORY = {
  title: "How a turn starts",
  steps: [
    { caption: "The request lands here.", focus: ["src/ws.ts#handle"] },
    {
      caption: "It reaches the orchestrator.",
      focus: ["src/ws.ts#handle", "src/orchestrator.ts"],
      links: [{ from: "src/ws.ts#handle", to: "src/orchestrator.ts" }],
      level: "symbol",
      expandNeighbours: ["src/orchestrator.ts"],
    },
  ],
};

describe("code graph views", () => {
  it("read each provider's finished calls, oldest first, over all their steps' nodes", () => {
    const views = codeGraphViews([
      call("b", 2, "mcp__t3-code__astrolabe_code_graph_show", STORY),
      // Codex hands JSON text; Cursor wraps the arguments.
      call("a", 1, "astrolabe_code_graph_show", JSON.stringify({ steps: [STORY.steps[0]] })),
      call("c", 3, "astrolabe_code_graph_show", {
        toolName: "astrolabe_code_graph_show",
        args: { steps: [{ caption: "Only this.", focus: ["lib"] }] },
      }),
    ]);
    expect(views.map((view) => view.id)).toEqual(["a", "b", "c"]);
    const story = views[1];
    expect(story).toMatchObject({
      title: "How a turn starts",
      roots: ["src/ws.ts#handle", "src/orchestrator.ts"],
    });
    expect(story?.steps[0]).toEqual({
      caption: "The request lands here.",
      focus: ["src/ws.ts#handle"],
      links: [],
      level: "file",
      depth: 0,
      expandNeighbours: [],
      showContents: [],
    });
    expect(story?.steps[1]).toMatchObject({
      level: "symbol",
      expandNeighbours: ["src/orchestrator.ts"],
    });
    expect(views[2]?.roots).toEqual(["lib"]);
  });

  it("skip running, failed, malformed and other tools' calls", () => {
    expect(
      codeGraphViews([
        call("running", 1, "astrolabe_code_graph_show", STORY, { status: "running" }),
        call("failed", 2, "astrolabe_code_graph_show", STORY, {
          output: { isError: true, content: [{ type: "text", text: "nope" }] },
        }),
        call("empty", 3, "astrolabe_code_graph_show", { steps: [] }),
        call("nofocus", 4, "astrolabe_code_graph_show", { steps: [{ caption: "x", focus: [] }] }),
        call("other", 5, "astrolabe_code_map", STORY),
      ]),
    ).toEqual([]);
  });

  it("keep a step inside its view", () => {
    const [view] = codeGraphViews([call("b", 1, "astrolabe_code_graph_show", STORY)]);
    if (view === undefined) throw new Error("no view");
    expect([clampStep(view, -1), clampStep(view, 1), clampStep(view, 9)]).toEqual([0, 1, 1]);
  });
});
