import type { EnvironmentIssueEntry } from "@t3tools/client-runtime/issue-list";
import { MessageSquareIcon } from "lucide-react";
import { memo, type DragEvent, type MouseEvent } from "react";

import { cn } from "~/lib/utils";
import { endDrag } from "~/panes/drag";
import type { RowClick } from "~/tabNavigation.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
} from "../pullRequest/PullRequestListRow";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
} from "../pullRequest/pullRequestPresentation";
import {
  preventMiddleClickScroll,
  SIDEBAR_CARD_ITEM_CLASS,
  SIDEBAR_ROW_ACTIVE_CLASS,
  SIDEBAR_ROW_IDLE_CLASS,
  SIDEBAR_ROW_SURFACE_CLASS,
  SidebarCardContent,
  SidebarCardFooter,
  SidebarCardHeader,
  SidebarCardTitle,
} from "../sidebar/SidebarCard";
import { IssueStateGlyph, issueTrackerPresentation } from "./issuePresentation";

export type IssueRowTarget = Pick<
  EnvironmentIssueEntry,
  "environmentId" | "projectId" | "tracker" | "host" | "scope" | "key" | "url"
>;

/**
 * Astrolabe: an issue drawn as the sidebar's cards are (where it lives and when; its key and
 * title; then who opened it, its first label, who has it and how much it was discussed).
 */
function IssueRowImpl({
  entry,
  selected,
  showTracker,
  environmentLabel,
  onSelect,
  onDragRow,
  onRowMenu,
}: {
  entry: EnvironmentIssueEntry;
  selected: boolean;
  /** Only when the list spans more than one tracker or host. */
  showTracker: boolean;
  /** Names the server this row was read from, where the list spans more than one. */
  environmentLabel?: string | undefined;
  /** `click` is how the row was pressed (see `rowClickIntent`). */
  onSelect: (entry: EnvironmentIssueEntry, click: RowClick) => void;
  onDragRow: (entry: EnvironmentIssueEntry, event: DragEvent<HTMLElement>) => void;
  onRowMenu: (entry: EnvironmentIssueEntry, event: MouseEvent<HTMLElement>) => void;
}) {
  const tracker = issueTrackerPresentation(entry.tracker);
  const [label] = entry.labels;
  return (
    <div className={cn("flex items-center", SIDEBAR_CARD_ITEM_CLASS)}>
      <button
        type="button"
        aria-current={selected ? "page" : undefined}
        aria-label={`${entry.displayKey} ${entry.title}`}
        draggable
        onDragStart={(event) => onDragRow(entry, event)}
        onDragEnd={endDrag}
        onContextMenu={(event) => {
          event.preventDefault();
          onRowMenu(entry, event);
        }}
        onClick={(event) => onSelect(entry, event)}
        onMouseDown={preventMiddleClickScroll}
        onAuxClick={(event) => {
          if (event.button === 1) onSelect(entry, event);
        }}
        className={cn(
          SIDEBAR_ROW_SURFACE_CLASS,
          "min-w-0 flex-1",
          selected ? SIDEBAR_ROW_ACTIVE_CLASS : SIDEBAR_ROW_IDLE_CLASS,
        )}
      >
        <SidebarCardContent>
          <SidebarCardHeader>
            <IssueStateGlyph state={entry.state} />
            {showTracker ? (
              <tracker.Icon aria-label={tracker.providerName} className="size-3 shrink-0" />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
              {entry.scope}
              {environmentLabel ? ` · ${environmentLabel}` : null}
            </span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-secondary-label">
              {formatRelativeTimeLabel(entry.updatedAt)}
            </span>
          </SidebarCardHeader>
          <SidebarCardTitle>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className={PULL_REQUEST_ROW_NUMBER_CLASS}>{entry.displayKey}</span>
              <span className="min-w-0 truncate text-sm font-medium text-foreground/90">
                {entry.title}
              </span>
            </span>
          </SidebarCardTitle>
          <SidebarCardFooter>
            <PullRequestRowAuthor
              actor={entry.author}
              className="min-w-3.5 max-w-32"
              labelClassName="truncate"
            />
            {label ? (
              <PullRequestLabelChip label={label} className="max-w-24">
                {entry.labels.length > 1 ? (
                  <span className="shrink-0">+{entry.labels.length - 1}</span>
                ) : null}
              </PullRequestLabelChip>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {entry.assignees.length > 0 ? (
                <span className="flex items-center -space-x-1">
                  {entry.assignees.slice(0, 3).map((assignee) => (
                    <PullRequestActorAvatar
                      key={assignee.login}
                      actor={assignee}
                      className="ring-1 ring-background"
                    />
                  ))}
                </span>
              ) : null}
              {entry.commentCount > 0 ? (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <MessageSquareIcon aria-hidden className="size-3" />
                  {entry.commentCount}
                </span>
              ) : null}
            </span>
          </SidebarCardFooter>
        </SidebarCardContent>
      </button>
    </div>
  );
}

export const IssueRow = memo(IssueRowImpl);
