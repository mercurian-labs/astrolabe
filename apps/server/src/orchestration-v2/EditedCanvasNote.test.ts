import { assert, it } from "@effect/vitest";
import { TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { editedCanvasNote } from "./EditedCanvasNote.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const board = (id: string, editedAt?: string) =>
  ({
    id: TurnItemId.make(id),
    type: "canvas",
    title: `Board ${id}`,
    document: {
      nodes: [{ id: "a", type: "text", text: "Moved here", x: 0, y: 0, width: 100, height: 60 }],
      edges: [],
    },
    ...(editedAt === undefined ? {} : { editedAt: at(editedAt) }),
  }) as OrchestrationV2TurnItem;

it("tells the agent only the boards the user changed since its last prompt, as they stand", () => {
  const since = at("2026-11-12T10:00:00Z");
  const note = editedCanvasNote(
    [
      board("drawn"),
      board("before", "2026-11-12T09:00:00Z"),
      board("after", "2026-11-12T11:00:00Z"),
    ],
    since,
  );
  assert.include(note ?? "", '<board title="Board after" itemId="after">');
  assert.include(note ?? "", "[a] Moved here");
  assert.notInclude(note ?? "", "Board before");
  assert.notInclude(note ?? "", "Board drawn");
  assert.isNull(editedCanvasNote([board("drawn"), board("before", "2026-11-12T09:00:00Z")], since));
  const edited = [board("kept", "2026-11-12T11:00:00Z"), board("left", "2026-11-12T11:30:00Z")];
  const omitting = editedCanvasNote(edited, since, ["left"]) ?? "";
  assert.include(omitting, "Board kept");
  assert.notInclude(omitting, "Board left");
  assert.include(editedCanvasNote(edited, since, undefined) ?? "", "Board left");
  assert.isNull(editedCanvasNote(edited, since, ["kept", "left"]));
});
