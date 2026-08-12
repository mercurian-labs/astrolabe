import type {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanImplementProposal,
  PlanSplitProposal,
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
  type LandedPlan,
  type SplitCard,
} from "./splits.logic";

const EMPTY_LANDED_PLANS: ReadonlyArray<LandedPlan> = [];

export function SplitSheet({
  open,
  proposal,
  landedPlans = EMPTY_LANDED_PLANS,
  existingSplits,
  onOpenChange,
  onCancel,
  onConfirm,
  onSelect,
  onOpenSessionDraft,
}: {
  readonly open: boolean;
  readonly proposal?: PlanImplementProposal | undefined;
  readonly landedPlans?: ReadonlyArray<LandedPlan> | undefined;
  readonly existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (plans: ReadonlyArray<PlanSplitProposal>) => void;
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
          landedPlans={landedPlans}
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
  landedPlans = EMPTY_LANDED_PLANS,
  existingSplits,
  onCancel,
  onConfirm,
  onSelect,
  onOpenSessionDraft,
}: {
  readonly proposal?: PlanImplementProposal | undefined;
  readonly landedPlans?: ReadonlyArray<LandedPlan> | undefined;
  readonly existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit>;
  readonly onCancel: () => void;
  readonly onConfirm: (plans: ReadonlyArray<PlanSplitProposal>) => void;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly onOpenSessionDraft?: ((input: PlanImplementProposal) => void) | undefined;
}) {
  const partitioned = useMemo(
    () =>
      proposal === undefined
        ? { cards: [], alreadySplit: [] }
        : partitionProposal(proposal, existingSplits),
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
          {landedPlans.length > 0
            ? "Choose a repository plan to go to it."
            : "Review where the plan belongs. Nothing is added until you confirm."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        {landedPlans.length > 0 ? (
          landedPlans.map((plan) => (
            <button
              key={plan.commitId}
              className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left"
              type="button"
              onClick={() => onSelect(plan.commitId)}
            >
              <span className="text-sm font-medium">
                You added a plan for {plan.repositoryName}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Go to plan
                <ArrowRightIcon className="size-4" />
              </span>
            </button>
          ))
        ) : proposal?.verdict.kind === "atomic" ? (
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-sm font-medium">This plan is ready to implement.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A coding session will run in{" "}
              <span className="font-medium text-foreground">{proposal.verdict.repositoryName}</span>
              .
            </p>
          </div>
        ) : proposal === undefined ? null : (
          <>
            {proposal.verdict.kind === "needs-split" ? (
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                <p>
                  This plan covers work in more than one repository. A coding session works in one
                  repository at a time.
                </p>
                {proposal.verdict.rationale === undefined ? null : (
                  <p>{proposal.verdict.rationale}</p>
                )}
              </div>
            ) : null}
            {partitioned.alreadySplit.map((split) => (
              <button
                key={split.repositoryId}
                className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left"
                type="button"
                onClick={() => onSelect(split.commitId)}
              >
                <span>
                  <span className="block text-sm font-medium">{split.repositoryName}</span>
                  <span className="text-xs text-muted-foreground">
                    This repository already has its own plan
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  Go to plan
                  <ArrowRightIcon className="size-4" />
                </span>
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
                      aria-label={`Remove plan for ${card.repositoryName}`}
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
                    aria-label={`Plan for ${card.repositoryName}`}
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
          {landedPlans.length > 0 ? "Done" : "Cancel"}
        </Button>
        {landedPlans.length > 0 || proposal === undefined ? null : proposal.verdict.kind ===
          "atomic" ? (
          <Button
            disabled={onOpenSessionDraft === undefined}
            onClick={() => onOpenSessionDraft?.(proposal)}
          >
            Coding sessions arrive next
          </Button>
        ) : payload === null ? null : (
          <Button onClick={() => onConfirm(payload)}>Add a plan for each repository</Button>
        )}
      </DialogFooter>
    </>
  );
}
