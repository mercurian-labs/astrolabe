import { useContext, type ComponentProps } from "react";

import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { RightPanelHostContext } from "./PaneSurfaceHost";

/** What makes ChatView's header the window's title bar, which a pane's header is not. */
const TITLEBAR_CLASSES = new Set([
  "drag-region",
  ...COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS.split(" "),
]);

/**
 * ChatView's header bar, T3 Code's own `<header>` as drawn. Inside the panes each thread, the
 * host's or a guest's, keeps it at the top of its own tab, panel controls and all; the tab
 * strip above is the window's title bar, so the header drops what made it one: the drag region,
 * and the inset that clears a collapsed sidebar's toggle.
 */
export function PaneChatHeader({ className, ...props }: ComponentProps<"header">) {
  const inPanes = useContext(RightPanelHostContext) !== null;
  return (
    <header
      className={
        inPanes
          ? className
              ?.split(" ")
              .filter((name) => !TITLEBAR_CLASSES.has(name))
              .join(" ")
          : className
      }
      {...props}
    />
  );
}
