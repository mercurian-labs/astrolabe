import { useContext, type ComponentProps } from "react";

import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { ChatOwnerContext } from "./PaneSurfaceHost";

/** What makes ChatView's header the window's title bar, which a pane's header is not. */
const TITLEBAR_CLASSES = new Set([
  "drag-region",
  "wco:pr-(--workspace-native-controls-inset)",
  ...COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS.split(" "),
]);

/**
 * ChatView's `<header>`. Inside the panes the tab strip is the window's title bar, so it drops
 * what made it one: the drag region, and the insets for a collapsed sidebar's toggle and the
 * window's controls. It has no back and forward: a chat never shows anything else in its place.
 */
export function PaneChatHeader({ className, ...props }: ComponentProps<"header">) {
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
    />
  );
}
