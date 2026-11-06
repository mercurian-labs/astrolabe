import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { type RightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { parseChatSurfaceKey } from "../sectionTabs/sectionTabs";
import { useMaximizedPaneId, useMaximizedPaneStore } from "./maximize";
import type { PanelProps } from "./panesController";
import { PaneTabKeyContext, useChatOwner, useWorkspaceHost } from "./PaneSurfaceHost";
import {
  useLiveSurfaceKeys,
  useTabPaneId,
  useWorkspaceFront,
  useWorkspaceHostPaneId,
  workspace,
  WORKSPACE_LAYOUT_KEY,
} from "./workspace";

/**
 * Whether a maximized pane fills the panes over the one showing this surface. A browser's webview
 * floats above the app at its pane's position, so a pane can't cover it.
 */
export function useLiveSurfaceCovered(): boolean {
  const maximized = useMaximizedPaneId();
  const paneId = useTabPaneId(useContext(PaneTabKeyContext));
  return maximized !== null && paneId !== null && maximized !== paneId;
}

/**
 * Astrolabe: ChatView's right panel inside the shared panes, with no frame: the thread's surfaces
 * are tabs linked to its chat. While its chat is in front this lends the panes ChatView's panel
 * props and renders every surface in front of a pane into its tab's container; maximizing
 * maximizes the pane of the active one.
 */
export function LinkedPanel({
  renderSurface,
  ...props
}: PanelProps & { readonly renderSurface: (surface: RightPanelSurface) => ReactNode }) {
  const host = useWorkspaceHost();
  const owner = useChatOwner();
  const front = useWorkspaceFront();
  const inFront = owner !== null && owner === front;
  const given = useRef<PanelProps | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lends ChatView's latest props to the panes' store
  useLayoutEffect(() => {
    if (!inFront) return;
    given.current = props;
    workspace.setPanel(props);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes them back as ChatView goes
  useLayoutEffect(
    () => () => {
      if (given.current) workspace.clearPanel(given.current);
    },
    [],
  );
  const hostPaneId = useWorkspaceHostPaneId();
  // T3 Code's maximize fills the window with the panel; here the pane showing it fills the panes.
  const maximized = inFront && props.maximized === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps T3 Code's maximize and the pane's in step
  useLayoutEffect(() => {
    if (!maximized || hostPaneId === null) return;
    const store = useMaximizedPaneStore.getState();
    const now = store.maximized;
    if (now?.layoutKey !== WORKSPACE_LAYOUT_KEY || now.paneId !== hostPaneId) {
      store.toggle(WORKSPACE_LAYOUT_KEY, hostPaneId);
    }
    // Restoring the pane from its own control ends the panel's maximize too.
    const stop = useMaximizedPaneStore.subscribe((state) => {
      if (state.maximized?.paneId === hostPaneId) return;
      const ref = workspace.frontRef();
      if (ref) useRightPanelStore.getState().setMaximized(ref, false);
    });
    return () => {
      stop();
      const left = useMaximizedPaneStore.getState();
      if (
        left.maximized?.layoutKey === WORKSPACE_LAYOUT_KEY &&
        left.maximized.paneId === hostPaneId
      ) {
        left.restore();
      }
    };
  }, [hostPaneId, maximized]);
  const liveKeys = useLiveSurfaceKeys(owner);
  if (!inFront || host === null) return null;
  return liveKeys.flatMap((key) => {
    const surface = props.surfaces.find(({ id }) => id === parseChatSurfaceKey(key)?.surfaceId);
    if (!surface) return [];
    return [
      createPortal(
        <PaneTabKeyContext value={key}>{renderSurface(surface)}</PaneTabKeyContext>,
        host.containerFor(key),
        key,
      ),
    ];
  });
}
