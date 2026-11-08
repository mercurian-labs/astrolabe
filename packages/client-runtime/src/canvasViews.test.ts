import { describe, expect, it } from "vite-plus/test";

import { canvasViewFromToolItem } from "./canvasViews.ts";

const input = { title: "Flow", cards: [{ id: "a", text: "A" }] };
const item = (overrides: Record<string, unknown>) => ({
  toolName: "mcp__t3-code__astrolabe_canvas_show",
  status: "completed",
  input,
  output: { structuredContent: { message: "Shown" } },
  ...overrides,
});

describe("canvasViewFromToolItem", () => {
  it("lays out a finished call, from any provider's shape of its input", () => {
    for (const shape of [
      input,
      JSON.stringify(input),
      { toolName: "astrolabe_canvas_show", args: input },
    ]) {
      const view = canvasViewFromToolItem(item({ input: shape }));
      expect(view?.title).toBe("Flow");
      expect(view?.data.nodes.map((node) => node.id)).toEqual(["a"]);
    }
  });

  it("draws nothing for a call still running, a failed one, another tool or a bad input", () => {
    for (const overrides of [
      { status: "running" },
      { output: { isError: true, content: [{ type: "text", text: "No" }] } },
      { toolName: "mcp__t3-code__html_render" },
      { input: { title: "No cards" } },
    ]) {
      expect(canvasViewFromToolItem(item(overrides))).toBeUndefined();
    }
  });
});
