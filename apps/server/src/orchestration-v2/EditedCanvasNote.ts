import { canvasData, canvasOutline } from "@mercurian/wiki";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** A board is told in full; past this the rest is cut, so one large board can't crowd a turn. */
const MAX_NOTE_CHARS = 16_000;

/**
 * Astrolabe: what the agent hears of the boards the user changed since `since`, as they now stand,
 * with the ids its tools name them by. Null when none changed.
 */
export function editedCanvasNote(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  since: DateTime.Utc,
): string | null {
  const edited = items.flatMap((item) =>
    item.type === "canvas" &&
    item.editedAt !== undefined &&
    DateTime.isGreaterThan(item.editedAt, since)
      ? [item]
      : [],
  );
  if (edited.length === 0) return null;
  const boards = edited.map((item) =>
    [
      `<board title="${item.title ?? "Canvas"}" itemId="${item.id}">`,
      canvasOutline(item.title ?? "Canvas", canvasData(item.document)),
      "</board>",
    ].join("\n"),
  );
  const note = [
    "Since your last turn the user edited boards you drew in this thread. Each is as they left it: build on that version, and don't redraw what they changed.",
    ...boards,
  ].join("\n\n");
  // Cut at a line, so no card or emoji is left half told.
  return note.length > MAX_NOTE_CHARS
    ? `${note.slice(0, note.lastIndexOf("\n", MAX_NOTE_CHARS))}\n…`
    : note;
}
