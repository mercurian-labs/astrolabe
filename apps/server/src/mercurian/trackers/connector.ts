/**
 * The connector seam: one interface every tracker implements, and the narrow
 * shape all of them produce.
 *
 * Two things about this interface are the design, not an implementation detail:
 *
 * - it has **no write method**. A connector cannot push anything tracker-ward,
 *   because there is nowhere to put it. Pull-only is a property of the type,
 *   which is what "Mercurian never writes to the tracker" means structurally;
 * - it answers in {@link TrackerIssue} — id, title, description, url, status —
 *   and nothing else. Labels, assignees, sprints and priorities have no field
 *   to land in.
 *
 * Adding Jira or GitHub Issues later is one literal on `TrackerKind`, one
 * connector file, and one registry entry. Nothing in the store, on the wire, or
 * in the UI changes shape — which is what keeps each additional tracker cheap.
 *
 * @module TrackerConnector
 */
import type * as Effect from "effect/Effect";

import type {
  MercurianConnectTrackerInput,
  TrackerIssue,
  TrackerIssuePage,
  TrackerKind,
} from "@t3tools/contracts";

export type ConnectTrackerInputFor<K extends TrackerKind> = Extract<
  MercurianConnectTrackerInput,
  { readonly kind: K }
>;

/** What a successful probe learned: the name to show the connection by. */
export interface TrackerProbeResult {
  /** What the tracker calls the workspace this credential reaches. */
  readonly label: string;
}

/**
 * The two ways a tracker says no. They are separate because the Settings row
 * and the connect dialog say different things for each: a wrong key is the
 * person's to fix, an unreachable service is not.
 */
export type TrackerConnectorRefusal =
  | { readonly _tag: "TrackerAuthRefusal" }
  | { readonly _tag: "TrackerUnreachableRefusal" };

export const trackerAuthRefusal: TrackerConnectorRefusal = { _tag: "TrackerAuthRefusal" };
export const trackerUnreachableRefusal: TrackerConnectorRefusal = {
  _tag: "TrackerUnreachableRefusal",
};

/** What a browse asks for. `search` and `cursor` are the tracker's own. */
export interface TrackerIssueQuery {
  readonly search?: string | undefined;
  readonly cursor?: string | undefined;
}

export interface TrackerConnector<K extends TrackerKind> {
  readonly kind: K;
  /** Packs this tracker's connect fields into its one opaque stored credential. */
  readonly packCredential: (input: ConnectTrackerInputFor<K>) => string;
  /**
   * Validates the credential and names what it reaches. Run before anything is
   * written at connect time, and again — cheaply, behind a cache — to say where
   * a connection stands.
   */
  readonly probe: (
    credential: string,
  ) => Effect.Effect<TrackerProbeResult, TrackerConnectorRefusal>;
  /**
   * The live browse, and the only issue-shaped read there is. Never stored:
   * import is selection, not synchronization.
   */
  readonly listIssues: (
    credential: string,
    query: TrackerIssueQuery,
  ) => Effect.Effect<TrackerIssuePage, TrackerConnectorRefusal>;
  /** Read one origin live for an explicit refresh. Null means it no longer exists. */
  readonly getIssue: (
    credential: string,
    issueId: string,
  ) => Effect.Effect<TrackerIssue | null, TrackerConnectorRefusal>;
}

/**
 * The registry every tracker-aware service reads. Total over `TrackerKind`, so
 * a new literal without a connector is a type error rather than a runtime hole.
 */
export type TrackerConnectorRegistry = Readonly<{
  [K in TrackerKind]: TrackerConnector<K>;
}>;

export type { TrackerIssue, TrackerIssuePage };
