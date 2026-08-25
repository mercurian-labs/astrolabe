/**
 * Mercurian's workspace-scoped planning seed on the wire.
 *
 * The scoping rule this module exists to enforce: a provider *instance* is a
 * connected account on one machine, because signing in belongs to the
 * provider's agent on that machine. The workspace is shared. So nothing
 * workspace-level ever names an instance. The last-used planning model is named
 * abstractly — a provider, model, and optional provider options — and each
 * machine resolves that choice to one of its own instances at runtime,
 * freshly, never storing the answer.
 *
 * That is why {@link PlanningModelSelection} has no field an instance id could
 * occupy, and why {@link resolvePlanningModel} takes the machine's live
 * provider snapshots as an argument rather than reading anything persisted.
 *
 * @module MercurianWorkspaceContracts
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "./providerInstance.ts";
import { ProviderOptionSelections } from "./model.ts";
import { isProviderAvailable, type ServerProviders } from "./server.ts";

export const MERCURIAN_WORKSPACE_WS_METHODS = {
  subscribeWorkspaceSettings: "mercurian.subscribeWorkspaceSettings",
} as const;

/**
 * The workspace's whole vocabulary for the planning model: which provider,
 * which model of it, and any explicitly selected provider options. **There is
 * no instance field, and adding one would be a design decision rather than a
 * refactor** — an instance is machine-local, and a workspace that named one
 * would resolve to nothing on every other machine.
 *
 * `provider` is the open branded driver-kind slug (see `providerInstance`), so
 * a workspace can name a provider this build does not ship — a fork's driver, a
 * branch rolled back — and still round-trip. It simply resolves to nothing
 * here rather than failing to decode.
 */
export const PlanningModelSelection = Schema.Struct({
  provider: ProviderDriverKind,
  model: TrimmedNonEmptyString,
  options: Schema.optional(ProviderOptionSelections),
});
export type PlanningModelSelection = typeof PlanningModelSelection.Type;

/** Planning choices compare semantically; provider option order is not meaningful. */
export function planningModelSelectionsEqual(
  left: PlanningModelSelection,
  right: PlanningModelSelection,
): boolean {
  if (left.provider !== right.provider || left.model !== right.model) return false;
  const leftOptions = left.options ?? [];
  const rightOptions = right.options ?? [];
  return (
    leftOptions.length === rightOptions.length &&
    leftOptions.every((option) =>
      rightOptions.some(
        (candidate) => candidate.id === option.id && candidate.value === option.value,
      ),
    ) &&
    rightOptions.every((option) =>
      leftOptions.some(
        (candidate) => candidate.id === option.id && candidate.value === option.value,
      ),
    )
  );
}

/**
 * Every workspace-scoped setting in one value. `planningModel` records the
 * choice the workspace last planned under; `null` means nothing has run yet.
 */
export const WorkspaceSettingsSnapshot = Schema.Struct({
  planningModel: Schema.NullOr(PlanningModelSelection),
});
export type WorkspaceSettingsSnapshot = typeof WorkspaceSettingsSnapshot.Type;

/**
 * Workspace values are few and move only on discrete product acts, so the
 * subscription re-sends the whole value rather than carrying sequenced deltas —
 * the same shape the planning tree uses for the same reason.
 */
export const WorkspaceSettingsStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: WorkspaceSettingsSnapshot,
});
export type WorkspaceSettingsStreamItem = typeof WorkspaceSettingsStreamItem.Type;

export const MercurianSubscribeWorkspaceSettingsInput = Schema.Struct({});
export type MercurianSubscribeWorkspaceSettingsInput =
  typeof MercurianSubscribeWorkspaceSettingsInput.Type;

/**
 * Everything below the workspace-settings surface that a client cannot act on:
 * storage failures and decode failures. The underlying failure rides as
 * `cause` so the server log keeps the chain.
 */
export class MercurianWorkspaceError extends Schema.TaggedErrorClass<MercurianWorkspaceError>()(
  "MercurianWorkspaceError",
  {
    operation: Schema.Literal("subscribeWorkspaceSettings"),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian workspace operation ${this.operation} failed`;
  }
}

/**
 * What a machine makes of an abstract planning-model choice right now.
 *
 * `unresolved` is deliberately not a failure and never rewrites the pair:
 * the record stays saved, and the machine that lacks an instance says so. The
 * same workspace resolves fine on the machine that has one.
 */
export type PlanningModelResolution =
  | { readonly _tag: "unset" }
  | {
      readonly _tag: "resolved";
      readonly instanceId: ProviderInstanceId;
      readonly provider: ProviderDriverKind;
      readonly model: string;
    }
  | {
      readonly _tag: "unresolved";
      readonly reason: "no-instance" | "model-unavailable" | "not-signed-in" | "option-unavailable";
    };

/**
 * Resolve an abstract provider/model/options choice to one instance on this machine.
 * Pure: the picker renders it in a client, and a planning turn computes it server-side
 * against the registry's own snapshots.
 *
 * The rule, stated once:
 *
 *   - candidates are snapshots of that driver which are available, enabled,
 *     and installed — the ones that could actually run a turn;
 *   - among candidates offering the model, explicitly unauthenticated
 *     instances are set aside; authenticated and unknown instances are usable;
 *   - among usable offerers, the provider's default instance wins; otherwise
 *     the first candidate in snapshot order, which is settings order;
 *   - no candidates at all is `no-instance`; candidates but none offering the
 *     model is `model-unavailable`; offerers but none usable is
 *     `not-signed-in`.
 *
 * Capability gating flows through for free: a model the installed agent is too
 * old to run is already absent from the snapshot's `models`, so it resolves as
 * `model-unavailable` and the caller can name the unlocking upgrade from the
 * candidate's `versionAdvisory`.
 *
 * Curation is deliberately not consulted. Hiding a model is a picker
 * preference of one client; the recorded pair has to keep resolving on a
 * machine whose user hid it.
 */
export const resolvePlanningModel = (
  setting: PlanningModelSelection | null,
  providers: ServerProviders,
): PlanningModelResolution => {
  if (setting === null) {
    return { _tag: "unset" };
  }
  const candidates = providers.filter(
    (snapshot) =>
      snapshot.driver === setting.provider &&
      isProviderAvailable(snapshot) &&
      snapshot.enabled &&
      snapshot.installed,
  );
  if (candidates.length === 0) {
    return { _tag: "unresolved", reason: "no-instance" };
  }
  const offering = candidates.filter((snapshot) =>
    snapshot.models.some((model) => model.slug === setting.model),
  );
  if (offering.length === 0) {
    return { _tag: "unresolved", reason: "model-unavailable" };
  }
  const usable = offering.filter((snapshot) => snapshot.auth.status !== "unauthenticated");
  if (usable.length === 0) {
    return { _tag: "unresolved", reason: "not-signed-in" };
  }
  const defaultInstanceId = defaultInstanceIdForDriver(setting.provider);
  const chosen = usable.find((snapshot) => snapshot.instanceId === defaultInstanceId) ?? usable[0]!;
  const chosenModel = chosen.models.find((model) => model.slug === setting.model)!;
  const descriptors = chosenModel.capabilities?.optionDescriptors ?? [];
  const optionsOffered = (setting.options ?? []).every((selection) => {
    const descriptor = descriptors.find((candidate) => candidate.id === selection.id);
    if (descriptor === undefined) return false;
    if (descriptor.type === "boolean") return typeof selection.value === "boolean";
    return (
      typeof selection.value === "string" &&
      descriptor.options.some((option) => option.id === selection.value)
    );
  });
  if (!optionsOffered) {
    return { _tag: "unresolved", reason: "option-unavailable" };
  }
  return {
    _tag: "resolved",
    instanceId: chosen.instanceId,
    provider: setting.provider,
    model: setting.model,
  };
};
