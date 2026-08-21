/**
 * Mercurian's tracker surface on the wire: connecting a tracker, seeing where
 * each connection stands, and reading the issues a connection reaches.
 *
 * Mercurian is where issues get planned, never a mirror of the tracker. Two
 * properties of this file are what enforce that, structurally rather than by
 * review discipline:
 *
 * - {@link TrackerIssue} has exactly five fields. Labels, assignees, sprints
 *   and priorities have no field to land in — they stay in the tracker, one
 *   click away through the issue's own `url`;
 * - nothing here writes tracker-ward. The methods are a subscription, a
 *   connect, a disconnect, and a read; connections are pull-only, and
 *   write-back is a resolved-deferred decision, not an unimplemented one.
 *
 * Its own module rather than more of `mercurian.ts`, which is the planning
 * surface its header says it is.
 *
 * @module MercurianTrackerContracts
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MERCURIAN_TRACKER_WS_METHODS = {
  subscribeTrackers: "mercurian.subscribeTrackers",
  connectTracker: "mercurian.connectTracker",
  disconnectTracker: "mercurian.disconnectTracker",
  listTrackerIssues: "mercurian.listTrackerIssues",
} as const;

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const TrackerConnectionId = makeEntityId("TrackerConnectionId");
export type TrackerConnectionId = typeof TrackerConnectionId.Type;

/**
 * Which tracker a connection speaks to. One literal per *shipped* connector —
 * Jira and GitHub Issues are the named family, not a wire enum to pre-declare,
 * and each arrives with its own connector and its own connect inputs.
 */
export const TrackerKind = Schema.Literals(["linear", "jira", "github"]);
export type TrackerKind = typeof TrackerKind.Type;

/**
 * Where a connection stands *right now*. A fact about the outside world, so it
 * is derived live behind a short-lived cache and never stored: a key revoked in
 * the tracker decays to `unauthorized` on its own, without a refresh button.
 */
export const TrackerStanding = Schema.Literals(["connected", "unauthorized", "unreachable"]);
export type TrackerStanding = typeof TrackerStanding.Type;

/**
 * One connected tracker, as Settings renders it. The credential is not here and
 * never will be: it crosses the wire once, inbound, and nothing echoes it back.
 */
export const TrackerConnection = Schema.Struct({
  connectionId: TrackerConnectionId,
  kind: TrackerKind,
  /** What the tracker called itself when the connection was made. */
  label: TrimmedNonEmptyString,
  standing: TrackerStanding,
  createdAt: IsoDateTime,
});
export type TrackerConnection = typeof TrackerConnection.Type;

/**
 * The minimal common shape. Every connected tracker, whatever its API,
 * produces exactly this — id, title, description, a URL back to the origin,
 * and status. Nothing else crosses.
 *
 * Adding a field here is a design decision about what Mercurian is, not a
 * refactor: the narrowness is what keeps "don't rebuild the tracker" true
 * without anyone having to remember it.
 */
export const TrackerIssue = Schema.Struct({
  /** The tracker's own human-facing key — what a person would say out loud. */
  id: TrimmedNonEmptyString,
  title: Schema.String,
  /** `""` is a real state: an absent description is an empty one. */
  description: Schema.String,
  /** The canonical link back to the origin. Opening it opens the issue. */
  url: TrimmedNonEmptyString,
  /** The tracker's own status word, uninterpreted — normalizing across
   * trackers would be rebuilding tracker semantics. */
  status: Schema.String,
});
export type TrackerIssue = typeof TrackerIssue.Type;

/** A page of live issues. Never stored: import is selection, not synchronization. */
export const TrackerIssuePage = Schema.Struct({
  issues: Schema.Array(TrackerIssue),
  /** Opaque to Mercurian; hand it back to page on. Absent means the end. */
  nextCursor: Schema.optional(TrimmedNonEmptyString),
});
export type TrackerIssuePage = typeof TrackerIssuePage.Type;

/**
 * Every connection in one value. Connections are few and change only on
 * discrete human acts, so the subscription re-sends the whole snapshot rather
 * than carrying deltas — the planning tree's shape, for the same reason.
 */
export const TrackersSnapshot = Schema.Struct({
  connections: Schema.Array(TrackerConnection),
});
export type TrackersSnapshot = typeof TrackersSnapshot.Type;

export const TrackersStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: TrackersSnapshot,
});
export type TrackersStreamItem = typeof TrackersStreamItem.Type;

// ===============================
// Inputs
// ===============================

export const MercurianSubscribeTrackersInput = Schema.Struct({});
export type MercurianSubscribeTrackersInput = typeof MercurianSubscribeTrackersInput.Type;

/**
 * The credential's one and only crossing. It is validated against the tracker
 * before anything is written, so a refused key leaves nothing behind, and it is
 * stored as a file beside the server's other secrets — never as a row, never in
 * a response, never in a log.
 */
export const LinearConnectTrackerInput = Schema.Struct({
  kind: Schema.Literal("linear"),
  token: TrimmedNonEmptyString,
});
export type LinearConnectTrackerInput = typeof LinearConnectTrackerInput.Type;

export const JiraConnectTrackerInput = Schema.Struct({
  kind: Schema.Literal("jira"),
  site: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});
export type JiraConnectTrackerInput = typeof JiraConnectTrackerInput.Type;

export const GitHubConnectTrackerInput = Schema.Struct({
  kind: Schema.Literal("github"),
  token: TrimmedNonEmptyString,
});
export type GitHubConnectTrackerInput = typeof GitHubConnectTrackerInput.Type;

export const MercurianConnectTrackerInput = Schema.Union([
  LinearConnectTrackerInput,
  JiraConnectTrackerInput,
  GitHubConnectTrackerInput,
]);
export type MercurianConnectTrackerInput = typeof MercurianConnectTrackerInput.Type;

export const MercurianDisconnectTrackerInput = Schema.Struct({
  connectionId: TrackerConnectionId,
});
export type MercurianDisconnectTrackerInput = typeof MercurianDisconnectTrackerInput.Type;

/**
 * A live read of the tracker's issues. `cursor` is the previous page's
 * `nextCursor`; `search` is passed to the tracker, which is the only thing that
 * knows how to search its own backlog.
 */
export const MercurianListTrackerIssuesInput = Schema.Struct({
  connectionId: TrackerConnectionId,
  search: Schema.optional(Schema.String),
  cursor: Schema.optional(TrimmedNonEmptyString),
});
export type MercurianListTrackerIssuesInput = typeof MercurianListTrackerIssuesInput.Type;

// ===============================
// Refusals
// ===============================

export class TrackerConnectionNotFoundError extends Schema.TaggedErrorClass<TrackerConnectionNotFoundError>()(
  "TrackerConnectionNotFoundError",
  { connectionId: TrackerConnectionId },
) {
  override get message(): string {
    return `Tracker connection ${this.connectionId} does not exist`;
  }
}

/** The tracker understood the request and rejected the credential. */
export class TrackerAuthError extends Schema.TaggedErrorClass<TrackerAuthError>()(
  "TrackerAuthError",
  { kind: TrackerKind },
) {
  override get message(): string {
    return `The ${this.kind} credential was not accepted`;
  }
}

/** The tracker never answered — the network, or the service itself. */
export class TrackerUnreachableError extends Schema.TaggedErrorClass<TrackerUnreachableError>()(
  "TrackerUnreachableError",
  { kind: TrackerKind },
) {
  override get message(): string {
    return `Could not reach ${this.kind}`;
  }
}

export const isTrackerConnectionNotFoundError = Schema.is(TrackerConnectionNotFoundError);
export const isTrackerAuthError = Schema.is(TrackerAuthError);
export const isTrackerUnreachableError = Schema.is(TrackerUnreachableError);

/**
 * Everything below the tracker surface a client cannot act on: storage
 * failures, decode failures, secret-store failures. The underlying failure
 * rides as `cause` so the server log keeps the chain — and carries no payload
 * echo, because the payload held a credential.
 */
export class MercurianTrackerError extends Schema.TaggedErrorClass<MercurianTrackerError>()(
  "MercurianTrackerError",
  {
    operation: Schema.Literals([
      "subscribeTrackers",
      "connectTracker",
      "disconnectTracker",
      "listTrackerIssues",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian tracker operation ${this.operation} failed`;
  }
}
