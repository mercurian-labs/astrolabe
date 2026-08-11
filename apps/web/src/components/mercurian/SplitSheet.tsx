import type {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanImplementProposal,
} from "@t3tools/contracts";
import { ArrowRightIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import {
  confirmPayload,
  partitionProposal,
  type ExistingSplit,
  type SplitCard,
} from "./splits.logic";

export function SplitSheet({
  open,
  proposal,
  existingSplits,
  onOpenChange,
  onCancel,
  onConfirm,
  onSelect,
  onOpenSessionDraft,
}: {
  readonly open: boolean;
  readonly proposal: PlanImplementProposal;
  readonly existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (
    splits: ReadonlyArray<{ readonly repositoryId: MercurianRepositoryId; readonly text: string }>,
  ) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onOpenSessionDraft?: ((input: PlanImplementProposal) => void) | undefined;
}) {
  const dismiss = () => {
    onOpenChange(false);
    onCancel();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss();
        else onOpenChange(true);
      }}
    >
      <DialogPopup>
        <SplitSheetPanel
          existingSplits={existingSplits}
          proposal={proposal}
          onCancel={dismiss}
          onConfirm={onConfirm}
          onOpenSessionDraft={onOpenSessionDraft}
          onSelect={onSelect}
        />
      </DialogPopup>
    </Dialog>
  );
}

export function SplitSheetPanel({
  proposal,
  existingSplits,
  onCancel,
  onConfirm,
  onSelect,
  onOpenSessionDraft,
}: {
  readonly proposal: PlanImplementProposal;
  readonly existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit>;
  readonly onCancel: () => void;
  readonly onConfirm: (
    splits: ReadonlyArray<{ readonly repositoryId: MercurianRepositoryId; readonly text: string }>,
  ) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onOpenSessionDraft?: ((input: PlanImplementProposal) => void) | undefined;
}) {
  const partitioned = useMemo(
    () => partitionProposal(proposal, existingSplits),
    [existingSplits, proposal],
  );
  const [cards, setCards] = useState<ReadonlyArray<SplitCard>>(partitioned.cards);

  useEffect(() => setCards(partitioned.cards), [partitioned.cards]);

  const payload = confirmPayload(cards);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Implement this plan</DialogTitle>
        <DialogDescription>
          Review where the plan belongs. Nothing lands until you confirm.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        {proposal.verdict.kind === "atomic" ? (
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-sm">
              This plan is atomic — it implements in{" "}
              <span className="font-medium">{proposal.verdict.repositoryName}</span>.
            </p>
          </div>
        ) : (
          <>
            {proposal.verdict.rationale === undefined ? null : (
              <p className="text-sm text-muted-foreground">{proposal.verdict.rationale}</p>
            )}
            {partitioned.alreadySplit.map((split) => (
              <button
                key={split.repositoryId}
                className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left"
                type="button"
                onClick={() => onSelect(split.commitId)}
              >
                <span>
                  <span className="block text-sm font-medium">{split.repositoryName}</span>
                  <span className="text-xs text-muted-foreground">Already split — jump to it</span>
                </span>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </button>
            ))}
            {cards.map((card, index) =>
              card.removed === true ? null : (
                <div
                  key={card.repositoryId}
                  className="rounded-lg border border-border/70 bg-muted/10 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{card.repositoryName}</p>
                    <Button
                      aria-label={`Remove ${card.repositoryName} split`}
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setCards((current) =>
                          current.map((one, currentIndex) =>
                            currentIndex === index ? { ...one, removed: true } : one,
                          ),
                        )
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`${card.repositoryName} split plan`}
                    className="min-h-36"
                    value={card.text}
                    onChange={(event) =>
                      setCards((current) =>
                        current.map((one, currentIndex) =>
                          currentIndex === index ? { ...one, text: event.target.value } : one,
                        ),
                      )
                    }
                  />
                </div>
              ),
            )}
          </>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {proposal.verdict.kind === "atomic" ? (
          <Button
            disabled={onOpenSessionDraft === undefined}
            onClick={() => onOpenSessionDraft?.(proposal)}
          >
            Coding sessions arrive next
          </Button>
        ) : (
          <Button
            disabled={payload === null}
            onClick={() => payload === null || onConfirm(payload)}
          >
            {payload?.length === 1 ? "Land split" : `Land ${payload?.length ?? 0} splits`}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
