/**
 * Shared presentation for Mercurian's instance-free planning-model pair.
 */
import {
  isProviderAvailable,
  type PlanningModelResolution,
  type PlanningModelSelection,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../../providerInstances";
import { formatProviderDriverKindLabel } from "../../providerModels";

export function providerLabel(provider: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? formatProviderDriverKindLabel(provider);
}

/**
 * Whether an instance could run a turn on this machine right now — the same
 * test `resolvePlanningModel` applies, kept in step with it deliberately.
 */
const isCandidate = (snapshot: ServerProvider): boolean =>
  isProviderAvailable(snapshot) && snapshot.enabled && snapshot.installed;

export interface PlanningModelUpgradeNudge {
  readonly instanceLabel: string;
  readonly latestVersion: string;
  readonly canUpdate: boolean;
}

export type PlanningModelDisplay =
  | { readonly kind: "unset" }
  | {
      readonly kind: "resolved";
      readonly providerLabel: string;
      readonly modelLabel: string;
      readonly instanceLabel: string;
      readonly accentColor: string | undefined;
    }
  | {
      readonly kind: "unresolved";
      readonly providerLabel: string;
      readonly modelLabel: string;
      readonly message: string;
      /** Present only when an instance of this provider is behind its latest. */
      readonly upgrade: PlanningModelUpgradeNudge | null;
    };

/**
 * An instance of this provider that is behind its latest release, if any — the
 * one whose update would plausibly unlock a model the agent is currently too
 * old to run. Naming it is how the gating message points at the upgrade
 * instead of leaving the model mysteriously absent.
 */
function upgradeNudgeFor(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
  entriesByInstanceId: ReadonlyMap<ProviderInstanceId, ProviderInstanceEntry>,
): PlanningModelUpgradeNudge | null {
  for (const snapshot of providers) {
    if (snapshot.driver !== provider || !isCandidate(snapshot)) continue;
    const advisory = snapshot.versionAdvisory;
    if (advisory?.status !== "behind_latest" || advisory.latestVersion === null) continue;
    return {
      instanceLabel:
        entriesByInstanceId.get(snapshot.instanceId)?.displayName ?? providerLabel(provider),
      latestVersion: advisory.latestVersion,
      canUpdate: advisory.canUpdate,
    };
  }
  return null;
}

/**
 * What the picker shows. The saved pair is always rendered from the record
 * itself, never from the options list — a machine that cannot resolve the
 * record still has to show what history chose, and must never
 * quietly rewrite it.
 */
export function describePlanningModel(
  selection: PlanningModelSelection | null,
  resolution: PlanningModelResolution,
  providers: ReadonlyArray<ServerProvider>,
): PlanningModelDisplay {
  if (selection === null || resolution._tag === "unset") {
    return { kind: "unset" };
  }

  const entriesByInstanceId = new Map<ProviderInstanceId, ProviderInstanceEntry>(
    deriveProviderInstanceEntries(providers).map((entry) => [entry.instanceId, entry]),
  );
  const provider = providerLabel(selection.provider);
  // The model's own display name when some instance still lists it; the raw
  // slug otherwise, which is exactly the case where it has gone missing.
  const modelLabel =
    providers
      .flatMap((snapshot) => (snapshot.driver === selection.provider ? snapshot.models : []))
      .find((model) => model.slug === selection.model)?.name ?? selection.model;

  if (resolution._tag === "resolved") {
    const entry = entriesByInstanceId.get(resolution.instanceId);
    return {
      kind: "resolved",
      providerLabel: provider,
      modelLabel,
      instanceLabel: entry?.displayName ?? resolution.instanceId,
      accentColor: entry?.accentColor,
    };
  }

  const upgrade = upgradeNudgeFor(providers, selection.provider, entriesByInstanceId);
  const message =
    resolution.reason === "no-instance"
      ? `No ${provider} instance on this machine. The model stays selected and resolves wherever one exists.`
      : upgrade === null
        ? `${modelLabel} is not available on this machine's ${provider} instance.`
        : `${modelLabel} is not available on this machine's ${provider} instance. Update ${upgrade.instanceLabel} to ${upgrade.latestVersion} to unlock it.`;

  return { kind: "unresolved", providerLabel: provider, modelLabel, message, upgrade };
}
