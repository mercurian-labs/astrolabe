import {
  type PlanningModelResolution,
  type PlanningModelSelection,
  resolvePlanningModel,
  type ServerProvider,
} from "@t3tools/contracts";

export interface PlanningModelDerivation {
  readonly setting: PlanningModelSelection | null;
  readonly resolution: PlanningModelResolution;
  readonly providers: ReadonlyArray<ServerProvider>;
}

export function derivePlanningModelState(
  setting: PlanningModelSelection | null,
  providers: ReadonlyArray<ServerProvider>,
): PlanningModelDerivation {
  return { setting, resolution: resolvePlanningModel(setting, providers), providers };
}
