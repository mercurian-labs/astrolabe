import type {
  EnvironmentId,
  MemoryReadingPosition,
  MercurianProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { useMemoryInvalidation, useReadMemoryDashboard } from "../../state/mercurianMemory";
import { advanceLineMemoryRefresh, type LineMemoryRefreshCursor } from "./lineMemoryRefresh";
import type { MemoryDashboardState } from "./MemoryTab.logic";

export interface LineMemoryDashboard {
  readonly state: MemoryDashboardState;
  readonly refresh: () => Promise<void>;
  /** Counts invalidation signals so prepared reviews can mark themselves stale. */
  readonly invalidationTick: number;
}

/**
 * The line's memory dashboard at the route-selected position. It lives above
 * the tab so the needs-review count is current while Memory is closed.
 *
 * Latest reads refresh on invalidation signals; a historical position is an
 * immutable object set and stays pinned. Responses are sequenced so a slow read
 * for an earlier key never overwrites the current one.
 */
export function useLineMemoryDashboard(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: MercurianProjectId | null;
  readonly threadId: ThreadId;
  readonly reading: MemoryReadingPosition;
}): LineMemoryDashboard {
  const { environmentId, projectId, threadId, reading } = input;
  const readDashboard = useReadMemoryDashboard(environmentId);
  const key = `${environmentId}\0${projectId ?? ""}\0${threadId}\0${JSON.stringify(reading)}`;
  const [result, setResult] = useState<{
    readonly key: string;
    readonly state: MemoryDashboardState;
  } | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (projectId === null) return;
    const requestId = ++sequence.current;
    const outcome = await readDashboard({ projectId, line: { threadId }, position: reading });
    if (requestId !== sequence.current) return;
    setResult({
      key,
      state: outcome.ok
        ? { kind: "ready", dashboard: outcome.value }
        : {
            kind: "error",
            message:
              outcome.error instanceof Error
                ? outcome.error.message
                : "Could not read this line's memory.",
          },
    });
  }, [key, projectId, readDashboard, reading, threadId]);

  const invalidation = useMemoryInvalidation(
    environmentId,
    projectId === null ? undefined : { projectId, line: { threadId } },
  );
  const emission = invalidation._tag === "Success" ? invalidation.value : undefined;
  const subscriptionKey = `${environmentId}\0${projectId ?? ""}\0${threadId}`;
  const [invalidationTick, setInvalidationTick] = useState(0);
  const cursor = useRef<LineMemoryRefreshCursor | undefined>(undefined);
  const readLatest = useEffectEvent(() => {
    void refresh();
  });
  useEffect(() => {
    const next = advanceLineMemoryRefresh(cursor.current, {
      key,
      subscriptionKey,
      emission,
      latest: reading.kind === "latest",
    });
    cursor.current = next.cursor;
    if (next.invalidate) setInvalidationTick((tick) => tick + 1);
    if (next.read) readLatest();
  }, [key, subscriptionKey, emission, reading.kind]);

  return {
    state:
      result?.key === key
        ? result.state
        : invalidation._tag === "Failure"
          ? { kind: "error", message: "Could not subscribe to this line's memory." }
          : { kind: "loading" },
    refresh,
    invalidationTick,
  };
}
