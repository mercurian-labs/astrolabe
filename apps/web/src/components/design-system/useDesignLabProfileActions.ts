import { useCallback } from "react";

import {
  DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
  useDesignLabOverridesStore,
} from "../../designLabOverrides";
import { buildDesignLabProposal } from "../../designLabProposal";
import {
  parseDesignLabProfileFile,
  serializeDesignLabProfileFile,
  useDesignLabProfilesStore,
  type DesignLabProfile,
} from "../../designLabProfiles";
import { useTheme } from "../../hooks/useTheme";
import {
  getCustomThemes,
  getThemeDefinition,
  installCustomTheme,
  updateCustomTheme,
  type ThemeDefinition,
} from "../../themePalette";

function downloadTextFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function embeddedThemesForProfile(profile: DesignLabProfile): ReadonlyArray<ThemeDefinition> {
  const customThemeIds = new Set(getCustomThemes().map(({ id }) => id));
  const referencedIds = new Set(
    [
      profile.appearance.theme,
      profile.appearance.halves?.light,
      profile.appearance.halves?.dark,
    ].filter((id): id is string => id !== undefined),
  );
  return [...referencedIds]
    .filter((id) => customThemeIds.has(id))
    .map((id) => getThemeDefinition(id))
    .filter((theme): theme is ThemeDefinition => theme !== null);
}

export function useDesignLabProfileActions() {
  const setOverrides = useDesignLabOverridesStore((store) => store.setOverrides);
  const { clearThemeHalves, setTheme, setThemeHalf } = useTheme();

  const applyProfile = useCallback(
    (profile: DesignLabProfile) => {
      setOverrides(profile.axes);
      setTheme(profile.appearance.theme);
      if (profile.appearance.halves?.light !== undefined) {
        setThemeHalf("light", profile.appearance.halves.light);
      }
      if (profile.appearance.halves?.dark !== undefined) {
        setThemeHalf("dark", profile.appearance.halves.dark);
      }
      useDesignLabProfilesStore.getState().activateProfile(profile.id);
    },
    [setOverrides, setTheme, setThemeHalf],
  );

  const returnToShippedAppearance = useCallback(() => {
    setOverrides(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES);
    setTheme("system");
    clearThemeHalves();
    useDesignLabProfilesStore.getState().deactivate();
    useDesignLabProfilesStore
      .getState()
      .captureCurrent(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, { theme: "system", halves: null });
  }, [clearThemeHalves, setOverrides, setTheme]);

  const deleteProfile = useCallback(
    (profile: DesignLabProfile) => {
      if (useDesignLabProfilesStore.getState().activeProfileId === profile.id) {
        returnToShippedAppearance();
      }
      useDesignLabProfilesStore.getState().deleteProfile(profile.id);
    },
    [returnToShippedAppearance],
  );

  const exportProfile = useCallback((profile: DesignLabProfile) => {
    downloadTextFile(
      `${profile.id}.design-profile.json`,
      serializeDesignLabProfileFile(profile, embeddedThemesForProfile(profile)),
      "application/json;charset=utf-8",
    );
  }, []);

  const proposeProfile = useCallback((profile: DesignLabProfile) => {
    downloadTextFile(
      `${profile.id}.design-proposal.md`,
      buildDesignLabProposal(profile, embeddedThemesForProfile(profile)),
      "text/markdown;charset=utf-8",
    );
  }, []);

  const importProfile = useCallback(
    async (file: File): Promise<DesignLabProfile> => {
      let value: unknown;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new Error("Design Lab profile files must contain valid JSON.");
      }
      const parsed = parseDesignLabProfileFile(value);
      for (const theme of parsed.embeddedThemes) {
        if (getCustomThemes().some(({ id }) => id === theme.id)) updateCustomTheme(theme);
        else installCustomTheme(theme);
      }
      const imported = useDesignLabProfilesStore.getState().addImportedProfile(parsed.profile);
      applyProfile(imported);
      return imported;
    },
    [applyProfile],
  );

  return {
    applyProfile,
    returnToShippedAppearance,
    deleteProfile,
    exportProfile,
    importProfile,
    proposeProfile,
  } as const;
}
