import type { EnvironmentId } from "@t3tools/contracts";
import { Plus, SquareDashed } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { SurfaceIcon, type PullRequestTabStatusSeed } from "~/components/RightPanelTabs";
import { useTheme } from "~/hooks/useTheme";
import { closeTab, isEmptyTab, newTab, surfaceIdOf } from "~/panes/arrangement";
import { createPanesController, type PanesController } from "~/panes/panesController";
import {
  PanesHostContext,
  PanesLayoutKeyContext,
  type PaneTabs,
  type PanesHost,
} from "~/panes/panesHost";
import { PaneTree } from "~/panes/PaneTree";
import type { StorageLike } from "~/panes/persistence";
import { NO_TAB_SELECTION, useTabSelectionStore } from "~/panes/tabSelection";
import { leaves, type Leaf } from "~/panes/tree";
import {
  PULL_REQUESTS_PANEL_REF,
  selectThreadRightPanelState,
  useRightPanelStore,
  type PullRequestSurface,
} from "~/rightPanelStore";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Astrolabe: the Pull Requests main area, open pull requests in tabs that split, as the Wikis
 * area holds documents (see `wikiPanes`). The tabs mirror the page's own right-panel record
 * (`PULL_REQUESTS_PANEL_REF`), which the page opens, activates and closes pull requests through,
 * so the list, the URL and the panes stay one selection. Each pane renders its front pull request.
 */
export interface PullRequestPanesProps {
  /** The detail of one open pull request; `active` says it is the focused pane's. */
  readonly renderDetail: (surface: PullRequestSurface, active: boolean) => ReactNode;
  /** A tab's title beyond its number, from the listed pull request when the list has it. */
  readonly titleOf: (surface: PullRequestSurface) => string | null;
  readonly statusSeeds: Readonly<Record<string, PullRequestTabStatusSeed>> | undefined;
  readonly environmentId: EnvironmentId | null;
  /** Closes a pull request the way the page does, keeping its URL in step. */
  readonly onClose: (surface: PullRequestSurface) => void;
  /** The focused pane's pull request changed, so the page's URL can follow it. */
  readonly onFocus: (surface: PullRequestSurface | null) => void;
  /** Shown in an empty tab. */
  readonly emptyState?: ReactNode;
}

const LAYOUT_KEY = "pull-requests";
const PullRequestPanesContext = createContext<PullRequestPanesProps | null>(null);

function usePullRequestPanesProps(): PullRequestPanesProps {
  const props = useContext(PullRequestPanesContext);
  if (!props) throw new Error("usePullRequestPanesProps must be used inside PullRequestPanes.");
  return props;
}

function deviceStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function surfaceOf(surfaceId: string | null): PullRequestSurface | null {
  if (surfaceId === null) return null;
  const surface = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    PULL_REQUESTS_PANEL_REF,
  ).surfaces.find((entry) => entry.id === surfaceId);
  return surface?.kind === "pull-request" ? surface : null;
}

function usePullRequestSurface(surfaceId: string | null): PullRequestSurface | null {
  return useRightPanelStore((state) => {
    if (surfaceId === null) return null;
    const surface = selectThreadRightPanelState(
      state.byThreadKey,
      PULL_REQUESTS_PANEL_REF,
    ).surfaces.find((entry) => entry.id === surfaceId);
    return surface?.kind === "pull-request" ? surface : null;
  });
}

export function PullRequestPanes(props: PullRequestPanesProps) {
  const [{ host, containerFor, prune, controller, setCloser }] = useState(createPullRequestHost);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useLayoutEffect(() => {
    setCloser(props.onClose);
  });
  useLayoutEffect(() => {
    controller.load(PULL_REQUESTS_PANEL_REF, LAYOUT_KEY);
  }, [controller]);
  // After the load, so it subscribes to a loaded arrangement; paired with its own cleanup.
  useLayoutEffect(() => controller.follow(), [controller]);
  useEffect(() => {
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    const save = () => controller.flush();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [controller]);

  // The page's URL follows the focused pane's pull request. Nothing is reported before a pull
  // request first shows, so a link naming one is not cleared while it opens.
  const focusedSurfaceId = snapshot?.record.activeSurfaceId ?? null;
  const { onFocus } = props;
  const reported = useRef(false);
  useEffect(() => {
    if (focusedSurfaceId === null && !reported.current) return;
    reported.current = true;
    onFocus(surfaceOf(focusedSurfaceId));
  }, [focusedSurfaceId, onFocus]);

  // Each pane renders the pull request in its front tab; tabs behind it are mounted when shown.
  // The record's surfaces are read through the store; a change to them changes the snapshot.
  const fronts =
    snapshot === null
      ? []
      : leaves(snapshot.arrangement.root).flatMap(({ active: key }) => {
          const surface = surfaceOf(surfaceIdOf(key));
          return surface ? [{ key, surface }] : [];
        });
  useEffect(() => {
    prune(new Set(fronts.map((front) => front.key)));
  }, [fronts, prune]);

  return (
    <PullRequestPanesContext.Provider value={props}>
      <PanesHostContext.Provider value={host}>
        <PanesLayoutKeyContext.Provider value={LAYOUT_KEY}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
            {snapshot ? <PaneTree snapshot={snapshot} panelMaximized /> : null}
          </div>
          {fronts.map(({ key, surface }) =>
            createPortal(
              props.renderDetail(surface, surface.id === focusedSurfaceId),
              containerFor(key),
              key,
            ),
          )}
        </PanesLayoutKeyContext.Provider>
      </PanesHostContext.Provider>
    </PullRequestPanesContext.Provider>
  );
}

/**
 * The panes' host. A pane's front tab renders into its own container, which the pane takes in;
 * the containers of tabs no pane shows are dropped, as the right panel drops all but its one
 * surface.
 */
function createPullRequestHost() {
  const controller: PanesController = createPanesController(deviceStorage());
  const containers = new Map<string, HTMLDivElement>();
  let closer: ((surface: PullRequestSurface) => void) | null = null;
  const containerFor = (key: string) => {
    let container = containers.get(key);
    if (!container) {
      container = document.createElement("div");
      container.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
      container.dataset.pullRequestTab = key;
      containers.set(key, container);
    }
    return container;
  };
  const prune = (shown: ReadonlySet<string>) => {
    for (const [key, container] of containers) {
      if (shown.has(key)) continue;
      container.remove();
      containers.delete(key);
    }
  };
  const close = (tabKey: string) => {
    const surface = surfaceOf(surfaceIdOf(tabKey));
    if (surface && closer) closer(surface);
    else controller.update((arrangement) => closeTab(arrangement, tabKey));
  };
  const tabs: PaneTabs = {
    useLabel: usePullRequestTabLabel,
    close,
    NewTab: NewTabButton,
    place(slot: HTMLElement, leaf: Leaf) {
      if (isEmptyTab(leaf.active)) return;
      const container = containerFor(leaf.active);
      // Moving a node that is already in place would still detach and reattach it.
      if (container.parentNode !== slot) slot.appendChild(container);
    },
    Overlay: EmptyTabOverlay,
    reservesTopRight: false,
  };
  const host: PanesHost = { controller, tabs };
  return {
    host,
    controller,
    containerFor,
    prune,
    setCloser(next: (surface: PullRequestSurface) => void) {
      closer = next;
    },
  };
}

function usePullRequestTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const { titleOf, statusSeeds, environmentId } = usePullRequestPanesProps();
  const surface = usePullRequestSurface(surfaceIdOf(tabKey));
  const { resolvedTheme } = useTheme();
  if (!surface) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  const title = titleOf(surface);
  return {
    title: title ? `#${surface.number} ${title}` : `#${surface.number}`,
    icon: (
      <SurfaceIcon
        surface={surface}
        previewUrl={null}
        previewCapturedUrl={null}
        theme={resolvedTheme}
        environmentId={(surface.environmentId as EnvironmentId | undefined) ?? environmentId}
        pullRequestStatusSeed={statusSeeds?.[surface.id]}
      />
    ),
  };
}

function NewTabButton({ paneId }: { readonly paneId: string }) {
  const { controller } = useContext(PanesHostContext)!;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="New tab"
            className="shrink-0"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => controller.update((arrangement) => newTab(arrangement, paneId))}
          />
        }
      >
        <Plus className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">New tab</TooltipPopup>
    </Tooltip>
  );
}

function EmptyTabOverlay({ leaf }: { readonly leaf: Leaf }) {
  const { emptyState } = usePullRequestPanesProps();
  if (!isEmptyTab(leaf.active)) return null;
  return (
    emptyState ?? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No pull request open</EmptyTitle>
          <EmptyDescription>Open a pull request from the sidebar.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  );
}
