/**
 * The tracker store's values as the wire carries them.
 *
 * One thing changes at this boundary: rows hold `DateTime.Utc`, contracts hold
 * ISO strings. Standing rides along beside the connection because it is not a
 * property *of* the row — it was probed a moment ago.
 *
 * Issues need no mapper. The connector already answers in the contracts' own
 * five-field shape, which is the point of the shape: there is no richer
 * server-side issue type for a mapper to narrow.
 *
 * @module TrackerWire
 */
import * as DateTime from "effect/DateTime";

import type * as Contracts from "@t3tools/contracts";

import type { TrackerConnectionStatus, TrackersSnapshot } from "./TrackerStore.ts";

export const toWireConnection = (status: TrackerConnectionStatus): Contracts.TrackerConnection => ({
  connectionId: status.connection.connectionId,
  kind: status.connection.kind,
  label: status.connection.label,
  standing: status.standing,
  createdAt: DateTime.formatIso(status.connection.createdAt),
});

export const toWireTrackersSnapshot = (snapshot: TrackersSnapshot): Contracts.TrackersSnapshot => ({
  connections: snapshot.connections.map(toWireConnection),
});
