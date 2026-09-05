import { reconstructionBoundaryLabel } from "./SessionReconstruction.logic";
import type { PlanReconstruction } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { useGetReconstruction } from "../../state/mercurian";
import { planCommitSummary, type PlanGraph } from "./PlanGraph.logic";
import { useThreadSpace } from "./ThreadSpaceContext";

const cache = new Map<string, PlanReconstruction>();

export function SessionReconstruction({
  reconstructionId,
  graph,
}: {
  readonly reconstructionId: string;
  readonly graph: PlanGraph;
}) {
  const { planId, environmentId } = useThreadSpace();
  const get = useGetReconstruction();
  const cacheKey = JSON.stringify([environmentId, planId, reconstructionId]);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${cacheKey}:${attempt}`;
  const [result, setResult] = useState<{ key: string; value: PlanReconstruction | null }>();
  const record = result?.key === requestKey ? result.value : cache.get(cacheKey);
  useEffect(() => {
    let active = true;
    if (cache.has(cacheKey) || planId === null) return;
    void get({ planId, reconstructionId })
      .then((response) => {
        if (!active) return;
        const value = response.ok ? response.value.reconstruction : null;
        if (value !== null) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value!);
          cache.set(cacheKey, value);
        }
        setResult({ key: requestKey, value });
      })
      .catch(() => {
        if (active) setResult({ key: requestKey, value: null });
      });
    return () => {
      active = false;
    };
  }, [get, requestKey, cacheKey, planId, reconstructionId]);
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="font-medium">Session reconstruction</p>
      {record === undefined ? (
        <p>Loading reconstruction…</p>
      ) : record === null ? (
        <p>
          Reconstruction unavailable.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      ) : (
        <ReconstructionDetails record={record} graph={graph} />
      )}
    </section>
  );
}

export function ReconstructionDetails({
  record,
  graph,
}: {
  readonly record: PlanReconstruction;
  readonly graph: PlanGraph;
}) {
  const start = graph.byId.get(record.sessionStartMessageCommitId);
  return (
    <>
      <p>{reconstructionBoundaryLabel(record, graph)}</p>
      <p className="text-muted-foreground">
        Session began at{" "}
        {start === undefined
          ? record.sessionStartMessageCommitId.slice(0, 8)
          : planCommitSummary(start.item)}
        .
      </p>
      {record.compacted === null ? null : (
        <details>
          <summary className="cursor-pointer">Summary used</summary>
          <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">
            {record.compacted.summary}
          </div>
        </details>
      )}
    </>
  );
}
