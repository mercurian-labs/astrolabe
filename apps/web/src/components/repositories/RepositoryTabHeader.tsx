import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Astrolabe: the row across the top of every Repositories tab, one height and one look for a
 * file, a local graph, a checkout's changes and an empty tab: what the tab shows, in a path's
 * monospace, then a few words of status and the tab's actions as ghost icon buttons.
 */
function Root({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 border-b border-border ps-3 pe-1.5 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Path({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-0 flex-1 truncate font-mono", className)} {...props} />;
}

function Status({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("flex shrink-0 items-center gap-1 px-1", className)} {...props} />;
}

/** An action: a ghost icon button named by its tooltip; `pressed` for one that toggles. */
function Action({
  label,
  tooltip = label,
  pressed,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "size" | "variant" | "className"> & {
  readonly label: string;
  readonly tooltip?: ReactNode;
  readonly pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={pressed}
            data-pressed={pressed ? "" : undefined}
            size="icon-xs"
            variant="ghost-muted"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export const RepositoryTabHeader = { Root, Path, Status, Action };
