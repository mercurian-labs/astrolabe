/**
 * Mercurian's settings sections, as data.
 *
 * Two groups. Workspace is Mercurian's own list — the connections and
 * preferences configured once and rarely revisited, plus the Archived page.
 * Application is what the fork brought with it: kept reachable and untouched
 * until the open decision on the inherited t3code sections is taken.
 */
export type SettingsSectionPath =
  | "/settings/trackers"
  | "/settings/providers"
  | "/settings/preferences"
  | "/settings/archived"
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/source-control"
  | "/settings/connections";

export interface SettingsNavSection {
  readonly to: SettingsSectionPath;
  readonly label: string;
}

export interface SettingsNavGroup {
  readonly label: string;
  readonly sections: readonly SettingsNavSection[];
}

/** Where `/settings` lands: Mercurian's first section, not the fork's. */
export const SETTINGS_LANDING_PATH = "/settings/trackers" as const;

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Workspace",
    sections: [
      { to: "/settings/trackers", label: "Trackers" },
      { to: "/settings/providers", label: "Providers" },
      { to: "/settings/preferences", label: "Preferences" },
      { to: "/settings/archived", label: "Archived" },
    ],
  },
  {
    label: "Application",
    sections: [
      { to: "/settings/general", label: "General" },
      { to: "/settings/appearance", label: "Appearance" },
      { to: "/settings/keybindings", label: "Keybindings" },
      { to: "/settings/source-control", label: "Source Control" },
      { to: "/settings/connections", label: "Connections" },
    ],
  },
];

/** Equality, not the prefix match the tree uses: every section is a leaf route. */
export function isSettingsSectionActive(pathname: string, to: SettingsSectionPath): boolean {
  return pathname === to;
}
