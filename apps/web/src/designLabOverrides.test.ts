import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
  applyDesignLabOverrides,
  getDesignLabBorderColors,
  getEffectiveDesignLabOverrides,
  selectDesignLabAxisOverrides,
  useDesignLabOverridesStore,
  type DesignLabSettings,
  type EffectiveDesignLabOverrides,
} from "./designLabOverrides";
import { getStandardThemeColors } from "./themePalette";

function createRoot(): HTMLElement {
  const values = new Map<string, string>();
  const style = {
    fontSize: "",
    getPropertyValue: (property: string) => values.get(property) ?? "",
    removeProperty: (property: string) => {
      const previous = values.get(property) ?? "";
      values.delete(property);
      return previous;
    },
    setProperty: (property: string, value: string) => {
      values.set(property, value);
    },
  } as unknown as CSSStyleDeclaration;
  return { style } as HTMLElement;
}

const settings: DesignLabSettings = {
  sans: "Inter",
  code: "Menlo",
  composer: "",
  sizeInterface: 16,
  sizePrompt: 14,
  sizeCode: 13,
  smoothing: false,
  glassOpacityPct: 80,
};

function effective(
  overrides: Partial<EffectiveDesignLabOverrides> = {},
): EffectiveDesignLabOverrides {
  return {
    radiusRem: null,
    typography: settings,
    shadowOpacity: null,
    borderColors: null,
    glassBlurPx: null,
    glassOpacityPct: settings.glassOpacityPct,
    glassSaturation: null,
    ...overrides,
  };
}

describe("design lab override application", () => {
  it("removes nullable variables while retaining merged settings values", () => {
    const root = createRoot();
    for (const variable of [
      "--radius",
      "--tw-shadow-color",
      "--glass-blur",
      "--glass-saturation",
      "--border",
      "--input",
      "--sidebar-border",
      "--toolbar-border",
    ]) {
      root.style.setProperty(variable, "stale");
    }

    applyDesignLabOverrides(root, effective());

    expect(root.style.getPropertyValue("--glass-opacity")).toBe("80%");
    expect(root.style.getPropertyValue("--font-sans")).toContain("Inter");
    expect(root.style.getPropertyValue("--font-mono")).toContain("Menlo");
    expect(root.style.fontSize).toBe("16px");
    for (const variable of [
      "--radius",
      "--tw-shadow-color",
      "--glass-blur",
      "--glass-saturation",
      "--border",
      "--input",
      "--sidebar-border",
      "--toolbar-border",
    ]) {
      expect(root.style.getPropertyValue(variable)).toBe("");
    }
  });

  it("writes and clears the radius override", () => {
    const root = createRoot();
    applyDesignLabOverrides(root, effective({ radiusRem: 0.875 }));
    expect(root.style.getPropertyValue("--radius")).toBe("0.875rem");
    applyDesignLabOverrides(root, effective());
    expect(root.style.getPropertyValue("--radius")).toBe("");
  });

  it("writes shadow strength as a root black alpha", () => {
    const root = createRoot();
    applyDesignLabOverrides(root, effective({ shadowOpacity: 0.24 }));
    expect(root.style.getPropertyValue("--tw-shadow-color")).toBe("rgb(0 0 0 / 0.24)");
  });

  it("mixes every border role toward canvas below one and text above one", () => {
    const colors = getStandardThemeColors("light");
    expect(getDesignLabBorderColors(colors, 0.5)).toEqual({
      "--border": `color-mix(in oklab, ${colors.border} 50%, ${colors.canvas})`,
      "--input": `color-mix(in oklab, ${colors.input} 50%, ${colors.canvas})`,
      "--sidebar-border": `color-mix(in oklab, ${colors.sidebarBorder} 50%, ${colors.canvas})`,
      "--toolbar-border": `color-mix(in oklab, ${colors.toolbarBorder} 50%, ${colors.canvas})`,
    });
    expect(getDesignLabBorderColors(colors, 1.5)).toEqual({
      "--border": `color-mix(in oklab, ${colors.border} 50%, ${colors.text})`,
      "--input": `color-mix(in oklab, ${colors.input} 50%, ${colors.text})`,
      "--sidebar-border": `color-mix(in oklab, ${colors.sidebarBorder} 50%, ${colors.text})`,
      "--toolbar-border": `color-mix(in oklab, ${colors.toolbarBorder} 50%, ${colors.text})`,
    });
    expect(getDesignLabBorderColors(colors, 1)).toBeNull();
  });

  it("merges typography field by field and leaves contract clamping to the shared writer", () => {
    const colors = getStandardThemeColors("dark");
    const merged = getEffectiveDesignLabOverrides(
      {
        ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
        fontSans: "Atkinson Hyperlegible",
        sizeInterface: 200,
        sizeCode: 17,
      },
      settings,
      colors,
    );
    expect(merged.typography).toEqual({
      sans: "Atkinson Hyperlegible",
      code: "Menlo",
      composer: "",
      sizeInterface: 200,
      sizePrompt: 14,
      sizeCode: 17,
      smoothing: false,
    });

    const root = createRoot();
    applyDesignLabOverrides(root, merged);
    expect(root.style.fontSize).toBe("20px");
    expect(root.style.getPropertyValue("--font-size-code")).toBe("17px");
  });
});

describe("design lab override store", () => {
  it("round-trips the last lab location", () => {
    const location = { page: "axis-typography", entry: "interface" };
    useDesignLabOverridesStore.getState().setLastLabLocation(location);
    expect(useDesignLabOverridesStore.getState().lastLabLocation).toEqual(location);
  });

  it("re-applies when repaintNonce is bumped", () => {
    const root = createRoot();
    useDesignLabOverridesStore.setState({
      ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
      radiusRem: 1.125,
      repaintNonce: 0,
    });
    const applyCurrent = () => {
      const store = useDesignLabOverridesStore.getState();
      applyDesignLabOverrides(
        root,
        getEffectiveDesignLabOverrides(
          selectDesignLabAxisOverrides(store),
          settings,
          getStandardThemeColors("light"),
        ),
      );
    };
    const unsubscribe = useDesignLabOverridesStore.subscribe((store, previous) => {
      if (store.repaintNonce !== previous.repaintNonce) applyCurrent();
    });

    applyCurrent();
    root.style.removeProperty("--radius");
    useDesignLabOverridesStore.getState().bumpRepaintNonce();
    expect(root.style.getPropertyValue("--radius")).toBe("1.125rem");
    unsubscribe();
  });
});
