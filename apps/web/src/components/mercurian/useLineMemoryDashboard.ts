import type {
  EnvironmentId,
  MemoryReadingPosition,
  MercurianProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useMemoryInvalidation, useReadMemoryDashboard } from "../../state/mercurianMemory";
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invalidation = useMemoryInvalidation(environmentId);
  const [invalidationTick, setInvalidationTick] = useState(0);
  const sawSubscriptionEmission = useRef(false);
  useEffect(() => {
    if (invalidation._tag !== "Success") return;
    // The subscription's own first emission is covered by the initial read.
    if (!sawSubscriptionEmission.current) {
      sawSubscriptionEmission.current = true;
      return;
    }
    setInvalidationTick((tick) => tick + 1);
    if (reading.kind === "latest") void refresh();
  }, [invalidation, reading.kind, refresh]);

  return {
    state: result?.key === key ? result.state : { kind: "loading" },
    refresh,
    invalidationTick,
  };
}
