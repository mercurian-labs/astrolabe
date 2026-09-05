import type { ChatMessage } from "../../types";
import type { TimelineEntry } from "../../session-logic";

/** The checkpoint path controls membership; live rows supply the original rich message data. */
export function mergeConversationPath(
  path: ReadonlyArray<ChatMessage>,
  live: ReadonlyArray<TimelineEntry>,
  historical: boolean,
): TimelineEntry[] {
  const ids = new Set(path.map((message) => message.id));
  const originals = new Map(
    live.flatMap((entry) => (entry.kind === "message" ? [[entry.message.id, entry] as const] : [])),
  );
  const first = path[0]?.createdAt;
  const last = path.at(-1)?.createdAt;
  const messages: TimelineEntry[] = path.map(
    (message) =>
      originals.get(message.id) ?? {
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      },
  );
  const supplementary = live.filter((entry) => {
    if (entry.kind === "message") {
      return (
        !historical && !ids.has(entry.message.id) && (last === undefined || entry.createdAt > last)
      );
    }
    return (
      first !== undefined &&
      entry.createdAt >= first &&
      (!historical || (last !== undefined && entry.createdAt <= last))
    );
  });
  return [...messages, ...supplementary].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}
