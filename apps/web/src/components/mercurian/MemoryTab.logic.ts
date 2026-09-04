import type {
  MercurianLineMemoryChanges,
  MercurianMergeMemoryHomeResult,
} from "@t3tools/contracts";

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

/** Review committed changes oldest-first, then the line snapshot's unmarked tail. */
export function memoryMergeHomeWalk(
  changes: MercurianLineMemoryChanges,
): ReadonlyArray<MemoryTabRow> {
  return memoryTabRows(changes)
    .filter((row) => !row.reviewed)
    .toSorted((left, right) => {
      if (left.kind === "unmarked") return 1;
      if (right.kind === "unmarked") return -1;
      return (left.authoredAt ?? "").localeCompare(right.authoredAt ?? "");
    });
}

export function memoryMergeHomeOutcomeCopy(result: MercurianMergeMemoryHomeResult): string {
  switch (result.kind) {
    case "merged":
      return `Memory merged home at ${result.commitOid.slice(0, 8)}.`;
    case "deferred-to-push":
      return "Memory reviewed; it ships with the pull request.";
    case "conflict":
      return `Memory conflicts with main in ${result.conflicts.map(({ path }) => path).join(", ")}.`;
  }
}

export function memoryMergeHomeRefusalCopy(cause: unknown): string {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause) || !("reason" in cause)) {
    return cause instanceof Error ? cause.message : "Could not merge memory home.";
  }
  if (cause._tag === "MemoryReviewBlockedError" && cause.reason === "turn-active") {
    return "Wait for the active turn to finish before merging memory home.";
  }
  if (cause._tag === "MergeMemoryHomeBlockedError" && cause.reason === "git-too-old") {
    return "Update to Git 2.38 or newer to merge this standalone memory home.";
  }
  if (cause._tag === "MergeMemoryHomeBlockedError" && cause.reason === "checkout-dirty") {
    return "Commit or stash the memory checkout's changes before merging home.";
  }
  if (cause._tag === "MergeMemoryHomeBlockedError" && cause.reason === "main-missing") {
    return "Create the local memory home branch before merging home.";
  }
  return cause instanceof Error ? cause.message : "Could not merge memory home.";
}

export const memoryMergeHomeReconciliationMessage = (paths: ReadonlyArray<string>) =>
  `Reconcile the memory changes on ${paths.join(", ")} against current main and land the reconciliation as an amendment`;

export const memoryTabRevertTarget = (
  row: MemoryTabRow,
): { readonly kind: "commit"; readonly commitOid: string } | { readonly kind: "unmarked" } =>
  row.kind === "unmarked" ? { kind: "unmarked" } : { kind: "commit", commitOid: row.id };
