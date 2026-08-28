import {
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
  type DesignLabAxisOverrides,
} from "./designLabOverrides";
import {
  parseThemeFile,
  serializeThemeFile,
  themeIdFromName,
  type ThemeDefinition,
  type ThemeFile,
  type ThemeHalves,
} from "./themePalette";

export const DESIGN_LAB_PROFILE_FILE_VERSION = 1 as const;
export const DESIGN_LAB_PROFILES_STORAGE_KEY = "t3code:design-lab-profiles:v1";

export type DesignLabProfileAppearance = Readonly<{
  theme: string;
  halves: ThemeHalves | null;
}>;

export type DesignLabProfile = Readonly<{
  id: string;
  name: string;
  axes: DesignLabAxisOverrides;
  appearance: DesignLabProfileAppearance;
  updatedAt: number;
}>;

export type ParsedDesignLabProfileFile = Readonly<{
  profile: DesignLabProfile;
  embeddedThemes: ReadonlyArray<ThemeDefinition>;
}>;

type DesignLabProfilesStore = Readonly<{
  profiles: ReadonlyArray<DesignLabProfile>;
  activeProfileId: string | null;
  currentAxes: DesignLabAxisOverrides;
  captureCurrent: (axes: DesignLabAxisOverrides, appearance: DesignLabProfileAppearance) => void;
  saveProfile: (name: string) => DesignLabProfile;
  activateProfile: (id: string) => void;
  deactivate: () => void;
  deleteProfile: (id: string) => void;
  addImportedProfile: (profile: DesignLabProfile) => DesignLabProfile;
}>;

const DEFAULT_APPEARANCE: DesignLabProfileAppearance = { theme: "system", halves: null };

let currentAppearance = DEFAULT_APPEARANCE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseNullableNumber(
  axes: Record<string, unknown>,
  key: keyof DesignLabAxisOverrides,
  minimum: number,
  maximum: number,
): number | null {
  const value = axes[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The "${key}" profile axis must be a finite number or null.`);
  }
  return clamp(value, minimum, maximum);
}

function parseNullableFont(
  axes: Record<string, unknown>,
  key: "fontSans" | "fontCode" | "fontComposer",
): string | null {
  const value = axes[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`The "${key}" profile axis must be a font name or null.`);
  }
  return value;
}

function parseAxes(value: unknown): DesignLabAxisOverrides {
  if (!isRecord(value)) throw new Error("Design Lab profile files need an axes object.");
  return {
    radiusRem: parseNullableNumber(value, "radiusRem", 0, 1.125),
    fontSans: parseNullableFont(value, "fontSans"),
    fontCode: parseNullableFont(value, "fontCode"),
    fontComposer: parseNullableFont(value, "fontComposer"),
    sizeInterface: parseNullableNumber(
      value,
      "sizeInterface",
      MIN_INTERFACE_FONT_SIZE,
      MAX_INTERFACE_FONT_SIZE,
    ),
    sizePrompt: parseNullableNumber(
      value,
      "sizePrompt",
      MIN_PROMPT_FONT_SIZE,
      MAX_PROMPT_FONT_SIZE,
    ),
    sizeCode: parseNullableNumber(value, "sizeCode", MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE),
    shadowOpacity: parseNullableNumber(value, "shadowOpacity", 0, 0.4),
    borderStrength: parseNullableNumber(value, "borderStrength", 0.25, 2),
    glassBlurPx: parseNullableNumber(value, "glassBlurPx", 0, 32),
    glassOpacityPct: parseNullableNumber(
      value,
      "glassOpacityPct",
      MIN_GLASS_OPACITY,
      MAX_GLASS_OPACITY,
    ),
    glassSaturation: parseNullableNumber(value, "glassSaturation", 0.5, 2),
  };
}

function parseAppearance(value: unknown): DesignLabProfileAppearance {
  if (!isRecord(value) || typeof value.theme !== "string" || value.theme.trim().length === 0) {
    throw new Error("Design Lab profile files need an appearance with a theme.");
  }
  if (value.halves === null) return { theme: value.theme, halves: null };
  if (!isRecord(value.halves)) {
    throw new Error("Design Lab profile appearance halves must be an object or null.");
  }
  const light = value.halves.light;
  const dark = value.halves.dark;
  if (light !== undefined && typeof light !== "string") {
    throw new Error('The profile appearance "light" half must be a theme id.');
  }
  if (dark !== undefined && typeof dark !== "string") {
    throw new Error('The profile appearance "dark" half must be a theme id.');
  }
  return {
    theme: value.theme,
    halves: {
      ...(typeof light === "string" ? { light } : {}),
      ...(typeof dark === "string" ? { dark } : {}),
    },
  };
}

function profileName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 48) {
    throw new Error("Design Lab profile files need a name (48 characters or fewer).");
  }
  return value.trim();
}

function themeFileObject(theme: ThemeDefinition): ThemeFile {
  return JSON.parse(serializeThemeFile(theme)) as ThemeFile;
}

export function parseDesignLabProfileFile(value: unknown): ParsedDesignLabProfileFile {
  if (!isRecord(value)) {
    throw new Error("Design Lab profile files must contain a JSON object.");
  }
  if (value.version !== DESIGN_LAB_PROFILE_FILE_VERSION) {
    throw new Error(
      `This Design Lab profile file uses an unsupported version. Expected ${DESIGN_LAB_PROFILE_FILE_VERSION}.`,
    );
  }

  const name = profileName(value.name);
  const axes = parseAxes(value.axes);
  const appearance = parseAppearance(value.appearance);
  if (!Array.isArray(value.themes)) {
    throw new Error("Design Lab profile files need a themes array.");
  }

  return {
    profile: {
      id: themeIdFromName(name),
      name,
      axes,
      appearance,
      updatedAt: Date.now(),
    },
    embeddedThemes: value.themes.map(parseThemeFile),
  };
}

export function serializeDesignLabProfileFile(
  profile: DesignLabProfile,
  embeddedThemes: ReadonlyArray<ThemeDefinition>,
): string {
  return `${JSON.stringify(
    {
      version: DESIGN_LAB_PROFILE_FILE_VERSION,
      name: profile.name,
      axes: profile.axes,
      appearance: profile.appearance,
      themes: embeddedThemes.map(themeFileObject),
    },
    null,
    2,
  )}\n`;
}

function axesEqual(left: DesignLabAxisOverrides, right: DesignLabAxisOverrides): boolean {
  return Object.keys(DEFAULT_DESIGN_LAB_AXIS_OVERRIDES).every(
    (key) =>
      left[key as keyof DesignLabAxisOverrides] === right[key as keyof DesignLabAxisOverrides],
  );
}

function appearanceEqual(
  left: DesignLabProfileAppearance,
  right: DesignLabProfileAppearance,
): boolean {
  return (
    left.theme === right.theme &&
    left.halves?.light === right.halves?.light &&
    left.halves?.dark === right.halves?.dark
  );
}

function uniqueProfileId(profiles: ReadonlyArray<DesignLabProfile>, requestedId: string): string {
  const ids = new Set(profiles.map(({ id }) => id));
  if (!ids.has(requestedId)) return requestedId;
  let suffix = 2;
  while (ids.has(`${requestedId}-${suffix}`)) suffix += 1;
  return `${requestedId}-${suffix}`;
}

function createDesignLabProfilesStore() {
  return create<DesignLabProfilesStore>()(
    persist(
      (set, get) => ({
        profiles: [],
        activeProfileId: null,
        currentAxes: DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
        captureCurrent: (axes, appearance) => {
          currentAppearance = appearance;
          const state = get();
          const activeIndex = state.profiles.findIndex(({ id }) => id === state.activeProfileId);
          const activeProfile = state.profiles[activeIndex];
          const axesChanged = !axesEqual(state.currentAxes, axes);
          const activeChanged =
            activeProfile !== undefined &&
            (!axesEqual(activeProfile.axes, axes) ||
              !appearanceEqual(activeProfile.appearance, appearance));
          if (!axesChanged && !activeChanged) return;

          set((state) => {
            const profiles = activeChanged
              ? state.profiles.map((profile, index) =>
                  index === activeIndex
                    ? { ...profile, axes, appearance, updatedAt: Date.now() }
                    : profile,
                )
              : state.profiles;
            return { currentAxes: axes, profiles };
          });
        },
        saveProfile: (rawName) => {
          const name = profileName(rawName);
          const state = get();
          const activeIndex = state.profiles.findIndex(({ id }) => id === state.activeProfileId);
          const existing = state.profiles[activeIndex];
          const profile: DesignLabProfile = existing
            ? {
                ...existing,
                name,
                axes: state.currentAxes,
                appearance: currentAppearance,
                updatedAt: Date.now(),
              }
            : {
                id: uniqueProfileId(state.profiles, themeIdFromName(name)),
                name,
                axes: state.currentAxes,
                appearance: currentAppearance,
                updatedAt: Date.now(),
              };
          const profiles = [...state.profiles];
          if (existing) profiles[activeIndex] = profile;
          else profiles.push(profile);
          set({ profiles, activeProfileId: profile.id });
          return profile;
        },
        activateProfile: (id) => {
          const profile = get().profiles.find((candidate) => candidate.id === id);
          if (!profile) return;
          currentAppearance = profile.appearance;
          set({ activeProfileId: id, currentAxes: profile.axes });
        },
        deactivate: () => set({ activeProfileId: null }),
        deleteProfile: (id) =>
          set((state) => {
            const profiles = state.profiles.filter((profile) => profile.id !== id);
            if (profiles.length === state.profiles.length) return state;
            return {
              profiles,
              activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
            };
          }),
        addImportedProfile: (profile) => {
          const state = get();
          const imported = {
            ...profile,
            id: uniqueProfileId(state.profiles, profile.id),
          };
          set({ profiles: [...state.profiles, imported] });
          return imported;
        },
      }),
      {
        name: DESIGN_LAB_PROFILES_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ profiles, activeProfileId, currentAxes }) => ({
          profiles,
          activeProfileId,
          currentAxes,
        }),
      },
    ),
  );
}

export const useDesignLabProfilesStore = /* @__PURE__ */ createDesignLabProfilesStore();
