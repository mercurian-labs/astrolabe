import {
  EMBER_THEME,
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeColorVariable,
  getThemeModes,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeDefinition,
} from "../themePalette";

export type FoundationsTheme = Readonly<{
  id: string;
  label: string;
  modes: ReadonlyArray<ThemeAppearance>;
  definition: ThemeDefinition | null;
}>;

export type FoundationsRole = Readonly<{
  role: (typeof THEME_COLOR_ROLES)[number];
  cssVariable: string;
  value: string;
}>;

const STANDARD_THEME: FoundationsTheme = {
  id: "standard",
  label: "Standard",
  modes: ["light", "dark"],
  definition: null,
};

const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [
  T3_CHAT_THEME,
  GROVE_THEME,
  OCEAN_THEME,
  EMBER_THEME,
  IRIS_THEME,
];

export function foundationsThemes(): ReadonlyArray<FoundationsTheme> {
  return [
    STANDARD_THEME,
    ...BUILT_IN_THEMES.map((definition) => ({
      id: definition.id,
      label: definition.label,
      modes: getThemeModes(definition),
      definition,
    })),
  ];
}

export function foundationsRoles(
  theme: FoundationsTheme,
  appearance: ThemeAppearance,
): Array<FoundationsRole> {
  const colors =
    theme.definition === null
      ? getStandardThemeColors(appearance)
      : getThemeColorsForMode(theme.definition, appearance);

  if (colors === null) return [];

  return THEME_COLOR_ROLES.map((role) => ({
    role,
    cssVariable: getThemeColorVariable(role),
    value: colors[role],
  }));
}
