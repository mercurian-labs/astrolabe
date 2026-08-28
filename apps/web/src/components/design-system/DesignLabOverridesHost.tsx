import { useEffect, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  applyDesignLabOverrides,
  getEffectiveDesignLabOverrides,
  selectDesignLabAxisOverrides,
  useDesignLabOverridesStore,
} from "../../designLabOverrides";
import { useDesignLabProfilesStore } from "../../designLabProfiles";
import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeDefinition,
  resolveThemeHalf,
} from "../../themePalette";

export function DesignLabOverridesHost() {
  const hydrationTarget = useRef(useDesignLabProfilesStore.getState().currentAxes);
  const hydrationPending = useRef(true);
  const overrides = useDesignLabOverridesStore(useShallow(selectDesignLabAxisOverrides));
  const setOverrides = useDesignLabOverridesStore((store) => store.setOverrides);
  const captureCurrent = useDesignLabProfilesStore((store) => store.captureCurrent);
  const repaintNonce = useDesignLabOverridesStore((store) => store.repaintNonce);
  const fontFamilySans = useClientSettings((settings) => settings.fontFamilySans);
  const fontFamilyCode = useClientSettings((settings) => settings.fontFamilyCode);
  const fontFamilyComposer = useClientSettings((settings) => settings.fontFamilyComposer);
  const fontSizeInterface = useClientSettings((settings) => settings.fontSizeInterface);
  const fontSizePrompt = useClientSettings((settings) => settings.fontSizePrompt);
  const fontSizeCode = useClientSettings((settings) => settings.fontSizeCode);
  const fontSmoothing = useClientSettings((settings) => settings.fontSmoothing);
  const glassOpacity = useClientSettings((settings) => settings.glassOpacity);
  const { resolvedTheme, theme, themeHalves } = useTheme();

  useLayoutEffect(() => {
    setOverrides(hydrationTarget.current);
  }, [setOverrides]);

  useEffect(() => {
    if (hydrationPending.current) {
      const target = hydrationTarget.current;
      if (
        Object.keys(target).some(
          (key) => target[key as keyof typeof target] !== overrides[key as keyof typeof overrides],
        )
      ) {
        return;
      }
      hydrationPending.current = false;
    }
    captureCurrent(overrides, { theme, halves: themeHalves });
  }, [captureCurrent, overrides, theme, themeHalves]);

  useEffect(() => {
    const activeTheme = getThemeDefinition(resolveThemeHalf(theme, themeHalves, resolvedTheme));
    const themeColors = activeTheme
      ? (getThemeColorsForMode(activeTheme, resolvedTheme) ?? activeTheme.colors)
      : getStandardThemeColors(resolvedTheme);

    applyDesignLabOverrides(
      document.documentElement,
      getEffectiveDesignLabOverrides(
        overrides,
        {
          sans: fontFamilySans,
          code: fontFamilyCode,
          composer: fontFamilyComposer,
          sizeInterface: fontSizeInterface,
          sizePrompt: fontSizePrompt,
          sizeCode: fontSizeCode,
          smoothing: fontSmoothing,
          glassOpacityPct: glassOpacity,
        },
        themeColors,
      ),
    );
    // An active strength stance deliberately outranks palette drafts for
    // border roles; reset it to hand those roles back to the color editor.
  }, [
    fontFamilyCode,
    fontFamilyComposer,
    fontFamilySans,
    fontSizeCode,
    fontSizeInterface,
    fontSizePrompt,
    fontSmoothing,
    glassOpacity,
    overrides,
    repaintNonce,
    resolvedTheme,
    theme,
    themeHalves,
  ]);

  return null;
}
