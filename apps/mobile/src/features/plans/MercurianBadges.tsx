import { PLAN_MAY_BE_STALE_LABEL } from "@t3tools/client-runtime/state/plan-freshness";

import { StatusPill } from "../../components/StatusPill";
import { READY_TO_IMPLEMENT_LABEL } from "./mercurianBadges.logic";

export function ReadyBadge() {
  return (
    <StatusPill
      size="compact"
      label={READY_TO_IMPLEMENT_LABEL}
      pillClassName="bg-emerald-500/15"
      textClassName="text-emerald-700 dark:text-emerald-300"
    />
  );
}

export function StalePlanBadge() {
  return (
    <StatusPill
      size="compact"
      label={PLAN_MAY_BE_STALE_LABEL}
      pillClassName="bg-amber-500/15"
      textClassName="text-amber-700 dark:text-amber-300"
    />
  );
}

export function StaleSpecBadge() {
  return (
    <StatusPill
      size="compact"
      label="Spec stale"
      pillClassName="bg-amber-500/15"
      textClassName="text-amber-700 dark:text-amber-300"
    />
  );
}
