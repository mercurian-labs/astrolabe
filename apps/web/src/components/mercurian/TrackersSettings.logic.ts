import type {
  MercurianConnectTrackerInput,
  TrackerConnection,
  TrackerKind,
  TrackerStanding,
} from "@t3tools/contracts";

export interface TrackerCredentialField {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly secret: boolean;
}

export interface TrackerKindPresentation {
  readonly name: string;
  readonly credentialHint: string;
  readonly fields: ReadonlyArray<TrackerCredentialField>;
}

/**
 * What Settings says about a tracker, and where its credentials come from.
 *
 * One entry per shipped connector. The connect dialog renders its list of
 * trackers from this record, so a new tracker becomes visible in the UI by
 * being added here — there is no second list to keep in step.
 */
export const TRACKER_KIND_PRESENTATION: Readonly<Record<TrackerKind, TrackerKindPresentation>> = {
  linear: {
    name: "Linear",
    credentialHint: "Create a personal API key in Linear under Settings → Security & access.",
    fields: [
      {
        key: "token",
        label: "Linear API key",
        placeholder: "lin_api_…",
        secret: true,
      },
    ],
  },
  jira: {
    name: "Jira",
    credentialHint:
      "Create an API token at id.atlassian.com under Security → Create and manage API tokens.",
    fields: [
      {
        key: "site",
        label: "Atlassian site",
        placeholder: "acme.atlassian.net",
        secret: false,
      },
      {
        key: "email",
        label: "Account email",
        placeholder: "you@acme.com",
        secret: false,
      },
      {
        key: "token",
        label: "API token",
        placeholder: "Your Atlassian API token",
        secret: true,
      },
    ],
  },
  github: {
    name: "GitHub Issues",
    credentialHint:
      "In GitHub, open Settings → Developer settings → Personal access tokens. The token needs issue read access to the repositories you want to browse.",
    fields: [
      {
        key: "token",
        label: "Personal access token",
        placeholder: "ghp_… or github_pat_…",
        secret: true,
      },
    ],
  },
};

export const TRACKER_KINDS = Object.keys(TRACKER_KIND_PRESENTATION) as ReadonlyArray<TrackerKind>;

/** Builds the kind's wire input only when every displayed field is complete. */
export function buildConnectInput(
  kind: TrackerKind,
  values: Readonly<Record<string, string>>,
): MercurianConnectTrackerInput | null {
  const read = (key: string) => {
    const value = values[key]?.trim();
    return value === undefined || value.length === 0 ? null : value;
  };

  switch (kind) {
    case "linear": {
      const token = read("token");
      return token === null ? null : { kind, token };
    }
    case "jira": {
      const site = read("site");
      const email = read("email");
      const token = read("token");
      return site === null || email === null || token === null
        ? null
        : { kind, site, email, token };
    }
    case "github": {
      const token = read("token");
      return token === null ? null : { kind, token };
    }
  }
}

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
