import type { PlanGroundingScope } from "@t3tools/contracts";
import { CircleAlertIcon } from "lucide-react";

/** Grounding that could not reach everything, shown only when narrowing happened. */
export function NarrowedGroundingNotice({ scope }: { readonly scope: PlanGroundingScope }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      <CircleAlertIcon className="size-3 shrink-0" />
      <span>
        Grounded without {scope.unreachableRepositories.join(", ")} — out of reach for this
        provider.
      </span>
    </p>
  );
}
