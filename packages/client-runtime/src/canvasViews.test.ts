import { describe, expect, it } from "vite-plus/test";

import { canvasViewFromItem } from "./canvasViews.ts";

const input = { title: "Flow", cards: [{ id: "a", text: "A" }] };
const item = (overrides: Record<string, unknown>) => ({
  type: "dynamic_tool",
  toolName: "mcp__t3-code__astrolabe_canvas_show",
  status: "completed",
  input,
  output: { structuredContent: { message: "Shown" } },
  ...overrides,
});

describe("canvasViewFromItem", () => {
  it("lays out a finished call that recorded no board, from any provider's shape of its input", () => {
    for (const shape of [
      input,
      JSON.stringify(input),
      { toolName: "astrolabe_canvas_show", args: input },
    ]) {
      const view = canvasViewFromItem(item({ input: shape }));
      expect(view?.title).toBe("Flow");
      expect(view?.data.nodes.map((node) => node.id)).toEqual(["a"]);
    }
  });

  it("draws a recorded board where it was laid out, and nothing for the call that recorded it", () => {
    const board = canvasViewFromItem({
      type: "canvas",
      title: "Flow",
      document: {
        nodes: [{ id: "a", type: "text", text: "A", x: 40, y: 80, width: 180, height: 60 }],
        edges: [],
        astrolabe: { stories: [{ title: "Tour", steps: [{ note: "Here", cards: ["a"] }] }] },
      },
    });
    expect(board?.data.nodes).toMatchObject([{ id: "a", x: 40, y: 80 }]);
    expect(board?.data.stories?.[0]?.title).toBe("Tour");
    expect(
      canvasViewFromItem(
        item({
          output: { structuredContent: { message: "Shown", canvasItemId: "turn-item:canvas:1" } },
        }),
      ),
    ).toBeNull();
  });

  it("leaves a call still running, a failed one, another tool or a bad input to its own row", () => {
    for (const overrides of [
      { status: "running" },
      { output: { isError: true, content: [{ type: "text", text: "No" }] } },
      { toolName: "mcp__t3-code__html_render" },
      { input: { title: "No cards" } },
    ]) {
      expect(canvasViewFromItem(item(overrides))).toBeUndefined();
    }
  });
});
