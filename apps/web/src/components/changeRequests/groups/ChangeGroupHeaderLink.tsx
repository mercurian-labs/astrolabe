import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { CHANGE_GROUP_STATE_LABELS, type ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { LayersIcon } from "lucide-react";

import { useChangeGroups } from "~/state/changeGroups";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { showChangeGroupTab } from "./openThreadChangeRequests";

/**
 * Astrolabe: in a change request's tab header, the change group it is in, opening the group's tab
 * on a click. Nothing for one in no group.
 */
export function ChangeGroupHeaderLink({
  isMember,
}: {
  readonly isMember: (group: EnvironmentChangeGroup, member: ChangeGroupMember) => boolean;
}) {
  const group = useChangeGroups().find((candidate) =>
    candidate.members.some((member) => isMember(candidate, member)),
  );
  if (group === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="min-w-0 max-w-56"
            aria-label={`Change group: ${group.title}`}
            onClick={() => showChangeGroupTab(group)}
          />
        }
      >
        <LayersIcon aria-hidden />
        <span className="truncate">{group.title}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{`Change group · ${CHANGE_GROUP_STATE_LABELS[group.state]}`}</TooltipPopup>
    </Tooltip>
  );
}
