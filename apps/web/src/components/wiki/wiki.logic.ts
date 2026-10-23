import type { EnvironmentId, WikiChangeRequestId } from "@t3tools/contracts";

/**
 * `/wikis/$wikiId` search: a link to a document (`note`, read inside `changeRequest` when one
 * is named) or to a change request, opened as a tab in the Wikis area.
 */
export interface WikiSearch {
  readonly environmentId?: EnvironmentId;
  readonly note?: string;
  readonly changeRequest?: WikiChangeRequestId;
}

const searchString = (value: unknown, max = 300): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

export function parseWikiSearch(raw: Record<string, unknown>): WikiSearch {
  const environmentId = searchString(raw.environmentId);
  const note = searchString(raw.note);
  const changeRequest = searchString(raw.changeRequest);
  return {
    ...(environmentId ? { environmentId: environmentId as EnvironmentId } : {}),
    ...(note ? { note } : {}),
    ...(changeRequest ? { changeRequest: changeRequest as WikiChangeRequestId } : {}),
  };
}

// Shared with the mobile app.
export {
  noteKey,
  noteNameOfFile,
  defaultSaveTarget,
  mergeBlockedReason,
  describeIndexError,
  describeWikiFailure,
  summarizeMirror,
  PERSON_ACTOR,
  isTurnRunning,
  latestAmendmentFor,
  authorColor,
  queuedSaveStep,
  type MirrorTone,
  type QueuedWikiSave,
} from "@t3tools/client-runtime/wikiLogic";
