import { PinOffIcon } from "lucide-react";
import { Fragment, type MouseEvent, type ReactNode } from "react";

import type { SidebarThreadSummary } from "../../types";
import { ThreadWorktreeIndicator } from "../ThreadStatusIndicators";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { AgentRowSummary } from "./agentRowSummary";

/**
 * Astrolabe: a thread row's second line, the parts of its `AgentRowSummary` joined with " · ".
 * The pull request is the row's own badge, drawn with the summary's text, so it still opens the
 * pull request (or the list of them) and keeps its tooltip. The branch and the agent's name give
 * way when the line runs out of room.
 */
export function AgentRowDetails(props: {
  summary: AgentRowSummary;
  thread: Pick<SidebarThreadSummary, "id" | "branch" | "worktreePath">;
  pullRequest: ReactNode;
}) {
  const { summary } = props;
  const parts: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (summary.draft) {
    parts.push({
      key: "draft",
      node: (
        <span
          data-testid={`sidebar-draft-indicator-${props.thread.id}`}
          className="shrink-0 font-medium text-warning-foreground"
        >
          Draft
        </span>
      ),
    });
  }
  if (summary.branch) {
    parts.push({
      key: "branch",
      node: (
        <span className="flex min-w-0 items-center gap-1">
          {summary.branch.worktree ? <ThreadWorktreeIndicator thread={props.thread} /> : null}
          <MiddleTruncate value={summary.branch.text} showTitle={false} />
        </span>
      ),
    });
  }
  if (summary.pullRequest !== null && props.pullRequest) {
    parts.push({
      key: "pull-request",
      node: <span className="flex shrink-0 items-center">{props.pullRequest}</span>,
    });
  }
  if (summary.agent) {
    parts.push({
      key: "agent",
      node: <span className="min-w-0 truncate">{summary.agent}</span>,
    });
  }
  return (
    <div className="flex h-4 min-w-0 items-center gap-1 text-secondary-label text-xs">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? (
            <span aria-hidden className="shrink-0 opacity-60">
              ·
            </span>
          ) : null}
          {part.node}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A pinned thread row's Unpin, among its hover actions: the row has no pin glyph, since the
 * Pinned heading marks the pinned rows.
 */
export function UnpinRowAction(props: { onClick: (event: MouseEvent) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Unpin thread"
            onClick={props.onClick}
            className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <PinOffIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">Unpin thread</TooltipPopup>
    </Tooltip>
  );
}
