import {
  ProviderDriverKind,
  resolvePlanningModel,
  type PlanModelDirective,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";

import {
  derivePlanningModelOptionGroups,
  describePlanningModel,
  type PlanningModelDisplay,
  type PlanningModelOptionGroup,
} from "./PlanningModelSetting.logic";

export const FOLLOW_DEFAULT = {
  _tag: "follow-default",
} as const satisfies PlanModelDirective;

export function effectivePlanModelSelection(
  directive: PlanModelDirective,
  workspaceDefault: PlanningModelSelection | null,
): PlanningModelSelection | null {
  return directive._tag === "override" ? directive.selection : workspaceDefault;
}

export function derivePlanModelPickerGroups(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
): ReadonlyArray<PlanningModelOptionGroup> {
  return derivePlanningModelOptionGroups(providers, settings);
}

function pairLabel(
  selection: PlanningModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): string {
  const resolution = resolvePlanningModel(selection, providers);
  const display = describePlanningModel(selection, resolution, providers);
  return display.kind === "unset"
    ? `${selection.provider} · ${selection.model}`
    : `${display.providerLabel} · ${display.modelLabel}`;
}

export function workspaceDefaultOptionLabel(
  workspaceDefault: PlanningModelSelection | null,
  providers: ReadonlyArray<ServerProvider>,
): string {
  return workspaceDefault === null
    ? "Workspace default — none set"
    : `Workspace default — ${pairLabel(workspaceDefault, providers)}`;
}

export interface PlanModelPickerDisplay {
  readonly selection: PlanningModelSelection | null;
  readonly resolution: PlanningModelResolution;
  readonly display: PlanningModelDisplay;
  readonly triggerLabel: string;
  readonly followsDefault: boolean;
}

/** The trigger and gate describe the effective pair itself, even when unresolved. */
export function describePlanModelPickerChoice(
  directive: PlanModelDirective,
  workspaceDefault: PlanningModelSelection | null,
  providers: ReadonlyArray<ServerProvider>,
): PlanModelPickerDisplay {
  const selection = effectivePlanModelSelection(directive, workspaceDefault);
  const resolution = resolvePlanningModel(selection, providers);
  const display = describePlanningModel(selection, resolution, providers);
  return {
    selection,
    resolution,
    display,
    triggerLabel:
      display.kind === "unset"
        ? "Choose a model"
        : `${display.providerLabel} · ${display.modelLabel}`,
    followsDefault: directive._tag === "follow-default",
  };
}

/** Stable command values keep the component's selection grammar string-only. */
export function serializePlanModelDirective(directive: PlanModelDirective): string {
  return directive._tag === "follow-default"
    ? "follow-default"
    : `override:${encodeURIComponent(directive.selection.provider)}:${encodeURIComponent(directive.selection.model)}`;
}

export function parsePlanModelDirective(value: string): PlanModelDirective | null {
  if (value === "follow-default") return FOLLOW_DEFAULT;
  const [tag, provider, model, ...rest] = value.split(":");
  if (tag !== "override" || provider === undefined || model === undefined || rest.length > 0) {
    return null;
  }
  const decodedProvider = decodeURIComponent(provider);
  const decodedModel = decodeURIComponent(model);
  if (decodedProvider.length === 0 || decodedModel.trim().length === 0) return null;
  return {
    _tag: "override",
    selection: { provider: ProviderDriverKind.make(decodedProvider), model: decodedModel },
  };
}
