import {
  defaultInstanceIdForDriver,
  ProviderInstanceId,
  resolvePlanningModel,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";

import { getAppModelOptionsForInstance } from "../../modelSelection";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "../chat/providerIconUtils";
import { describePlanningModel } from "./PlanningModel.logic";

export const NO_PLANNING_MODEL_INSTANCE = ProviderInstanceId.make("t3code_no_planning_model");

export function activeInstanceIdForPlanningSelection(
  selection: PlanningModelSelection | null,
  resolution: PlanningModelResolution,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId {
  if (selection === null) return NO_PLANNING_MODEL_INSTANCE;
  if (resolution._tag === "resolved") return resolution.instanceId;
  return (
    entries.find((entry) => entry.driverKind === selection.provider && entry.isDefault)
      ?.instanceId ??
    entries.find((entry) => entry.driverKind === selection.provider)?.instanceId ??
    defaultInstanceIdForDriver(selection.provider)
  );
}

export function planningSelectionForInstanceModel(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  instanceId: ProviderInstanceId,
  model: string,
): PlanningModelSelection | null {
  const entry = entries.find((candidate) => candidate.instanceId === instanceId);
  return entry === undefined ? null : { provider: entry.driverKind, model };
}

/**
 * Build the coding-session picker's instance-keyed options. If the recorded
 * pair is missing locally, inject its slug on the display instance so the
 * upstream trigger renders the record instead of substituting option zero.
 */
export function planningModelOptionsByInstance(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: UnifiedSettings,
  selection: PlanningModelSelection | null,
  activeInstanceId: ProviderInstanceId,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const options = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of entries) {
    options.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
  }
  if (selection === null) return options;

  const active = options.get(activeInstanceId) ?? [];
  if (active.some((model) => model.slug === selection.model)) return options;
  const display = describePlanningModel(
    selection,
    resolvePlanningModel(selection, providers),
    providers,
  );
  options.set(activeInstanceId, [
    ...active,
    {
      slug: selection.model,
      name: display.kind === "unset" ? selection.model : display.modelLabel,
    },
  ]);
  return options;
}

export function planningModelDisabledReason(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
  model: string,
): string | null {
  const entry = entries.find((candidate) => candidate.instanceId === instanceId);
  if (entry === undefined) return "This provider instance is not available on this machine.";
  const selection = { provider: entry.driverKind, model } satisfies PlanningModelSelection;
  const resolution = resolvePlanningModel(selection, providers);
  if (resolution._tag === "resolved") return null;
  // Offering is capability; authentication gates sending, so signed-out models stay selectable.
  if (resolution._tag === "unresolved" && resolution.reason === "not-signed-in") return null;
  const display = describePlanningModel(selection, resolution, providers);
  return display.kind === "unresolved" ? display.message : "Choose a model to continue.";
}

export function derivePlanModelPickerState(
  selection: PlanningModelSelection | null,
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
) {
  const entries = deriveProviderInstanceEntries(providers);
  const resolution = resolvePlanningModel(selection, providers);
  const activeInstanceId = activeInstanceIdForPlanningSelection(selection, resolution, entries);
  return {
    entries,
    resolution,
    activeInstanceId,
    modelOptionsByInstance: planningModelOptionsByInstance(
      entries,
      settings,
      selection,
      activeInstanceId,
      providers,
    ),
  };
}
