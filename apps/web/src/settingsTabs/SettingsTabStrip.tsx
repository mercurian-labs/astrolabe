import { useNavigate } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { useLayoutEffect, type ComponentType } from "react";

import { settingsBreadcrumbLabel } from "~/components/settings/SettingsBreadcrumb";
import type { SettingsPath } from "~/components/settings/settingsSearch";
import { SETTINGS_SECTION_ICONS } from "~/components/settings/SettingsSidebarNav";
import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";
import { createTabListStore, neighbourOf } from "../titlebarTabs/tabListStore";
import { TitlebarTab, TitlebarTabStrip } from "../titlebarTabs/TitlebarTabs";

/** A settings page a tab can show, by its path; every page with a breadcrumb label. */
type SettingsTabPath = SettingsPath | "/settings/open-source-licenses";

export const SETTINGS_TABS_STORAGE_KEY = "t3code:settings-tabs:v1";

/** The settings pages open as tabs, by path. Visiting a page opens its tab. */
export const useSettingsTabsStore = createTabListStore(SETTINGS_TABS_STORAGE_KEY);

function settingsTabPath(pathname: string): SettingsTabPath | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  return settingsBreadcrumbLabel(path) === null ? null : (path as SettingsTabPath);
}

/** Opens the tab of the settings page on screen, and says which it is; null off a page. */
export function useOpenSettingsTab(pathname: string): string | null {
  const path = settingsTabPath(pathname);
  useLayoutEffect(() => {
    if (path !== null) useSettingsTabsStore.getState().open(path);
  }, [path]);
  return path;
}

const SETTINGS_TAB_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> =
  SETTINGS_SECTION_ICONS;

/**
 * The settings pages visited, as tabs across the top of the settings screen, working as the chat
 * tabs do (see `TitlebarTabStrip`). The page on screen is the tab in front. Closing the last tab
 * leaves settings for the chat you came from, as leaving settings does.
 */
export function SettingsTabStrip({ activeKey }: { activeKey: string | null }) {
  const keys = useSettingsTabsStore((store) => store.keys);
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();

  const show = (key: string) => {
    const path = settingsTabPath(key);
    if (path === null) return;
    void navigate({ to: path, hash: "", replace: true, hashScrollIntoView: false });
  };

  const close = (key: string) => {
    const store = useSettingsTabsStore.getState();
    if (key === activeKey) {
      const next = neighbourOf(store.keys, key);
      if (next === null) void navigateToMainApp();
      else show(next);
    }
    store.close(key);
  };

  return (
    <TitlebarTabStrip
      id="settings"
      label="Open settings"
      keys={keys}
      activeKey={activeKey}
      atWindowEdge
      onMove={(key, index) => useSettingsTabsStore.getState().move(key, index)}
      renderTab={(key, slot) => {
        const Icon = SETTINGS_TAB_ICONS[key] ?? SettingsIcon;
        return (
          <TitlebarTab
            key={key}
            tabKey={key}
            title={settingsBreadcrumbLabel(key) ?? "Settings"}
            icon={<Icon />}
            slot={slot}
            onSelect={() => show(key)}
            onClose={() => close(key)}
          />
        );
      }}
    />
  );
}
