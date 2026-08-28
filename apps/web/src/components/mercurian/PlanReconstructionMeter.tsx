import type {
  PlanReconstructionMeasure,
  PlanningModelResolution,
  PlanningModelSelection,
  ServerProvider,
} from "@t3tools/contracts";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { reconstructionMeterState } from "./PlanReconstructionMeter.logic";

function formatPercentage(fraction: number): string {
  const percentage = fraction * 100;
  return percentage < 10
    ? `${percentage.toFixed(1).replace(/\.0$/, "")}%`
    : `${Math.round(percentage)}%`;
}

/** Quiet, informational reconstruction gauge for the planning composer. */
export function PlanReconstructionMeter(props: {
  readonly measure: PlanReconstructionMeasure | null;
  readonly draftChars: number;
  readonly selection: PlanningModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly resolution: PlanningModelResolution;
}) {
  const state = reconstructionMeterState(props);
  if (state === null) return null;

  const percentage = formatPercentage(state.fillFraction);
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - state.fillFraction);
  const tokenLabel =
    state.approxMaxTokens === null
      ? `${formatContextWindowTokens(state.approxUsedTokens)} estimated tokens`
      : `${percentage} · ${formatContextWindowTokens(state.approxUsedTokens)}/${formatContextWindowTokens(state.approxMaxTokens)} estimated tokens`;
  const statusText = state.willElide
    ? `Reconstruction ${tokenLabel}. The next reply will see its oldest history entries elided.`
    : `Reconstruction ${tokenLabel}. The recorded history still fits verbatim.`;
  const stroke = state.willElide
    ? "var(--color-amber-500)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <span
      aria-label={statusText}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-[11px]",
        state.willElide ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
      role="status"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full" />
          }
        >
          <span className="relative flex size-5 items-center justify-center">
            <svg
              aria-hidden="true"
              className="absolute inset-0 size-full -rotate-90"
              viewBox="0 0 24 24"
            >
              <circle
                cx="12"
                cy="12"
                fill="none"
                r={radius}
                stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                strokeWidth="3"
              />
              <circle
                cx="12"
                cy="12"
                fill="none"
                r={radius}
                stroke={stroke}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                strokeWidth="3"
              />
            </svg>
            {state.willElide ? (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-amber-500 ring-2 ring-background"
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipPopup className="w-64 max-w-none whitespace-normal p-2" side="top">
          <span className="block font-medium">Next reply reconstruction</span>
          <span className="mt-1 block text-muted-foreground">{tokenLabel}</span>
          <span className="mt-1 block text-muted-foreground">
            Includes recorded dialogue, the plan, the spec, prompt framing, and this draft.
          </span>
          <span className="mt-1 block text-muted-foreground">
            {state.willElide
              ? "The next reply will see its oldest history entries elided."
              : "The recorded history still fits verbatim."}
          </span>
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
