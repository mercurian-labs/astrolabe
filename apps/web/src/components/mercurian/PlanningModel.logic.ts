/**
 * Shared presentation for Mercurian's instance-free planning-model pair.
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
} from "@t3tools/contracts";

import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../../providerInstances";
import { formatProviderDriverKindLabel } from "../../providerModels";

export function providerLabel(provider: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? formatProviderDriverKindLabel(provider);
}

/** Recorded option labels when live descriptors know them, raw values otherwise. */
export function planningModelOptionLabels(
  selection: PlanningModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<string> {
  const models = providers.flatMap((snapshot) =>
    snapshot.driver === selection.provider
      ? snapshot.models.filter((model) => model.slug === selection.model)
      : [],
  );
  return (selection.options ?? []).map((recorded) => {
    for (const model of models) {
      const descriptor = model.capabilities?.optionDescriptors?.find(
        (candidate) => candidate.id === recorded.id,
      );
      if (descriptor?.type === "select" && typeof recorded.value === "string") {
        const label = descriptor.options.find((option) => option.id === recorded.value)?.label;
        if (label !== undefined) return label;
      }
      if (descriptor?.type === "boolean" && typeof recorded.value === "boolean") {
        return `${descriptor.label} ${recorded.value ? "On" : "Off"}`;
      }
    }
    return String(recorded.value);
  });
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

function signedOutInstanceLabelFor(
  selection: PlanningModelSelection,
  providers: ReadonlyArray<ServerProvider>,
  entriesByInstanceId: ReadonlyMap<ProviderInstanceId, ProviderInstanceEntry>,
): string {
  const offerers = providers.filter(
    (snapshot) =>
      snapshot.driver === selection.provider &&
      isCandidate(snapshot) &&
      snapshot.auth.status === "unauthenticated" &&
      snapshot.models.some((model) => model.slug === selection.model),
  );
  const defaultInstanceId = defaultInstanceIdForDriver(selection.provider);
  const instance =
    offerers.find((snapshot) => snapshot.instanceId === defaultInstanceId) ?? offerers[0];
  return instance === undefined
    ? providerLabel(selection.provider)
    : (entriesByInstanceId.get(instance.instanceId)?.displayName ??
        providerLabel(selection.provider));
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

  const upgrade =
    resolution.reason === "model-unavailable" || resolution.reason === "option-unavailable"
      ? upgradeNudgeFor(providers, selection.provider, entriesByInstanceId)
      : null;
  const recordedOptions = planningModelOptionLabels(selection, providers).join(" · ");
  const message =
    resolution.reason === "no-instance"
      ? `No ${provider} instance on this machine. The model stays selected and resolves wherever one exists.`
      : resolution.reason === "not-signed-in"
        ? `Not signed in to ${signedOutInstanceLabelFor(selection, providers, entriesByInstanceId)}. The model stays selected and resolves once you sign in.`
        : resolution.reason === "option-unavailable"
          ? upgrade === null
            ? `${modelLabel}'s recorded reasoning depth (${recordedOptions}) is not available on this machine's ${provider} instance.`
            : `${modelLabel}'s recorded reasoning depth (${recordedOptions}) is not available on this machine's ${provider} instance. Update ${upgrade.instanceLabel} to ${upgrade.latestVersion} to unlock it.`
          : upgrade === null
            ? `${modelLabel} is not available on this machine's ${provider} instance.`
            : `${modelLabel} is not available on this machine's ${provider} instance. Update ${upgrade.instanceLabel} to ${upgrade.latestVersion} to unlock it.`;

  return { kind: "unresolved", providerLabel: provider, modelLabel, message, upgrade };
}
