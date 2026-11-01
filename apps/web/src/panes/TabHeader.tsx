import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";

/**
 * Astrolabe: the row across the top of a pane's tab, drawn as a chat's header is: the strip's
 * height and no border, a breadcrumb, a quiet status and ghost icon actions. Like the chat's
 * timeline, the scroll element below takes `topbar-scroll-fade` with a top inset of
 * `--workspace-titlebar-scroll-fade-height`, so what scrolls up fades out under the header.
 */
function Root({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-tab-header
      className={cn(
        "flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-2 bg-background pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) sm:gap-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The chat header's breadcrumb: where the tab's page lives, muted, then the page in the
 * foreground. The muted part gives way first, so the page keeps its name.
 */
function Title({
  label,
  parent,
  keepParentEnd = false,
  children,
}: {
  readonly label: string;
  readonly parent?: string | null;
  /** Cuts the parent from its start, so its nearest part stays, as a folder path's does. */
  readonly keepParentEnd?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceBreadcrumb
      ariaLabel={label}
      className="flex-1 overflow-clip [overflow-clip-margin:2px]"
    >
      {parent ? (
        <>
          <WorkspaceBreadcrumbItem className="shrink">
            {keepParentEnd ? (
              <WorkspaceBreadcrumbText className="[direction:rtl]">
                <bdi>{parent}</bdi>
              </WorkspaceBreadcrumbText>
            ) : (
              <WorkspaceBreadcrumbText>{parent}</WorkspaceBreadcrumbText>
            )}
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator>
            <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="max-w-full shrink-0">
        {typeof children === "string" ? (
          <WorkspaceBreadcrumbText>{children}</WorkspaceBreadcrumbText>
        ) : (
          children
        )}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

/** A repository-relative path: its folder muted, the file's name in the foreground. */
function Path({ path }: { readonly path: string }) {
  const cut = path.lastIndexOf("/");
  return (
    <Title label="File path" parent={cut > 0 ? path.slice(0, cut) : null} keepParentEnd>
      {path.slice(cut + 1)}
    </Title>
  );
}

function Status({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Actions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}

/**
 * An action, as the chat header's panel controls are: a ghost icon button named by its tooltip,
 * or with `pressed` a ghost toggle.
 */
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
  const { onClick, disabled } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pressed === undefined ? (
            <Button aria-label={label} size="icon-sm" variant="ghost" {...props} />
          ) : (
            <Toggle
              aria-label={label}
              size="sm"
              variant="ghost"
              pressed={pressed}
              disabled={disabled}
              onClick={onClick}
            />
          )
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export const TabHeader = { Root, Title, Path, Status, Actions, Action };
