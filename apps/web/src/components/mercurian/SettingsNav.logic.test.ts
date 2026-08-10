import { describe, expect, it } from "vite-plus/test";

import {
  isSettingsSectionActive,
  SETTINGS_LANDING_PATH,
  SETTINGS_NAV_GROUPS,
} from "./SettingsNav.logic";

const groupNamed = (label: string) => SETTINGS_NAV_GROUPS.find((group) => group.label === label);

describe("SETTINGS_NAV_GROUPS", () => {
  it("puts Mercurian's own sections first, in the designed order", () => {
    expect(SETTINGS_NAV_GROUPS[0]?.label).toBe("Workspace");
    expect(groupNamed("Workspace")?.sections.map((section) => section.to)).toEqual([
      "/settings/trackers",
      "/settings/providers",
      "/settings/preferences",
      "/settings/archived",
    ]);
  });

  it("keeps every inherited fork section reachable", () => {
    expect(groupNamed("Application")?.sections.map((section) => section.to)).toEqual([
      "/settings/general",
      "/settings/appearance",
      "/settings/keybindings",
      "/settings/source-control",
      "/settings/connections",
    ]);
  });

  it("lists no section twice", () => {
    const paths = SETTINGS_NAV_GROUPS.flatMap((group) =>
      group.sections.map((section) => section.to),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("lands on a section the nav actually lists", () => {
    const paths = SETTINGS_NAV_GROUPS.flatMap((group) =>
      group.sections.map((section) => section.to),
    );
    expect(paths).toContain(SETTINGS_LANDING_PATH);
  });
});

describe("isSettingsSectionActive", () => {
  it("matches the section you are on and no sibling", () => {
    expect(isSettingsSectionActive("/settings/trackers", "/settings/trackers")).toBe(true);
    expect(isSettingsSectionActive("/settings/trackers", "/settings/preferences")).toBe(false);
    expect(isSettingsSectionActive("/settings", "/settings/trackers")).toBe(false);
  });
});
