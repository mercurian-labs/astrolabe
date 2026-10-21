import { useAtomValue } from "@effect/atom-react";

import nightlyReteUrl from "~/assets/brand/stage-nightly-rete.svg";
import devTerrainStripUrl from "~/assets/brand/terrain-dev-strip.webp";
import { cn } from "~/lib/utils";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

export type SidebarStageBackdropVariant = "nightly" | "dev";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

// Dev wears the approved olive/stone terrain, the same flat map as the dev app icon's ground: a
// ring-rich crop east of the icon's (x 3040, y 880, at source scale) recoloured into a dark olive
// ramp, so white marks and controls read over it. Nightly wears an astrolabe's rete (its circles, ecliptic ring and
// star pointers in brass) on the nightly icon's charcoal, pivoting on the brand's rust dot. Both
// strips cover wider sidebars by scaling.
const STAGE_ART_URLS: Record<SidebarStageBackdropVariant, string> = {
  dev: devTerrainStripUrl,
  nightly: nightlyReteUrl,
};

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  enabled = true,
): SidebarStageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(enabled = true): SidebarStageBackdropVariant | null {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), enabled);
}

/** Stage-channel header art; grounds mirror the per-channel app icons in `assets/`. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <StageArtImage variant={variant} />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <StageArtImage variant={variant} compact />;
}

function StageArtImage({
  variant,
  compact = false,
}: {
  variant: SidebarStageBackdropVariant;
  compact?: boolean;
}) {
  return (
    <img
      data-stage-art={variant}
      src={STAGE_ART_URLS[variant]}
      alt=""
      draggable={false}
      className={cn("h-full w-full object-cover", compact ? "object-center" : "object-left")}
    />
  );
}
