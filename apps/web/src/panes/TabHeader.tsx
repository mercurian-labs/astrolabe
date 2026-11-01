import { Fragment, type ComponentProps, type ReactNode } from "react";

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

/** The chat header's breadcrumb: `trail` muted, then what the tab shows in the foreground. */
function Title({
  label,
  trail = [],
  children,
}: {
  readonly label: string;
  readonly trail?: ReadonlyArray<string>;
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceBreadcrumb
      ariaLabel={label}
      className="flex-1 overflow-clip [overflow-clip-margin:2px]"
    >
      {trail.map((part, index) => (
        <Fragment key={trail.slice(0, index + 1).join("/")}>
          <WorkspaceBreadcrumbItem className="shrink">
            <WorkspaceBreadcrumbText>{part}</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator>
            <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
        </Fragment>
      ))}
      {/* Folders give way first, so the last part keeps its name. */}
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

/** A repository-relative path as a breadcrumb: its folders muted, the file's name after them. */
function Path({ path }: { readonly path: string }) {
  const parts = path.split("/").filter((part) => part.length > 0);
  return (
    <Title label="File path" trail={parts.slice(0, -1)}>
      {parts.at(-1) ?? path}
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
