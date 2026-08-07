import { useAtomValue } from "@effect/atom-react";
import { createMercurianTrackerAtoms } from "@t3tools/client-runtime/state/mercurian-trackers";
import type {
  MercurianConnectTrackerInput,
  TrackerConnection,
  TrackerConnectionId,
  TrackersSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import {
  useEnvironmentBoundCommand,
  useEnvironmentBoundCommandResult,
} from "./useEnvironmentBoundCommand";

export const mercurianTrackers = createMercurianTrackerAtoms(connectionAtomRuntime);

const EMPTY_TRACKERS_ATOM = Atom.make(
  AsyncResult.initial<{ readonly kind: "snapshot"; readonly snapshot: TrackersSnapshot }, never>(
    false,
  ),
);

const NO_CONNECTIONS: ReadonlyArray<TrackerConnection> = [];

export interface TrackersState {
  readonly connections: ReadonlyArray<TrackerConnection>;
  /** `true` until the first snapshot lands; Settings renders its empty state meanwhile. */
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * The connected trackers, live. There is no refresh: standing is probed on the
 * server behind a short cache, so a key revoked in the tracker shows up here on
 * its own within a minute.
 */
export function useTrackers(): TrackersState {
  const environmentId = usePrimaryEnvironmentId();
  const result = useAtomValue(
    environmentId === null
      ? EMPTY_TRACKERS_ATOM
      : mercurianTrackers.trackers({ environmentId, input: {} }),
  );
  const item = Option.getOrNull(AsyncResult.value(result));
  const failure = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  return {
    connections: item?.snapshot.connections ?? NO_CONNECTIONS,
    isPending: item === null && environmentId !== null && failure === null,
    error:
      failure === null
        ? null
        : failure instanceof Error
          ? failure.message
          : "Could not load tracker connections.",
  };
}

/**
 * Connect a tracker. The credential crosses once, on this call, and nothing
 * comes back carrying it — the answer is the connection's label and standing.
 *
 * Bound through {@link useEnvironmentBoundCommandResult} rather than the plain
 * bind: a rejected key and an unreachable tracker are different sentences in
 * the dialog, and only one of them is the person's to fix. That bind also
 * silences the toast, so a refusal the dialog renders is not also announced.
 */
export function useConnectTracker() {
  const run = useEnvironmentBoundCommandResult(mercurianTrackers.connectTracker);
  return useCallback((input: MercurianConnectTrackerInput) => run(input), [run]);
}

/**
 * Forget a connection and its credential. Nothing in the tracker is touched:
 * there is no call that could.
 */
export function useDisconnectTracker() {
  const run = useEnvironmentBoundCommand(mercurianTrackers.disconnectTracker);
  return useCallback((connectionId: TrackerConnectionId) => run({ connectionId }), [run]);
}

/**
 * A page of a connection's issues, fetched live and never stored. This is the
 * read issue import pages through; it exists here because the minimal common
 * shape is only demonstrable end to end on a real read.
 */
export function useListTrackerIssues() {
  const run = useEnvironmentBoundCommand(mercurianTrackers.listTrackerIssues);
  return useCallback(
    (input: { connectionId: TrackerConnectionId; search?: string; cursor?: string }) => run(input),
    [run],
  );
}
