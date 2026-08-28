import { create } from "zustand";

import { applyAppearanceFontVariables, type AppearanceFontPreferences } from "./appearanceFonts";
import type { ThemeColors } from "./themePalette";

export type DesignLabSearch = Readonly<{
  page?: string;
  entry?: string;
}>;

export type DesignLabAxisOverrides = Readonly<{
  radiusRem: number | null;
  fontSans: string | null;
  fontCode: string | null;
  fontComposer: string | null;
  sizeInterface: number | null;
  sizePrompt: number | null;
  sizeCode: number | null;
  shadowOpacity: number | null;
  borderStrength: number | null;
  glassBlurPx: number | null;
  glassOpacityPct: number | null;
  glassSaturation: number | null;
}>;

export const DEFAULT_DESIGN_LAB_AXIS_OVERRIDES: DesignLabAxisOverrides = {
  radiusRem: null,
  fontSans: null,
  fontCode: null,
  fontComposer: null,
  sizeInterface: null,
  sizePrompt: null,
  sizeCode: null,
  shadowOpacity: null,
  borderStrength: null,
  glassBlurPx: null,
  glassOpacityPct: null,
  glassSaturation: null,
};

export type DesignLabSettings = AppearanceFontPreferences &
  Readonly<{
    glassOpacityPct: number;
  }>;

export type EffectiveDesignLabOverrides = Readonly<{
  radiusRem: number | null;
  typography: AppearanceFontPreferences;
  shadowOpacity: number | null;
  borderColors: DesignLabBorderColors | null;
  glassBlurPx: number | null;
  glassOpacityPct: number;
  glassSaturation: number | null;
}>;

export const DESIGN_LAB_BORDER_VARIABLES = [
  ["--border", "border"],
  ["--input", "input"],
  ["--sidebar-border", "sidebarBorder"],
  ["--toolbar-border", "toolbarBorder"],
] as const satisfies ReadonlyArray<readonly [string, keyof ThemeColors]>;

export type DesignLabBorderVariable = (typeof DESIGN_LAB_BORDER_VARIABLES)[number][0];
export type DesignLabBorderColors = Readonly<Record<DesignLabBorderVariable, string>>;

function formatMixPercentage(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

export function getDesignLabBorderColors(
  colors: ThemeColors,
  strength: number | null,
): DesignLabBorderColors | null {
  if (strength === null || strength === 1) return null;

  const towardCanvas = strength < 1;
  const borderPercentage = towardCanvas ? strength * 100 : (2 - strength) * 100;
  const target = towardCanvas ? colors.canvas : colors.text;
  return Object.fromEntries(
    DESIGN_LAB_BORDER_VARIABLES.map(([variable, role]) => [
      variable,
      `color-mix(in oklab, ${colors[role]} ${formatMixPercentage(borderPercentage)}%, ${target})`,
    ]),
  ) as DesignLabBorderColors;
}

export function getEffectiveDesignLabOverrides(
  overrides: DesignLabAxisOverrides,
  settings: DesignLabSettings,
  themeColors: ThemeColors,
): EffectiveDesignLabOverrides {
  return {
    radiusRem: overrides.radiusRem,
    typography: {
      sans: overrides.fontSans ?? settings.sans,
      code: overrides.fontCode ?? settings.code,
      composer: overrides.fontComposer ?? settings.composer,
      sizeInterface: overrides.sizeInterface ?? settings.sizeInterface,
      sizePrompt: overrides.sizePrompt ?? settings.sizePrompt,
      sizeCode: overrides.sizeCode ?? settings.sizeCode,
      smoothing: settings.smoothing,
    },
    shadowOpacity: overrides.shadowOpacity,
    borderColors: getDesignLabBorderColors(themeColors, overrides.borderStrength),
    glassBlurPx: overrides.glassBlurPx,
    glassOpacityPct: overrides.glassOpacityPct ?? settings.glassOpacityPct,
    glassSaturation: overrides.glassSaturation,
  };
}

type StyleRoot = Pick<HTMLElement, "style">;

function setOrRemove(style: CSSStyleDeclaration, property: string, value: string | null): void {
  if (value === null) style.removeProperty(property);
  else style.setProperty(property, value);
}

export function applyDesignLabOverrides(
  root: StyleRoot,
  effective: EffectiveDesignLabOverrides,
): void {
  applyAppearanceFontVariables(root as HTMLElement, effective.typography);
  root.style.setProperty("--glass-opacity", `${effective.glassOpacityPct}%`);
  setOrRemove(
    root.style,
    "--radius",
    effective.radiusRem === null ? null : `${effective.radiusRem}rem`,
  );
  setOrRemove(
    root.style,
    "--tw-shadow-color",
    effective.shadowOpacity === null ? null : `rgb(0 0 0 / ${effective.shadowOpacity})`,
  );
  setOrRemove(
    root.style,
    "--glass-blur",
    effective.glassBlurPx === null ? null : `${effective.glassBlurPx}px`,
  );
  setOrRemove(
    root.style,
    "--glass-saturation",
    effective.glassSaturation === null ? null : String(effective.glassSaturation),
  );
  for (const [variable] of DESIGN_LAB_BORDER_VARIABLES) {
    setOrRemove(root.style, variable, effective.borderColors?.[variable] ?? null);
  }
}

type DesignLabOverridesStore = DesignLabAxisOverrides & {
  lastLabLocation: DesignLabSearch | null;
  repaintNonce: number;
  themeEditorSlot: HTMLElement | null;
  setOverrides: (overrides: Partial<DesignLabAxisOverrides>) => void;
  resetShape: () => void;
  resetTypography: () => void;
  resetElevation: () => void;
  setLastLabLocation: (location: DesignLabSearch) => void;
  bumpRepaintNonce: () => void;
  setThemeEditorSlot: (slot: HTMLElement | null) => void;
};

export const useDesignLabOverridesStore = create<DesignLabOverridesStore>((set) => ({
  ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
  lastLabLocation: null,
  repaintNonce: 0,
  themeEditorSlot: null,
  setOverrides: (overrides) => set(overrides),
  resetShape: () => set({ radiusRem: null }),
  resetTypography: () =>
    set({
      fontSans: null,
      fontCode: null,
      fontComposer: null,
      sizeInterface: null,
      sizePrompt: null,
      sizeCode: null,
    }),
  resetElevation: () =>
    set({
      shadowOpacity: null,
      borderStrength: null,
      glassBlurPx: null,
      glassOpacityPct: null,
      glassSaturation: null,
    }),
  setLastLabLocation: (lastLabLocation) => set({ lastLabLocation }),
  bumpRepaintNonce: () => set((state) => ({ repaintNonce: state.repaintNonce + 1 })),
  setThemeEditorSlot: (themeEditorSlot) => set({ themeEditorSlot }),
}));

export function selectDesignLabAxisOverrides(
  store: DesignLabOverridesStore,
): DesignLabAxisOverrides {
  return {
    radiusRem: store.radiusRem,
    fontSans: store.fontSans,
    fontCode: store.fontCode,
    fontComposer: store.fontComposer,
    sizeInterface: store.sizeInterface,
    sizePrompt: store.sizePrompt,
    sizeCode: store.sizeCode,
    shadowOpacity: store.shadowOpacity,
    borderStrength: store.borderStrength,
    glassBlurPx: store.glassBlurPx,
    glassOpacityPct: store.glassOpacityPct,
    glassSaturation: store.glassSaturation,
  };
}
