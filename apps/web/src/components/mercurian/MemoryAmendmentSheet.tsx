import type { MercurianCommitId, MemoryAmendmentProposal, PlanId } from "@t3tools/contracts";
import type { CodeViewDiffItem } from "@pierre/diffs/react";
import { BookOpenCheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName } from "../../lib/diffRendering";
import { useCancelMemoryAmendment, useConfirmMemoryAmendment } from "../../state/mercurian";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  confirmMemoryAmendmentBlockedReason,
  memoryAmendmentCancelPayload,
  memoryAmendmentConfirmPayload,
  memoryAmendmentSheetState,
  type MemoryAmendmentBlockedReason,
} from "./MemoryAmendmentSheet.logic";

export function MemoryAmendmentSheet({
  open,
  planId,
  parentCommitId,
  proposal,
  turnActive,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly planId: PlanId;
  readonly parentCommitId: MercurianCommitId | null;
  readonly proposal: MemoryAmendmentProposal;
  readonly turnActive: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirmMemoryAmendment();
  const cancel = useCancelMemoryAmendment();
  const [submitting, setSubmitting] = useState(false);
  const [blockedReason, setBlockedReason] = useState<MemoryAmendmentBlockedReason | null>(null);

  useEffect(() => {
    setSubmitting(false);
    setBlockedReason(null);
  }, [proposal.turnId]);

  const decline = () => {
    onOpenChange(false);
    void cancel(memoryAmendmentCancelPayload(planId));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else decline();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogTitle className="sr-only">Review memory amendment</DialogTitle>
        <MemoryAmendmentSheetPanel
          blockedReason={blockedReason}
          confirmDisabled={submitting || turnActive || parentCommitId === null}
          proposal={proposal}
          onConfirm={() => {
            if (parentCommitId === null || submitting || turnActive) return;
            setSubmitting(true);
            setBlockedReason(null);
            void confirm(memoryAmendmentConfirmPayload(planId, parentCommitId)).then((result) => {
              if (!result.ok) setBlockedReason(confirmMemoryAmendmentBlockedReason(result.error));
              setSubmitting(false);
            });
          }}
          onDecline={decline}
        />
      </DialogPopup>
    </Dialog>
  );
}

export function MemoryAmendmentSheetPanel({
  proposal,
  blockedReason,
  confirmDisabled,
  onConfirm,
  onDecline,
}: {
  readonly proposal: MemoryAmendmentProposal;
  readonly blockedReason: MemoryAmendmentBlockedReason | null;
  readonly confirmDisabled: boolean;
  readonly onConfirm: () => void;
  readonly onDecline: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const state = memoryAmendmentSheetState({
    proposal,
    turnActive: confirmDisabled,
    parentCommitId: "panel" as MercurianCommitId,
    blockedReason,
  });
  const renderablePatch = useMemo(
    () => getRenderablePatch(proposal.patch, `memory-amendment:${proposal.turnId}`),
    [proposal.patch, proposal.turnId],
  );
  const diffItems = useMemo<ReadonlyArray<CodeViewDiffItem<undefined>>>(
    () =>
      renderablePatch?.kind === "files"
        ? renderablePatch.files.map((fileDiff, index) => ({
            id: fileDiff.cacheKey ?? `${fileDiff.name ?? fileDiff.prevName ?? "file"}:${index}`,
            type: "diff",
            fileDiff,
            annotations: [],
            collapsed: false,
          }))
        : [],
    [renderablePatch],
  );
  if (state === null) return null;

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex flex-col gap-2 px-6 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <BookOpenCheckIcon className="size-5 shrink-0 text-muted-foreground" />
          <h2 className="font-heading text-xl font-semibold leading-none">{state.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Review the exact change. Nothing is written until you confirm.
        </p>
      </header>

      <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-4">
        {renderablePatch?.kind === "files" ? (
          <div className="h-[24rem] max-h-[45vh] min-h-48 overflow-hidden rounded-lg border border-border">
            <StyledDiffCodeView
              className="h-full overflow-auto"
              items={diffItems}
              options={{
                diffStyle: "unified",
                theme: resolveDiffThemeName(resolvedTheme),
              }}
            />
          </div>
        ) : renderablePatch?.kind === "raw" ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{renderablePatch.reason}</p>
            <pre className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {renderablePatch.text}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This amendment has no rendered changes.</p>
        )}

        {state.placements.length === 0 ? null : (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {state.placements.map((placement) => (
              <li key={placement}>{placement}</li>
            ))}
          </ul>
        )}

        {state.blockedNotice === null ? null : (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground"
          >
            {state.blockedNotice}
          </p>
        )}
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t border-border bg-muted/72 px-6 py-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDecline}>
          Not now
        </Button>
        <Button type="button" disabled={state.confirmDisabled} onClick={onConfirm}>
          Amend memory
        </Button>
      </footer>
    </div>
  );
}
