import { threadChangeGroups } from "@t3tools/client-runtime/changeGroups";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS } from "@t3tools/shared/changeGroups";
import { LayersIcon } from "lucide-react";

import { useChangeGroups } from "~/state/changeGroups";
import { cn } from "~/lib/utils";
import { ThreadDetailsControl } from "../../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "../../chat/threadDetailsPanelStyles";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { showChangeGroupTab } from "./openThreadChangeRequests";

/**
 * Astrolabe: the change groups a thread works in, in its details beside its pull request: one row
 * each, with how many of its change requests merged, opening the group's tab beside the chat.
 */
export function ThreadChangeGroupRows({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const groups = threadChangeGroups(useChangeGroups(), environmentId, threadId);
  return groups.map((group) => {
    const merged = group.members.filter((member) => member.state === "merged").length;
    const count = `${merged} of ${group.members.length} merged`;
    return (
      <Tooltip key={group.groupId}>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              type="button"
              variant="ghost"
              size="sm"
              part="row"
              aria-label={`Change group: ${group.title}, ${count}`}
              onClick={() => showChangeGroupTab(group)}
            />
          }
        >
          <LayersIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span
            className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
          >
            {group.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{`Change group · ${CHANGE_GROUP_STATE_LABELS[group.state]}`}</TooltipPopup>
      </Tooltip>
    );
  });
}
