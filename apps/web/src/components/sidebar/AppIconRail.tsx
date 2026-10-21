import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChartNoAxesColumnIcon, MessagesSquare, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { usePullRequestsSupported } from "~/state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useNavigateToMainApp } from "./mainAppLocation";

/**
 * The far-left icon rail: the app's sections on top (Threads, for now), and Pull Requests,
 * Usage and Settings at the foot, which the sidebar's footer used to hold. It runs from below
 * the title bar to the window's bottom edge and stays when the sidebar collapses; the sidebar
 * opens beside it (see `AppSidebarLayout`). The cell above it is the sidebar's part of the title
 * bar, drawn as the sidebar's own: beside the sidebar's header while it is open, and holding the
 * sidebar toggle while it is collapsed. The title bar runs unbroken across it; the rail's edge
 * starts at the title bar's bottom border. Narrow windows, where the sidebar is a sheet, have no rail.
 */
export function AppIconRail() {
  const isMobile = useIsMobile();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const pullRequestsSupported = usePullRequestsSupported();
  if (isMobile) return null;

  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const onUsage = pathname === "/usage";
  const onPullRequests = pathname === "/pull-requests";
  const onThreads =
    !onSettings && !onUsage && !onPullRequests && !pathname.startsWith("/projects/");

  return (
    <>
      <div
        aria-hidden
        data-app-rail-cap=""
        className={cn(
          "fixed top-0 left-0 h-(--workspace-topbar-height) w-11 border-b border-border bg-sidebar",
          isElectron && "drag-region",
        )}
      />
      <nav
        aria-label="Sections"
        data-app-rail=""
        className="fixed top-(--workspace-topbar-height) bottom-0 left-0 z-20 flex w-11 flex-col items-center border-r border-border bg-sidebar py-2"
      >
        <SidebarMenu className="items-center">
          <RailItem
            label="Threads"
            icon={<MessagesSquare />}
            active={onThreads}
            onClick={() => void navigateToMainApp()}
          />
        </SidebarMenu>
        <SidebarMenu className="mt-auto items-center">
          {pullRequestsSupported ? (
            <RailItem
              label="Pull Requests"
              icon={<PullRequestGlyph.pullRequest />}
              active={onPullRequests}
              onClick={() =>
                void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
              }
            />
          ) : null}
          <RailItem
            label="Usage"
            icon={<ChartNoAxesColumnIcon />}
            active={onUsage}
            onClick={() => void navigate({ to: "/usage" })}
          />
          <RailItem
            label="Settings"
            icon={<SettingsIcon />}
            active={onSettings}
            onClick={() => void navigate({ to: "/settings" })}
          />
        </SidebarMenu>
      </nav>
    </>
  );
}

/** One section: an icon with its name in a tooltip, marked by a bar on the rail's edge when current. */
function RailItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="relative">
      {active ? (
        <span
          aria-hidden
          className="absolute inset-y-2 -start-1.5 w-0.5 rounded-full bg-sidebar-foreground"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              aria-current={active ? "page" : undefined}
              isActive={active}
              onClick={onClick}
              size="icon"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="right">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
