import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import {
  wikiScopeKey,
  type WikiChangeEntry,
  type WikiDocumentEntry,
  type WikiListEntries,
} from "@t3tools/client-runtime/wikiList";
import type { EnvironmentId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";

/**
 * Astrolabe: the Wikis tab and the Change requests tab's wiki group, each one flat list laid out
 * as the thread list is. Wikis lists the documents, with a first row counting the open change
 * requests that leads to them; Change requests lists the open ones under a section label, then a
 * folded shelf of the merged and closed.
 */
export type WikiListItem =
  | { readonly type: "section"; readonly key: string; readonly label: string }
  | { readonly type: "changes-link"; readonly key: string; readonly count: number }
  | {
      readonly type: "settled-shelf";
      readonly key: string;
      readonly count: number;
      readonly expanded: boolean;
    }
  | {
      readonly type: "document";
      readonly key: string;
      readonly entry: WikiDocumentEntry;
      /** The project standing in the wiki's folder, whose icon the row draws. */
      readonly project: EnvironmentProject | null;
      readonly showTrailingDivider: boolean;
    }
  | {
      readonly type: "change";
      readonly key: string;
      readonly entry: WikiChangeEntry;
      readonly project: EnvironmentProject | null;
      readonly showTrailingDivider: boolean;
    };

function projectFinder(projects: ReadonlyMap<string, EnvironmentProject>) {
  return (entry: WikiDocumentEntry | WikiChangeEntry) =>
    entry.wiki.projectId === null
      ? null
      : (projects.get(scopedProjectKey(entry.environmentId, entry.wiki.projectId)) ?? null);
}

/** A hairline separates two rows; section labels, links and shelves draw their own rule. */
function withDividers(items: WikiListItem[]): WikiListItem[] {
  return items.map((item, index) => {
    if (item.type !== "document" && item.type !== "change") return item;
    const next = items[index + 1];
    const showTrailingDivider = next?.type === "document" || next?.type === "change";
    return showTrailingDivider ? { ...item, showTrailingDivider } : item;
  });
}

/** The Wikis tab: a row counting the open changes, when there are any, then the documents. */
export function buildWikiListItems(
  entries: WikiListEntries,
  options: {
    /** Projects by `scopedProjectKey`. */
    readonly projects: ReadonlyMap<string, EnvironmentProject>;
  },
): WikiListItem[] {
  const projectOf = projectFinder(options.projects);
  const items: WikiListItem[] = [];
  if (entries.changes.length > 0) {
    items.push({ type: "changes-link", key: "changes-link", count: entries.changes.length });
  }
  for (const entry of entries.documents) {
    items.push({
      type: "document",
      key: entry.key,
      entry,
      project: projectOf(entry),
      showTrailingDivider: false,
    });
  }
  return withDividers(items);
}

/**
 * The Change requests tab's wiki group: the open change requests under "Wiki changes", then
 * the merged and closed on a shelf, folded unless `settledExpanded`. Empty with none at all.
 */
export function buildWikiChangeItems(
  entries: WikiListEntries,
  options: {
    readonly settledExpanded: boolean;
    readonly projects: ReadonlyMap<string, EnvironmentProject>;
  },
): WikiListItem[] {
  const projectOf = projectFinder(options.projects);
  const change = (entry: WikiChangeEntry): WikiListItem => ({
    type: "change",
    key: entry.key,
    entry,
    project: projectOf(entry),
    showTrailingDivider: false,
  });
  if (entries.changes.length === 0 && entries.settled.length === 0) return [];
  const items: WikiListItem[] = [
    { type: "section", key: "section:changes", label: `Wiki changes · ${entries.changes.length}` },
    ...entries.changes.map(change),
  ];
  if (entries.settled.length > 0) {
    items.push({
      type: "settled-shelf",
      key: "settled-shelf",
      count: entries.settled.length,
      expanded: options.settledExpanded,
    });
    if (options.settledExpanded) items.push(...entries.settled.map(change));
  }
  return withDividers(items);
}

/** The stored wiki filter, or null once the wiki it names is gone. */
export function resolveWikiScope(
  overviews: ReadonlyArray<WikiOverview>,
  stored: string | null,
): string | null {
  return stored !== null &&
    overviews.some(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === stored,
    )
    ? stored
    : null;
}

/**
 * The wiki filter's choices: each wiki by name, followed by its server's when the list reads
 * more than one server.
 */
export function wikiScopeChoices(
  overviews: ReadonlyArray<WikiOverview>,
  serverLabels: ReadonlyMap<EnvironmentId, string>,
): ReadonlyArray<{ readonly scope: string; readonly label: string }> {
  return overviews.map((overview) => {
    const server = serverLabels.size > 1 ? serverLabels.get(overview.environmentId) : undefined;
    return {
      scope: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
      label: server ? `${overview.wiki.name} · ${server}` : overview.wiki.name,
    };
  });
}

/** A document row's footer: the open change it is in, else its links. */
export function wikiDocumentFooter(entry: WikiDocumentEntry): {
  readonly inChange: boolean;
  readonly text: string;
} {
  const first = entry.changes[0];
  if (first !== undefined) {
    return {
      inChange: true,
      text:
        entry.changes.length > 1
          ? `In ${entry.changes.length} open changes`
          : `In “${first.title}”`,
    };
  }
  const links = entry.links === 1 ? "1 link" : `${entry.links} links`;
  return {
    inChange: false,
    text: entry.backlinks > 0 ? `${links} · linked from ${entry.backlinks}` : links,
  };
}

/** A change request row's footer: whether it settled, and what it holds. */
export function wikiChangeFooter(entry: WikiChangeEntry): {
  readonly summary: string;
  readonly actors: string;
} {
  const { changeRequest } = entry;
  const amendments = changeRequest.amendments.length;
  const status =
    changeRequest.status === "merged"
      ? "Merged"
      : changeRequest.status === "closed"
        ? "Closed"
        : null;
  return {
    summary: [
      status,
      `${amendments} ${amendments === 1 ? "amendment" : "amendments"}`,
      `${entry.files.length} ${entry.files.length === 1 ? "document" : "documents"}`,
    ]
      .filter((part) => part !== null)
      .join(" · "),
    actors: [...new Set(changeRequest.amendments.map((amendment) => amendment.actor))].join(", "),
  };
}
