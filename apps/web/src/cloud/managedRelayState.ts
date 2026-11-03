import { useAtomValue } from "@effect/atom-react";
import {
  createManagedRelayQueryManager,
  deregisterManagedRelayEnvironment,
  ManagedRelay,
  managedRelaySessionAtom,
  readManagedRelaySnapshotState,
} from "@t3tools/client-runtime/relay";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MANAGED_TUNNEL_LIMIT,
  T3CHAT_PLAN_TUNNEL_LIMITS,
  type RelayClientDeviceRecord,
  type RelayClientEnvironmentRecord,
  type RelayT3ChatLinkResponse,
} from "@t3tools/contracts/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom } from "effect/reactivity";

import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const managedRelayAtomRuntime = Atom.runtime(
  Layer.effect(
    ManagedRelay.ManagedRelayClient,
    runtime.contextEffect.pipe(
      Effect.map((context) => Context.get(context, ManagedRelay.ManagedRelayClient)),
    ),
  ),
);

const managedRelayQueryManager = createManagedRelayQueryManager(managedRelayAtomRuntime);

const managedRelayMutationScheduler = createAtomCommandScheduler();

export const deregisterManagedRelayEnvironmentCommand = createRuntimeCommand(
  managedRelayAtomRuntime,
  {
    label: "web:managed-relay:deregister-environment",
    scheduler: managedRelayMutationScheduler,
    concurrency: {
      mode: "serial",
      key: (input: { readonly accountId: string; readonly environmentId: EnvironmentId }) =>
        input.accountId,
    },
    execute: (input, registry) => deregisterManagedRelayEnvironment(registry, input),
  },
);

const EMPTY_T3CHAT_LINK_ATOM = Atom.make(
  AsyncResult.success<RelayT3ChatLinkResponse>({ available: false, link: null }),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:web:t3chat-link:null"));

function useManagedRelayT3ChatLink() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId
    ? managedRelayQueryManager.t3ChatLinkAtom(accountId)
    : EMPTY_T3CHAT_LINK_ATOM;
  const snapshot = readManagedRelaySnapshotState(useAtomValue(atom));
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshT3ChatLink(appAtomRegistry, accountId);
    }
  };

  return { ...snapshot, accountId, refresh };
}

const EMPTY_ENVIRONMENTS_ATOM = Atom.make(
  AsyncResult.success<ReadonlyArray<RelayClientEnvironmentRecord>>([]),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:web:environments:null"));

const EMPTY_DEVICES_ATOM = Atom.make(
  AsyncResult.success<ReadonlyArray<RelayClientDeviceRecord>>([]),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:web:devices:null"));

export function useManagedRelayEnvironments() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId
    ? managedRelayQueryManager.environmentsAtom(accountId)
    : EMPTY_ENVIRONMENTS_ATOM;
  const result = useAtomValue(atom);
  const snapshot = readManagedRelaySnapshotState(result);
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshEnvironments(appAtomRegistry, accountId);
    }
  };

  return {
    ...snapshot,
    accountId,
    refresh,
  };
}

export function useManagedRelayDevices() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId ? managedRelayQueryManager.devicesAtom(accountId) : EMPTY_DEVICES_ATOM;
  const result = useAtomValue(atom);
  const snapshot = readManagedRelaySnapshotState(result);
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshDevices(appAtomRegistry, accountId);
    }
  };

  return {
    ...snapshot,
    accountId,
    refresh,
  };
}

// Mirrors the relay's cap: a manual override is exact, otherwise a linked plan raises the default.
// Astrolabe offers no plan linking, so the relay's cap is read but never upsold.
function managedTunnelLimit(t3Chat: RelayT3ChatLinkResponse): number {
  if (t3Chat.maxTunnelsOverride !== undefined) return t3Chat.maxTunnelsOverride;
  if (!t3Chat.available) return DEFAULT_MANAGED_TUNNEL_LIMIT;
  switch (t3Chat.link?.plan) {
    case "premier":
      return T3CHAT_PLAN_TUNNEL_LIMITS.premier;
    case "pro":
      return T3CHAT_PLAN_TUNNEL_LIMITS.pro;
    default:
      return DEFAULT_MANAGED_TUNNEL_LIMIT;
  }
}

/** Refetches the account's environments and tunnel cap after a tunnel changes. */
export function refreshManagedTunnelUsage() {
  const accountId = appAtomRegistry.get(managedRelaySessionAtom)?.accountId;
  if (!accountId) return;
  managedRelayQueryManager.refreshEnvironments(appAtomRegistry, accountId);
  managedRelayQueryManager.refreshT3ChatLink(appAtomRegistry, accountId);
}

/** Managed tunnels on this account and its cap. Null fields are still loading or failed. */
export function useManagedTunnelUsage() {
  const environments = useManagedRelayEnvironments();
  const t3Chat = useManagedRelayT3ChatLink();
  const used =
    environments.accountId === null
      ? null
      : (environments.data?.filter(
          (environment) => environment.endpoint.providerKind === "cloudflare_tunnel",
        ).length ?? null);
  return {
    used,
    limit: t3Chat.accountId !== null && t3Chat.data ? managedTunnelLimit(t3Chat.data) : null,
    refresh: refreshManagedTunnelUsage,
  };
}
