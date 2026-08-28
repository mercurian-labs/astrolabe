import { PlanStatusDot } from "~/components/mercurian/PlanStatusDot";
import type { PlanRowStatus } from "~/components/mercurian/planListing.logic";

const statuses = [
  { status: "awaiting-input", label: "Awaiting input" },
  { status: "working", label: "Working" },
  { status: "unseen", label: "Unseen updates" },
] satisfies ReadonlyArray<{ readonly status: PlanRowStatus; readonly label: string }>;

export default function StatusVocabularyDemo() {
  return (
    <div className="grid grid-cols-3 gap-6 [&_.animate-status-pulse]:animate-none">
      {statuses.map(({ status, label }) => (
        <div key={status} className="flex flex-col items-center gap-3 text-center">
          <PlanStatusDot status={status} />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}
