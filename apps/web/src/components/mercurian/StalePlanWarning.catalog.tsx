import type { CatalogEntry } from "../../design-system/catalog";
import { AlertDialog } from "../ui/alert-dialog";
import { StalePlanWarningContent } from "./StalePlanWarning";

export const STALE_PLAN_WARNING_CATALOG_ENTRIES = [
  {
    id: "stale-plan-warning-plan-may-be-stale",
    section: "mercurian-grammar",
    group: "StalePlanWarning",
    title: "Plan may be stale",
    description: "The confirmation shown before implementing from a stale plan.",
    sourcePath: "src/components/mercurian/StalePlanWarning.tsx",
    render: () => (
      <AlertDialog open>
        <StalePlanWarningContent onContinue={() => undefined} onReviewPlan={() => undefined} />
      </AlertDialog>
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;
