/**
 * The pure half of the workspace planning-model setting.
 *
 * Two jobs, both of which coding sessions will want later (061 picks per
 * session and instance-grouped, but the derivation and the resolution wording
 * are the same problem): turn this machine's provider snapshots into the
 * options a *provider-grouped* picker offers, and turn the saved pair plus its
 * resolution into what the row says.
 *
 * The picker here groups by provider, not by instance, because the workspace
 * setting names a provider — an instance is a machine-local account and the
 * workspace never names one. Curation still applies: the models offered for a
 * provider are the curated list of the instance that provider would resolve
 * to, so hiding and reordering a model in Settings shapes this picker the same
 * way it shapes every other one.
 */
import {
  defaultInstanceIdForDriver,
  isProviderAvailable,
  type PlanningModelResolution,
  type PlanningModelSelection,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";

import { getAppModelOptionsForInstance } from "../../modelSelection";
import { sortModelsForProviderInstance } from "../../modelOrdering";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../../providerInstances";
import { formatProviderDriverKindLabel } from "../../providerModels";

export function providerLabel(provider: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? formatProviderDriverKindLabel(provider);
}

export interface PlanningModelOption {
  readonly provider: ProviderDriverKind;
  readonly model: string;
  readonly label: string;
}

export interface PlanningModelOptionGroup {
  readonly provider: ProviderDriverKind;
  readonly label: string;
  /** The instance whose curated list these options came from. */
  readonly instanceId: ProviderInstanceId;
  readonly options: ReadonlyArray<PlanningModelOption>;
}

/**
 * Whether an instance could run a turn on this machine right now — the same
 * test `resolvePlanningModel` applies, kept in step with it deliberately.
 */
const isCandidate = (snapshot: ServerProvider): boolean =>
  isProviderAvailable(snapshot) && snapshot.enabled && snapshot.installed;

/**
 * The instance a provider resolves to when the model is not yet known: its
 * default when that is a candidate, otherwise the first candidate in settings
 * order. This is the same preference `resolvePlanningModel` uses, which is why
 * a model picked here resolves back to the instance whose list offered it.
 */
export function representativeInstance(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): ServerProvider | undefined {
  const candidates = providers.filter(
    (snapshot) => snapshot.driver === provider && isCandidate(snapshot),
  );
  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  return candidates.find((snapshot) => snapshot.instanceId === defaultInstanceId) ?? candidates[0];
}

const favoritesForInstance = (
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): ReadonlyArray<string> =>
  (settings.favorites ?? [])
    .filter((favorite) => favorite.provider === instanceId)
    .map((favorite) => favorite.model);

/**
 * One group per provider that has a usable instance on this machine, each
 * offering that instance's curated models — hidden ones filtered, the user's
 * order kept, favorites floated to the top.
 *
 * A provider with no usable instance contributes no group: there is nothing
 * this machine could run it under. That is a fact about the machine, and it
 * does not stop the workspace from having saved that provider already — the
 * saved value renders from the setting, never from this list.
 */
export function derivePlanningModelOptionGroups(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
): ReadonlyArray<PlanningModelOptionGroup> {
  const entriesByInstanceId = new Map<ProviderInstanceId, ProviderInstanceEntry>(
    deriveProviderInstanceEntries(providers).map((entry) => [entry.instanceId, entry]),
  );
  const groups: PlanningModelOptionGroup[] = [];
  const seen = new Set<ProviderDriverKind>();

  for (const snapshot of providers) {
    if (seen.has(snapshot.driver)) continue;
    seen.add(snapshot.driver);

    const instance = representativeInstance(providers, snapshot.driver);
    if (instance === undefined) continue;
    const entry = entriesByInstanceId.get(instance.instanceId);
    if (entry === undefined) continue;

    const curated = sortModelsForProviderInstance(getAppModelOptionsForInstance(settings, entry), {
      favoriteModels: favoritesForInstance(settings, instance.instanceId),
      groupFavorites: true,
    });
    if (curated.length === 0) continue;

    groups.push({
      provider: snapshot.driver,
      label: providerLabel(snapshot.driver),
      instanceId: instance.instanceId,
      options: curated.map((option) => ({
        provider: snapshot.driver,
        model: option.slug,
        label: option.name,
      })),
    });
  }

  return groups;
}

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
 * What the row shows. The saved pair is always rendered from the setting
 * itself, never from the options list — a machine that cannot resolve the
 * setting still has to show the workspace what it chose, and must never
 * quietly rewrite it.
 */
export function describePlanningModel(
  setting: PlanningModelSelection | null,
  resolution: PlanningModelResolution,
  providers: ReadonlyArray<ServerProvider>,
): PlanningModelDisplay {
  if (setting === null || resolution._tag === "unset") {
    return { kind: "unset" };
  }

  const entriesByInstanceId = new Map<ProviderInstanceId, ProviderInstanceEntry>(
    deriveProviderInstanceEntries(providers).map((entry) => [entry.instanceId, entry]),
  );
  const provider = providerLabel(setting.provider);
  // The model's own display name when some instance still lists it; the raw
  // slug otherwise, which is exactly the case where it has gone missing.
  const modelLabel =
    providers
      .flatMap((snapshot) => (snapshot.driver === setting.provider ? snapshot.models : []))
      .find((model) => model.slug === setting.model)?.name ?? setting.model;

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

  const upgrade = upgradeNudgeFor(providers, setting.provider, entriesByInstanceId);
  const message =
    resolution.reason === "no-instance"
      ? `No ${provider} instance on this machine. The setting stays saved and resolves wherever one exists.`
      : upgrade === null
        ? `${modelLabel} is not available on this machine's ${provider} instance.`
        : `${modelLabel} is not available on this machine's ${provider} instance. Update ${upgrade.instanceLabel} to ${upgrade.latestVersion} to unlock it.`;

  return { kind: "unresolved", providerLabel: provider, modelLabel, message, upgrade };
}
