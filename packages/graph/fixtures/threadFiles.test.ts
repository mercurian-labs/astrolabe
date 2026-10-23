import { describe, expect, it } from "vite-plus/test";

import type { ThreadRecord } from "../src/model/thread.ts";
import { filesAt, turnEnd, turnStart, writtenNotes } from "./threadFiles.ts";

const THREAD: ThreadRecord = {
  id: "t",
  title: "t",
  memoryId: "m",
  turns: [
    {
      id: "a",
      label: "amend and link",
      events: [
        { kind: "read", note: "Graph" },
        { kind: "amend", note: "Graph" },
        { kind: "link", from: "Graph", to: "Lab" },
      ],
    },
    {
      id: "b",
      label: "write, then unlink elsewhere",
      events: [
        { kind: "write", note: "Review" },
        { kind: "link", from: "Review", to: "Merges" },
        { kind: "link", from: "Graph", to: "Budget" },
        { kind: "unlink", from: "Old", to: "Publishing" },
      ],
    },
  ],
};

const PROSE = {
  "a:1": "Amended.",
  "a:2": "See [[Lab]].",
  "b:0": "Reviews.",
  "b:1": "They gate [[Merges]].",
  "b:2": "Budget: [[Budget]].",
};

const SEEDS = new Map([
  ["Graph", "# Graph\n\nFirst paragraph.\n\n## Later\n\nMore.\n"],
  ["Old", "# Old\n\nSee [[Publishing|publishing]] and [[Publishing#Rules]].\n"],
]);

describe("threadFiles", () => {
  it("counts every event, reads included, toward a position", () => {
    expect(turnStart(THREAD, 1)).toBe(3);
    expect(turnEnd(THREAD, 1)).toBe(7);
    expect(writtenNotes(THREAD)).toEqual(["Graph", "Review", "Old"]);
  });

  it("puts an amendment after the first paragraph and a same-turn link inside it", () => {
    expect(filesAt(THREAD, SEEDS, 3, PROSE).texts.get("Graph")).toBe(
      "# Graph\n\nFirst paragraph.\n\nAmended. See [[Lab]].\n\n## Later\n\nMore.\n",
    );
  });

  it("writes a new note, and a link in a later turn starts its own paragraph", () => {
    const files = filesAt(THREAD, SEEDS, 7, PROSE).texts;
    expect(files.get("Review")).toBe("# Review\n\nReviews. They gate [[Merges]].\n");
    expect(files.get("Graph")).toBe(
      "# Graph\n\nFirst paragraph.\n\nBudget: [[Budget]].\n\nAmended. See [[Lab]].\n\n## Later\n\nMore.\n",
    );
    expect(files.get("Old")).toBe("# Old\n\nSee publishing and Publishing.\n");
  });

  it("leaves the seeds as they were", () => {
    filesAt(THREAD, SEEDS, 7, PROSE);
    expect(SEEDS.get("Graph")).toBe("# Graph\n\nFirst paragraph.\n\n## Later\n\nMore.\n");
  });
});
