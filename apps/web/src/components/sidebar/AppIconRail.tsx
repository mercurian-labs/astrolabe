import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PanelLeft, PanelLeftClose } from "lucide";
import { BookOpenIcon, ChartNoAxesColumnIcon, MessagesSquare, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { MorphIcon } from "../MorphIcon";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { usePullRequestsSupported } from "~/state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  useSidebarVisibility,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isWikisPath, useNavigateToMainApp } from "./mainAppLocation";

/** One of the app's sections, as the icon rail and the keyboard menu's Go to offer it. */
interface AppSection {
  readonly id: "threads" | "wikis" | "pull-requests" | "usage" | "settings";
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly open: () => void;
  /** The rail's foot holds it, rather than its top. */
  readonly foot: boolean;
}

/**
 * The app's sections: Threads and Wikis, then Pull Requests (where a server supports them),
 * Usage and Settings. Each opens as the rail's button does.
 */
export function useAppSections(): readonly AppSection[] {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const pullRequestsSupported = usePullRequestsSupported();

  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const onUsage = pathname === "/usage";
  const onPullRequests = pathname === "/pull-requests";
  const onWikis = isWikisPath(pathname);
  const onThreads =
    !onSettings && !onUsage && !onPullRequests && !onWikis && !pathname.startsWith("/projects/");

  return [
    {
      id: "threads",
      label: "Threads",
      icon: <MessagesSquare />,
      active: onThreads,
      open: () => void navigateToMainApp(),
      foot: false,
    },
    {
      id: "wikis",
      label: "Wikis",
      icon: <BookOpenIcon />,
      active: onWikis,
      open: () => void navigate({ to: "/wikis" }),
      foot: false,
    },
    ...(pullRequestsSupported
      ? [
          {
            id: "pull-requests" as const,
            label: "Pull Requests",
            icon: <PullRequestGlyph.pullRequest />,
            active: onPullRequests,
            open: () =>
              void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() }),
            foot: false,
          },
        ]
      : []),
    {
      id: "usage",
      label: "Usage",
      icon: <ChartNoAxesColumnIcon />,
      active: onUsage,
      open: () => void navigate({ to: "/usage" }),
      foot: true,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon />,
      active: onSettings,
      open: () => void navigate({ to: "/settings" }),
      foot: true,
    },
  ];
}

/**
 * The far-left icon rail: the app's sections on top (Threads, Wikis and Pull Requests), and
 * Usage and Settings at the foot, which the sidebar's footer used to hold. It runs from below
 * the title bar to the window's bottom edge and stays when the sidebar collapses; the sidebar
 * opens beside it (see `AppSidebarLayout`), and the sidebar's toggle ends the foot, so it stays
 * in reach while the sidebar is collapsed. The cell above it is the rail's part of the title bar,
 * drawn as the rail. The title bar's bottom border stops at it, so the cell and the rail read as
 * one column; the rail's edge starts at that border's row, so the two lines meet square at the
 * sidebar's corner. Narrow windows, where the sidebar is a sheet, have no rail (the toggle sits
 * in the title bar there).
 * It is the leftmost of the places the focus moves go between, its buttons a list walked with
 * `j`/`k` (see `keyboardNav/`).
 */
export function AppIconRail() {
  const isMobile = useIsMobile();
  const sections = useAppSections();
  if (isMobile) return null;

  const item = (section: AppSection) => (
    <RailItem
      key={section.id}
      label={section.label}
      icon={section.icon}
      active={section.active}
      onClick={section.open}
    />
  );

  return (
    <>
      <div
        aria-hidden
        data-app-rail-cap=""
        className={cn(
          "fixed top-0 left-0 h-(--workspace-topbar-height) w-11 bg-sidebar",
          isElectron && "drag-region",
        )}
      />
      <nav
        aria-label="Sections"
        data-app-rail=""
        className="fixed top-[calc(var(--workspace-topbar-height)-1px)] bottom-0 left-0 z-20 flex w-11 flex-col items-center border-r border-border bg-sidebar py-2"
      >
        <SidebarMenu className="items-center">
          {sections.filter((section) => !section.foot).map(item)}
        </SidebarMenu>
        <SidebarMenu className="mt-auto items-center">
          {sections.filter((section) => section.foot).map(item)}
          <SidebarToggleItem />
        </SidebarMenu>
      </nav>
    </>
  );
}

/** The sidebar's toggle (`sidebar.toggle`), as the title bar held it before the rail did. */
function SidebarToggleItem() {
  const { toggleSidebar } = useSidebar();
  const open = useSidebarVisibility();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });
  return (
    <RailItem
      label="Toggle main sidebar"
      tooltip={`Toggle main sidebar${shortcutLabel ? ` (${shortcutLabel})` : ""}`}
      icon={<MorphIcon className="size-4" icon={open ? PanelLeftClose : PanelLeft} />}
      active={false}
      pressed={open}
      onClick={toggleSidebar}
    />
  );
}

/**
 * One section: an icon with its name in a tooltip, marked by a bar on the rail's edge when
 * current. The sidebar's toggle is one too, `pressed` while the sidebar is open.
 */
function RailItem({
  label,
  tooltip = label,
  icon,
  active,
  pressed,
  onClick,
}: {
  label: string;
  tooltip?: string;
  icon: ReactNode;
  active: boolean;
  pressed?: boolean;
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
              aria-pressed={pressed}
              isActive={active}
              onClick={onClick}
              size="icon"
              // Walked as a list from the keyboard (`placeLists.ts`), with the rows' ring.
              focusRing="light"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="right">{tooltip}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
