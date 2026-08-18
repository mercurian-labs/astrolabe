import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { PLAN_MAY_BE_STALE_DESCRIPTION, PLAN_MAY_BE_STALE_LABEL } from "./PlanFreshness";

export function StalePlanWarning({
  open,
  onContinue,
  onOpenChange,
  onReviewPlan,
}: {
  readonly open: boolean;
  readonly onContinue: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReviewPlan: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <StalePlanWarningPanel onContinue={onContinue} onReviewPlan={onReviewPlan} />
    </AlertDialog>
  );
}

export function StalePlanWarningPanel({
  onContinue,
  onReviewPlan,
}: {
  readonly onContinue: () => void;
  readonly onReviewPlan: () => void;
}) {
  return (
    <AlertDialogPopup>
      <StalePlanWarningContent onContinue={onContinue} onReviewPlan={onReviewPlan} />
    </AlertDialogPopup>
  );
}

export function StalePlanWarningContent({
  onContinue,
  onReviewPlan,
}: {
  readonly onContinue: () => void;
  readonly onReviewPlan: () => void;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{PLAN_MAY_BE_STALE_LABEL}</AlertDialogTitle>
        <AlertDialogDescription>
          {PLAN_MAY_BE_STALE_DESCRIPTION} — the plan may be stale.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" onClick={onReviewPlan}>
          Review plan
        </Button>
        <Button onClick={onContinue}>Continue anyway</Button>
      </AlertDialogFooter>
    </>
  );
}
