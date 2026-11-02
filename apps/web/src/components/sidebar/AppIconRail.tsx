import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PanelLeft, PanelLeftClose } from "lucide";
import {
  BookOpenIcon,
  ChartNoAxesColumnIcon,
  FolderGit2Icon,
  MessagesSquare,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { AstrolabeMarkSmall } from "../brand/AstrolabeMarks";
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
import { AccountMenu } from "./AccountMenu";
import {
  isPullRequestsPath,
  isRepositoriesPath,
  isWikisPath,
  useNavigateToAgents,
  useSectionPathname,
} from "./mainAppLocation";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

/** One of the app's sections, as the icon rail and the keyboard menu's Go to offer it. */
interface AppSection {
  readonly id: "threads" | "wikis" | "repositories" | "pull-requests" | "usage" | "settings";
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly open: () => void;
  /** The rail's foot holds it, rather than its top. */
  readonly foot: boolean;
}

/**
 * The app's sections: Agents and Wikis, then Change Requests (where a server supports pull
 * requests; it lists the wikis' change requests beside them) and
 * Usage, and Settings. Each opens as the rail's button does.
 */
export function useAppSections(): readonly AppSection[] {
  const pathname = useLocation({ select: (location) => location.pathname });
  // Settings and Usage open over a section, which stays the one its button marks.
  const sectionPathname = useSectionPathname();
  const navigate = useNavigate();
  const navigateToAgents = useNavigateToAgents();
  const pullRequestsSupported = usePullRequestsSupported();

  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const onUsage = pathname === "/usage";
  const onPullRequests = isPullRequestsPath(sectionPathname);
  const onWikis = isWikisPath(sectionPathname);
  const onRepositories = isRepositoriesPath(sectionPathname);
  const onThreads =
    !onPullRequests && !onWikis && !onRepositories && !sectionPathname.startsWith("/projects/");

  return [
    {
      id: "threads",
      label: "Agents",
      icon: <MessagesSquare />,
      active: onThreads,
      open: () => void navigateToAgents(),
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
    {
      id: "repositories",
      label: "Projects",
      icon: <FolderGit2Icon />,
      active: onRepositories,
      open: () => void navigate({ to: "/repositories" }),
      foot: false,
    },
    ...(pullRequestsSupported
      ? [
          {
            id: "pull-requests" as const,
            label: "Changes",
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
 * The far-left icon rail: monogram, sections, and at its foot Usage and Settings (the account menu
 * where sign-in is set up). It stays when the sidebar collapses; its title-bar cell keeps the
 * sidebar toggle in reach (after the macOS window buttons, `--rail-toggle-left`). Narrow windows,
 * where the sidebar is a sheet, have no rail. It is the leftmost focus place (`keyboardNav/`).
 */
export function AppIconRail() {
  const isMobile = useIsMobile();
  const sidebarOpen = useSidebarVisibility();
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
          "fixed top-0 left-0 flex h-(--workspace-topbar-height) w-11 items-center justify-center bg-sidebar",
          isElectron && "drag-region",
        )}
      />
      {/* The sidebar's toggle, centred in the cap, or just after the macOS window buttons. */}
      <div
        data-app-rail-toggle=""
        className="fixed top-[var(--workspace-controls-top)] left-(--rail-toggle-left,--spacing(1.5)) z-50 flex h-(--workspace-topbar-height) items-center [-webkit-app-region:no-drag]"
      >
        <SidebarMenu>
          <SidebarToggleItem />
        </SidebarMenu>
      </div>
      {sidebarOpen ? (
        // Where the open sidebar meets the rail and the title bar, its corner rounds as the tab
        // in front does: the rail's colour outside the curve, the sidebar's within.
        <div
          aria-hidden
          data-app-rail-corner=""
          className="pointer-events-none fixed top-[calc(var(--workspace-topbar-height)-1px)] left-[calc(--spacing(11)-1px)] z-30 size-[calc(var(--radius-md)+1px)] bg-sidebar"
        >
          <span className="absolute inset-0 rounded-tl-md border-t border-l border-border bg-(--astrolabe-canvas)" />
        </div>
      ) : (
        // With the sidebar collapsed, the content's top-left corner, where the rail's edge meets
        // the title bar's bottom border, rounds the same way: the rail's colour outside the
        // curve, the two borders joined along it, and whatever the content draws within.
        <div
          aria-hidden
          data-app-rail-corner="collapsed"
          className="pointer-events-none fixed top-[calc(var(--workspace-topbar-height)-1px)] left-[calc(--spacing(11)-1px)] z-30 size-[calc(var(--radius-md)+1px)]"
        />
      )}
      <nav
        aria-label="Sections"
        data-app-rail=""
        className="fixed top-[calc(var(--workspace-topbar-height)-1px)] bottom-0 left-0 z-20 flex w-11 flex-col items-center border-r border-border bg-sidebar py-2"
      >
        <div className="flex shrink-0 justify-center pb-1">
          <RailMark />
        </div>
        <SidebarMenu className="items-center">
          {sections.filter((section) => !section.foot).map(item)}
        </SidebarMenu>
        <SidebarMenu className="mt-auto items-center">
          <SidebarUpdatePill inRail />
          {sections
            .filter((section) => section.foot)
            .map((section) =>
              // Settings is the account menu wherever sign-in is set up.
              section.id === "settings" && hasCloudPublicConfig() ? (
                <SidebarMenuItem key={section.id} className="relative">
                  {section.active ? <ActiveBar /> : null}
                  <AccountMenu side="right" active={section.active} />
                </SidebarMenuItem>
              ) : (
                item(section)
              ),
            )}
        </SidebarMenu>
      </nav>
    </>
  );
}

/** The monogram on a tile as large as a rail button's square, so it heads their column. */
function RailMark() {
  return (
    <span
      data-app-rail-mark=""
      className="flex size-8 items-center justify-center rounded-md border border-border bg-background shadow-xs/5"
    >
      <AstrolabeMarkSmall className="h-5" />
    </span>
  );
}

/** The sidebar's toggle (`sidebar.toggle`), in the title bar's corner above the rail. */
function SidebarToggleItem() {
  const { toggleSidebar } = useSidebar();
  const open = useSidebarVisibility();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });
  // Usage has no sidebar to toggle (see `AppSidebarLayout`).
  if (usagePageOpen) return null;
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
      {active ? <ActiveBar /> : null}
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

function ActiveBar() {
  return (
    <span
      aria-hidden
      className="absolute inset-y-2 -start-1.5 w-0.5 rounded-full bg-sidebar-foreground"
    />
  );
}
