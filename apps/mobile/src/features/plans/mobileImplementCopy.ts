import {
  PLAN_MAY_BE_STALE_DESCRIPTION,
  PLAN_MAY_BE_STALE_LABEL,
} from "@t3tools/client-runtime/state/plan-freshness";

import { NO_SESSION_MODEL_REASON } from "./codingSessionDraftSheet.logic";
import { READY_TO_IMPLEMENT_LABEL } from "./mercurianBadges.logic";
import { PLAN_IMPLEMENT_COPY } from "./planImplementSheet.logic";
import { STALE_PLAN_WARNING_MESSAGE } from "./useImplementFlow.logic";

export const IMPLEMENT_ANALYZING_COPY =
  "Checking whether this plan is ready to implement. A coding session works in one repository at a time.";

export const MOBILE_IMPLEMENT_RENDERED_COPY = [
  ...Object.values(PLAN_IMPLEMENT_COPY),
  PLAN_MAY_BE_STALE_LABEL,
  PLAN_MAY_BE_STALE_DESCRIPTION,
  STALE_PLAN_WARNING_MESSAGE,
  READY_TO_IMPLEMENT_LABEL,
  "Spec stale",
  NO_SESSION_MODEL_REASON,
  IMPLEMENT_ANALYZING_COPY,
  "Review plan",
  "Continue anyway",
] as const;
