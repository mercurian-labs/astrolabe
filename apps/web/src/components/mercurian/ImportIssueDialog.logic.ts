import type {
  MercurianListTrackerIssuesInput,
  PlanImportResult,
  TrackerConnection,
  TrackerConnectionId,
  TrackerIssue,
  TrackerIssuePage,
} from "@t3tools/contracts";

/**
 * Which connection the browse opens on.
 *
 * One connection needs no picker — asking someone to choose from a list of one
 * is a step that only exists to be dismissed. With none, or with several,
 * nothing is chosen for them.
 */
export function autoSelectedConnectionId(
  connections: ReadonlyArray<TrackerConnection>,
): TrackerConnectionId | null {
  return connections.length === 1 ? (connections[0]?.connectionId ?? null) : null;
}

/**
 * Whichever of the chosen and the available connections still agree.
 *
 * Connections arrive live, so the one being browsed can be disconnected in
 * another window mid-browse. Re-deriving rather than trusting the stored choice
 * is what keeps the dialog from paging against a connection that is gone.
 */
export function resolveConnectionId(
  connections: ReadonlyArray<TrackerConnection>,
  chosen: TrackerConnectionId | null,
): TrackerConnectionId | null {
  if (chosen !== null && connections.some((one) => one.connectionId === chosen)) {
    return chosen;
  }
  return autoSelectedConnectionId(connections);
}

/**
 * What to ask the tracker for. `search` goes to the tracker, which is the only
 * thing that knows how to search its own backlog; `cursor` is the previous
 * page's, and its absence is what makes this the first page.
 *
 * Both are omitted when empty rather than sent blank: the contract's optionals
 * mean "not asked", and an empty search is not a search for nothing.
 */
export function buildIssuesRequest(input: {
  readonly connectionId: TrackerConnectionId;
  readonly search: string;
  readonly cursor?: TrackerIssuePage["nextCursor"];
}): MercurianListTrackerIssuesInput {
  const search = input.search.trim();
  return {
    connectionId: input.connectionId,
    ...(search.length === 0 ? {} : { search }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

export interface IssueBrowseState {
  readonly issues: ReadonlyArray<TrackerIssue>;
  /** Absent means the tracker has no more to give. */
  readonly nextCursor: TrackerIssuePage["nextCursor"];
}

export const EMPTY_BROWSE: IssueBrowseState = { issues: [], nextCursor: undefined };

/**
 * A page, folded into what is already on screen.
 *
 * Loading more appends; a fresh read replaces. Nothing is deduplicated, because
 * nothing needs to be: a cursor names where the tracker left off, so the page
 * after it is issues this browse has not seen.
 */
export function appendIssuePage(
  current: IssueBrowseState,
  page: TrackerIssuePage,
  mode: "replace" | "append",
): IssueBrowseState {
  return {
    issues: mode === "append" ? [...current.issues, ...page.issues] : [...page.issues],
    nextCursor: page.nextCursor,
  };
}

/**
 * What the surface says after an import, and whether it says anything.
 *
 * All three outcomes navigate to the plan: idempotency reads as arriving
 * somewhere, never as an error. The two that were not a creation say so,
 * because landing in a plan you did not just make is otherwise a surprise.
 */
export interface ImportOutcomeNotice {
  readonly title: string;
  readonly description: string;
}

export function describeImportOutcome(
  outcome: PlanImportResult["outcome"],
): ImportOutcomeNotice | null {
  switch (outcome) {
    case "created":
      return null;
    case "existing":
      return {
        title: "This issue already has a thread",
        description: "Opened it instead of importing a second copy.",
      };
    case "resurfaced":
      return {
        title: "This issue's thread was restored",
        description: "It had been archived, so importing brought it back.",
      };
  }
}
