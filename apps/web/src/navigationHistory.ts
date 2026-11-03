import { tabHistorySlot } from "./whichKey/handles";

export type HistoryDirection = "back" | "forward";

// Astrolabe: the focused pane's tab in front walks its own history, as Mod+[ and Mod+] do.
export function canNavigateHistory(direction: HistoryDirection): boolean {
  const tabHistory = tabHistorySlot.get();
  if (tabHistory) return direction === "back" ? tabHistory.canGoBack : tabHistory.canGoForward;
  return direction === "back" ? window.navigation.canGoBack : window.navigation.canGoForward;
}

export function navigateHistory(direction: HistoryDirection) {
  const tabHistory = tabHistorySlot.get();
  if (tabHistory) tabHistory.go(direction);
  else if (direction === "back") window.history.back();
  else window.history.forward();
}
