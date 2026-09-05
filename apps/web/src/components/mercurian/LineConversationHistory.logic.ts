import { MessageId } from "@t3tools/contracts";

import type { ConversationHistoryPage } from "../chat/ConversationHistory";
import type { PlanGraph } from "./PlanGraph.logic";

/** Read a bounded segment of the carrying parent path, never sibling continuations. */
export function readLineConversationHistory(
  graph: PlanGraph,
  cursor: string,
  limit = 40,
): ConversationHistoryPage {
  const messages: ConversationHistoryPage["messages"][number][] = [];
  const visited = new Set<string>();
  let next: string | null = cursor;
  let missing = false;
  while (next !== null && visited.size < limit) {
    if (visited.has(next)) {
      next = null;
      break;
    }
    visited.add(next);
    const node = graph.byId.get(next);
    if (node === undefined) {
      missing = true;
      next = null;
      break;
    }
    const item = node.item;
    if (item._tag === "message") {
      messages.push({
        id: MessageId.make(item.commitId),
        role: item.authorKind === "human" ? "user" : "assistant",
        text: item.text,
        ...(item.attachments === undefined ? {} : { attachments: item.attachments }),
        turnId: null,
        streaming: false,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
      });
    }
    next = item.parents[0] ?? null;
  }
  return { messages: messages.toReversed(), nextCursor: next, missing };
}
