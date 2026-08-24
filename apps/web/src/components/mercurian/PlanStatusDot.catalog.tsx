import type { CatalogEntry } from "../../design-system/catalog";
import { PlanStatusDot } from "./PlanStatusDot";

export const PLAN_STATUS_DOT_CATALOG_ENTRIES = [
  {
    id: "plan-status-dot-awaiting-input",
    section: "mercurian-grammar",
    group: "PlanStatusDot",
    title: "Awaiting input",
    description: "The plan status shown when the assistant needs a user response.",
    sourcePath: "src/components/mercurian/PlanStatusDot.tsx",
    render: () => <PlanStatusDot status="awaiting-input" />,
    layout: "preview",
    preferredCanvas: "compact",
  },
  {
    id: "plan-status-dot-working",
    section: "mercurian-grammar",
    group: "PlanStatusDot",
    title: "Working",
    description: "The plan status shown while the assistant is working.",
    sourcePath: "src/components/mercurian/PlanStatusDot.tsx",
    render: () => <PlanStatusDot status="working" />,
    layout: "preview",
    preferredCanvas: "compact",
  },
  {
    id: "plan-status-dot-unseen-updates",
    section: "mercurian-grammar",
    group: "PlanStatusDot",
    title: "Unseen updates",
    description: "The plan status shown when completed work has not been viewed.",
    sourcePath: "src/components/mercurian/PlanStatusDot.tsx",
    render: () => <PlanStatusDot status="unseen" />,
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;
