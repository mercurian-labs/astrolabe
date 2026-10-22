import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import { getLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentIdentificationMode, useLegacySidebarEnabled } from "../hooks/useSettings";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import LegacyThreadSidebar from "./LegacySidebar";
import { useThreadVisitedMigration } from "../hooks/useThreadVisitedMigration";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { AppIconRail } from "./sidebar/AppIconRail";
import { SidebarBrandWidthProbe, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarCollapsedActionsSlot } from "./sidebar/SidebarThreadHeader";
import { SidebarTabHistory } from "./sidebar/SidebarTabHistory";
import { isRepositoriesPath, isWikisPath, MainAppLocationTracker } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { RepositorySidebar } from "./repositories/RepositorySidebar";
import { WikiSidebar } from "./wiki/WikiSidebar";
import { PullRequestsSidebar } from "./pullRequest/PullRequestsSidebar";
import { KeyboardNavigation } from "../keyboardNav/KeyboardNavigation";
import { WhichKey } from "../whichKey/WhichKey";
import { tabHistorySlot } from "../whichKey/handles";
import { useSidebarStageBackdropVariant } from "./SidebarStageBackdrop";
import { useProjects } from "../state/entities";
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

/**
 * Astrolabe: the icon rail's width (`w-11`). On desktop everything beside it starts this far in,
 * so title-bar content measured from the window's left edge is measured from here instead.
 */
const ICON_RAIL_WIDTH_PX = 44;

const SIDEBAR_BESIDE_RAIL_CLASS = cn(
  "left-11 group-data-[side=left]:border-r-0",
  "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border",
);

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

// getWindowFullscreenState is a synchronous IPC round trip, so the snapshot is cached
// and only re-read when a subscription starts.
let windowFullscreenSnapshot: boolean | null = null;

function macosDesktopBridge() {
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;
  return window.desktopBridge ?? null;
}

function subscribeToWindowFullscreen(onChange: () => void): () => void {
  const bridge = macosDesktopBridge();
  if (
    typeof bridge?.getWindowFullscreenState !== "function" ||
    typeof bridge.onWindowFullscreenStateChange !== "function"
  ) {
    return () => {};
  }
  const unsubscribe = bridge.onWindowFullscreenStateChange((fullscreen) => {
    windowFullscreenSnapshot = fullscreen;
    onChange();
  });
  // The window may have changed state between the first render and this subscription.
  windowFullscreenSnapshot = bridge.getWindowFullscreenState();
  return () => {
    unsubscribe();
    windowFullscreenSnapshot = null;
  };
}

function readWindowFullscreen(): boolean {
  if (windowFullscreenSnapshot === null) {
    const getWindowFullscreenState = macosDesktopBridge()?.getWindowFullscreenState;
    windowFullscreenSnapshot =
      typeof getWindowFullscreenState === "function" ? getWindowFullscreenState() : false;
  }
  return windowFullscreenSnapshot;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar, isMobile, mobileSheetMounted } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B for bold; the toggle stays
        // available everywhere else, including the plain-text composer.
        return;
      }
      if (
        resolveShortcutCommand(event, keybindings, { context: { usagePageOpen } }) !==
        "sidebar.toggle"
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "sidebar.toggle") toggleSidebar();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings, toggleSidebar, usagePageOpen]);

  // Astrolabe: beside the icon rail the toggle is the rail's (`AppIconRail`); the title bar keeps
  // only the section's back and forward while the sidebar is collapsed (the sidebar's header holds
  // them while it is open), where the main area's title bar content starts.
  if (!isMobile) {
    return (
      <div
        className="pointer-events-none fixed top-[var(--workspace-controls-top)] left-[calc(2.75rem+var(--workspace-titlebar-content-left))] z-50 flex h-[var(--workspace-topbar-height)] items-center"
        data-sidebar-control=""
      >
        {isSidebarVisible ? null : (
          <SidebarCollapsedActionsSlot gap>
            <SidebarTabHistory />
          </SidebarCollapsedActionsSlot>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        isMobile && mobileSheetMounted && "hidden",
      )}
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function routePanelsOpen(routeThreadRef: ReturnType<typeof useThreadRouteRef>) {
  if (!routeThreadRef) return { terminalOpen: false, previewOpen: false };
  return {
    terminalOpen: selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      routeThreadRef,
    ).terminalOpen,
    previewOpen:
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
      "preview",
  };
}

export function NavigationHistoryShortcuts() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          ...routePanelsOpen(routeThreadRef),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
          usagePageOpen,
        },
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      event.preventDefault();
      event.stopPropagation();
      // Astrolabe: in a section with tabs (Agents, Wikis), the tab in front's own history.
      const tabHistory = tabHistorySlot.get();
      if (tabHistory) {
        if (!event.repeat) tabHistory.go(command === "navigation.back" ? "back" : "forward");
        return;
      }
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, routeThreadRef, usagePageOpen]);

  return null;
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// Undoes the thread actions in the sidebar's notice. Mounted wherever the
// thread sidebar can show; Settings replaces it. Listens in the capture phase
// so mod+z reaches it before the composer's own undo handler consumes the key.
function ThreadUndoShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();
  // A collapsed sidebar hides the notice, so text fields keep their own undo.
  const noticeVisible = useSidebarVisibility();
  // Outlives the effect: undoing an archive navigates, which re-runs it mid-hold.
  const heldUndoKey = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key undoes once. Cancel its repeats so they cannot fall through
      // to the editor's own undo, even after the last notice is gone.
      if (event.repeat) {
        if (event.code === heldUndoKey.current) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      // A modifier tapped mid-hold leaves the held key repeating.
      if (!MODIFIER_KEYS.has(event.key)) heldUndoKey.current = null;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          ...routePanelsOpen(routeThreadRef),
          editableFocus:
            isEditableFocused(event.target) && !(noticeVisible && threadUndoClaimsShortcut()),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "thread.undo") {
        if (!MODIFIER_KEYS.has(event.key)) releaseThreadUndoShortcut();
        return;
      }
      if (isCommandPaletteOpen() || isModelPickerOpen()) return;
      if (undoLatestThreadAction()) {
        heldUndoKey.current = event.code;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Pastes from a menu, dictation and drops edit text without a keypress.
    const onInput = () => releaseThreadUndoShortcut();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("input", onInput, true);
    };
  }, [keybindings, noticeVisible, routeThreadRef]);

  return null;
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  useThreadVisitedMigration();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  // Astrolabe: Wikis is a section of its own, beside the threads, with its own sidebar.
  const isOnWikis = isWikisPath(pathname);
  // Astrolabe: and Repositories, a repository's files and changes.
  const isOnRepositories = isRepositoriesPath(pathname);
  // Astrolabe: so is Pull Requests, whose page fills its sidebar with the list.
  const isOnPullRequests = pathname === "/pull-requests";
  // Astrolabe: Usage has no sidebar. It shows collapsed there, and the toggle is gone, while the
  // other sections keep the open state the user left it in.
  const isOnUsage = pathname === "/usage";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const hasIconRail = !useIsMobile();
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
  // Astrolabe: the icon rail takes its width from the room the sidebar and the main area share.
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(
    viewportWidth - (hasIconRail ? ICON_RAIL_WIDTH_PX : 0),
    sidebarMinimumWidth,
  );
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const isWindowFullscreen = useSyncExternalStore(
    subscribeToWindowFullscreen,
    readWindowFullscreen,
  );
  const windowControlsInsetStyle = (
    isMacosDesktop && !isWindowFullscreen
      ? {
          "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET,
          // Astrolabe: the rail's sidebar toggle sits just after the window's buttons.
          "--rail-toggle-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET,
        }
      : {}
  ) as CSSProperties;
  const sidebarProviderStyle = {
    "--sidebar-width": `${clampThreadSidebarWidth(sidebarWidth, sidebarMinimumWidth, sidebarMaximumWidth)}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...(hasIconRail
      ? {
          // The sidebar toggle sits over the rail, so title-bar content clears only what reaches
          // past it: in the macOS desktop app, the window's buttons and the toggle after them.
          "--workspace-titlebar-content-left": `max(0.5rem, calc(var(--workspace-controls-left) + 2.25rem - ${ICON_RAIL_WIDTH_PX}px))`,
        }
      : {}),
    ...windowControlsInsetStyle,
  } as CSSProperties;

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        open={sidebarOpen && !isOnUsage}
        onOpenChange={(open) => {
          if (!isOnUsage) setSidebarOpen(open);
        }}
        style={sidebarProviderStyle}
      >
        <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
        <ProjectProjectionRetention />
        {/* The icon rail's room in the layout; the sidebar opens beside it. */}
        {hasIconRail ? <div aria-hidden className="w-11 shrink-0" /> : null}
        <Sidebar
          side="left"
          collapsible="offcanvas"
          data-app-sidebar=""
          role="navigation"
          aria-label={
            isOnSettings
              ? "Settings"
              : isOnWikis
                ? "Wikis"
                : isOnRepositories
                  ? "Repositories"
                  : isOnPullRequests
                    ? "Changes"
                    : "Agents"
          }
          resizable={{
            maxWidth: sidebarMaximumWidth,
            minWidth: sidebarMinimumWidth,
            shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
              nextWidth <= currentWidth ||
              wrapper.clientWidth - (hasIconRail ? ICON_RAIL_WIDTH_PX : 0) - nextWidth >=
                THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
            onResize: setSidebarWidth,
          }}
          style={windowControlsInsetStyle}
          // Astrolabe: beside the icon rail, its edge drawn the window's full height while it is
          // open, through the title bar, as Obsidian's is; collapsed, the rail covers it.
          {...(hasIconRail ? { className: SIDEBAR_BESIDE_RAIL_CLASS } : {})}
        >
          {isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : isOnWikis ? (
            <WikiSidebar />
          ) : isOnRepositories ? (
            <RepositorySidebar />
          ) : isOnPullRequests ? (
            <PullRequestsSidebar />
          ) : legacySidebarEnabled ? (
            <LegacyThreadSidebar routeReveal={sidebarRouteReveal} />
          ) : (
            <ThreadSidebar routeReveal={sidebarRouteReveal} />
          )}
          <SidebarRail
            onDoubleClick={resetSidebarWidth}
            // Astrolabe: its hover line lies over the sidebar's edge line, which is drawn inside
            // the sidebar, rather than beside it.
            {...(hasIconRail ? { className: "after:-translate-x-full" } : {})}
          />
        </Sidebar>
        {children}
        <AppIconRail />
        <SidebarControl />
        <NavigationHistoryShortcuts />
        {/* Astrolabe: the undo notice lives in the thread sidebar, which the other sections'
            sidebars replace. */}
        {isOnSettings || isOnWikis || isOnRepositories || isOnPullRequests ? null : (
          <ThreadUndoShortcut />
        )}
        <MainAppLocationTracker />
        {/* Astrolabe: the keyboard menu (mod+k, and Space as a leader key), and moving focus
            between the sidebar and the panes, and through the sidebar's list. */}
        <WhichKey />
        <KeyboardNavigation />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
