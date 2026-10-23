import type { ViewStyle } from "react-native";
import type { MobileThemeVariables } from "../../lib/mobileTheme";

export const THREAD_LIST_V2_MONO_FONT = "Menlo";
export const THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME = "px-5 py-2.5";
export const THREAD_LIST_V2_ROW_DIVIDERS = true;
export const THREAD_LIST_V2_SIDEBAR_ROW_STYLE = {
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
} satisfies ViewStyle;
export const THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE = {
  borderRadius: 12,
  overflow: "hidden",
} satisfies ViewStyle;

export const selectedThreadRowColors = {
  foregroundClassName: "text-thread-selected-foreground",
  mutedForegroundClassName: "text-thread-selected-foreground-muted",
  iconTintClassName: "accent-thread-selected-foreground",
  mutedIconTintClassName: "accent-thread-selected-foreground-muted",
};

/** A row's colours on the screen surface (not the sidebar), which read no theme values. */
export const THREAD_LIST_V2_SCREEN_ROW = {
  className: "bg-screen",
  interactionClassName: "bg-row-hover",
  foregroundClassName: "text-foreground",
  mutedForegroundClassName: "text-foreground-muted",
  tertiaryForegroundClassName: "text-foreground-tertiary",
  mutedIconTintClassName: "accent-foreground-muted",
  tertiaryIconTintClassName: "accent-foreground-tertiary",
} as const;

export function getThreadListV2NewBranchMenuTitle(_branch: string) {
  return "New thread on branch";
}

export function getThreadListV2RowAppearance(
  theme: MobileThemeVariables,
  sidebarPane: boolean,
  selected: boolean,
) {
  const selectedBackgroundColor = theme["--color-thread-selected"];
  const style: ViewStyle | undefined = sidebarPane
    ? {
        backgroundColor: selected ? selectedBackgroundColor : theme["--color-drawer"],
        borderRadius: THREAD_LIST_V2_SIDEBAR_ROW_STYLE.borderRadius,
      }
    : undefined;
  const swipeContainerStyle: ViewStyle | undefined = sidebarPane
    ? THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE
    : undefined;

  return {
    className: sidebarPane ? undefined : THREAD_LIST_V2_SCREEN_ROW.className,
    interactionClassName: sidebarPane
      ? "bg-thread-hover"
      : THREAD_LIST_V2_SCREEN_ROW.interactionClassName,
    interactionOpacity: selected ? 0 : 1,
    foregroundClassName: sidebarPane
      ? "text-drawer-foreground"
      : THREAD_LIST_V2_SCREEN_ROW.foregroundClassName,
    mutedForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : THREAD_LIST_V2_SCREEN_ROW.mutedForegroundClassName,
    tertiaryForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : THREAD_LIST_V2_SCREEN_ROW.tertiaryForegroundClassName,
    mutedIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : THREAD_LIST_V2_SCREEN_ROW.mutedIconTintClassName,
    tertiaryIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : THREAD_LIST_V2_SCREEN_ROW.tertiaryIconTintClassName,
    style,
    cardStyle: sidebarPane ? { ...style, ...THREAD_LIST_V2_SIDEBAR_ROW_STYLE } : undefined,
    swipeContainerStyle,
    swipeBackgroundColor: theme[sidebarPane ? "--color-drawer" : "--color-screen"],
    providerIconSurfaceColor: sidebarPane
      ? selected
        ? selectedBackgroundColor
        : theme["--color-drawer"]
      : theme["--color-screen"],
  };
}
