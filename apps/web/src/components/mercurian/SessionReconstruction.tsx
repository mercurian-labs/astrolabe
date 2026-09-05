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
  const [record, setRecord] = useState<PlanReconstruction | null | undefined>(() =>
    cache.get(cacheKey),
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const cached = cache.get(cacheKey);
    setRecord(cached);
    if (cached !== undefined || planId === null) return;
    void get({ planId, reconstructionId }).then((result) => {
      if (!active) return;
      const value = result.ok ? result.value.reconstruction : null;
      if (value !== null) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, value);
      }
      setRecord(value);
    });
    return () => {
      active = false;
    };
  }, [get, cacheKey, planId, reconstructionId, attempt]);
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
