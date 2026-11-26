import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { documentFile } from "./wiki.logic";

/**
 * A tab the Wikis section used to open, kept for one release so saved layouts and old links still
 * land: a document opens as its Projects file tab (`LegacyWikiTab`); a change request is dropped.
 */
export type WikiTab =
  | {
      readonly kind: "note";
      readonly environmentId: EnvironmentId;
      readonly wikiId: WikiId;
      /** Its path from the wiki's root. */
      readonly file: string;
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
    ? `${NOTE_PREFIX}${part(tab.environmentId)}:${part(tab.wikiId)}:${part(tab.changeRequestId ?? "")}:${part(tab.file)}`
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
      // A layout saved before wikis had folders holds a note's bare name.
      file: documentFile(name),
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
