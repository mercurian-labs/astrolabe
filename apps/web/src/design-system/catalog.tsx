import type { ReactNode } from "react";

import {
  LiveTokenSwatch,
  LiveTokenValue,
  Page,
  Preview,
  Section,
  SourcePath,
} from "../components/design-system/DesignSystemPage";
import { foundationsRoles, foundationsThemes } from "../foundations/foundations.logic";
import { getThemeColorVariable, type ThemeAppearance } from "../themePalette";
import {
  BREAKPOINT_TOKENS,
  ELEVATION_GLASS_TOKENS,
  FOUNDATION_COLOR_FAMILIES,
  MOTION_TOKENS,
  RADIUS_TOKENS,
  SPACING_STEPS,
  TYPOGRAPHY_TOKENS,
} from "./foundations";
import { DAG_EXPLORER_CATALOG_ENTRIES } from "../components/mercurian/DagExplorer.catalog";
import { PLAN_ARTIFACT_CATALOG_ENTRIES } from "../components/mercurian/PlanArtifact.catalog";
import { PLAN_COMPOSER_CATALOG_ENTRIES } from "../components/mercurian/PlanComposer.catalog";
import { PLAN_LIST_SIDEBAR_CATALOG_ENTRIES } from "../components/mercurian/PlanListSidebar.catalog";
import { PLAN_NODE_POPOVER_CATALOG_ENTRIES } from "../components/mercurian/PlanNodePopover.catalog";
import { PLAN_STATUS_DOT_CATALOG_ENTRIES } from "../components/mercurian/PlanStatusDot.catalog";
import { PLAN_TIMELINE_CATALOG_ENTRIES } from "../components/mercurian/PlanTimeline.catalog";
import { SPEC_ARTIFACT_CATALOG_ENTRIES } from "../components/mercurian/SpecArtifact.catalog";
import { STALE_PLAN_WARNING_CATALOG_ENTRIES } from "../components/mercurian/StalePlanWarning.catalog";

export const CATALOG_SECTIONS = [
  {
    id: "overview",
    title: "Overview",
    description: "Scope, sources of truth, and review guidance.",
  },
  {
    id: "foundations",
    title: "Foundations",
    description: "The inherited visual system rendered from production tokens.",
  },
  {
    id: "mercurian-grammar",
    title: "Mercurian grammar",
    description: "Status, plan navigation, composer, and artifact states.",
  },
  {
    id: "checkpoint-graph",
    title: "Checkpoint Graph",
    description: "Timeline, node detail, and history exploration states.",
  },
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTIONS)[number]["id"];
export type CatalogCanvasWidth = "compact" | "desktop" | "wide";
export type CatalogLayout = "document" | "preview";
export type CatalogViewportTag = "narrow" | "desktop" | "increased-text" | "reduced-motion";

export type CatalogAxeException = Readonly<{
  ruleId: string;
  reason: string;
}>;

export type CatalogRenderContext = Readonly<{
  themeId: string;
  appearance: ThemeAppearance;
}>;

export type CatalogEntry = Readonly<{
  id: string;
  section: CatalogSectionId;
  group?: string;
  title: string;
  description: string;
  sourcePath: string;
  render: (context: CatalogRenderContext) => ReactNode;
  layout: CatalogLayout;
  preferredCanvas: CatalogCanvasWidth;
  viewportTags?: ReadonlyArray<CatalogViewportTag>;
  exercise?: (container: HTMLElement) => void | Promise<void>;
  setup?: () => (() => void) | void;
  axeExceptions?: ReadonlyArray<CatalogAxeException>;
}>;

function OverviewPage() {
  return (
    <Page
      description="A production-styled, application-owned lens over Astrolabe's current visual language. The catalog documents the system; it does not define it."
      eyebrow="Design system"
      title="Astrolabe catalog"
    >
      <Section
        description="Every catalog surface points back to the production source that owns its behavior or value."
        id="source-boundaries"
        title="Source-of-truth boundaries"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Preview label="Foundation boundary">
            <h3 className="font-semibold">Foundations</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Color names and values come from themePalette.ts and live computed CSS.
            </p>
          </Preview>
          <Preview label="Production component boundary">
            <h3 className="font-semibold">Shipping components</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Product primitives remain under components/ui and components/mercurian.
            </p>
          </Preview>
          <Preview label="Catalog boundary">
            <h3 className="font-semibold">Documentation only</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Catalog layout, navigation, and previews are never imported by the product.
            </p>
          </Preview>
        </div>
      </Section>

      <Section id="review" title="Review a visual change">
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            "Find the production source path shown by the relevant page.",
            "Check the affected page in both appearances and every supported palette.",
            "Judge narrow width, keyboard focus, and reduced motion when the entry claims them.",
          ].map((instruction, index) => (
            <li className="rounded-xl border border-border bg-card p-4" key={instruction}>
              <span className="mb-2 block text-xs font-medium text-muted-foreground">
                Step {index + 1}
              </span>
              {instruction}
            </li>
          ))}
        </ol>
      </Section>

      <SourcePath path="src/design-system/catalog.tsx" />
    </Page>
  );
}

function FoundationsColorPage({ themeId, appearance }: CatalogRenderContext) {
  const themes = foundationsThemes();
  const theme = themes.find(({ id }) => id === themeId) ?? themes[0]!;
  const roles = foundationsRoles(theme, appearance);
  const rolesById = new Map(roles.map((role) => [role.role, role]));

  return (
    <Page
      description="Every customizable semantic role, grouped by responsibility. Declared values come from the active production palette; swatches resolve the CSS actually applied to this document."
      eyebrow="Foundations"
      title="Color roles and themes"
    >
      <Section
        description="Use the shell controls to apply any combination through applyThemePalette."
        id="theme-matrix"
        title="Theme and appearance matrix"
      >
        <div className="flex flex-wrap gap-2">
          {themes.flatMap((candidate) =>
            candidate.modes.map((mode) => (
              <span
                className="rounded-full border border-border bg-card px-3 py-1 text-xs"
                key={`${candidate.id}-${mode}`}
              >
                {candidate.label} · {mode}
              </span>
            )),
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {theme.label} · {appearance}
        </p>
      </Section>

      {FOUNDATION_COLOR_FAMILIES.map((family) => (
        <Section
          description={family.description}
          id={`colors-${family.id}`}
          key={family.id}
          title={family.title}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {family.roles.map((role) => {
              const declared = rolesById.get(role);
              if (!declared) return null;
              return (
                <Preview label={`${role} color role`} key={role}>
                  <LiveTokenSwatch
                    fallback={declared.value}
                    label={role}
                    variable={getThemeColorVariable(role)}
                  />
                  <code className="mt-3 block font-mono text-xs text-muted-foreground">
                    Declared: {declared.value}
                  </code>
                </Preview>
              );
            })}
          </div>
        </Section>
      ))}

      <SourcePath path="src/themePalette.ts · src/index.css" />
    </Page>
  );
}

function FoundationsTypographyPage() {
  return (
    <Page
      description="The interface, prompt, and code voices are read from the live appearance variables, including user overrides applied by the production runtime."
      eyebrow="Foundations"
      title="Typography voices"
    >
      <Section id="type-voices" title="Inherited voices">
        <div className="grid gap-4 md:grid-cols-2">
          {TYPOGRAPHY_TOKENS.map(({ token, label, description }) => {
            const isSize = token.includes("size");
            return (
              <Preview label={`${label} typography token`} key={token}>
                <code className="font-mono text-xs text-muted-foreground">{token}</code>
                <p
                  className="mt-4 text-xl leading-relaxed"
                  style={
                    isSize
                      ? { fontSize: `var(${token}, inherit)` }
                      : { fontFamily: `var(${token}, inherit)` }
                  }
                >
                  {description}
                </p>
                <LiveTokenValue variable={token} />
              </Preview>
            );
          })}
        </div>
      </Section>
      <SourcePath path="src/index.css · src/appearanceFonts.ts" />
    </Page>
  );
}

function FoundationsSpacingPage() {
  return (
    <Page
      description="The catalog samples the Tailwind spacing scale used by production utilities and resolves its base step from live CSS."
      eyebrow="Foundations"
      title="Spacing and density"
    >
      <Section
        description="Multipliers are utility names, not copied pixel values."
        id="spacing-scale"
        title="Common spacing steps"
      >
        <Preview label="Spacing scale">
          <div className="space-y-4">
            {SPACING_STEPS.map((step) => (
              <div className="grid grid-cols-[3rem_1fr] items-center gap-3" key={step}>
                <code className="font-mono text-xs text-muted-foreground">{step}</code>
                <div
                  aria-label={`Spacing step ${step}`}
                  className="h-3 max-w-full rounded-full bg-primary"
                  style={{ width: `calc(var(--spacing) * ${step})` }}
                />
              </div>
            ))}
          </div>
        </Preview>
        <LiveTokenValue variable="--spacing" />
      </Section>
      <SourcePath path="src/index.css · production Tailwind utility usage" />
    </Page>
  );
}

function FoundationsShapePage() {
  return (
    <Page
      description="Shared radii and glass tokens are live; component-owned shadows remain visibly identified as unmanaged rather than promoted into new tokens."
      eyebrow="Foundations"
      title="Shape, elevation, and glass"
    >
      <Section id="radius" title="Radius scale">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RADIUS_TOKENS.map(({ token, label, description }) => (
            <Preview label={`${label} radius`} key={token}>
              <div
                className="mb-4 h-20 border border-border bg-muted"
                style={{ borderRadius: `var(${token})` }}
              />
              <h3 className="font-medium">{label}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
              <LiveTokenValue variable={token} />
            </Preview>
          ))}
        </div>
      </Section>
      <Section
        description="Glass is shared. Several elevation shadows are still owned by individual production components."
        id="elevation-glass"
        title="Elevation and glass"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ELEVATION_GLASS_TOKENS.map(({ token, label, description }) => (
            <Preview label={`${label} token`} key={token}>
              <h3 className="font-medium">{label}</h3>
              <p className="my-2 text-sm text-muted-foreground">{description}</p>
              <LiveTokenValue variable={token} />
            </Preview>
          ))}
        </div>
      </Section>
      <SourcePath path="src/index.css" />
    </Page>
  );
}

function FoundationsMotionPage() {
  return (
    <Page
      description="Motion is bounded, event-driven, or duty-cycled. The production reduced-motion media query removes nonessential motion."
      eyebrow="Foundations"
      title="Motion and reduced motion"
    >
      <Section id="motion-recipes" title="Shared motion recipes">
        <div className="grid gap-4 md:grid-cols-3">
          {MOTION_TOKENS.map(({ token, label, description }) => (
            <Preview label={`${label} motion token`} key={token}>
              <div
                className="mb-4 size-8 rounded-full bg-primary motion-reduce:animate-none"
                style={{ animation: `var(${token})` }}
              />
              <h3 className="font-medium">{label}</h3>
              <p className="my-2 text-sm text-muted-foreground">{description}</p>
              <LiveTokenValue variable={token} />
            </Preview>
          ))}
        </div>
      </Section>
      <SourcePath path="src/index.css" />
    </Page>
  );
}

function FoundationsFocusPage() {
  return (
    <Page
      description="Keyboard focus uses the live semantic ring role. Forced-colors rules remain in production CSS for native high-contrast behavior."
      eyebrow="Foundations"
      title="Focus and accessibility"
    >
      <Section
        description="Tab to the controls to inspect the production focus-visible treatment."
        id="focus-ring"
        title="Focus visibility"
      >
        <Preview className="flex flex-wrap gap-3" label="Focus examples">
          <button
            className="rounded-md border border-border bg-background px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          >
            Neutral action
          </button>
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          >
            Primary action
          </button>
        </Preview>
        <LiveTokenSwatch label="Focus ring" variable="--ring" />
      </Section>
      <SourcePath path="src/index.css" />
    </Page>
  );
}

function FoundationsBreakpointsPage() {
  return (
    <Page
      description="Responsive behavior uses Tailwind's live CSS-first breakpoint variables plus a small number of component-owned container thresholds."
      eyebrow="Foundations"
      title="Breakpoints and responsive behavior"
    >
      <Section id="breakpoint-scale" title="Viewport tiers">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-lg border-collapse text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Tier
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Token
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Live value
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Responsibility
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {BREAKPOINT_TOKENS.map(({ token, label, description }) => (
                <tr key={token}>
                  <th className="px-4 py-3 font-medium" scope="row">
                    {label}
                  </th>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{token}</td>
                  <td className="px-4 py-3">
                    <LiveTokenValue variable={token} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <SourcePath path="src/index.css · Tailwind v4 theme" />
    </Page>
  );
}

export const CATALOG_ENTRIES: ReadonlyArray<CatalogEntry> = [
  {
    id: "overview",
    section: "overview",
    title: "Overview",
    description: "Catalog scope, source boundaries, and visual-change review guidance.",
    sourcePath: "src/design-system/catalog.tsx",
    render: () => <OverviewPage />,
    layout: "document",
    preferredCanvas: "wide",
  },
  {
    id: "foundations-color",
    section: "foundations",
    title: "Color roles and themes",
    description: "Every customizable semantic color role across every theme and appearance.",
    sourcePath: "src/themePalette.ts",
    render: (context) => <FoundationsColorPage {...context} />,
    layout: "document",
    preferredCanvas: "wide",
    viewportTags: ["narrow", "desktop"],
  },
  {
    id: "foundations-typography",
    section: "foundations",
    title: "Typography",
    description: "Interface, prompt, and code voices and their live appearance settings.",
    sourcePath: "src/index.css",
    render: () => <FoundationsTypographyPage />,
    layout: "document",
    preferredCanvas: "desktop",
    viewportTags: ["increased-text"],
  },
  {
    id: "foundations-spacing",
    section: "foundations",
    title: "Spacing and density",
    description: "The production spacing scale sampled without duplicating its values.",
    sourcePath: "src/index.css",
    render: () => <FoundationsSpacingPage />,
    layout: "document",
    preferredCanvas: "desktop",
  },
  {
    id: "foundations-shape",
    section: "foundations",
    title: "Shape, elevation, and glass",
    description: "Live radius and glass tokens plus current elevation ownership.",
    sourcePath: "src/index.css",
    render: () => <FoundationsShapePage />,
    layout: "document",
    preferredCanvas: "desktop",
  },
  {
    id: "foundations-motion",
    section: "foundations",
    title: "Motion",
    description: "Bounded motion recipes and the production reduced-motion behavior.",
    sourcePath: "src/index.css",
    render: () => <FoundationsMotionPage />,
    layout: "document",
    preferredCanvas: "desktop",
    viewportTags: ["reduced-motion"],
  },
  {
    id: "foundations-focus",
    section: "foundations",
    title: "Focus and accessibility",
    description: "Keyboard focus, semantic rings, and forced-color behavior.",
    sourcePath: "src/index.css",
    render: () => <FoundationsFocusPage />,
    layout: "document",
    preferredCanvas: "compact",
  },
  {
    id: "foundations-breakpoints",
    section: "foundations",
    title: "Breakpoints",
    description: "Live CSS-first viewport tiers and responsive responsibilities.",
    sourcePath: "src/index.css",
    render: () => <FoundationsBreakpointsPage />,
    layout: "document",
    preferredCanvas: "desktop",
    viewportTags: ["narrow", "desktop"],
  },
  ...PLAN_STATUS_DOT_CATALOG_ENTRIES,
  ...PLAN_LIST_SIDEBAR_CATALOG_ENTRIES,
  ...PLAN_COMPOSER_CATALOG_ENTRIES,
  ...PLAN_ARTIFACT_CATALOG_ENTRIES,
  ...SPEC_ARTIFACT_CATALOG_ENTRIES,
  ...STALE_PLAN_WARNING_CATALOG_ENTRIES,
  ...PLAN_TIMELINE_CATALOG_ENTRIES,
  ...PLAN_NODE_POPOVER_CATALOG_ENTRIES,
  ...DAG_EXPLORER_CATALOG_ENTRIES,
];

export const OVERVIEW_ENTRY_ID = "overview";

export function assertValidCatalogRegistry(
  sections: ReadonlyArray<Readonly<{ id: string }>>,
  entries: ReadonlyArray<CatalogEntry>,
): void {
  const sectionIds = new Set(sections.map(({ id }) => id));
  const entryIds = new Set<string>();

  for (const entry of entries) {
    if (entryIds.has(entry.id)) {
      throw new Error(`Duplicate catalog entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
    if (!sectionIds.has(entry.section)) {
      throw new Error(`Unknown catalog section "${entry.section}" for entry "${entry.id}"`);
    }
    if (entry.sourcePath.trim().length === 0) {
      throw new Error(`Catalog entry "${entry.id}" needs a source path`);
    }
    if (entry.description.trim().length === 0) {
      throw new Error(`Catalog entry "${entry.id}" needs a description`);
    }
  }
}

export function resolveCatalogPage(
  pageId: string | undefined,
  entries: ReadonlyArray<CatalogEntry> = CATALOG_ENTRIES,
): CatalogEntry {
  return (
    entries.find(({ id }) => id === pageId) ??
    entries.find(({ id }) => id === OVERVIEW_ENTRY_ID) ??
    CATALOG_ENTRIES[0]!
  );
}
