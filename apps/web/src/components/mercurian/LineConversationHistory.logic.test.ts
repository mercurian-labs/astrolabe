import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { readLineConversationHistory } from "./LineConversationHistory.logic";

function message(id: string, parents: string[], sequence: number): PlanTimelineItem {
  return {
    _tag: "message",
    commitId: MercurianCommitId.make(id),
    parents: parents.map((parent) => MercurianCommitId.make(parent)),
    sequence,
    authorKind: sequence % 2 === 0 ? "assistant" : "human",
    text: id,
    published: false,
    createdAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("readLineConversationHistory", () => {
  const graph = buildPlanGraph([
    message("requirement", [], 1),
    message("acknowledgment", ["requirement"], 2),
    message("original-followup", ["acknowledgment"], 3),
    message("fork-message", ["acknowledgment"], 4),
    message("fork-followup", ["fork-message"], 5),
  ]);

  it("ends at the fork point and excludes later turns on either branch", () => {
    const page = readLineConversationHistory(graph, "acknowledgment");
    expect(page.messages.map(({ text, role }) => ({ text, role }))).toEqual([
      { text: "requirement", role: "user" },
      { text: "acknowledgment", role: "assistant" },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("pages a nested fork across lines without overlaps", () => {
    const first = readLineConversationHistory(graph, "fork-followup", 2);
    expect(first.messages.map((m) => m.text)).toEqual(["fork-message", "fork-followup"]);
    expect(first.nextCursor).toBe("acknowledgment");
    const second = readLineConversationHistory(graph, first.nextCursor!, 2);
    expect(second.messages.map((m) => m.text)).toEqual(["requirement", "acknowledgment"]);
    expect(second.nextCursor).toBeNull();
  });

  it("bounds traversal even through historical artifact revisions", () => {
    const revisions = Array.from({ length: 100 }, (_, index): PlanTimelineItem => ({
      _tag: "plan-revision",
      commitId: MercurianCommitId.make(`revision-${index}`),
      parents: [MercurianCommitId.make(index === 0 ? "requirement" : `revision-${index - 1}`)],
      sequence: index + 2,
      authorKind: "assistant",
      published: false,
      createdAt: "2026-09-05T00:00:00.000Z",
    }));
    const history = buildPlanGraph([message("requirement", [], 1), ...revisions]);
    const page = readLineConversationHistory(history, "revision-99", 10);
    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBe("revision-89");
  });

  it("keeps attachments and presents stored messages as settled", () => {
    const attachments = [
      {
        type: "image" as const,
        id: "image-1",
        name: "example.png",
        mimeType: "image/png",
        sizeBytes: 123,
      },
    ];
    const item: PlanTimelineItem = {
      ...message("image", [], 1),
      _tag: "message",
      text: "image",
      attachments,
    };
    const page = readLineConversationHistory(buildPlanGraph([item]), "image");
    expect(page.messages[0]).toMatchObject({
      id: "image",
      turnId: null,
      streaming: false,
      attachments,
    });
  });

  it("reports a missing parent instead of claiming the history is complete", () => {
    const history = buildPlanGraph([message("visible", ["missing"], 1)]);
    const page = readLineConversationHistory(history, "visible");
    expect(page.messages.map((m) => m.text)).toEqual(["visible"]);
    expect(page.missing).toBe(true);
  });
});
