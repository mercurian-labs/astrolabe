import { describe, expect, it } from "vite-plus/test";

import {
  EMBER_THEME,
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeColorVariable,
  getThemeModes,
  GROVE_THEME,
  IRIS_THEME,
  isThemeColor,
  OCEAN_THEME,
  T3_CHAT_THEME,
  THEME_COLOR_ROLES,
} from "../themePalette";
import { foundationsRoles, foundationsThemes } from "./foundations.logic";

describe("foundations themes", () => {
  it("includes the standard palette and every shipped built-in definition", () => {
    const themes = foundationsThemes();
    const definitions = [T3_CHAT_THEME, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME];

    expect(themes).toHaveLength(definitions.length + 1);
    expect(themes[0]?.definition).toBeNull();
    expect(themes.slice(1)).toEqual(
      definitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        modes: getThemeModes(definition),
        definition,
      })),
    );
  });

  it("lists every semantic role exactly once for every available theme appearance", () => {
    for (const theme of foundationsThemes()) {
      for (const appearance of theme.modes) {
        const roles = foundationsRoles(theme, appearance);

        expect(roles.map(({ role }) => role)).toEqual([...THEME_COLOR_ROLES]);
        expect(new Set(roles.map(({ role }) => role)).size).toBe(THEME_COLOR_ROLES.length);
      }
    }
  });

  it("resolves each declared value and CSS variable through the shipped palette API", () => {
    for (const theme of foundationsThemes()) {
      for (const appearance of theme.modes) {
        const expectedColors =
          theme.definition === null
            ? getStandardThemeColors(appearance)
            : getThemeColorsForMode(theme.definition, appearance);

        expect(expectedColors).not.toBeNull();
        expect(foundationsRoles(theme, appearance)).toEqual(
          THEME_COLOR_ROLES.map((role) => ({
            role,
            cssVariable: getThemeColorVariable(role),
            value: expectedColors?.[role],
          })),
        );
      }
    }
  });

  it("only exposes values accepted by the product theme color validator", () => {
    for (const theme of foundationsThemes()) {
      for (const appearance of theme.modes) {
        expect(foundationsRoles(theme, appearance).every(({ value }) => isThemeColor(value))).toBe(
          true,
        );
      }
    }
  });
});
