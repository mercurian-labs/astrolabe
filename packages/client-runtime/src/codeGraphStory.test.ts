import { describe, expect, it } from "vite-plus/test";

import { codeGraphShowInput, codeGraphStoryLabel, codeGraphStoryLines } from "./codeGraphStory.ts";

const STEPS = [
  { caption: "The request lands here.", focus: ["src/ws.ts#handle"] },
  { caption: "It reaches the orchestrator.", focus: ["src/orchestrator.ts"] },
  { caption: "The adapter starts the turn.", focus: ["src/adapter.ts"] },
];

describe("code graph stories", () => {
  it("name a titled story and count its steps, numbering the captions", () => {
    const story = codeGraphShowInput({ title: "How a turn starts", steps: STEPS })!;
    expect(codeGraphStoryLabel(story)).toBe("“How a turn starts” · 3 steps");
    expect(codeGraphStoryLines(story)).toEqual([
      "1. The request lands here.",
      "2. It reaches the orchestrator.",
      "3. The adapter starts the turn.",
    ]);
  });

  it("call an untitled one a picture of the code, and a single step plain", () => {
    expect(codeGraphStoryLabel(codeGraphShowInput({ steps: STEPS.slice(0, 2) })!)).toBe(
      "a picture of the code · 2 steps",
    );
    const single = codeGraphShowInput({ steps: [STEPS[0]] })!;
    expect(codeGraphStoryLabel(single)).toBe("a picture of the code");
    expect(codeGraphStoryLines(single)).toEqual(["The request lands here."]);
  });

  it("read JSON text and Cursor's envelope, and nothing that is not a story", () => {
    const story = { title: "Wiring", steps: STEPS.slice(0, 1) };
    expect(codeGraphShowInput(JSON.stringify(story))?.title).toBe("Wiring");
    expect(codeGraphShowInput({ toolName: "astrolabe_code_graph_show", args: story })?.title).toBe(
      "Wiring",
    );
    expect(codeGraphShowInput({ steps: [] })).toBeNull();
    expect(codeGraphShowInput("not json")).toBeNull();
  });
});
