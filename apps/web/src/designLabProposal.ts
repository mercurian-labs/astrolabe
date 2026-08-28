import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
} from "@t3tools/contracts";

import { DEFAULT_CODE_FONT_STACK, DEFAULT_SANS_FONT_STACK } from "./appearanceFonts";
import type { DesignLabAxisOverrides } from "./designLabOverrides";
import { serializeDesignLabProfileFile, type DesignLabProfile } from "./designLabProfiles";
import type { ThemeDefinition } from "./themePalette";

type ShippedDesignDefault = Readonly<{
  label: string;
  value: string | number;
  source: string;
  cssDeclaration?: string;
  caveat?: string;
}>;

export const SHIPPED_DESIGN_DEFAULTS: Readonly<
  Record<keyof DesignLabAxisOverrides, ShippedDesignDefault>
> = {
  radiusRem: {
    label: "Corner radius",
    value: 0.625,
    source: "apps/web/src/index.css:1390",
    cssDeclaration: "--radius: 0.625rem;",
  },
  fontSans: {
    label: "Interface font",
    value: DEFAULT_SANS_FONT_STACK,
    source: "apps/web/src/appearanceFonts.ts:19",
  },
  fontCode: {
    label: "Code font",
    value: DEFAULT_CODE_FONT_STACK,
    source: "apps/web/src/appearanceFonts.ts:24",
  },
  fontComposer: {
    label: "Prompt font",
    value: DEFAULT_SANS_FONT_STACK,
    source: "apps/web/src/appearanceFonts.ts:107",
  },
  sizeInterface: {
    label: "Interface font size",
    value: DEFAULT_INTERFACE_FONT_SIZE,
    source: "packages/contracts/src/settings.ts:97",
  },
  sizePrompt: {
    label: "Prompt font size",
    value: DEFAULT_PROMPT_FONT_SIZE,
    source: "packages/contracts/src/settings.ts:105",
  },
  sizeCode: {
    label: "Code font size",
    value: DEFAULT_CODE_FONT_SIZE,
    source: "packages/contracts/src/settings.ts:113",
  },
  shadowOpacity: {
    label: "Shadow strength",
    value: "per-elevation alpha values",
    source: "apps/web/src/index.css (standard shadow utilities and local elevation recipes)",
    caveat:
      "This proposal flattens the shipped per-elevation shadow alphas into one root shadow color; intentionally colored shadows remain local.",
  },
  borderStrength: {
    label: "Border strength",
    value: "standard palette roles (1×)",
    source: "apps/web/src/themePalette.ts (border, input, sidebarBorder, toolbarBorder)",
    caveat:
      "Ship this through the border, input, sidebarBorder, and toolbarBorder roles in every standard palette.",
  },
  glassBlurPx: {
    label: "Glass blur",
    value: 12,
    source: "apps/web/src/index.css:103 (dark override at :119)",
    cssDeclaration: "--glass-blur: 12px;",
  },
  glassOpacityPct: {
    label: "Glass opacity",
    value: 80,
    source: "apps/web/src/index.css:104",
    cssDeclaration: "--glass-opacity: 80%;",
  },
  glassSaturation: {
    label: "Glass saturation",
    value: 1.14,
    source: "apps/web/src/index.css:105 (dark override at :120)",
    cssDeclaration: "--glass-saturation: 1.14;",
  },
};

const AXIS_KEYS = Object.keys(SHIPPED_DESIGN_DEFAULTS) as ReadonlyArray<
  keyof DesignLabAxisOverrides
>;

function isDivergent(
  key: keyof DesignLabAxisOverrides,
  proposed: DesignLabAxisOverrides[keyof DesignLabAxisOverrides],
): boolean {
  if (proposed === null || proposed === "") return false;
  if (key === "shadowOpacity") return true;
  return proposed !== SHIPPED_DESIGN_DEFAULTS[key].value;
}

function displayValue(value: string | number): string {
  return typeof value === "number" ? String(value) : `\`${value}\``;
}

export function buildDesignLabProposal(
  profile: DesignLabProfile,
  embeddedThemes: ReadonlyArray<ThemeDefinition>,
): string {
  const divergentAxes = AXIS_KEYS.filter((key) => isDivergent(key, profile.axes[key]));
  const lines = [
    `# Design proposal — ${profile.name}`,
    "",
    "Review these changes against the product's current shipped defaults before implementing them.",
    "",
    "## Divergent axes",
    "",
  ];

  if (divergentAxes.length === 0) {
    lines.push("No adjustable axes diverge from the shipped defaults.", "");
  } else {
    lines.push(
      "| Axis | Proposed value | Shipped value | Owning source |",
      "| --- | --- | --- | --- |",
    );
    for (const key of divergentAxes) {
      const shipped = SHIPPED_DESIGN_DEFAULTS[key];
      lines.push(
        `| ${shipped.label} | ${displayValue(profile.axes[key] as string | number)} | ${displayValue(shipped.value)} | \`${shipped.source}\` |`,
      );
    }
    lines.push("");
    for (const key of divergentAxes) {
      const caveat = SHIPPED_DESIGN_DEFAULTS[key].caveat;
      if (caveat) lines.push(`- **${SHIPPED_DESIGN_DEFAULTS[key].label}:** ${caveat}`);
    }
    if (divergentAxes.some((key) => SHIPPED_DESIGN_DEFAULTS[key].caveat)) lines.push("");
  }

  const hasThemeDirection =
    profile.appearance.theme !== "system" || profile.appearance.halves !== null;
  if (hasThemeDirection) {
    lines.push(
      "## Theme direction",
      "",
      `- Proposed theme: \`${profile.appearance.theme}\` (halves: \`${JSON.stringify(profile.appearance.halves)}\`).`,
      "- Shipped value: `system` — `apps/web/src/hooks/useTheme.ts:38`.",
      "- Standard theme tables live in `apps/web/src/themePalette.ts`; apply palette changes there. Custom theme definitions needed to reproduce this direction are embedded below.",
      "",
    );
  }

  lines.push(
    "## Reproducible profile",
    "",
    "```json",
    serializeDesignLabProfileFile(profile, embeddedThemes).trimEnd(),
    "```",
    "",
  );
  return lines.join("\n");
}
