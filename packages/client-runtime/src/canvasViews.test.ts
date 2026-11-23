import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  canvasViewFromItem,
  canvasViewNamed,
  editedBoardsSinceLastPrompt,
  editedFilesSinceLastPrompt,
} from "./canvasViews.ts";

const input = { title: "Flow", cards: [{ id: "a", text: "A" }] };
const item = (overrides: Record<string, unknown>) => ({
  type: "dynamic_tool",
  toolName: "mcp__t3-code__astrolabe_canvas_show",
  status: "completed",
  input,
  output: { structuredContent: { message: "Shown" } },
  ...overrides,
});

describe("canvasViewNamed", () => {
  const views = [
    { id: "1", title: "Checkout Flow" },
    { id: "2", title: "Auth: sign-in" },
    { id: "3", title: "checkout flow" },
  ];
  it.each([
    ["Checkout Flow.canvas", "3"],
    ["checkout flow", "3"],
    ["CHECKOUT FLOW.CANVAS", "3"],
    ["Auth sign-in.canvas", "2"],
    ["Auth: sign-in", "2"],
    ["Missing.canvas", undefined],
    ["", undefined],
  ])("finds %j as the board %s", (name, id) => {
    expect(canvasViewNamed(views, name)?.id).toBe(id);
  });
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
    // An older board's stories are left in its file and drawn as nothing.
    expect(board?.data).toEqual({ nodes: [expect.objectContaining({ id: "a", x: 40, y: 80 })], edges: [] });
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

describe("editedBoardsSinceLastPrompt", () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  const run = (
    userMessageId: string,
    startedAt: string | null,
    requestedAt = "2026-11-12T08:00:00Z",
  ) => ({
    userMessageId,
    requestedAt: at(requestedAt),
    startedAt: startedAt === null ? null : at(startedAt),
  });
  const board = (id: string, editedAt?: string) => ({
    id,
    type: "canvas",
    title: `Board ${id}`,
    ...(editedAt === undefined ? {} : { editedAt: at(editedAt) }),
  });
  const thread = {
    runs: [run("prompt", "2026-11-12T10:00:00Z"), run("slash", "2026-11-12T12:00:00Z")],
    messages: [
      { id: "prompt", text: "Draw the flow" },
      { id: "slash", text: " /compact" },
    ],
    turnItems: [
      board("drawn"),
      board("before", "2026-11-12T09:00:00Z"),
      board("after", "2026-11-12T11:00:00Z"),
    ],
  };

  it("finds the boards edited since the last prompt, which a slash command is not", () => {
    expect(editedBoardsSinceLastPrompt(thread, {})).toEqual([
      { id: "after", title: "Board after", editedAt: "2026-11-12T11:00:00.000Z", dismissed: false },
    ]);
    expect(editedBoardsSinceLastPrompt({ ...thread, runs: [] }, {})).toEqual([]);
  });

  it("counts a queued message as the last prompt, so its turn tells the agent", () => {
    const queued = {
      ...thread,
      runs: [...thread.runs, run("queued", null, "2026-11-12T11:30:00Z")],
    };
    expect(
      editedBoardsSinceLastPrompt(
        { ...queued, messages: [...queued.messages, { id: "queued", text: "Next" }] },
        {},
      ),
    ).toEqual([]);
  });

  it("keeps a board left out until it is edited again", () => {
    const dismissed = { after: "2026-11-12T11:00:00.000Z" };
    expect(editedBoardsSinceLastPrompt(thread, dismissed)[0]?.dismissed).toBe(true);
    const reedited = { ...thread, turnItems: [board("after", "2026-11-12T11:45:00Z")] };
    expect(editedBoardsSinceLastPrompt(reedited, dismissed)[0]?.dismissed).toBe(false);
  });

  it("finds the files edited since the last prompt the same way, each left out until edited again", () => {
    const file = (path: string, editedAt: string) => ({ path, editedAt: at(editedAt) });
    const edited = {
      ...thread,
      thread: {
        editedFiles: [
          file("src/after.ts", "2026-11-12T11:00:00Z"),
          file("src/before.ts", "2026-11-12T09:00:00Z"),
        ],
      },
    };
    expect(editedFilesSinceLastPrompt(edited, {})).toEqual([
      { path: "src/after.ts", editedAt: "2026-11-12T11:00:00.000Z", dismissed: false },
    ]);
    const dismissed = { "src/after.ts": "2026-11-12T11:00:00.000Z" };
    expect(editedFilesSinceLastPrompt(edited, dismissed)[0]?.dismissed).toBe(true);
    const reedited = {
      ...edited,
      thread: { editedFiles: [file("src/after.ts", "2026-11-12T11:45:00Z")] },
    };
    expect(editedFilesSinceLastPrompt(reedited, dismissed)[0]?.dismissed).toBe(false);
  });
});
