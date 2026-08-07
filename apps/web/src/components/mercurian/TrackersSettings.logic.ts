import type { TrackerConnection, TrackerKind, TrackerStanding } from "@t3tools/contracts";

/**
 * What Settings says about a tracker, and where its credentials come from.
 *
 * One entry per shipped connector. The connect dialog renders its list of
 * trackers from this record, so a new tracker becomes visible in the UI by
 * being added here — there is no second list to keep in step.
 */
export const TRACKER_KIND_PRESENTATION: Readonly<
  Record<TrackerKind, { readonly name: string; readonly credentialHint: string }>
> = {
  linear: {
    name: "Linear",
    credentialHint: "Create a personal API key in Linear under Settings → Security & access.",
  },
};

export const TRACKER_KINDS = Object.keys(TRACKER_KIND_PRESENTATION) as ReadonlyArray<TrackerKind>;

export interface StandingPresentation {
  readonly label: string;
  readonly tone: "neutral" | "warning";
  /** One line saying what the standing means and what to do about it. */
  readonly detail: string;
}

/**
 * Standing is a live fact, not a stored one, so its copy says what is true
 * right now rather than what once happened. `connected` stays quiet; the two
 * refusals are distinguished because only one of them is the person's to fix.
 */
export function presentStanding(
  standing: TrackerStanding,
  trackerName: string,
): StandingPresentation {
  switch (standing) {
    case "connected":
      return {
        label: "Connected",
        tone: "neutral",
        detail: `${trackerName} is answering.`,
      };
    case "unauthorized":
      return {
        label: "Key rejected",
        tone: "warning",
        detail: `${trackerName} is no longer accepting this key. Disconnect and connect again with a new one.`,
      };
    case "unreachable":
      return {
        label: "Unreachable",
        tone: "warning",
        detail: `Could not reach ${trackerName}. This usually clears on its own.`,
      };
  }
}

export const trackerName = (kind: TrackerKind): string => TRACKER_KIND_PRESENTATION[kind].name;

/** How a connection row reads: which tracker, which workspace, since when. */
export interface ConnectionRowPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly standing: StandingPresentation;
}

export function presentConnection(
  connection: TrackerConnection,
  formatDate: (isoDate: string) => string,
): ConnectionRowPresentation {
  const name = trackerName(connection.kind);
  return {
    title: name,
    // The label is what the tracker called itself at connect time, so it is the
    // thing a person recognizes the connection by when they have two.
    subtitle: `${connection.label} · connected ${formatDate(connection.createdAt)}`,
    standing: presentStanding(connection.standing, name),
  };
}

/**
 * What the connect dialog shows when an attempt fails. The two refusals say
 * different things because one of them is actionable and the other is not;
 * anything else is ours, not the person's, and says so without pretending to
 * know more.
 */
export function presentConnectFailure(
  failure: { readonly _tag?: string } | null | undefined,
  kind: TrackerKind,
): string | null {
  if (failure === null || failure === undefined) return null;
  const name = trackerName(kind);
  switch (failure._tag) {
    case "TrackerAuthError":
      return `${name} did not accept this key.`;
    case "TrackerUnreachableError":
      return `Could not reach ${name}. Check the connection and try again.`;
    default:
      return `Could not connect to ${name}.`;
  }
}
