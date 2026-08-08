import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { PlanRowStatus } from "./ProjectTreeSidebar.logic";

/**
 * How each status reads. The urgency palette is the fork's, unchanged: amber
 * and indigo for what wants you, sky for what is moving, emerald for what
 * finished while you were away. Only working pulses — the dot moves when the
 * work does.
 *
 * One vocabulary, every surface: the tree row and the palette row say a status
 * the same way, which is why this lives beside neither of them.
 */
export const PLAN_STATUS_PRESENTATION: Record<
  PlanRowStatus,
  { readonly label: string; readonly colorClass: string; readonly dotClass: string }
> = {
  "awaiting-input": {
    label: "Awaiting your input",
    colorClass: "text-indigo-600 dark:text-indigo-300/90",
    dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
  },
  working: {
    label: "Assistant working",
    colorClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80 animate-status-pulse",
  },
  unseen: {
    label: "Unseen updates",
    colorClass: "text-emerald-600 dark:text-emerald-300/90",
    dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
  },
};

/**
 * One status, one dot. No label on the row: a row's width belongs to the plan's
 * title, and the word is a hover away.
 */
export function PlanStatusDot({ status }: { readonly status: PlanRowStatus }) {
  const presentation = PLAN_STATUS_PRESENTATION[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={presentation.label}
            className={cn(
              "inline-flex size-3.5 shrink-0 items-center justify-center",
              presentation.colorClass,
            )}
          />
        }
      >
        <span className={cn("size-[9px] rounded-full", presentation.dotClass)} />
      </TooltipTrigger>
      <TooltipPopup side="top">{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}
