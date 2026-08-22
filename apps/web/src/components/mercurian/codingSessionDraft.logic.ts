import type { ModelSelection, ServerProvider, UnifiedSettings } from "@t3tools/contracts";

import { getAppModelOptionsForInstance } from "../../modelSelection";
import { sortModelsForProviderInstance } from "../../modelOrdering";
import { deriveProviderInstanceEntries } from "../../providerInstances";

export * from "@t3tools/client-runtime/state/coding-session-draft";

export function codingSessionModelGroups(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
) {
  return deriveProviderInstanceEntries(providers)
    .filter((entry) => entry.isAvailable && entry.enabled && entry.installed)
    .map((entry) => ({
      instance: entry,
      models: sortModelsForProviderInstance(getAppModelOptionsForInstance(settings, entry)),
    }))
    .filter((group) => group.models.length > 0);
}

export function seedCodingSessionModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
  sticky?: ModelSelection,
): ModelSelection | null {
  const groups = codingSessionModelGroups(providers, settings);
  if (sticky !== undefined) {
    const group = groups.find((candidate) => candidate.instance.instanceId === sticky.instanceId);
    if (group?.models.some((model) => model.slug === sticky.model)) return sticky;
  }
  const first = groups[0];
  const model = first?.models[0];
  return first === undefined || model === undefined
    ? null
    : { instanceId: first.instance.instanceId, model: model.slug };
}
