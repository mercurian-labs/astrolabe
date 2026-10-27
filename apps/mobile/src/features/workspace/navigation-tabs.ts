import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { Platform } from "react-native";
import {
  NAVIGATION_TAB_LABELS,
  NAVIGATION_TAB_ORDER,
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  enabledNavigationTabs,
  type NavigationTab,
} from "./navigation-tab-order";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { mobilePreferencesAtom } from "../../state/preferences";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { registeredWorkspaceTabs, resolveWorkspaceTabOrder } from "./workspace-tabs-state";

export const WORKSPACE_TAB_LABELS = NAVIGATION_TAB_LABELS;

export const NAVIGATION_TAB_ICONS = {
  threads: "text.bubble",
  pullRequests: PullRequestGlyph.pullRequest,
  wikis: "book",
  repositories: "folder",
  usage: "chart.bar.xaxis",
} as const satisfies Readonly<Record<NavigationTab, AppSymbolName>>;

const REGISTERED_TABS = registeredWorkspaceTabs(
  Platform.OS === "ios" && !Platform.isPad ? "iphone" : "other",
);
/** Sections this device never shows, as if the user had hidden them. */
const UNREGISTERED_TABS = NAVIGATION_TAB_ORDER.filter((tab) => !REGISTERED_TABS.includes(tab));
export const NAVIGATION_CUSTOMIZABLE = navigationCustomizationAvailable(REGISTERED_TABS.length);

export function useNavigationTabOrder() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.navigationTabOrder
    : undefined;
  return useMemo(
    () => resolveWorkspaceTabOrder(saved).filter((tab) => REGISTERED_TABS.includes(tab)),
    [saved],
  );
}

export function useHiddenNavigationTabs() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.hiddenNavigationTabs
    : undefined;
  return useMemo(
    () => [
      ...(NAVIGATION_CUSTOMIZABLE ? resolveHiddenNavigationTabs(saved) : []),
      ...UNREGISTERED_TABS,
    ],
    [saved],
  );
}

export function useEnabledNavigationTabs() {
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  return useMemo(() => enabledNavigationTabs(order, hidden), [order, hidden]);
}
