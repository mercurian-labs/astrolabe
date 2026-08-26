import type {
  PlanningModelResolution,
  PlanningModelSelection,
  ProviderOptionSelection,
  ServerProvider,
} from "@t3tools/contracts";

import { shouldRenderTraitsControls, TraitsPicker } from "../chat/TraitsPicker";

/** Controlled adapter from a branch-local planning choice to the shared traits picker. */
export function PlanTraitsPicker({
  selection,
  resolution,
  providers,
  prompt,
  disabled = false,
  onPromptChange,
  onChange,
}: {
  readonly selection: PlanningModelSelection | null;
  readonly resolution: PlanningModelResolution;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly prompt: string;
  readonly disabled?: boolean;
  readonly onPromptChange: (prompt: string) => void;
  readonly onChange: (selection: PlanningModelSelection) => void;
}) {
  if (selection === null || resolution._tag !== "resolved") return null;
  const snapshot = providers.find((provider) => provider.instanceId === resolution.instanceId);
  if (snapshot === undefined) return null;
  const traits = {
    provider: selection.provider,
    models: snapshot.models,
    model: selection.model,
    prompt,
    modelOptions: selection.options,
  } as const;
  if (!shouldRenderTraitsControls({ ...traits, planModeEnabled: false })) return null;

  return (
    <span
      aria-disabled={disabled || undefined}
      className={
        disabled ? "pointer-events-none inline-flex min-w-0 opacity-64" : "inline-flex min-w-0"
      }
      inert={disabled ? true : undefined}
    >
      <TraitsPicker
        {...traits}
        planModeEnabled={false}
        key={disabled ? "disabled" : "enabled"}
        triggerClassName="max-w-40"
        onPromptChange={onPromptChange}
        onModelOptionsChange={(options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
          const { options: _previousOptions, ...pair } = selection;
          onChange(options === undefined ? pair : { ...pair, options });
        }}
      />
    </span>
  );
}
