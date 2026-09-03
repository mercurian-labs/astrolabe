import type { ThreadId } from "@t3tools/contracts";

import { useRecreateLineBranch } from "../../state/mercurian";
import { Button } from "../ui/button";

export function LineBranchMissingBanner(props: {
  readonly threadId: ThreadId;
  readonly branch: string | null;
  readonly lineBranchMissingOid: string | null;
}) {
  const recreateLineBranch = useRecreateLineBranch();

  if (props.lineBranchMissingOid === null || props.branch === null) return null;

  return (
    <div
      role="alert"
      className="flex w-full items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        Branch <code>{props.branch}</code> no longer exists in this repository
      </span>
      <Button
        size="xs"
        type="button"
        variant="outline"
        onClick={() => void recreateLineBranch({ threadId: props.threadId })}
      >
        Recreate at {props.lineBranchMissingOid.slice(0, 7)}
      </Button>
    </div>
  );
}
