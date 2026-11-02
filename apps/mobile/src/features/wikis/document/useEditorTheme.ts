import { useMemo } from "react";
import { Platform } from "react-native";

import { mobileHtmlRenderTheme } from "../../../lib/htmlRenderTheme";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";

/** The app's colours for the editor page, as the HTML render view themes agent pages. */
export function useEditorTheme() {
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  return useMemo(
    () =>
      mobileHtmlRenderTheme({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    [themeId, themeAppearance, themeVariables, systemColorsActive],
  );
}
