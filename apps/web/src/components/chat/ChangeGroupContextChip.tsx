import type { ChangeGroupContextRecord } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS, findChangeGroup } from "@t3tools/shared/changeGroups";
import { ArrowUpRightIcon, BookOpenIcon, LayersIcon } from "lucide-react";
import { useState } from "react";

import { useChangeGroupsWhile } from "~/state/changeGroups";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { CHANGE_GROUP_MEMBER_STATE_LABELS } from "../changeRequests/groups/changeGroupPresentation";
import { showChangeGroupTab } from "../changeRequests/groups/openThreadChangeRequests";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { composerFloatingLayerProps } from "./composerEventScope";

/**
 * Astrolabe: a change group named in a message, the same chip in a draft and a sent message. Its
 * popover shows the group as it is now, found by its members once its root changed.
 */
export function ChangeGroupContextChip(props: {
  record: ChangeGroupContextRecord;
  copyMarkdown?: string | undefined;
}) {
  const { record } = props;
  const [open, setOpen] = useState(false);
  // Read while the popover is open: a sent message's chip follows no group otherwise.
  const group = findChangeGroup(
    useChangeGroupsWhile(open).filter(
      (candidate) => candidate.environmentId === record.environmentId,
    ),
    record.groupId,
    record.memberKeys,
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ContextChip
            kind="change-group"
            contentEditable={false}
            render={<button type="button" />}
            aria-label={`Change group, ${record.title}. Show details`}
            data-markdown-copy={props.copyMarkdown}
          />
        }
      >
        <LayersIcon />
        <ContextChipLabel>{record.label}</ContextChipLabel>
      </PopoverTrigger>
      <PopoverPopup
        {...composerFloatingLayerProps}
        aria-label={record.title}
        side="top"
        width="md"
        padding="compact"
      >
        <p className="truncate px-1 text-sm font-medium">{group?.title ?? record.title}</p>
        {group === null ? (
          <p className="px-1 pt-1 text-sm text-muted-foreground">
            This change group is not on a connected environment now.
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2 p-1">
            <p className="text-xs text-muted-foreground">
              {CHANGE_GROUP_STATE_LABELS[group.state]}
            </p>
            <ul className="flex w-full flex-col gap-1">
              {group.members.map((member) => {
                const Icon = member.side === "code" ? PullRequestGlyph.pullRequest : BookOpenIcon;
                return (
                  <li key={member.key} className="flex min-w-0 items-center gap-2 text-sm">
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {member.ref.kind === "pull-request"
                        ? `#${member.ref.number} ${member.title}`
                        : member.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {CHANGE_GROUP_MEMBER_STATE_LABELS[member.state]}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setOpen(false);
                showChangeGroupTab(group);
              }}
            >
              <ArrowUpRightIcon aria-hidden="true" />
              Open group
            </Button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
