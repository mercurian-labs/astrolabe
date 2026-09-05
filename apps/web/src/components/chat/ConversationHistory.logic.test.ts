import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveTimelineEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { mergeConversationPath } from "./ConversationHistory.logic";

function message(id: string, time: number, role: "user" | "assistant" = "user"): ChatMessage {
  return {
    id: MessageId.make(id),
    text: id,
    role,
    createdAt: `2026-09-05T00:00:0${time}.000Z`,
    updatedAt: `2026-09-05T00:00:0${time}.000Z`,
    streaming: false,
    turnId: null,
  };
}
const entries = (messages: ChatMessage[]) => deriveTimelineEntries(messages, [], []);
describe("mergeConversationPath", () => {
  it("reads ancestry and current-line messages as one deduplicated conversation", () => {
    const ancestor = message("ancestor", 1);
    const own = message("own", 2);
    const richOwn = { ...own, text: "original provider message" };
    const result = mergeConversationPath([ancestor, own], entries([richOwn]), false);
    expect(result.map((entry) => entry.id)).toEqual(["ancestor", "own"]);
    expect(result[1]).toEqual(entries([richOwn])[0]);
  });
  it("selecting a checkpoint removes later turns, even with matching timestamps", () => {
    const first = message("first", 1);
    const response = message("response", 1, "assistant");
    const later = message("later", 2);
    expect(
      mergeConversationPath([first], entries([first, response, later]), true).map(
        (entry) => entry.id,
      ),
    ).toEqual(["first"]);
    expect(
      mergeConversationPath([first, response], entries([first, response, later]), true).map(
        (entry) => entry.id,
      ),
    ).toEqual(["first", "response"]);
  });
  it("returning to the tip restores the complete path and live continuation", () => {
    const first = message("first", 1);
    const second = message("second", 2);
    const streaming = { ...message("streaming", 3, "assistant"), streaming: true };
    const live = entries([first, second, streaming]);
    expect(mergeConversationPath([first], live, true)).toHaveLength(1);
    expect(mergeConversationPath([first, second], live, false).map((entry) => entry.id)).toEqual([
      "first",
      "second",
      "streaming",
    ]);
  });
  it("does not reinsert old messages outside the loaded page", () => {
    const old = message("old", 1);
    const recent = message("recent", 2);
    expect(
      mergeConversationPath([recent], entries([old, recent]), false).map((entry) => entry.id),
    ).toEqual(["recent"]);
  });
});
