import { useContext, type ComponentProps } from "react";

import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { ChatOwnerContext } from "./PaneSurfaceHost";
import { TabHeader } from "./TabHeader";

/** What makes ChatView's header the window's title bar, which a pane's header is not. */
const TITLEBAR_CLASSES = new Set([
  "drag-region",
  "wco:pr-(--workspace-native-controls-inset)",
  ...COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS.split(" "),
]);

/**
 * ChatView's `<header>`. Inside the panes the tab strip is the window's title bar, so it drops
 * what made it one (the drag region, the insets for a collapsed sidebar's toggle and the
 * window's controls) and starts with the tab's back and forward, as every pane tab's header does.
 */
export function PaneChatHeader({ className, children, ...props }: ComponentProps<"header">) {
  const inPanes = useContext(ChatOwnerContext) !== null;
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
    >
      <TabHeader.History className="me-2 sm:me-3" />
      {children}
    </header>
  );
}
