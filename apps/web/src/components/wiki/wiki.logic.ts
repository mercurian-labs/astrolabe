import type {
  EnvironmentId,
  WikiChangeRequestId,
  WikiMapBackground,
  WikiQueryResult,
} from "@t3tools/contracts";

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

/** A document's whole path, which can run far past a name. */
const NOTE_PATH_LENGTH = 4096;

export function parseWikiSearch(raw: Record<string, unknown>): WikiSearch {
  const environmentId = searchString(raw.environmentId);
  const note = searchString(raw.note, NOTE_PATH_LENGTH);
  const changeRequest = searchString(raw.changeRequest);
  return {
    ...(environmentId ? { environmentId: environmentId as EnvironmentId } : {}),
    ...(note ? { note } : {}),
    ...(changeRequest ? { changeRequest: changeRequest as WikiChangeRequestId } : {}),
  };
}

// Shared with the mobile app.
export {
  changeRequestFiles,
  filesHoldDocument,
  documentFile,
  documentPath,
  documentTitle,
  draftDocuments,
  draftLabel,
  draftMovedTo,
  exactWikiPath,
  isCanvasName,
  isDocumentFile,
  isSettledChangeRequest,
  resolveWikiLink,
  wikiDocumentScope,
  wikiDraft,
  noteKey,
  NO_NOTE_FROM_RELATIVE_LINK,
  wikiDocumentFiles,
  wikiLinkFile,
  wikiLinkFiles,
  wikiLinkOpens,
  wikiLinkOptions,
  noteNameOfFile,
  mergeBlockedReason,
  mergeConflictAdvice,
  describeIndexError,
  describeWikiFailure,
  summarizeMirror,
  PERSON_ACTOR,
  isTurnRunning,
  latestAmendmentFor,
  authorColor,
  type MirrorTone,
} from "@t3tools/client-runtime/wikiLogic";

/** A map's tiles, picked as Obsidian does: the view's own, else a background, else the default. */
export function mapTilesFor(
  settings: NonNullable<WikiQueryResult["settings"]>,
  backgrounds: ReadonlyArray<WikiMapBackground>,
  picked: string | null,
  dark: boolean,
): ReadonlyArray<string> | undefined {
  if (settings.mapTiles?.length) {
    return dark && settings.mapTilesDark?.length ? settings.mapTilesDark : settings.mapTiles;
  }
  const background = backgrounds.find(({ name }) => name === picked) ?? backgrounds[0];
  if (background === undefined) return undefined;
  return [dark ? (background.darkTiles ?? background.lightTiles) : background.lightTiles];
}
