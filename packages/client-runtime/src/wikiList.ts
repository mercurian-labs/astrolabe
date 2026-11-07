import type { EnvironmentId, WikiChangeRequest, WikiId, WikiSummary } from "@t3tools/contracts";

import type { WikiOverview } from "./state/wiki.ts";
import {
  changeRequestFiles,
  documentTitle,
  draftDocuments,
  noteKey,
  wikiDraft,
} from "./wikiLogic.ts";

/**
 * Astrolabe: the Wikis list, as the thread list is one list across projects: the person's drafts,
 * every open change request, then every document (notes, `.base` and `.canvas` files), then the
 * merged and closed change requests (the shelf a closed one is reopened from), each newest first,
 * across every wiki on every server.
 */

/** A document in the list: a note, a `.base` or a `.canvas` file, on its wiki's main line. */
export interface WikiDocumentEntry {
  readonly kind: "document";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  /** What a search looks through: the path, without a note's `.md`. */
  readonly name: string;
  /** What the list shows: the last part of the path. */
  readonly title: string;
  /** What it opens by. */
  readonly file: string;
  /** A `.base` file: read only, with no links of its own. */
  readonly base: boolean;
  /** A `.canvas` file. */
  readonly canvas: boolean;
  readonly links: number;
  readonly backlinks: number;
  /** When the note last changed on main; null when the wiki does not say. */
  readonly editedAt: string | null;
  /** Open change requests that change the note, most recently updated first. */
  readonly changes: ReadonlyArray<WikiChangeRequest>;
}

/** A change request in the list. */
export interface WikiChangeEntry {
  readonly kind: "change";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly changeRequest: WikiChangeRequest;
  /** The documents its amendments touch. */
  readonly files: ReadonlyArray<string>;
}

export interface WikiListEntries {
  /** The person's drafts, one a wiki at most, apart from the change requests. */
  readonly drafts: ReadonlyArray<WikiChangeEntry>;
  readonly changes: ReadonlyArray<WikiChangeEntry>;
  readonly documents: ReadonlyArray<WikiDocumentEntry>;
  readonly settled: ReadonlyArray<WikiChangeEntry>;
}

/** The scope a wiki filter picks: one wiki on one server. */
export const wikiScopeKey = (environmentId: EnvironmentId, wikiId: WikiId) =>
  `${environmentId}:${wikiId}`;

const newestFirst = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

/** The list's entries across `overviews`, or only the wiki `scope` names. */
export function wikiListEntries(
  overviews: ReadonlyArray<WikiOverview>,
  scope: string | null,
): WikiListEntries {
  const drafts: WikiChangeEntry[] = [];
  const changes: WikiChangeEntry[] = [];
  const documents: WikiDocumentEntry[] = [];
  const settled: WikiChangeEntry[] = [];
  for (const { environmentId, wiki, index, changeRequests } of overviews) {
    const scopeKey = wikiScopeKey(environmentId, wiki.wikiId);
    if (scope !== null && scopeKey !== scope) continue;
    const entry = (changeRequest: WikiChangeRequest): WikiChangeEntry => ({
      kind: "change",
      key: `change:${scopeKey}:${changeRequest.changeRequestId}`,
      environmentId,
      wiki,
      changeRequest,
      files: changeRequestFiles(changeRequest),
    });
    const open: WikiChangeEntry[] = [];
    for (const changeRequest of changeRequests ?? []) {
      if (changeRequest.status === "open") {
        if (!changeRequest.draft) open.push(entry(changeRequest));
      } else {
        settled.push(entry(changeRequest));
      }
    }
    open.sort((a, b) => newestFirst(a.changeRequest.updatedAt, b.changeRequest.updatedAt));
    changes.push(...open);
    const draft = wikiDraft(changeRequests);
    const draftEntry = draft === null ? null : entry(draft);
    if (draftEntry !== null) drafts.push(draftEntry);
    const changing = draftEntry === null ? open : [draftEntry, ...open];
    const notes = (index?.notes ?? []).map((note) => ({ ...note, base: false, canvas: false }));
    const bases = (index?.bases ?? []).map((base) => ({
      name: base.file,
      file: base.file,
      outgoing: 0,
      incoming: 0,
      editedAt: base.editedAt,
      base: true,
      canvas: false,
    }));
    const canvases = (index?.canvases ?? []).map((canvas) => ({
      ...canvas,
      name: canvas.file,
      base: false,
      canvas: true,
    }));
    const listed = draftDocuments([...notes, ...bases, ...canvases], draft, (file, name) => ({
      name,
      file,
      outgoing: 0,
      incoming: 0,
      editedAt: draft?.updatedAt,
      base: /\.base$/i.test(file),
      canvas: /\.canvas$/i.test(file),
    }));
    for (const note of listed) {
      documents.push({
        kind: "document",
        key: `document:${scopeKey}:${note.file}`,
        environmentId,
        wiki,
        name: note.name,
        title: documentTitle(note.name),
        file: note.file,
        base: note.base,
        canvas: note.canvas,
        links: note.outgoing,
        backlinks: note.incoming,
        editedAt: note.editedAt ?? null,
        changes: changing
          .filter((change) => change.files.includes(note.file))
          .map((change) => change.changeRequest),
      });
    }
  }
  changes.sort((a, b) => newestFirst(a.changeRequest.updatedAt, b.changeRequest.updatedAt));
  settled.sort((a, b) => newestFirst(a.changeRequest.updatedAt, b.changeRequest.updatedAt));
  documents.sort((a, b) => newestFirst(a.editedAt, b.editedAt) || a.name.localeCompare(b.name));
  return { drafts, changes, documents, settled };
}

/**
 * The entries a search keeps: documents whose name and change requests whose title hold the
 * query, compared as the wiki compares note names. A blank query keeps everything.
 */
export function searchWikiListEntries(entries: WikiListEntries, query: string): WikiListEntries {
  const needle = noteKey(query.trim());
  if (needle === "") return entries;
  const matches = (change: WikiChangeEntry) => noteKey(change.changeRequest.title).includes(needle);
  return {
    drafts: entries.drafts.filter(matches),
    changes: entries.changes.filter(matches),
    documents: entries.documents.filter((document) => noteKey(document.name).includes(needle)),
    settled: entries.settled.filter(matches),
  };
}
