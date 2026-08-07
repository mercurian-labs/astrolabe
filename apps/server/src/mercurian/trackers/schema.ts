/**
 * Tracker connections as the store holds them.
 *
 * The identifier, the kind, and the standing vocabulary are the contracts' — a
 * connection id means the same thing on both sides of the wire, so there is one
 * brand, not two. What differs here is time: rows carry `DateTime.Utc`, and the
 * wire boundary formats them.
 *
 * @module TrackerSchema
 */
import * as Schema from "effect/Schema";

import { TrackerConnectionId, TrackerKind, TrimmedNonEmptyString } from "@t3tools/contracts";

export { TrackerConnectionId, TrackerKind };

/**
 * A connected tracker. `label` is what the tracker called itself when the
 * connection was made — a display fact captured once, not synced state.
 *
 * There is no token field and no standing field, and there never should be:
 * the credential is a file in the secret store, and standing is derived live.
 */
export const TrackerConnectionRecord = Schema.Struct({
  connectionId: TrackerConnectionId,
  kind: TrackerKind,
  label: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type TrackerConnectionRecord = typeof TrackerConnectionRecord.Type;

/**
 * Where a connection's credential lives: one file per connection, under the
 * server's secrets directory, `0600`. Keyed by connection id rather than by
 * kind, because two workspaces of the same tracker are two connections with two
 * credentials.
 */
export const trackerSecretName = (connectionId: TrackerConnectionId): string =>
  `mercurian-tracker-${connectionId}`;
