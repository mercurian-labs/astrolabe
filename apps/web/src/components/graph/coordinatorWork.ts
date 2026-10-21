import type { ThreadId, WikiChangeRequest } from "@t3tools/contracts";

/** What the work list needs of a thread shell. */
export interface WorkThread {
  readonly id: ThreadId;
  readonly title: string;
  readonly lineage: {
    readonly parentThreadId: ThreadId | null;
    readonly relationshipToParent: "fork" | "subagent" | null;
  };
}

export interface CoordinatorWork<T extends WorkThread> {
  /** The threads this one handed work to, in shell order. A fork is not handed work. */
  readonly children: ReadonlyArray<T>;
  /** Wiki change requests opened by this thread or its children: open first, then newest. */
  readonly changeRequests: ReadonlyArray<{
    readonly changeRequest: WikiChangeRequest;
    /** The thread that opened it: this one or a child. */
    readonly thread: T | null;
  }>;
}

const STATUS_ORDER = { open: 0, merged: 1, closed: 2 } as const;

/**
 * A coordinator's work: its child threads and the wiki change requests they (and it) opened.
 * `self` is the coordinator's own shell when known, so its own change requests name it.
 */
export function coordinatorWork<T extends WorkThread>(input: {
  readonly threadId: ThreadId;
  readonly self: T | null;
  readonly threads: ReadonlyArray<T>;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest>;
}): CoordinatorWork<T> {
  const children = input.threads.filter(
    (thread) =>
      thread.lineage.parentThreadId === input.threadId &&
      thread.lineage.relationshipToParent !== "fork",
  );
  const owners = new Map<ThreadId, T | null>([[input.threadId, input.self]]);
  for (const child of children) owners.set(child.id, child);
  const changeRequests = input.changeRequests
    .filter(
      (changeRequest) => changeRequest.threadId !== null && owners.has(changeRequest.threadId),
    )
    .toSorted(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .map((changeRequest) => ({
      changeRequest,
      thread: owners.get(changeRequest.threadId!) ?? null,
    }));
  return { children, changeRequests };
}

/** The thread's own open change request on a wiki: where a note it wrote is read. */
export function threadChangeRequestOn(
  changeRequests: ReadonlyArray<WikiChangeRequest>,
  threadId: ThreadId,
  wikiId: string,
): WikiChangeRequest | null {
  return (
    changeRequests.find(
      (changeRequest) =>
        changeRequest.threadId === threadId &&
        changeRequest.wikiId === wikiId &&
        changeRequest.status === "open",
    ) ?? null
  );
}
