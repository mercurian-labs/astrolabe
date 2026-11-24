import { ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  markdownWithCanvasLinks,
  splitMarkdownCanvasEmbeds,
  type ThreadCanvasEntry,
} from "./markdownCanvasLinks";

const canvas = (title: string, id = "item-1"): ThreadCanvasEntry => ({
  title,
  data: {
    nodes: [
      { id: "g1", type: "group", label: "Dispatch", x: 0, y: 0, width: 300, height: 180 },
      { id: "a", type: "text", text: "Card", x: 20, y: 40, width: 160, height: 80 },
    ],
    edges: [],
  },
  sourceThreadId: ThreadId.make("thread-1"),
  itemId: TurnItemId.make(id),
});

describe("splitMarkdownCanvasEmbeds", () => {
  it("splits standalone resolved canvas embeds while preserving surrounding prose and frames", () => {
    const canvases = [canvas("Command Flow")];
    const markdown = [
      "First stage:",
      "![[Command Flow.canvas#Dispatch]]",
      "Then whole board:",
      "![[Command Flow.canvas]]",
    ].join("\n");

    const segments = splitMarkdownCanvasEmbeds(markdown, canvases);
    expect(segments).toEqual([
      { kind: "markdown", markdown: "First stage:\n", sourceOffset: 0 },
      {
        kind: "canvas-embed",
        canvas: canvases[0],
        frame: "Dispatch",
        sourceOffset: 13,
      },
      { kind: "markdown", markdown: "Then whole board:\n", sourceOffset: 47 },
      {
        kind: "canvas-embed",
        canvas: canvases[0],
        frame: undefined,
        sourceOffset: 65,
      },
    ]);
  });

  it("ignores embeds inside fenced code blocks and unresolved wikilinks", () => {
    const canvases = [canvas("Command Flow")];
    const markdown = [
      "```md",
      "![[Command Flow.canvas]]",
      "```",
      "![[Not A Canvas.png]]",
      "See ![[Command Flow.canvas#Dispatch]] inline.",
    ].join("\n");

    expect(splitMarkdownCanvasEmbeds(markdown, canvases)).toEqual([
      { kind: "markdown", markdown, sourceOffset: 0 },
    ]);
  });
});

describe("markdownWithCanvasLinks", () => {
  it("rewrites resolved canvas wikilinks to t3-canvas links and leaves code and unresolved links untouched", () => {
    const canvases = [canvas("Command Flow")];
    const markdown = [
      "Open [[Command Flow.canvas#Dispatch]] or [[Command Flow.canvas|the flow]].",
      "Unresolved [[Auth]] and `[[Command Flow.canvas]]` stay literal.",
      "```",
      "[[Command Flow.canvas]]",
      "```",
    ].join("\n");

    expect(markdownWithCanvasLinks(markdown, canvases)).toBe(
      [
        "Open [Command Flow.canvas › Dispatch](<t3-canvas:link/Command%20Flow.canvas#Dispatch>) or [the flow](<t3-canvas:link/Command%20Flow.canvas>).",
        "Unresolved [[Auth]] and `[[Command Flow.canvas]]` stay literal.",
        "```",
        "[[Command Flow.canvas]]",
        "```",
      ].join("\n"),
    );
  });
});
