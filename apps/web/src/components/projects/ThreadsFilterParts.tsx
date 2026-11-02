import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { ProjectFaviconProject } from "../ProjectFavicon";
import { ProjectFilterIcon } from "./ProjectFilterIcon";
import type { ProjectFilterOption } from "./projectFilter";
import { THREAD_STATUS_FILTER_LABELS, type ThreadStatusFilter } from "./threadsFilter";

/** A filter row's checkbox, drawn only: the row itself is the option. */
export function ThreadsFilterCheckbox({ checked }: { readonly checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
        checked ? "border-primary bg-primary" : "border-muted-foreground/50",
      )}
    >
      {checked ? <CheckIcon className="size-2.5 text-primary-foreground" strokeWidth={3} /> : null}
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
 * Astrolabe: a section's filter in force, one pill per dimension, under the sidebar's title row,
 * with Clear once there are two.
 */
export function FilterPills({
  label,
  count,
  onClear,
  children,
}: {
  readonly label: string;
  /** How many dimensions are filtering, for Clear. */
  readonly count: number;
  readonly onClear: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-1 pt-1" aria-label={label}>
      {children}
      {count >= 2 ? (
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

/** A filter that is one tap on or off, offered while it would match something. */
export function OneTapFilterPill({
  on,
  label,
  count,
  icon,
  onToggle,
}: {
  readonly on: boolean;
  readonly label: string;
  readonly count: number;
  readonly icon: ReactNode;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        pillClass,
        "cursor-pointer gap-1 px-2",
        on
          ? "border-warning/60 bg-warning/12 text-sidebar-foreground"
          : "border-dashed border-sidebar-border text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
      )}
    >
      {icon}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

/** The Agents filter's pills: Needs you as one tap, then the projects and the other statuses. */
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
  return (
    <FilterPills label="Thread filters" count={pillCount} onClear={onClear}>
      {showNeedsYou ? (
        <OneTapFilterPill
          on={needsYou.on}
          label={THREAD_STATUS_FILTER_LABELS["needs-you"]}
          count={needsYou.count}
          icon={<ThreadStatusFilterIcon status="needs-you" className="size-3.5" />}
          onToggle={onToggleNeedsYou}
        />
      ) : null}
      {pickedProjects.length > 0 ? (
        <FilterPill
          label={namesOrCount(
            pickedProjects.map((item) => item.label),
            "projects",
          )}
          onOpen={onOpen}
          onRemove={onClearProjects}
        >
          <PillIcons>
            {pickedProjects.slice(0, 3).map((item) => (
              <span key={item.value} className="flex rounded-xs bg-sidebar [&_svg]:size-3.5">
                <ProjectFilterIcon option={item} />
              </span>
            ))}
          </PillIcons>
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
    </FilterPills>
  );
}

/** The picks' names, or how many past two. */
export const namesOrCount = (names: ReadonlyArray<string>, noun: string) =>
  names.length <= 2 ? names.join(", ") : `${names.length} ${noun}`;

/** Up to three picks' icons, overlapping. */
export function PillIcons({ children }: { readonly children: ReactNode }) {
  return <span className="flex shrink-0 -space-x-1">{children}</span>;
}

/** A dimension's pill: its body opens the filter, its × clears the dimension. */
export function FilterPill({
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
