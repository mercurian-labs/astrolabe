import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useRightPanelStore } from "../rightPanelStore";
import { useMaximizedPaneStore } from "./maximize";
import type { PanelProps } from "./panesController";
import { useChatOwner, useWorkspaceHost } from "./PaneSurfaceHost";
import {
  useWorkspaceFront,
  useWorkspaceHostPaneId,
  workspace,
  WORKSPACE_LAYOUT_KEY,
} from "./workspace";

/**
 * Astrolabe: ChatView's right panel inside the shared panes. There is no panel frame: the
 * thread's surfaces are tabs linked to its chat, standing wherever they were put. While its chat
 * is the one in front, this hands the panes ChatView's panel props (labels, adding and closing
 * surfaces) and renders the live surface into the pane showing its tab. Maximizing the panel
 * maximizes that pane.
 */
export function LinkedPanel(props: PanelProps) {
  const host = useWorkspaceHost();
  const owner = useChatOwner();
  const front = useWorkspaceFront();
  const inFront = owner !== null && owner === front;
  const given = useRef<PanelProps | null>(null);
  useLayoutEffect(() => {
    if (!inFront) return;
    given.current = props;
    workspace.setPanel(props);
  });
  useLayoutEffect(
    () => () => {
      if (given.current) workspace.clearPanel(given.current);
    },
    [],
  );
  const hostPaneId = useWorkspaceHostPaneId();
  // T3 Code's maximize fills the window with the panel; here the pane showing it fills the panes.
  const maximized = inFront && props.maximized === true;
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
  if (!inFront || host === null) return null;
  return createPortal(props.children, host.surface);
}
