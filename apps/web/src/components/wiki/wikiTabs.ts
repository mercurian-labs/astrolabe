import type {
  EnvironmentId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiSummary,
} from "@t3tools/contracts";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import { noteKey } from "./wiki.logic";

/**
 * What a tab in the Wikis area shows: a note, read from main or inside a change request, or a
 * change request itself. Tabs from every server and wiki share one arrangement, so each names
 * its server and wiki.
 */
export type WikiTab =
  | {
      readonly kind: "note";
      readonly environmentId: EnvironmentId;
      readonly wikiId: WikiId;
      readonly name: string;
      readonly changeRequestId: WikiChangeRequestId | undefined;
    }
  | {
      readonly kind: "change-request";
      readonly environmentId: EnvironmentId;
      readonly wikiId: WikiId;
      readonly changeRequestId: WikiChangeRequestId;
    };

const NOTE_PREFIX = "wiki-note:";
const CHANGE_REQUEST_PREFIX = "wiki-change:";

const part = (value: string) => encodeURIComponent(value);

/** A tab's key: every part URI-encoded, so `:` only ever separates them. */
export function wikiTabKey(tab: WikiTab): string {
  return tab.kind === "note"
    ? `${NOTE_PREFIX}${part(tab.environmentId)}:${part(tab.wikiId)}:${part(tab.changeRequestId ?? "")}:${part(tab.name)}`
    : `${CHANGE_REQUEST_PREFIX}${part(tab.environmentId)}:${part(tab.wikiId)}:${part(tab.changeRequestId)}`;
}

/** The tab a key names; null for a key that is not a wiki tab's (an empty tab's, say). */
export function parseWikiTabKey(key: string): WikiTab | null {
  const decode = (prefix: string, count: number) => {
    if (!key.startsWith(prefix)) return null;
    const parts = key.slice(prefix.length).split(":");
    if (parts.length !== count) return null;
    try {
      return parts.map(decodeURIComponent);
    } catch {
      return null;
    }
  };
  const note = decode(NOTE_PREFIX, 4);
  if (note) {
    const [environmentId, wikiId, changeRequestId, name] = note;
    if (!environmentId || !wikiId || !name) return null;
    return {
      kind: "note",
      environmentId: environmentId as EnvironmentId,
      wikiId: wikiId as WikiId,
      name,
      changeRequestId: changeRequestId ? (changeRequestId as WikiChangeRequestId) : undefined,
    };
  }
  const change = decode(CHANGE_REQUEST_PREFIX, 3);
  if (change) {
    const [environmentId, wikiId, changeRequestId] = change;
    if (!environmentId || !wikiId || !changeRequestId) return null;
    return {
      kind: "change-request",
      environmentId: environmentId as EnvironmentId,
      wikiId: wikiId as WikiId,
      changeRequestId: changeRequestId as WikiChangeRequestId,
    };
  }
  return null;
}

/** Whether two tabs show the same thing; note names compare as the wiki compares them. */
export function sameWikiTab(a: WikiTab, b: WikiTab): boolean {
  if (a.environmentId !== b.environmentId || a.wikiId !== b.wikiId) return false;
  if (a.kind === "note" && b.kind === "note") {
    return a.changeRequestId === b.changeRequestId && noteKey(a.name) === noteKey(b.name);
  }
  return a.kind === b.kind && a.changeRequestId === b.changeRequestId;
}

/** Whether a tab shows `document`, read from anywhere: a sidebar row stays lit for either. */
export function tabShowsDocument(
  tab: WikiTab | null,
  document: {
    readonly environmentId: EnvironmentId;
    readonly wikiId: WikiId;
    readonly name: string;
  },
): boolean {
  return (
    tab?.kind === "note" &&
    tab.environmentId === document.environmentId &&
    tab.wikiId === document.wikiId &&
    noteKey(tab.name) === noteKey(document.name)
  );
}

/** One document in the sidebar: a note on a wiki's main line. */
export interface WikiDocumentItem {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly name: string;
  readonly file: string;
  readonly links: number;
  readonly backlinks: number;
  /** When the note last changed on main; null when the wiki doesn't say. */
  readonly editedAt: string | null;
  /** Open change requests that change the note, most recently updated first. */
  readonly changes: ReadonlyArray<WikiChangeRequest>;
}

/** One open change request in the sidebar. */
export interface WikiChangeItem {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly changeRequest: WikiChangeRequest;
  /** The documents its amendments touch. */
  readonly files: ReadonlyArray<string>;
}

/** The scope a wiki filter picks: one wiki on one server. */
export const wikiScopeKey = (environmentId: EnvironmentId, wikiId: WikiId) =>
  `${environmentId}:${wikiId}`;

const newestFirst = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

/**
 * The sidebar's lists, as the thread list is one list across projects: every open change
 * request, then every document, then the merged and closed change requests (the shelf a
 * closed one is reopened from), each newest first, across every wiki in `overviews` (or only
 * the one `scope` names).
 */
export function wikiSidebarItems(
  overviews: ReadonlyArray<WikiOverview>,
  scope: string | null,
): {
  readonly changes: ReadonlyArray<WikiChangeItem>;
  readonly documents: ReadonlyArray<WikiDocumentItem>;
  readonly settled: ReadonlyArray<WikiChangeItem>;
} {
  const changes: WikiChangeItem[] = [];
  const documents: WikiDocumentItem[] = [];
  const settled: WikiChangeItem[] = [];
  for (const overview of overviews) {
    const { environmentId, wiki } = overview;
    if (scope !== null && wikiScopeKey(environmentId, wiki.wikiId) !== scope) continue;
    const open = (overview.changeRequests ?? [])
      .filter((changeRequest) => changeRequest.status === "open")
      .toSorted((a, b) => newestFirst(a.updatedAt, b.updatedAt));
    const item = (changeRequest: WikiChangeRequest): WikiChangeItem => ({
      key: wikiTabKey({
        kind: "change-request",
        environmentId,
        wikiId: wiki.wikiId,
        changeRequestId: changeRequest.changeRequestId,
      }),
      environmentId,
      wiki,
      changeRequest,
      files: [...new Set(changeRequest.amendments.flatMap((amendment) => amendment.files))],
    });
    for (const changeRequest of overview.changeRequests ?? []) {
      if (changeRequest.status !== "open") settled.push(item(changeRequest));
    }
    const openItems = open.map(item);
    changes.push(...openItems);
    for (const note of overview.index?.notes ?? []) {
      documents.push({
        key: wikiTabKey({
          kind: "note",
          environmentId,
          wikiId: wiki.wikiId,
          name: note.name,
          changeRequestId: undefined,
        }),
        environmentId,
        wiki,
        name: note.name,
        file: note.file,
        links: note.outgoing,
        backlinks: note.incoming,
        editedAt: note.editedAt ?? null,
        changes: openItems
          .filter((change) => change.files.includes(note.file))
          .map((change) => change.changeRequest),
      });
    }
  }
  changes.sort((a, b) => newestFirst(a.changeRequest.updatedAt, b.changeRequest.updatedAt));
  settled.sort((a, b) => newestFirst(a.changeRequest.updatedAt, b.changeRequest.updatedAt));
  documents.sort((a, b) => newestFirst(a.editedAt, b.editedAt) || a.name.localeCompare(b.name));
  return { changes, documents, settled };
}

/** One row of the sidebar's search results: a document or a change request. */
export type WikiSidebarEntry =
  | { readonly kind: "document"; readonly item: WikiDocumentItem }
  | { readonly kind: "change"; readonly item: WikiChangeItem };

/**
 * The sidebar's search, filtering its lists in place: the documents whose name and the change
 * requests whose title holds `query`, matched as note names are, in the lists' order (open
 * changes, documents, then merged and closed). Nothing for a blank query.
 */
export function searchWikiSidebarItems(
  lists: ReturnType<typeof wikiSidebarItems>,
  query: string,
): ReadonlyArray<WikiSidebarEntry> {
  const needle = noteKey(query.trim());
  if (needle === "") return [];
  const change = (item: WikiChangeItem): WikiSidebarEntry[] =>
    noteKey(item.changeRequest.title).includes(needle) ? [{ kind: "change", item }] : [];
  return [
    ...lists.changes.flatMap(change),
    ...lists.documents.flatMap((item): WikiSidebarEntry[] =>
      noteKey(item.name).includes(needle) ? [{ kind: "document", item }] : [],
    ),
    ...lists.settled.flatMap(change),
  ];
}

/** The tab a sidebar row opens: a document from main, or the change request itself. */
export function wikiSidebarEntryTab(entry: WikiSidebarEntry): WikiTab {
  return entry.kind === "document"
    ? {
        kind: "note",
        environmentId: entry.item.environmentId,
        wikiId: entry.item.wiki.wikiId,
        name: entry.item.name,
        changeRequestId: undefined,
      }
    : {
        kind: "change-request",
        environmentId: entry.item.environmentId,
        wikiId: entry.item.wiki.wikiId,
        changeRequestId: entry.item.changeRequest.changeRequestId,
      };
}
