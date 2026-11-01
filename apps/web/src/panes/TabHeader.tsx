import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useContext, type ComponentProps, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { PaneTabKeyContext } from "./PaneSurfaceHost";
import { useWorkspaceTabHistory, workspace } from "./workspace";

/**
 * Astrolabe: a pane tab's header row, drawn as a chat's: no border, the tab's back and forward,
 * a breadcrumb, a quiet status and ghost icon actions. The scroll element below takes
 * `topbar-scroll-fade` with a top inset of `--workspace-titlebar-scroll-fade-height`.
 */
function Root({ className, children, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-tab-header
      className={cn(
        "flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-2 bg-background pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) sm:gap-3",
        className,
      )}
      {...props}
    >
      <History />
      {children}
    </header>
  );
}

/**
 * Back and forward through what this tab showed, as Obsidian's tab headers start: the tab whose
 * header they sit in, focused or not, faint with nothing that way. Nothing outside the shared
 * panes.
 */
function History({ className }: { readonly className?: string }) {
  const tabKey = useContext(PaneTabKeyContext);
  return tabKey === null ? null : <TabHistory tabKey={tabKey} className={className} />;
}

function TabHistory({
  tabKey,
  className,
}: {
  readonly tabKey: string;
  readonly className?: string | undefined;
}) {
  const { canGoBack, canGoForward } = useWorkspaceTabHistory(tabKey);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const tooltip = (text: string, command: "navigation.back" | "navigation.forward") => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? `${text} (${shortcut})` : text;
  };
  return (
    <div className={cn("flex shrink-0 items-center", className)} data-tab-history>
      <Action
        label="Back"
        tooltip={tooltip("Back", "navigation.back")}
        disabled={!canGoBack}
        onClick={() => workspace.step("back", tabKey)}
      >
        <ArrowLeftIcon className="size-4" />
      </Action>
      <Action
        label="Forward"
        tooltip={tooltip("Forward", "navigation.forward")}
        disabled={!canGoForward}
        onClick={() => workspace.step("forward", tabKey)}
      >
        <ArrowRightIcon className="size-4" />
      </Action>
    </div>
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
      // Named apart from the landmarks its label shares a word with, as the Changes sidebar's.
      ariaLabel={`${label} breadcrumb`}
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

export const TabHeader = { Root, History, Title, Path, Status, Actions, Action };
