// @effect-diagnostics nodeBuiltinImport:off - The unit runner stubs CSS imports, so the raw-source assertion needs a filesystem fallback.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_DESIGN_LAB_AXIS_OVERRIDES } from "./designLabOverrides";
import { buildDesignLabProposal, SHIPPED_DESIGN_DEFAULTS } from "./designLabProposal";
import type { DesignLabProfile } from "./designLabProfiles";
import indexCssRaw from "./index.css?raw";

// The unit runner stubs CSS imports; the raw import is populated by Vite's
// normal module pipeline, while this fallback keeps the same assertion live here.
const indexCss =
  indexCssRaw || NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");

function profile(overrides: Partial<DesignLabProfile> = {}): DesignLabProfile {
  return {
    id: "proposal",
    name: "Proposal",
    axes: DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
    appearance: { theme: "system", halves: null },
    updatedAt: 1,
    ...overrides,
  };
}

describe("Design Lab shipped-default proposals", () => {
  it("emits only divergent axes with proposed, shipped, and source values", () => {
    const axes = {
      ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
      radiusRem: 0.875,
      fontSans: "Atkinson Hyperlegible",
      fontCode: "Menlo",
      fontComposer: "Georgia",
      sizeInterface: 18,
      sizePrompt: 16,
      sizeCode: 15,
      shadowOpacity: 0.2,
      borderStrength: 1.5,
      glassBlurPx: 24,
      glassOpacityPct: 90,
      glassSaturation: 1.5,
    };
    const proposal = buildDesignLabProposal(profile({ axes }), []);

    for (const key of Object.keys(SHIPPED_DESIGN_DEFAULTS) as Array<keyof typeof axes>) {
      const shipped = SHIPPED_DESIGN_DEFAULTS[key];
      expect(proposal).toContain(shipped.label);
      expect(proposal).toContain(String(axes[key]));
      expect(proposal).toContain(String(shipped.value));
      expect(proposal).toContain(shipped.source);
    }

    const shippedProposal = buildDesignLabProposal(profile(), []);
    expect(shippedProposal).toContain("No adjustable axes diverge from the shipped defaults.");
    expect(shippedProposal).not.toContain("| Corner radius |");
  });

  it("includes the shadow, border, and theme implementation caveats", () => {
    const proposal = buildDesignLabProposal(
      profile({
        axes: {
          ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES,
          shadowOpacity: 0.2,
          borderStrength: 1.5,
        },
        appearance: { theme: "solar-light", halves: { dark: "solar-dark" } },
      }),
      [],
    );

    expect(proposal).toContain("flattens the shipped per-elevation shadow alphas");
    expect(proposal).toContain("border, input, sidebarBorder, and toolbarBorder");
    expect(proposal).toContain("Standard theme tables live in `apps/web/src/themePalette.ts`");
    expect(proposal).toContain("Shipped value: `system`");
  });

  it("embeds the complete profile file as JSON", () => {
    const proposal = buildDesignLabProposal(
      profile({ axes: { ...DEFAULT_DESIGN_LAB_AXIS_OVERRIDES, radiusRem: 0.875 } }),
      [],
    );

    expect(proposal).toContain("```json");
    expect(proposal).toContain('"version": 1');
    expect(proposal).toContain('"name": "Proposal"');
    expect(proposal).toContain('"radiusRem": 0.875');
    expect(proposal).toContain('"themes": []');
  });

  it("keeps every CSS-transcribed shipped default honest", () => {
    const transcribed = Object.values(SHIPPED_DESIGN_DEFAULTS).filter(
      (entry): entry is typeof entry & { cssDeclaration: string } => "cssDeclaration" in entry,
    );

    expect(transcribed.length).toBeGreaterThan(0);
    for (const { cssDeclaration } of transcribed) expect(indexCss).toContain(cssDeclaration);
  });
});
