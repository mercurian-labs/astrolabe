/**
 * The sidebar's actions: search, project scope and new thread, as a group of
 * icon buttons at the end of the sidebar's titlebar row, opposite its toggle.
 *
 * Search opens the command palette rather than holding a field of its own, so
 * the thread list starts directly under the titlebar. While the sidebar is
 * collapsed, search and project scope follow the toggle into the main area's
 * titlebar through `SidebarCollapsedActionsSlot`.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. The scope icon swaps to the project favicon
 * while a project is selected, so the header still names the scope.
 */
import { FolderPlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation } from "@tanstack/react-router";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";
import { SidebarMenuButton, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isSidebarUtilityPage } from "./mainAppLocation";

export interface SidebarThreadHeaderProps {
  /** Without projects there is nothing to scope, so the scope picker stays out. */
  hasProjects: boolean;
  /** The project scope combobox, rendered between search and new thread. */
  projectScope: ReactNode;
  onSearch: () => void;
  searchShortcutLabel: string | null | undefined;
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
}

export function SidebarThreadHeader(props: SidebarThreadHeaderProps) {
  const { isMobile, open } = useSidebar();
  const slot = useSyncExternalStore(subscribeSlot, getSlot, () => null);
  if (!isMobile && !open && slot) {
    return createPortal(<SidebarThreadActions {...props} collapsed />, slot);
  }
  return <SidebarThreadActions {...props} collapsed={false} />;
}

function SidebarThreadActions({
  hasProjects,
  projectScope,
  onSearch,
  searchShortcutLabel,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  collapsed,
}: SidebarThreadHeaderProps & { collapsed: boolean }) {
  // Astrolabe: in the title bar of a page that lists no threads (Settings, Usage, Pull Requests),
  // the project filter has nothing to filter, so the collapsed actions leave it out.
  const onUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";
  return (
    <div className="flex shrink-0 items-center">
      <SidebarHeaderIconButton
        label="Search"
        tooltip={searchShortcutLabel ? `Search (${searchShortcutLabel})` : "Search"}
        onClick={onSearch}
      >
        <SearchIcon />
      </SidebarHeaderIconButton>
      {hasProjects && !(collapsed && onUtilityPage) ? projectScope : null}
      {collapsed ? null : (
        <SidebarHeaderIconButton
          label="New thread"
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  New thread in current project: Shift+click
                  {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon />
        </SidebarHeaderIconButton>
      )}
    </div>
  );
}

/** The project picker's last row: adding a project, which used to be its own header button. */
export function SidebarNewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="border-t border-border p-1">
      <button
        type="button"
        className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent sm:min-h-7 sm:text-sm"
        onClick={onClick}
      >
        <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
        New project
      </button>
    </div>
  );
}

// Where the sidebar's actions land while it is collapsed: beside the toggle in the main area's
// titlebar. One slot per window, registered by the toggle's container.
let slotElement: HTMLElement | null = null;
const slotListeners = new Set<() => void>();
function subscribeSlot(listener: () => void) {
  slotListeners.add(listener);
  return () => slotListeners.delete(listener);
}
function getSlot() {
  return slotElement;
}
function setSlot(element: HTMLElement | null) {
  slotElement = element;
  for (const listener of slotListeners) listener();
}

/**
 * Sits after the sidebar toggle while the sidebar is collapsed. It publishes its width as
 * `--workspace-collapsed-sidebar-actions`, so titlebars that inset for the toggle clear the
 * actions too.
 */
export function SidebarCollapsedActionsSlot() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    setSlot(element);
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize[0]?.inlineSize ?? element.offsetWidth;
      root.style.setProperty("--workspace-collapsed-sidebar-actions", `${width}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--workspace-collapsed-sidebar-actions");
      if (slotElement === element) setSlot(null);
    };
  }, [element]);
  return (
    <div
      ref={setElement}
      className="pointer-events-auto flex items-center empty:hidden [-webkit-app-region:no-drag]"
    />
  );
}

/**
 * Icon button with a tooltip, sized for the header's group. Spreads unknown props through so it
 * can serve as a popup trigger's render target, which injects its own handlers, ref and aria
 * state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  /** Accessible name; also the tooltip unless `tooltip` says more. */
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        {/* Coarse-pointer hit area, matching the rest of the sidebar chrome. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
