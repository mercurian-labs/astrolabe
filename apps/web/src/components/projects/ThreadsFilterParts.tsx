import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { ProjectFaviconProject } from "../ProjectFavicon";
import { ProjectFilterIcon } from "./ProjectFilterIcon";
import type { ProjectFilterOption } from "./projectFilter";
import { THREAD_STATUS_FILTER_LABELS, type ThreadStatusFilter } from "./threadsFilter";
import type { ThreadsFilterCheck } from "./useThreadsFilter";

/** A filter row's checkbox, drawn only: the row itself is the option. */
export function ThreadsFilterCheckbox({ check }: { readonly check: ThreadsFilterCheck }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
        check === "unchecked" ? "border-muted-foreground/50" : "border-primary",
        check === "checked" && "bg-primary",
      )}
    >
      {check === "checked" ? (
        <CheckIcon className="size-2.5 text-primary-foreground" strokeWidth={3} />
      ) : check === "partial" ? (
        <MinusIcon className="size-2.5 text-primary" strokeWidth={3} />
      ) : null}
    </span>
  );
}

/** A status's icon and colour, as the thread row's status reads. */
export function ThreadStatusFilterIcon({
  status,
  className,
}: {
  readonly status: ThreadStatusFilter;
  readonly className?: string;
}) {
  const classes = cn("size-4 shrink-0", className);
  switch (status) {
    case "needs-you":
      return (
        <MessageCircleQuestionIcon aria-hidden className={cn(classes, "text-warning-foreground")} />
      );
    case "working":
      return <CircleDashedIcon aria-hidden className={cn(classes, "text-info-foreground")} />;
    case "errored":
      return <CircleAlertIcon aria-hidden className={cn(classes, "text-error-foreground")} />;
  }
}

const pillClass =
  "inline-flex h-6 min-w-0 max-w-full items-center rounded-full border text-xs font-medium";

/**
 * Astrolabe: the filter in force, one pill per dimension, under the sidebar's title row. Needs you
 * is always offered while any thread needs you, so it is one tap rather than a trip to the menu.
 */
export function ThreadsFilterPills({
  pickedProjects,
  otherStatuses,
  needsYou,
  onToggleNeedsYou,
  onOpen,
  onClearProjects,
  onClearOtherStatuses,
  onClear,
}: {
  readonly pickedProjects: ReadonlyArray<ProjectFilterOption<ProjectFaviconProject>>;
  readonly otherStatuses: ReadonlyArray<ThreadStatusFilter>;
  readonly needsYou: { readonly on: boolean; readonly count: number };
  readonly onToggleNeedsYou: () => void;
  readonly onOpen: () => void;
  readonly onClearProjects: () => void;
  readonly onClearOtherStatuses: () => void;
  readonly onClear: () => void;
}) {
  const showNeedsYou = needsYou.on || needsYou.count > 0;
  const pillCount =
    (needsYou.on ? 1 : 0) +
    (pickedProjects.length > 0 ? 1 : 0) +
    (otherStatuses.length > 0 ? 1 : 0);
  if (!showNeedsYou && pillCount === 0) return null;
  const projectLabel =
    pickedProjects.length <= 2
      ? pickedProjects.map((item) => item.label).join(", ")
      : `${pickedProjects.length} projects`;
  return (
    <div className="flex flex-wrap items-center gap-1 px-1 pt-1" aria-label="Thread filters">
      {showNeedsYou ? (
        <button
          type="button"
          aria-pressed={needsYou.on}
          onClick={onToggleNeedsYou}
          className={cn(
            pillClass,
            "cursor-pointer gap-1 px-2",
            needsYou.on
              ? "border-warning/60 bg-warning/12 text-sidebar-foreground"
              : "border-dashed border-sidebar-border text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
          <ThreadStatusFilterIcon status="needs-you" className="size-3.5" />
          {THREAD_STATUS_FILTER_LABELS["needs-you"]}
          <span className="tabular-nums opacity-70">{needsYou.count}</span>
        </button>
      ) : null}
      {pickedProjects.length > 0 ? (
        <FilterPill label={projectLabel} onOpen={onOpen} onRemove={onClearProjects}>
          <span className="flex shrink-0 -space-x-1">
            {pickedProjects.slice(0, 3).map((item) => (
              <span key={item.value} className="flex rounded-xs bg-sidebar [&_svg]:size-3.5">
                <ProjectFilterIcon option={item} />
              </span>
            ))}
          </span>
        </FilterPill>
      ) : null}
      {otherStatuses.length > 0 ? (
        <FilterPill
          label={otherStatuses.map((status) => THREAD_STATUS_FILTER_LABELS[status]).join(", ")}
          onOpen={onOpen}
          onRemove={onClearOtherStatuses}
        >
          {otherStatuses.map((status) => (
            <ThreadStatusFilterIcon key={status} status={status} className="size-3.5" />
          ))}
        </FilterPill>
      ) : null}
      {pillCount >= 2 ? (
        <button
          type="button"
          onClick={onClear}
          className="h-6 cursor-pointer rounded-full px-2 text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function FilterPill({
  label,
  onOpen,
  onRemove,
  children,
}: {
  readonly label: string;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly children: ReactNode;
}) {
  return (
    <span className={cn(pillClass, "border-sidebar-border bg-sidebar-control-surface")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 cursor-pointer items-center gap-1 ps-2 pe-1 text-sidebar-foreground"
      >
        {children}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="me-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
