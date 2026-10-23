import { describe, expect, it } from "vite-plus/test";

import graphModelStory from "../../code-graph/fixtures/graph-model.story.json";
import type { Memory, ThreadRecord } from "../src/index.ts";
import { mountCodeView, playTarget } from "./codeEdits.tsx";

const story = graphModelStory as unknown as { memory: Memory; thread: ThreadRecord };

describe("the code view", () => {
  it("highlights the amended range as the agent's edit", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const before = "export function viewAt() {\n  return 1;\n}\n";
    const after = "export function viewAt() {\n  return 2;\n}\n";
    const code = mountCodeView(host, {
      before,
      after,
      path: "src/view.ts",
      range: { startLine: 1, endLine: 3 },
      turn: "t",
      theme: "light",
    });
    // The write lands a microtask after the view attaches.
    await Promise.resolve();
    expect(code.view.state.doc.toString()).toBe(after);
    const highlighted = [...host.querySelectorAll(".atlas-agent-change")].map(
      (element) => element.textContent,
    );
    expect(highlighted).toEqual(["2"]);
    code.destroy();
    host.remove();
  });
});

describe("the play a code view shows", () => {
  it("is the write of viewAt when graph-model's fourth checkpoint picks it", () => {
    const turn = story.thread.turns[3];
    const index = turn?.events.findIndex(
      (event) => event.kind === "write" && event.name === "viewAt",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(playTarget(story, 3, index ?? -1)).toEqual({
      story: "graph-model",
      ref: turn?.id,
      note: "apps/mercurian/graph/src/model/attention.test.ts#function:viewAt",
      name: "viewAt",
      path: "apps/mercurian/graph/src/model/attention.test.ts",
      range: { startLine: 69, endLine: 79 },
    });
  });

  it("is the turn's first write or amend of something with lines when no play is picked", () => {
    const target = playTarget(story, 3, null);
    expect(target?.ref).toBe(story.thread.turns[3]?.id);
    expect(target?.range).not.toBeNull();
  });

  it("is nothing for a link", () => {
    const turn = story.thread.turns[3];
    const link = turn?.events.findIndex((event) => event.kind === "link") ?? -1;
    expect(playTarget(story, 3, link)).toBeNull();
  });
});
