import type { PlanGraphNode } from "@t3tools/client-runtime/state/plan-graph";

export type PlanMapGlyph =
  | "messages-square"
  | "message-square"
  | "file-text"
  | "circle-dot"
  | "square-terminal";

export const PLAN_MAP_GLYPH_PATHS: Readonly<Record<PlanMapGlyph, ReadonlyArray<string>>> = {
  "messages-square": [
    "M7 8h10M7 12h6",
    "M5 17l-2 2v-5a7 7 0 0 1 7-7h5a7 7 0 0 1 7 7v1a7 7 0 0 1-7 7h-5a7 7 0 0 1-5-2z",
  ],
  "message-square": ["M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"],
  "file-text": [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
    "M14 2v6h6M8 13h8M8 17h8",
  ],
  "circle-dot": ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 12h.01"],
  "square-terminal": [
    "M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2",
    "m7 8 3 3-3 3M13 14h4",
  ],
};

export function planMapGlyphFor(node: PlanGraphNode): PlanMapGlyph {
  if (node.checkpoint !== undefined) return "messages-square";
  if (node.item._tag === "coding-session") return "square-terminal";
  if (node.item._tag === "plan-revision") return "file-text";
  if (node.item._tag === "spec-revision") return "circle-dot";
  return "message-square";
}

export const mirrorPlanMapGlyph = (node: PlanGraphNode) =>
  node.checkpoint === undefined && node.item._tag === "message" && node.item.authorKind === "human";
