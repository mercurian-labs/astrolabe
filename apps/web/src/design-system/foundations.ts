import { THEME_COLOR_ROLES, type ThemeColorRole } from "../themePalette";

export type FoundationColorFamilyId =
  | "canvas-chrome"
  | "surfaces"
  | "text-icon"
  | "actions"
  | "messages"
  | "feedback"
  | "sidebar"
  | "code"
  | "terminal";

type FoundationColorFamilyDefinition = Readonly<{
  id: FoundationColorFamilyId;
  title: string;
  description: string;
  includes: (role: ThemeColorRole) => boolean;
}>;

const roleSet = (...roles: ReadonlyArray<ThemeColorRole>) => {
  const included = new Set<ThemeColorRole>(roles);
  return (role: ThemeColorRole) => included.has(role);
};

const COLOR_FAMILY_DEFINITIONS: ReadonlyArray<FoundationColorFamilyDefinition> = [
  {
    id: "canvas-chrome",
    title: "Canvas and chrome",
    description: "The application frame, toolbar, controls, and structural borders.",
    includes: roleSet(
      "canvas",
      "chrome",
      "toolbar",
      "toolbarForeground",
      "toolbarBorder",
      "toolbarControl",
      "toolbarControlForeground",
      "toolbarControlHover",
      "border",
    ),
  },
  {
    id: "surfaces",
    title: "Surfaces",
    description: "Base, raised, overlay, input, muted, and secondary surfaces.",
    includes: roleSet(
      "surface",
      "surfaceRaised",
      "surfaceOverlay",
      "input",
      "secondary",
      "secondaryForeground",
      "muted",
      "mutedForeground",
    ),
  },
  {
    id: "text-icon",
    title: "Text and icon",
    description: "Primary, secondary, placeholder, and subdued icon voices.",
    includes: roleSet("text", "textMuted", "placeholder", "secondaryLabel", "iconMuted"),
  },
  {
    id: "actions",
    title: "Actions",
    description: "Accent, foreground, focus, and accent-surface roles for interactive controls.",
    includes: roleSet(
      "focus",
      "accent",
      "accentForeground",
      "accentSurface",
      "accentSurfaceForeground",
    ),
  },
  {
    id: "messages",
    title: "Messages",
    description: "Conversation surfaces and their dedicated action treatment.",
    includes: roleSet(
      "messageSurface",
      "messageForeground",
      "messageAction",
      "messageActionForeground",
      "messageActionHover",
    ),
  },
  {
    id: "feedback",
    title: "Feedback",
    description: "Error, warning, and update foreground/surface families.",
    includes: roleSet(
      "error",
      "errorForeground",
      "errorSurface",
      "warning",
      "warningForeground",
      "warningSurface",
      "update",
      "updateForeground",
      "updateSurface",
    ),
  },
  {
    id: "sidebar",
    title: "Sidebar",
    description: "Navigation chrome, selection, hover, and subdued sidebar content.",
    includes: (role) => role.startsWith("sidebar"),
  },
  {
    id: "code",
    title: "Code",
    description: "Inline and block code surfaces and foregrounds.",
    includes: (role) => role.startsWith("code"),
  },
  {
    id: "terminal",
    title: "Terminal",
    description: "Terminal canvas, text, cursor, selection, and scrollbar roles.",
    includes: (role) => role.startsWith("terminal"),
  },
];

export const FOUNDATION_COLOR_FAMILIES = COLOR_FAMILY_DEFINITIONS.map(
  ({ includes, ...family }) => ({
    ...family,
    roles: THEME_COLOR_ROLES.filter(includes),
  }),
);

export const FOUNDATION_COLOR_ROLES: ReadonlyArray<ThemeColorRole> =
  FOUNDATION_COLOR_FAMILIES.flatMap(({ roles }) => roles);

export type FoundationToken = Readonly<{
  token: string;
  label: string;
  description: string;
}>;

export const TYPOGRAPHY_TOKENS: ReadonlyArray<FoundationToken> = [
  {
    token: "--font-sans",
    label: "Interface",
    description: "Navigation, labels, documentation, and everyday controls.",
  },
  {
    token: "--font-mono",
    label: "Code",
    description: "Code, identifiers, paths, and precise values.",
  },
  {
    token: "--font-composer",
    label: "Prompt",
    description: "Prompt composition, falling back to the active interface voice.",
  },
  {
    token: "--font-size-prompt",
    label: "Prompt size",
    description: "The independently adjustable prompt text size.",
  },
  {
    token: "--font-size-code",
    label: "Code size",
    description: "The independently adjustable code and diff text size.",
  },
];

export const SPACING_STEPS = ["1", "2", "3", "4", "6", "8", "12"] as const;

export const RADIUS_TOKENS: ReadonlyArray<FoundationToken> = [
  { token: "--radius", label: "Base", description: "The inherited control radius." },
  { token: "--radius-sm", label: "Small", description: "Compact controls and details." },
  { token: "--radius-md", label: "Medium", description: "Standard compact surfaces." },
  { token: "--radius-lg", label: "Large", description: "Cards and common containers." },
  { token: "--radius-xl", label: "Extra large", description: "Prominent raised surfaces." },
  { token: "--radius-2xl", label: "2XL", description: "Large panels and feature surfaces." },
];

export const ELEVATION_GLASS_TOKENS: ReadonlyArray<FoundationToken> = [
  { token: "--shadow-sm", label: "Low elevation", description: "Subtle control separation." },
  { token: "--shadow-lg", label: "High elevation", description: "Floating surface separation." },
  { token: "--glass-blur", label: "Glass blur", description: "Backdrop blur on glass surfaces." },
  {
    token: "--glass-opacity",
    label: "Glass opacity",
    description: "Opaque share of the semantic surface color.",
  },
  {
    token: "--glass-saturation",
    label: "Glass saturation",
    description: "Backdrop saturation applied with blur.",
  },
];

export const UNMANAGED_ELEVATIONS = [
  {
    owner: "SidebarPlanHoverCard",
    sourcePath: "src/components/mercurian/SidebarPlanHoverCard.tsx",
    value: "Extra-large black overlay shadow at 25% opacity",
  },
] as const;

export const MOTION_TOKENS: ReadonlyArray<FoundationToken> = [
  {
    token: "--animate-skeleton",
    label: "Skeleton",
    description: "The loading shimmer recipe; disabled when reduced motion is requested.",
  },
  {
    token: "--animate-status-pulse",
    label: "Status pulse",
    description: "A duty-cycled stepped status signal that avoids continuous repainting.",
  },
  {
    token: "--animate-status-ping",
    label: "Status ping",
    description: "A bounded stepped burst followed by an idle hold.",
  },
];

export const BREAKPOINT_TOKENS: ReadonlyArray<FoundationToken> = [
  { token: "--breakpoint-sm", label: "Small", description: "Compact-to-wide layout threshold." },
  { token: "--breakpoint-md", label: "Medium", description: "Desktop navigation threshold." },
  { token: "--breakpoint-lg", label: "Large", description: "Expanded documentation canvas." },
  { token: "--breakpoint-xl", label: "Extra large", description: "Wide workspace threshold." },
  { token: "--breakpoint-2xl", label: "2XL", description: "Largest standard viewport tier." },
];
