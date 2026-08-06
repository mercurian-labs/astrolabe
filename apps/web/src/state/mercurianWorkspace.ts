import { useAtomValue } from "@effect/atom-react";
import { createMercurianWorkspaceAtoms } from "@t3tools/client-runtime/state/mercurian-workspace";
import {
  type PlanningModelResolution,
  type PlanningModelSelection,
  resolvePlanningModel,
  type WorkspaceSettingsSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { primaryServerProvidersAtom } from "./server";
import { useAtomCommand } from "./use-atom-command";

export const mercurianWorkspace = createMercurianWorkspaceAtoms(connectionAtomRuntime);

const EMPTY_SETTINGS_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: WorkspaceSettingsSnapshot },
    never
  >(false),
);

const UNSET: WorkspaceSettingsSnapshot = { planningModel: null };

export interface PlanningModelState {
  /** What the workspace saved: a provider and a model, never an instance. */
  readonly setting: PlanningModelSelection | null;
  /** What this machine makes of it right now — recomputed, never stored. */
  readonly resolution: PlanningModelResolution;
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * The workspace's planning model, and this machine's answer to it.
 *
 * The two halves come from different places on purpose. The pair is workspace
 * state and arrives over the workspace subscription; the instance it runs under
 * is a fact about this machine's signed-in accounts and is derived from the
 * live provider snapshots each time they change. A machine with no instance of
 * that provider still shows the saved pair — it just says so.
 */
export function usePlanningModel(): PlanningModelState {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null
      ? EMPTY_SETTINGS_ATOM
      : mercurianWorkspace.settings({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const item = Option.getOrNull(AsyncResult.value(result));
  const setting = (item?.snapshot ?? UNSET).planningModel;
  const failure = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  return {
    setting,
    resolution: resolvePlanningModel(setting, providers),
    isPending: item === null && environmentId !== null,
    error:
      failure === null
        ? null
        : failure instanceof Error
          ? failure.message
          : "Could not load the workspace settings.",
  };
}

/**
 * Name the workspace's planning model, or pass `null` to choose none. The
 * argument cannot name an instance, which is what keeps the setting meaningful
 * on every other machine in the workspace.
 */
export function useSetPlanningModel() {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(mercurianWorkspace.setPlanningModel);
  return useCallback(
    (planningModel: PlanningModelSelection | null) => {
      if (environmentId === null) {
        return Promise.resolve(false);
      }
      return run({ environmentId, input: { planningModel } }).then(
        (result) => result._tag === "Success",
      );
    },
    [environmentId, run],
  );
}
