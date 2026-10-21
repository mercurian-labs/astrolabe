import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { AstrolabeMarkSmall, AstrolabeWordmark } from "../brand/AstrolabeMarks";
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
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  actions,
}: {
  isElectron: boolean;
  /** Icon buttons at the row's end, opposite the sidebar toggle. */
  actions?: ReactNode;
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
  const [brandRow, setBrandRow] = useState<HTMLDivElement | null>(null);
  const wordmarkFits = useWordmarkFits(brandRow, pillLabel);

  return (
    // The titlebar row, not a padded SidebarHeader: it aligns to the window controls. Its end
    // keeps the sidebar's 8px inset, so the last action lines up with the rows and footer below.
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-2",
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
          The padding keeps the brand's focus ring inside the clip, and clears the sidebar toggle.
          The wordmark shows while it fits beside the pill, the monogram after. */}
      <div
        ref={setBrandRow}
        className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5 md:pl-(--workspace-titlebar-content-left)"
      >
        <SidebarBrand onBackdrop={backdropVariant !== null} wordmark={wordmarkFits} />
        {pillLabel ? (
          <div data-environment-pill className="flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          className={cn(
            "relative z-10 flex shrink-0 items-center",
            // Over the stage artwork the buttons keep their own colors on a glass surface.
            backdropVariant && "surface-glass rounded-lg p-px shadow-xs",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
});

// The wordmark's width at the header's 0.75rem height, from its canvas.
const WORDMARK_ASPECT = 373.52 / 59.74;
const WORDMARK_HEIGHT_REM = 0.75;

/** Whether the wordmark fits the brand row beside the environment pill, from measured widths. */
function useWordmarkFits(row: HTMLDivElement | null, pillLabel: string | null): boolean {
  const [fits, setFits] = useState(true);
  useEffect(() => {
    if (!row) return;
    const measure = () => {
      const style = getComputedStyle(row);
      const available =
        row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const pill = pillLabel ? row.querySelector<HTMLElement>("[data-environment-pill]") : null;
      const needed =
        WORDMARK_HEIGHT_REM * rem * WORDMARK_ASPECT +
        (pill ? parseFloat(style.columnGap) + pill.offsetWidth : 0);
      setFits(available >= needed);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    // The pill changes width with its label, without resizing the row.
    const pill = pillLabel ? row.querySelector("[data-environment-pill]") : null;
    if (pill) observer.observe(pill);
    return () => observer.disconnect();
  }, [row, pillLabel]);
  return fits;
}

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
      {/* The narrowest header: the monogram, then the three action buttons. */}
      <div className="ml-[var(--workspace-titlebar-content-left)] flex items-center gap-2">
        <AstrolabeMarkSmall className="h-3 shrink-0" />
        <div className="w-21 shrink-0" />
      </div>
    </div>
  );
}

function SidebarBrand({ onBackdrop, wordmark }: { onBackdrop: boolean; wordmark: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      {/* As tall as the drawn sidebar toggle icon beside it. */}
      {wordmark ? (
        <AstrolabeWordmark small label="Astrolabe" onDark={onBackdrop} className="h-3 shrink-0" />
      ) : (
        <AstrolabeMarkSmall label="Astrolabe" onDark={onBackdrop} className="h-3 shrink-0" />
      )}
    </Link>
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

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
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

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull Requests"
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

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarThreadUndoNotice />
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
