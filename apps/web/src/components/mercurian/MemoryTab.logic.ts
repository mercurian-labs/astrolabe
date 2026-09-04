import type { MercurianLineMemoryChanges } from "@t3tools/contracts";

export interface MemoryTabRow {
  readonly id: string;
  readonly kind: "marked" | "hand" | "unmarked";
  readonly title: string;
  readonly attribution: string;
  readonly turnId: string | null;
  readonly authoredAt: string | null;
  readonly diff: string;
  readonly reviewed: boolean;
}

export function memoryTabRows(changes: MercurianLineMemoryChanges): ReadonlyArray<MemoryTabRow> {
  return [
    ...changes.marked.map((entry) => ({
      id: entry.oid,
      kind: "marked" as const,
      title: entry.title,
      attribution: "Landed by the assistant",
      turnId: entry.turnId,
      authoredAt: entry.authoredAt,
      diff: entry.diff,
      reviewed: entry.reviewed,
    })),
    ...changes.hand.map((entry) => ({
      id: entry.oid,
      kind: "hand" as const,
      title: entry.title,
      attribution: "Committed by hand",
      turnId: null,
      authoredAt: entry.authoredAt,
      diff: entry.diff,
      reviewed: entry.reviewed,
    })),
    ...(changes.unmarked === null
      ? []
      : [
          {
            id: "unmarked",
            kind: "unmarked" as const,
            title: "Unmarked memory changes",
            attribution: "Held by the line snapshot",
            turnId: null,
            authoredAt: null,
            diff: changes.unmarked.diff,
            reviewed: false,
          },
        ]),
  ];
}

export const memoryTabUnreviewedCount = (changes: MercurianLineMemoryChanges) =>
  changes.unreviewedCount;

export const memoryTabRevertTarget = (
  row: MemoryTabRow,
): { readonly kind: "commit"; readonly commitOid: string } | { readonly kind: "unmarked" } =>
  row.kind === "unmarked" ? { kind: "unmarked" } : { kind: "commit", commitOid: row.id };
