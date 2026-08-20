import type { MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { useGetPlanTextAt, usePlanDetail } from "../../state/mercurian";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { PlanArtifactBody } from "./PlanArtifact";
import { buildPlanGraph } from "./PlanGraph.logic";
import { sessionPlanReading } from "./SessionPlanPanel.logic";

interface HistoricalPlanText {
  readonly commitId: MercurianCommitId;
  readonly planText: string | null;
}

export function SessionPlanPanel(props: {
  readonly planId: PlanId;
  readonly sessionLeafCommitId: MercurianCommitId;
}) {
  const { detail, isPending, error } = usePlanDetail(props.planId);
  const getPlanTextAt = useGetPlanTextAt();
  const graph = useMemo(() => buildPlanGraph(detail?.timeline ?? []), [detail?.timeline]);
  const reading = useMemo(
    () => sessionPlanReading(graph, props.sessionLeafCommitId),
    [graph, props.sessionLeafCommitId],
  );
  const [historicalPlanText, setHistoricalPlanText] = useState<HistoricalPlanText | null>(null);

  useEffect(() => {
    if (reading === null) return;
    let cancelled = false;
    void getPlanTextAt(props.planId, reading.planRevisionCommitId).then((result) => {
      if (cancelled) return;
      setHistoricalPlanText({
        commitId: reading.planRevisionCommitId,
        planText: result?.planText ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [getPlanTextAt, props.planId, reading]);

  if (isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  if (detail === null || reading === null) {
    return (
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-base text-foreground">Plan unavailable</EmptyTitle>
          <EmptyDescription>
            {error ?? "This session is no longer attached to a plan revision."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const planText =
    historicalPlanText?.commitId === reading.planRevisionCommitId
      ? historicalPlanText.planText
      : undefined;
  const title = reading.movedPastRepositoryName
    ? `Plan for ${reading.movedPastRepositoryName}`
    : detail.plan.title;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2 sm:px-4">
        <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>
        {reading.movedPast ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Planning has moved past this plan
            {reading.movedPastRepositoryName ? ` for ${reading.movedPastRepositoryName}` : ""}.
          </p>
        ) : null}
      </div>
      {planText === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : planText === null || planText.trim().length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyDescription>No plan revision preceded this session.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <PlanArtifactBody planText={planText} />
      )}
    </section>
  );
}
