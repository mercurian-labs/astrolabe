import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS } from "@t3tools/shared/changeGroups";

import { workspace } from "~/panes/workspace";
import { showKeyIn } from "~/sectionTabs/SectionTabContent";
import { useChangeGroups } from "~/state/changeGroups";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { changeGroupStateVariant } from "./changeGroupPresentation";
import { changeGroupTabKey } from "./changeGroupTabs";

/**
 * Astrolabe: the change group a thread's change requests are in, beside the thread's title: its
 * state, and its tab on a click: beside the chat, or in front where it is open. Nothing for a
 * thread in no group.
 */
export function ThreadChangeGroupPill({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const group = useChangeGroups().find(
    (candidate) =>
      candidate.environmentId === environmentId && candidate.threadIds.includes(threadId),
  );
  if (!group) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0 [-webkit-app-region:no-drag]"
            aria-label={`Change group: ${group.title}, ${CHANGE_GROUP_STATE_LABELS[group.state]}`}
            onClick={() =>
              workspace.update((arrangement) =>
                showKeyIn(arrangement, changeGroupTabKey(group), "beside"),
              )
            }
          />
        }
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
        <Badge size="sm" variant={changeGroupStateVariant(group.state)}>
          {CHANGE_GROUP_STATE_LABELS[group.state]}
        </Badge>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{`${group.title} · ${group.members.length} change requests`}</TooltipPopup>
    </Tooltip>
  );
}
