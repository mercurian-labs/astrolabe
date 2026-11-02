import {
  ArrowLeftIcon,
  BookOpenIcon,
  FolderGit2Icon,
  ChartNoAxesColumnIcon,
  MessagesSquare,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { AstrolabeMarkSmall } from "../brand/AstrolabeMarks";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { AccountMenu } from "./AccountMenu";
import {
  isPullRequestsPath,
  isSidebarUtilityPage,
  isRepositoriesPath,
  isWikisPath,
  useNavigateToAgents,
  useSectionPathname,
} from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    // The titlebar row, not a padded SidebarHeader: it aligns to the window controls.
    // Astrolabe: beside the icon rail it keeps the rail's colour (`index.css`).
    <div
      data-sidebar-chrome-header=""
      className={cn(
        // Astrolabe: its bottom border lines up with the tab strip's beside it.
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 border-b border-border pr-2",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label="Toggle main sidebar"
        />
      </div>
      {/* One visible line: the pill wraps onto the clipped second line once it no longer fits.
          The padding clears the window's own controls (beside the icon rail, the sidebar toggle
          is the rail's). Astrolabe: the rail's monogram stands for the brand, so the row holds
          no wordmark. */}
      <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5 md:pl-(--workspace-titlebar-content-left)">
        {pillLabel ? (
          <div data-environment-pill className="flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-2"
      ref={observeWidth}
    >
      {/* The narrowest sidebar: the monogram, then room for the title row's three buttons. */}
      <div className="ml-[var(--workspace-titlebar-content-left)] flex items-center gap-2">
        <AstrolabeMarkSmall className="h-3 shrink-0" />
        <div className="w-21 shrink-0" />
      </div>
    </div>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToAgents = useNavigateToAgents();
  const { isMobile, setOpenMobile } = useSidebar();
  // Settings and Usage open over a section, which keeps its footer.
  const sectionPathname = useSectionPathname();
  const isOnUtilityPage = isSidebarUtilityPage(sectionPathname);
  const isOnWikis = isWikisPath(sectionPathname);
  const isOnRepositories = isRepositoriesPath(sectionPathname);
  const isOnPullRequests = isPullRequestsPath(sectionPathname);
  const pullRequestsSupported = usePullRequestsSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };
  const handleWikisClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/wikis" });
  };
  const handleRepositoriesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/repositories" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToAgents();
  };

  // Astrolabe: on desktop the icon rail holds the sections, Agents among them as the way back,
  // and the update control above Settings, so the footer has no utility row.
  if (!isMobile) return null;

  // Where sign-in is set up, Settings is the account menu, and it stays beside Back so
  // signing in or out is reachable from the utility pages too.
  const accountMenu = hasCloudPublicConfig() ? (
    <SidebarMenuItem className="shrink-0">
      <AccountMenu side="top" onNavigate={closeMobileSidebar} />
    </SidebarMenuItem>
  ) : null;

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <>
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {accountMenu}
        </>
      ) : (
        <>
          {accountMenu ?? (
            <SidebarUtilityItem
              icon={<SettingsIcon />}
              label="Settings"
              onClick={handleSettingsClick}
            />
          )}
          {isOnWikis ? (
            <SidebarUtilityItem
              icon={<MessagesSquare />}
              label="Agents"
              onClick={handleBackClick}
            />
          ) : (
            <SidebarUtilityItem icon={<BookOpenIcon />} label="Wikis" onClick={handleWikisClick} />
          )}
          {isOnRepositories ? (
            <SidebarUtilityItem
              icon={<MessagesSquare />}
              label="Agents"
              onClick={handleBackClick}
            />
          ) : (
            <SidebarUtilityItem
              icon={<FolderGit2Icon />}
              label="Projects"
              onClick={handleRepositoriesClick}
            />
          )}
          {isOnPullRequests ? (
            <SidebarUtilityItem
              icon={<MessagesSquare />}
              label="Agents"
              onClick={handleBackClick}
            />
          ) : pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Changes"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter({
  showUndoNotice = false,
}: {
  showUndoNotice?: boolean;
}) {
  return (
    <SidebarFooter>
      {showUndoNotice ? <SidebarThreadUndoNotice /> : null}
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
