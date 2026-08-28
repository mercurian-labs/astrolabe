import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_DESIGN_LAB_AXIS_OVERRIDES } from "./designLabOverrides";
import {
  DESIGN_LAB_PROFILE_FILE_VERSION,
  parseDesignLabProfileFile,
  serializeDesignLabProfileFile,
  useDesignLabProfilesStore,
  type DesignLabProfile,
} from "./designLabProfiles";
import { getStandardThemeColors, type ThemeDefinition } from "./themePalette";

const appearance = { theme: "system", halves: null } as const;

function profile(overrides: Partial<DesignLabProfile> = {}): DesignLabProfile {
  return {
    id: "solar-light",
    name: "Solar light",
    axes: { ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, radiusRem: 0.375 },
    appearance,
    updatedAt: 1,
    ...overrides,
  };
}

function customTheme(): ThemeDefinition {
  return {
    id: "solar-light",
    label: "Solar light",
    appearance: "light",
    colors: getStandardThemeColors("light"),
  };
}

function fileValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: DESIGN_LAB_PROFILE_FILE_VERSION,
    name: "Solar light",
    axes: DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
    appearance,
    themes: [],
    ...overrides,
  };
}

beforeEach(() => {
  useDesignLabProfilesStore.setState({
    profiles: [],
    activeProfileId: null,
    currentAxes: DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
  });
  useDesignLabProfilesStore
    .getState()
    .captureCurrent(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, appearance);
});

describe("Design Lab profile files", () => {
  it("round-trips profiles without embedded themes", () => {
    const source = profile();
    const parsed = parseDesignLabProfileFile(JSON.parse(serializeDesignLabProfileFile(source, [])));

    expect(parsed.profile).toMatchObject({
      id: source.id,
      name: source.name,
      axes: source.axes,
      appearance: source.appearance,
    });
    expect(parsed.embeddedThemes).toEqual([]);
  });

  it("round-trips embedded custom themes by value", () => {
    const theme = customTheme();
    const parsed = parseDesignLabProfileFile(
      JSON.parse(
        serializeDesignLabProfileFile(profile({ appearance: { theme: theme.id, halves: null } }), [
          theme,
        ]),
      ),
    );

    expect(parsed.embeddedThemes).toEqual([theme]);
    expect(parsed.profile.appearance.theme).toBe(theme.id);
  });

  it("rejects unsupported versions, missing names, and non-object axes", () => {
    expect(() => parseDesignLabProfileFile(fileValue({ version: 2 }))).toThrow(
      /unsupported version.*Expected 1/i,
    );
    expect(() => parseDesignLabProfileFile(fileValue({ name: "" }))).toThrow(/need a name/i);
    expect(() => parseDesignLabProfileFile(fileValue({ axes: [] }))).toThrow(/axes object/i);
  });

  it("clamps every numeric axis to the documented range", () => {
    const parsed = parseDesignLabProfileFile(
      fileValue({
        axes: {
          radiusRem: 9,
          fontSans: null,
          fontCode: null,
          fontComposer: null,
          sizeInterface: 100,
          sizePrompt: -1,
          sizeCode: 100,
          shadowOpacity: 2,
          borderStrength: 0,
          glassBlurPx: 100,
          glassOpacityPct: 1,
          glassSaturation: 8,
        },
      }),
    );

    expect(parsed.profile.axes).toEqual({
      radiusRem: 1.125,
      fontSans: null,
      fontCode: null,
      fontComposer: null,
      sizeInterface: 20,
      sizePrompt: 12,
      sizeCode: 18,
      shadowOpacity: 0.4,
      borderStrength: 0.25,
      glassBlurPx: 32,
      glassOpacityPct: 40,
      glassSaturation: 2,
    });
  });

  it("uses the theme-file validator for embedded themes", () => {
    expect(() =>
      parseDesignLabProfileFile(
        fileValue({
          themes: [
            {
              version: 1,
              id: "empty-theme",
              name: "Empty theme",
              appearance: "light",
              colors: {},
            },
          ],
        }),
      ),
    ).toThrow("Add at least one color role to the theme file.");
  });
});

describe("Design Lab profile store", () => {
  it("does not publish equal captures and mirrors changed captures into the active profile", () => {
    let publications = 0;
    const unsubscribe = useDesignLabProfilesStore.subscribe(() => {
      publications += 1;
    });

    useDesignLabProfilesStore
      .getState()
      .captureCurrent(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, appearance);
    expect(publications).toBe(0);

    useDesignLabProfilesStore.setState({
      profiles: [profile({ axes: DEFAULT_DESIGN_LAB_AXIS_OVERRIDES })],
      activeProfileId: "solar-light",
    });
    publications = 0;
    const axes = { ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, radiusRem: 0.875 };
    const nextAppearance = { theme: "ocean", halves: { dark: "ocean" } } as const;
    useDesignLabProfilesStore.getState().captureCurrent(axes, nextAppearance);

    expect(publications).toBe(1);
    expect(useDesignLabProfilesStore.getState()).toMatchObject({ currentAxes: axes });
    expect(useDesignLabProfilesStore.getState().profiles[0]).toMatchObject({
      axes,
      appearance: nextAppearance,
    });
    unsubscribe();
  });

  it("creates and activates a profile, then updates it on re-save", () => {
    const axes = { ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, radiusRem: 0.875 };
    useDesignLabProfilesStore.getState().captureCurrent(axes, appearance);
    const created = useDesignLabProfilesStore.getState().saveProfile("Soft solar");

    expect(useDesignLabProfilesStore.getState().activeProfileId).toBe(created.id);
    expect(useDesignLabProfilesStore.getState().profiles).toEqual([created]);

    const nextAxes = { ...axes, glassBlurPx: 24 };
    useDesignLabProfilesStore.getState().captureCurrent(nextAxes, appearance);
    const updated = useDesignLabProfilesStore.getState().saveProfile("Soft solar revised");
    expect(updated).toMatchObject({ id: created.id, name: "Soft solar revised", axes: nextAxes });
    expect(useDesignLabProfilesStore.getState().profiles).toHaveLength(1);
  });

  it("deleting a non-active profile leaves active and current state untouched", () => {
    const active = profile();
    const other = profile({ id: "other", name: "Other" });
    useDesignLabProfilesStore.setState({
      profiles: [active, other],
      activeProfileId: active.id,
      currentAxes: active.axes,
    });

    useDesignLabProfilesStore.getState().deleteProfile(other.id);

    expect(useDesignLabProfilesStore.getState()).toMatchObject({
      profiles: [active],
      activeProfileId: active.id,
      currentAxes: active.axes,
    });
  });

  it("uniquifies colliding imported ids", () => {
    const existing = profile();
    useDesignLabProfilesStore.setState({ profiles: [existing] });

    const imported = useDesignLabProfilesStore.getState().addImportedProfile(profile());

    expect(imported.id).toBe("solar-light-2");
    expect(useDesignLabProfilesStore.getState().profiles.map(({ id }) => id)).toEqual([
      "solar-light",
      "solar-light-2",
    ]);
  });
});
