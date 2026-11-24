/** Astrolabe's own Settings pages. */
const ASTROLABE_SETTINGS_PAGE_TARGETS = ["SettingsChangeRequests", "SettingsWorkspaces"] as const;

export function isAstrolabeSettingsPageTarget(
  target: string,
): target is (typeof ASTROLABE_SETTINGS_PAGE_TARGETS)[number] {
  return ASTROLABE_SETTINGS_PAGE_TARGETS.some((candidate) => candidate === target);
}

/** Settings pages a Settings row opens. */
export const SETTINGS_PAGE_TARGETS = [
  "SettingsEnvironments",
  "SettingsNotifications",
  "SettingsThreads",
  ...ASTROLABE_SETTINGS_PAGE_TARGETS,
  "SettingsAbout",
  "SettingsArchive",
  "SettingsAppearance",
  "SettingsLanguage",
  "SettingsNavigation",
  "SettingsOrganization",
  "SettingsProjectOverview",
  "SettingsEnvironmentSourceControl",
  "SettingsWorktrees",
  "SettingsLabs",
  "SettingsEnvironmentMaintenance",
  "SettingsProviderAccounts",
  "SettingsKeyboard",
  "SettingsVoice",
  "SettingsFollowUp",
  "SettingsScheduledTasks",
  "SettingsProjectGrouping",
  "SettingsClientStorage",
  "SettingsDiagnostics",
  "SettingsOpenSourceLicenses",
  "SettingsUsage",
] as const;

export type SettingsPageTarget = (typeof SETTINGS_PAGE_TARGETS)[number];

export type SettingsLegalDocumentTarget = "SettingsLegal";
