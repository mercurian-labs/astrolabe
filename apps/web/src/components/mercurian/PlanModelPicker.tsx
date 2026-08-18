import type { PlanningModelSelection, ServerProvider } from "@t3tools/contracts";
import { useMemo } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import {
  derivePlanModelPickerState,
  planningModelDisabledReason,
  planningSelectionForInstanceModel,
} from "./PlanModelPicker.logic";

/** Thin adapter from Mercurian's instance-free pair to T3's session picker. */
export function PlanModelPicker({
  selection,
  providers,
  disabled = false,
  onChange,
}: {
  readonly selection: PlanningModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly disabled?: boolean;
  readonly onChange: (selection: PlanningModelSelection) => void;
}) {
  const settings = usePrimarySettings();
  const state = useMemo(
    () => derivePlanModelPickerState(selection, providers, settings),
    [providers, selection, settings],
  );

  return (
    <ProviderModelPicker
      activeInstanceId={state.activeInstanceId}
      disabled={disabled}
      instanceEntries={state.entries}
      lockedProvider={null}
      model={selection?.model ?? "Choose a model"}
      modelOptionsByInstance={state.modelOptionsByInstance}
      triggerAriaLabel="Planning model for this branch"
      triggerClassName="max-w-56"
      getModelDisabledReason={(instanceId, model) =>
        planningModelDisabledReason(state.entries, providers, instanceId, model)
      }
      onInstanceModelChange={(instanceId, model) => {
        const next = planningSelectionForInstanceModel(state.entries, instanceId, model);
        if (next !== null) onChange(next);
      }}
    />
  );
}
