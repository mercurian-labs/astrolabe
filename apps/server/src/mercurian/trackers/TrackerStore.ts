/**
 * TrackerStore — the tracker connections this workspace holds, and the live
 * read they reach.
 *
 * Three rules shape the whole surface:
 *
 * - **the credential is never a row.** It is written to the server's secret
 *   store as a file, `0600`, keyed by connection id, and read back only at the
 *   moment a connector call needs it. Nothing returns it, logs it, or stores it
 *   in sqlite;
 * - **standing is never stored.** Where a connection stands is a fact about the
 *   outside world, so it is probed live behind a short-lived cache. A key
 *   revoked in the tracker decays to `unauthorized` on its own, with no refresh
 *   button and no column to go stale;
 * - **no issue is ever stored.** `listIssues` is a pass-through to the
 *   connector. Import is selection, not synchronization, so there is no issue
 *   table for a stale copy to live in.
 *
 * The store composes the connector registry rather than knowing any tracker:
 * every kind answers in the same five-field shape, and the interface it answers
 * through has no write method — which is what makes "Mercurian never writes to
 * the tracker" a property of the types rather than a rule to remember.
 *
 * It knows nothing about plans, deliberately: a connection is workspace
 * configuration, and disconnecting one can never dangle a plan because an
 * imported plan's origin is content and history, not a foreign key into here.
 *
 * @module TrackerStore
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  TrackerAuthError,
  TrackerConnectionNotFoundError,
  TrackerUnreachableError,
  type TrackerIssuePage,
  type TrackerStanding,
} from "@t3tools/contracts";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import type { TrackerConnectorRefusal } from "./connector.ts";
import { TrackerConnectors } from "./connectors/registry.ts";
import {
  TrackerConnectionId,
  TrackerConnectionRecord,
  TrackerKind,
  trackerSecretName,
} from "./schema.ts";

// ===============================
// Domain
// ===============================

/** A connection with the standing its probe just reported. */
export interface TrackerConnectionStatus {
  readonly connection: TrackerConnectionRecord;
  readonly standing: TrackerStanding;
}

export interface TrackersSnapshot {
  readonly connections: ReadonlyArray<TrackerConnectionStatus>;
}

export type TrackerStoreRefusal =
  | TrackerConnectionNotFoundError
  | TrackerAuthError
  | TrackerUnreachableError;

export type TrackerStoreError = TrackerStoreRefusal | PersistenceSqlError | PersistenceDecodeError;

// ===============================
// Inputs
// ===============================

export const ConnectTrackerInput = Schema.Struct({
  kind: TrackerKind,
  /** The credential. Validated before anything is written, then filed away. */
  token: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
export type ConnectTrackerInput = typeof ConnectTrackerInput.Type;

export const DisconnectTrackerInput = Schema.Struct({ connectionId: TrackerConnectionId });
export type DisconnectTrackerInput = typeof DisconnectTrackerInput.Type;

export const ListTrackerIssuesInput = Schema.Struct({
  connectionId: TrackerConnectionId,
  search: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});
export type ListTrackerIssuesInput = typeof ListTrackerIssuesInput.Type;

// ===============================
// Service
// ===============================

export class TrackerStore extends Context.Service<
  TrackerStore,
  {
    /**
     * Probe first, then persist: a refused credential creates nothing, so a
     * mistyped key leaves no row and no secret file behind.
     */
    readonly connect: (
      input: ConnectTrackerInput,
    ) => Effect.Effect<TrackerConnectionStatus, TrackerStoreError>;
    /**
     * Forget the connection and its credential. Nothing in the tracker is
     * touched — there is no call that could.
     */
    readonly disconnect: (input: DisconnectTrackerInput) => Effect.Effect<void, TrackerStoreError>;
    /** Every connection with where it stands, probed live behind a short TTL. */
    readonly getSnapshot: Effect.Effect<TrackersSnapshot, TrackerStoreError>;
    /**
     * A page of the tracker's issues, fetched live and never stored. This is
     * the read issue import pages through.
     */
    readonly listIssues: (
      input: ListTrackerIssuesInput,
    ) => Effect.Effect<TrackerIssuePage, TrackerStoreError>;
    /** Fires once per mutation. What keeps a subscribed Settings page fresh. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/trackers/TrackerStore") {}

// ===============================
// Rows
// ===============================

const ConnectionIdRequest = Schema.Struct({ connectionId: TrackerConnectionId });
const NoRequest = Schema.Struct({});

/**
 * How long a probed standing is trusted. Short enough that a revoked key
 * surfaces on its own within a minute, long enough that a re-emitting
 * subscription is not a probe per keystroke.
 */
const DEFAULT_STANDING_CACHE_TTL = Duration.minutes(1);
const DEFAULT_STANDING_CACHE_CAPACITY = 64;

export interface TrackerStoreOptions {
  /** Zero it in tests, so standing can be observed changing without a sleep. */
  readonly standingCacheTtl?: Duration.Input;
  readonly standingCacheCapacity?: number;
}

const isTrackerStoreRefusal = Schema.is(
  Schema.Union([TrackerConnectionNotFoundError, TrackerAuthError, TrackerUnreachableError]),
);

function toTrackerStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): TrackerStoreError =>
    isTrackerStoreRefusal(cause)
      ? cause
      : Schema.isSchemaError(cause)
        ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
        : isPersistenceError(cause)
          ? cause
          : new PersistenceSqlError({ operation: sqlOperation, cause });
}

export const make = Effect.fn("TrackerStore.make")(function* (options: TrackerStoreOptions = {}) {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore;
  const connectors = yield* TrackerConnectors;
  const crypto = yield* Crypto.Crypto;
  const changesPubSub = yield* PubSub.unbounded<void>();

  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  const connectionColumns = sql`
    connection_id AS "connectionId",
    kind AS "kind",
    label AS "label",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const insertConnectionRow = SqlSchema.void({
    Request: TrackerConnectionRecord,
    execute: (row) => sql`
      INSERT INTO tracker_connections (connection_id, kind, label, created_at, updated_at)
      VALUES (${row.connectionId}, ${row.kind}, ${row.label}, ${row.createdAt}, ${row.updatedAt})
    `,
  });

  const findConnectionRow = SqlSchema.findOneOption({
    Request: ConnectionIdRequest,
    Result: TrackerConnectionRecord,
    execute: ({ connectionId }) => sql`
      SELECT ${connectionColumns}
      FROM tracker_connections
      WHERE connection_id = ${connectionId}
    `,
  });

  const listConnectionRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: TrackerConnectionRecord,
    execute: () => sql`
      SELECT ${connectionColumns}
      FROM tracker_connections
      ORDER BY created_at ASC, connection_id ASC
    `,
  });

  const deleteConnectionRow = SqlSchema.void({
    Request: ConnectionIdRequest,
    execute: ({ connectionId }) => sql`
      DELETE FROM tracker_connections WHERE connection_id = ${connectionId}
    `,
  });

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const readToken = Effect.fn("TrackerStore.readToken")(function* (
    connection: TrackerConnectionRecord,
  ) {
    const stored = yield* secrets.get(trackerSecretName(connection.connectionId));
    // A connection whose credential is gone cannot be authorized. Reporting it
    // as a refused key is the truth a person can act on — reconnect.
    if (Option.isNone(stored)) {
      return yield* new TrackerAuthError({ kind: connection.kind });
    }
    return decoder.decode(stored.value);
  });

  const toStoreRefusal = (kind: TrackerKind) => (refusal: TrackerConnectorRefusal) =>
    refusal._tag === "TrackerAuthRefusal"
      ? new TrackerAuthError({ kind })
      : new TrackerUnreachableError({ kind });

  /**
   * Standing, probed live and cached per connection for a minute. The key is
   * the connection, never its credential: the token stays in the secret store
   * and in the one request that uses it.
   *
   * A *lookup* failure — the secret store itself broke — is deliberately not
   * cached. That is a local fault, not a verdict about the tracker, and it
   * should clear on the next read instead of sticking for a minute.
   */
  const standingCache = yield* Cache.makeWith(
    (key: string) => {
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator) as TrackerKind;
      const connectionId = TrackerConnectionId.make(key.slice(separator + 1));
      return secrets.get(trackerSecretName(connectionId)).pipe(
        Effect.flatMap(
          Option.match({
            // A connection whose credential vanished cannot be authorized.
            onNone: () => Effect.succeed<TrackerStanding>("unauthorized"),
            onSome: (stored) =>
              connectors[kind].probe(decoder.decode(stored)).pipe(
                Effect.as<TrackerStanding>("connected"),
                Effect.catch((refusal) =>
                  Effect.succeed<TrackerStanding>(
                    refusal._tag === "TrackerAuthRefusal" ? "unauthorized" : "unreachable",
                  ),
                ),
              ),
          }),
        ),
      );
    },
    {
      capacity: options.standingCacheCapacity ?? DEFAULT_STANDING_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: () => options.standingCacheTtl ?? DEFAULT_STANDING_CACHE_TTL,
        onFailure: () => Duration.zero,
      }),
    },
  );

  const standingKey = (connection: Pick<TrackerConnectionRecord, "kind" | "connectionId">) =>
    `${connection.kind}:${connection.connectionId}`;

  const readStanding = (connection: TrackerConnectionRecord) =>
    Cache.get(standingCache, standingKey(connection));

  const requireConnection = Effect.fn("TrackerStore.requireConnection")(function* (
    connectionId: TrackerConnectionId,
  ) {
    const found = yield* findConnectionRow({ connectionId });
    if (Option.isNone(found)) {
      return yield* new TrackerConnectionNotFoundError({ connectionId });
    }
    return found.value;
  });

  const connect: TrackerStore["Service"]["connect"] = (input) =>
    Effect.gen(function* () {
      // The probe comes first and its refusal returns as-is: nothing is written
      // until the tracker itself has said the credential works.
      const probed = yield* connectors[input.kind]
        .probe(input.token)
        .pipe(Effect.mapError(toStoreRefusal(input.kind)));

      const connectionId = TrackerConnectionId.make(yield* crypto.randomUUIDv4);
      const connection = {
        connectionId,
        kind: input.kind,
        label: probed.label,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      } satisfies TrackerConnectionRecord;

      const secretName = trackerSecretName(connectionId);
      yield* secrets.set(secretName, encoder.encode(input.token));
      // A credential with no connection to belong to is an orphan, so the row
      // failing takes the secret down with it.
      yield* sql
        .withTransaction(insertConnectionRow(connection))
        .pipe(Effect.tapCause(() => secrets.remove(secretName).pipe(Effect.ignore)));

      // Seed the cache from the probe that just succeeded, so a fresh
      // connection reads `connected` immediately rather than probing twice.
      yield* Cache.set(standingCache, standingKey(connection), "connected");
      yield* announceChange;
      return { connection, standing: "connected" as const };
    }).pipe(
      Effect.mapError(
        toTrackerStoreError("TrackerStore.connect:query", "TrackerStore.connect:encodeRequest"),
      ),
    );

  const disconnect: TrackerStore["Service"]["disconnect"] = (input) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection(input.connectionId);
      yield* sql.withTransaction(deleteConnectionRow({ connectionId: input.connectionId }));
      // `remove` treats a missing file as success, so row-then-secret is
      // idempotent however a previous attempt died.
      yield* secrets.remove(trackerSecretName(input.connectionId));
      yield* Cache.invalidate(standingCache, standingKey(connection));
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toTrackerStoreError(
          "TrackerStore.disconnect:query",
          "TrackerStore.disconnect:encodeRequest",
        ),
      ),
    );

  const getSnapshot: TrackerStore["Service"]["getSnapshot"] = Effect.gen(function* () {
    const connections = yield* listConnectionRows({});
    const statuses = yield* Effect.forEach(
      connections,
      (connection) =>
        readStanding(connection).pipe(Effect.map((standing) => ({ connection, standing }))),
      { concurrency: "unbounded" },
    );
    return { connections: statuses } satisfies TrackersSnapshot;
  }).pipe(
    Effect.mapError(
      toTrackerStoreError("TrackerStore.getSnapshot:query", "TrackerStore.getSnapshot:decodeRows"),
    ),
  );

  const listIssues: TrackerStore["Service"]["listIssues"] = (input) =>
    Effect.gen(function* () {
      const connection = yield* requireConnection(input.connectionId);
      const token = yield* readToken(connection);
      // Straight through to the connector and straight back out. Nothing here
      // writes: there is no issue table, and there never will be one.
      return yield* connectors[connection.kind]
        .listIssues(token, {
          ...(input.search === undefined ? {} : { search: input.search }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        })
        .pipe(Effect.mapError(toStoreRefusal(connection.kind)));
    }).pipe(
      Effect.mapError(
        toTrackerStoreError("TrackerStore.listIssues:query", "TrackerStore.listIssues:decodeRows"),
      ),
    );

  return {
    connect,
    disconnect,
    getSnapshot,
    listIssues,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies TrackerStore["Service"];
});

export const layer = Layer.effect(TrackerStore, make());
