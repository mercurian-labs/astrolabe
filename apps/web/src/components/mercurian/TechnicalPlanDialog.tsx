import type {
  PlanId,
  PlanTechnicalPlan,
  PlanTimelineItem,
  TechnicalPlanAt,
} from "@t3tools/contracts";
import { CircleAlertIcon, FileCode2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useGetTechnicalPlanAt } from "../../state/mercurian";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { PlanMarkdown } from "./PlanArtifact";
import { isStale } from "./technicalPlans.logic";

export function TechnicalPlanDialog({
  open,
  onOpenChange,
  planId,
  technicalPlan,
  path,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly planId: PlanId;
  readonly technicalPlan: PlanTechnicalPlan;
  readonly path: ReadonlyArray<PlanTimelineItem>;
}) {
  const getTechnicalPlanAt = useGetTechnicalPlanAt();
  const [content, setContent] = useState<TechnicalPlanAt | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContent(null);
    void getTechnicalPlanAt(planId, technicalPlan.commitId).then((result) => {
      if (!cancelled && result !== null) setContent(result);
    });
    return () => {
      cancelled = true;
    };
  }, [getTechnicalPlanAt, open, planId, technicalPlan.commitId]);

  const sourceRevision = useMemo(
    () => path.find((item) => item.commitId === technicalPlan.sourceRevisionCommitId),
    [path, technicalPlan.sourceRevisionCommitId],
  );
  const stale = isStale(technicalPlan, path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="flex max-h-[min(52rem,calc(100dvh-2rem))] max-w-3xl flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2 pe-8">
            <FileCode2Icon className="size-4 text-muted-foreground" />
            <DialogTitle>{technicalPlan.repositoryName}</DialogTitle>
          </div>
          <DialogDescription>
            Derived from the plan as of{" "}
            {sourceRevision === undefined
              ? "its recorded revision"
              : formatRelativeTimeLabel(sourceRevision.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-h-0 px-0 pb-0">
          {content === null ? (
            <>
              {stale ? <StaleTechnicalPlanNotice /> : null}
              <p className="px-6 py-5 text-sm text-muted-foreground">Reading technical plan…</p>
            </>
          ) : (
            <TechnicalPlanDocument content={content} stale={stale} />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The immutable viewer body: intentionally no editor state or write action. */
export function TechnicalPlanDocument({
  content,
  stale,
}: {
  readonly content: TechnicalPlanAt;
  readonly stale: boolean;
}) {
  return (
    <>
      {stale ? <StaleTechnicalPlanNotice /> : null}
      {content.grounding === undefined || content.grounding.length === 0 ? null : (
        <details className="mx-6 mb-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Consulted {content.grounding.length} {content.grounding.length === 1 ? "item" : "items"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 border-l border-border pl-3 font-mono">
            {content.grounding.map((item) => (
              <li key={`${item.kind}-${item.label}-${item.detail ?? ""}`}>{item.label}</li>
            ))}
          </ul>
        </details>
      )}
      <PlanMarkdown planText={content.text} />
    </>
  );
}

function StaleTechnicalPlanNotice() {
  return (
    <div className="mx-6 mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>The plan has moved past this derivation — re-derive to update it.</span>
    </div>
  );
}
