import { useAtomValue } from "@effect/atom-react";
import { createMercurianWorkspaceAtoms } from "@t3tools/client-runtime/state/mercurian-workspace";
import {
  type PlanningModelResolution,
  type PlanningModelSelection,
  resolvePlanningModel,
  type ServerProvider,
  type UnifiedSettings,
  type WorkspaceSettingsSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimarySettings } from "../hooks/useSettings";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries } from "../providerInstances";
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
  /**
   * The snapshots the resolution was computed against, with settings overlaid.
   * Callers deriving picker options must use these rather than the raw stream,
   * or their options and the resolution disagree for a probe cycle.
   */
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * Provider snapshots with the current settings overlaid.
 *
 * A probe keeps reporting its previous `enabled` until the next reconciliation,
 * so a person who just disabled an instance would otherwise be told for several
 * seconds that the planning model still runs on it. Settings are the newer
 * truth about whether an instance is wanted; the probe stays authoritative
 * about everything it actually measured.
 */
export function withProviderSettingsOverlay(
  providers: ReadonlyArray<ServerProvider>,
  settings: Pick<UnifiedSettings, "providerInstances" | "providers">,
): ReadonlyArray<ServerProvider> {
  return applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings).map(
    (entry) =>
      entry.enabled === entry.snapshot.enabled
        ? entry.snapshot
        : { ...entry.snapshot, enabled: entry.enabled },
  );
}

function useResolvableProviders(): ReadonlyArray<ServerProvider> {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const settings = usePrimarySettings();
  return useMemo(() => withProviderSettingsOverlay(providers, settings), [providers, settings]);
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
  const providers = useResolvableProviders();
  const item = Option.getOrNull(AsyncResult.value(result));
  const setting = (item?.snapshot ?? UNSET).planningModel;
  const failure = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  return {
    setting,
    resolution: resolvePlanningModel(setting, providers),
    providers,
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
