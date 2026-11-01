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
 * Astrolabe: ChatView's right panel inside the shared panes, with no frame: the thread's surfaces
 * are tabs linked to its chat. While its chat is in front this lends the panes ChatView's panel
 * props and renders the live surface into the pane showing it; maximizing maximizes that pane.
 */
export function LinkedPanel(props: PanelProps) {
  const host = useWorkspaceHost();
  const owner = useChatOwner();
  const front = useWorkspaceFront();
  const inFront = owner !== null && owner === front;
  const given = useRef<PanelProps | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- lends ChatView's latest props to the panes' store
  useLayoutEffect(() => {
    if (!inFront) return;
    given.current = props;
    workspace.setPanel(props);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- takes them back as ChatView goes
  useLayoutEffect(
    () => () => {
      if (given.current) workspace.clearPanel(given.current);
    },
    [],
  );
  const hostPaneId = useWorkspaceHostPaneId();
  // T3 Code's maximize fills the window with the panel; here the pane showing it fills the panes.
  const maximized = inFront && props.maximized === true;
  // oxlint-disable-next-line t3code/react-effect-budget -- keeps T3 Code's maximize and the pane's in step
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
