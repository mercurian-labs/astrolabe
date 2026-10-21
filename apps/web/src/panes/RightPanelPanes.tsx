import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { PreviewPanelShell } from "../components/preview/PreviewPanelShell";
import { useRightPanelStore } from "../rightPanelStore";
import type { PanelProps } from "./panesController";
import { useRightPanelHost } from "./PaneSurfaceHost";
import { PaneTree } from "./PaneTree";

/**
 * ChatView's right panel, drawn as panes: T3 Code's panel frame (width, resizing, maximizing),
 * holding the thread's surfaces as tabs that split. As T3 Code's panel does, it runs the
 * window's full height, its top strips sharing the title bar with the chat's tabs. It takes the props ChatView gives its
 * panel's strip, and renders the active surface's content into the pane showing its tab.
 */
export function RightPanelPanes(props: PanelProps) {
  const host = useRightPanelHost();
  const { controller } = host;
  useLayoutEffect(() => {
    controller.setPanel(props);
  });
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const hostPaneId = snapshot?.hostPaneId ?? null;
  const maximized = props.maximized === true;
  // The keyboard menu's full screen maximizes the panel too, as its maximize control does.
  const panel = useMemo(
    () => ({
      maximized,
      setMaximized: (next: boolean) => {
        const ref = controller.threadRef();
        if (ref) useRightPanelStore.getState().setMaximized(ref, next);
      },
    }),
    [controller, maximized],
  );
  // The active surface's content shows only in the pane showing its tab.
  useLayoutEffect(() => {
    if (hostPaneId === null) host.hide();
  }, [host, hostPaneId]);
  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.inlineSize ? { inlineSize: props.inlineSize } : {})}
    >
      {snapshot ? (
        <PaneTree
          snapshot={snapshot}
          panelMaximized={maximized}
          {...(props.open !== false ? { panel } : {})}
        />
      ) : null}
      {createPortal(props.children, host.surface)}
    </PreviewPanelShell>
  );
}
