import { MERCURIAN_TRACKER_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Mercurian's tracker connections: the connected trackers as a live
 * subscription, plus the acts that connect and disconnect one, plus the live
 * read of a connection's issues.
 *
 * The subscription re-sends the whole snapshot on change rather than carrying
 * deltas — connections are few and move only when a person connects or
 * disconnects one. Standing rides in the snapshot because the server probes it
 * live, so the page is passively truthful without a refresh control.
 *
 * `listTrackerIssues` is a read, not a write, but it rides a command for the
 * same reason `getPlanTextAt` does: it answers a question asked once, rather
 * than maintaining state worth subscribing to. Nothing in this module writes to
 * the tracker, because no such method exists to call.
 */
export function createMercurianTrackerAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Connect and disconnect are rare and global ordering is fine: there is no
  // per-connection key worth serializing against.
  const writeScheduler = createAtomCommandScheduler();
  return {
    trackers: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:trackers",
      tag: MERCURIAN_TRACKER_WS_METHODS.subscribeTrackers,
    }),
    connectTracker: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:connect-tracker",
      tag: MERCURIAN_TRACKER_WS_METHODS.connectTracker,
      scheduler: writeScheduler,
    }),
    disconnectTracker: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:disconnect-tracker",
      tag: MERCURIAN_TRACKER_WS_METHODS.disconnectTracker,
      scheduler: writeScheduler,
    }),
    listTrackerIssues: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:list-tracker-issues",
      tag: MERCURIAN_TRACKER_WS_METHODS.listTrackerIssues,
      scheduler: writeScheduler,
    }),
  };
}
