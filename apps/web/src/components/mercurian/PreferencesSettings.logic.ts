import type { BackgroundActivitySettings } from "@t3tools/contracts";
import { getBackgroundActivityBaseProfile } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";

export type BackgroundActivityOverridePatch = Partial<{
  [K in keyof BackgroundActivitySettings["overrides"]]:
    | BackgroundActivitySettings["overrides"][K]
    | undefined;
}>;

export function durationToSeconds(duration: Duration.Duration): number {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

export function normalizeFetchIntervalSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function normalizeWorktreePoolSize(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.round(value));
}

/** Preserve every other override while setting or deleting this row's own. */
export function backgroundActivityOverrideSettings(
  current: BackgroundActivitySettings,
  overrides: BackgroundActivityOverridePatch,
) {
  const nextOverrides: BackgroundActivityOverridePatch = {
    ...current.overrides,
    ...overrides,
  };
  for (const [key, value] of Object.entries(nextOverrides)) {
    if (value === undefined) delete nextOverrides[key as keyof typeof nextOverrides];
  }
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile: "custom" as const,
      baseProfile: getBackgroundActivityBaseProfile(current),
      overrides: nextOverrides as BackgroundActivitySettings["overrides"],
    },
  };
}

export function fetchIntervalDiffersFromDefault(
  currentSeconds: number,
  defaultSeconds: number,
): boolean {
  return currentSeconds !== defaultSeconds;
}
