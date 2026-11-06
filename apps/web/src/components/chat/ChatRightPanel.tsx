import type { ReactNode } from "react";

import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import type { RightPanelSurface } from "../../rightPanelStore";
import { RightPanelSheet } from "../RightPanelSheet";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";
import { LinkedPanel } from "../../panes/LinkedPanel";
import { useWorkspaceHost } from "../../panes/PaneSurfaceHost";

type ChatRightPanelProps = Omit<RightPanelTabsProps, "mode" | "inlineSize" | "maximized"> & {
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly workspaceLayoutElement: HTMLElement | null;
  readonly widthStorageKey: string;
  readonly sheetAnimationDurationMs: number;
  readonly onCloseSheet: () => void;
  /** Astrolabe: a surface's content, for the shared panes, which show several at once. */
  readonly renderSurface: (surface: RightPanelSurface) => ReactNode;
};

/**
 * The right panel, inline beside the chat column or as a sheet on narrow
 * layouts. Its width follows a resize drag every frame, so the width state
 * lives here rather than in ChatView.
 */
export function ChatRightPanel(props: ChatRightPanelProps) {
  const {
    sheet,
    workspaceLayoutElement,
    widthStorageKey,
    sheetAnimationDurationMs,
    onCloseSheet,
    maximized,
    layoutControls,
    renderSurface,
    ...tabs
  } = props;
  const inlineSize = usePreviewPanelInlineSize({
    container: workspaceLayoutElement,
    widthStorageKey,
  });
  // Astrolabe: inside the shared panes, the thread's surfaces are tabs linked to its chat.
  const linked = useWorkspaceHost() !== null;
  if (linked) {
    return (
      <LinkedPanel {...tabs} mode="inline" maximized={maximized} renderSurface={renderSurface} />
    );
  }
  if (!sheet) {
    return <RightPanelTabs {...tabs} mode="inline" maximized={maximized} inlineSize={inlineSize} />;
  }
  return (
    <RightPanelSheet
      animationDurationMs={sheetAnimationDurationMs}
      open={tabs.open === true}
      onClose={onCloseSheet}
    >
      <RightPanelTabs
        {...tabs}
        mode="sheet"
        inlineSize={inlineSize}
        layoutControls={layoutControls}
      />
    </RightPanelSheet>
  );
}
