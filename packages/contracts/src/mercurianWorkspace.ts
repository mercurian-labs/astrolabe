/**
 * Mercurian's workspace settings on the wire — the settings that belong to the
 * workspace rather than to the machine it happens to be running on.
 *
 * The scoping rule this module exists to enforce: a provider *instance* is a
 * connected account on one machine, because signing in belongs to the
 * provider's agent on that machine. The workspace is shared. So nothing
 * workspace-level ever names an instance. The planning model is named
 * abstractly — a provider and a model — and each machine resolves that pair to
 * one of its own instances at runtime, freshly, never storing the answer.
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
import { isProviderAvailable, type ServerProviders } from "./server.ts";

export const MERCURIAN_WORKSPACE_WS_METHODS = {
  subscribeWorkspaceSettings: "mercurian.subscribeWorkspaceSettings",
  setPlanningModel: "mercurian.setPlanningModel",
} as const;

/**
 * The workspace's whole vocabulary for the planning model: which provider, and
 * which model of it. **There is no instance field, and adding one would be a
 * design decision rather than a refactor** — an instance is machine-local, and
 * a workspace that named one would resolve to nothing on every other machine.
 *
 * `provider` is the open branded driver-kind slug (see `providerInstance`), so
 * a workspace can name a provider this build does not ship — a fork's driver, a
 * branch rolled back — and still round-trip. It simply resolves to nothing
 * here rather than failing to decode.
 */
export const PlanningModelSelection = Schema.Struct({
  provider: ProviderDriverKind,
  model: TrimmedNonEmptyString,
});
export type PlanningModelSelection = typeof PlanningModelSelection.Type;

/**
 * Every workspace-scoped setting in one value. `null` is a real state for the
 * planning model: no one has chosen one yet.
 */
export const WorkspaceSettingsSnapshot = Schema.Struct({
  planningModel: Schema.NullOr(PlanningModelSelection),
});
export type WorkspaceSettingsSnapshot = typeof WorkspaceSettingsSnapshot.Type;

/**
 * Workspace settings are few and move only on discrete human acts, so the
 * subscription re-sends the whole value rather than carrying sequenced deltas —
 * the same shape the planning tree uses for the same reason.
 */
export const WorkspaceSettingsStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: WorkspaceSettingsSnapshot,
});
export type WorkspaceSettingsStreamItem = typeof WorkspaceSettingsStreamItem.Type;

/** `null` clears the setting: choosing nothing is a choice a person can make. */
export const MercurianSetPlanningModelInput = Schema.Struct({
  planningModel: Schema.NullOr(PlanningModelSelection),
});
export type MercurianSetPlanningModelInput = typeof MercurianSetPlanningModelInput.Type;

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
    operation: Schema.Literals(["subscribeWorkspaceSettings", "setPlanningModel"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian workspace operation ${this.operation} failed`;
  }
}

/**
 * What a machine makes of the workspace's planning model right now.
 *
 * `unresolved` is deliberately not a failure and never rewrites the setting:
 * the pair stays saved, and the machine that lacks an instance says so. The
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
      readonly reason: "no-instance" | "model-unavailable";
    };

/**
 * Resolve the workspace's abstract provider/model pair to one instance on this
 * machine. Pure, and written for both callers from day one: the settings row
 * renders it in a client, and a planning turn will compute it server-side
 * against the registry's own snapshots.
 *
 * The rule, stated once:
 *
 *   - candidates are snapshots of that driver which are available, enabled,
 *     and installed — the ones that could actually run a turn;
 *   - among candidates offering the model, the provider's default instance
 *     wins; otherwise the first candidate in snapshot order, which is settings
 *     order;
 *   - no candidates at all is `no-instance`; candidates but none offering the
 *     model is `model-unavailable`.
 *
 * Capability gating flows through for free: a model the installed agent is too
 * old to run is already absent from the snapshot's `models`, so it resolves as
 * `model-unavailable` and the caller can name the unlocking upgrade from the
 * candidate's `versionAdvisory`.
 *
 * Curation is deliberately not consulted. Hiding a model is a picker
 * preference of one client; the workspace setting has to keep resolving on a
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
  const defaultInstanceId = defaultInstanceIdForDriver(setting.provider);
  const chosen =
    offering.find((snapshot) => snapshot.instanceId === defaultInstanceId) ?? offering[0]!;
  return {
    _tag: "resolved",
    instanceId: chosen.instanceId,
    provider: setting.provider,
    model: setting.model,
  };
};
