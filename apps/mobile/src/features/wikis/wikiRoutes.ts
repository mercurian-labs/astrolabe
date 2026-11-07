/**
 * Astrolabe: the Wikis screens' route params. A document is read from its wiki's main line,
 * or inside a change request when one is named.
 */
export type WikiDocumentParams = {
  readonly environmentId: string;
  readonly wikiId: string;
  /** The document's path; a link made before wikis had folders holds a note's bare name. */
  readonly name: string;
  readonly changeRequestId?: string;
};

/** One canvas a change request changes, as a review. */
export type WikiCanvasReviewParams = {
  readonly environmentId: string;
  readonly wikiId: string;
  readonly changeRequestId: string;
  readonly name: string;
};

export type WikiChangeRequestParams = {
  readonly environmentId: string;
  readonly wikiId: string;
  readonly changeRequestId: string;
};

/**
 * A deep link with a document's path spelled out, which a `:name` segment can't hold: its route
 * reads `/` only as `%2F`, so `documents/a/Plan.md` would match nothing.
 */
export const wikiDocumentLink = (path: string): string =>
  path.replace(
    /^(\/?wikis\/[^/]+\/[^/]+\/(?:documents|changes\/[^/]+\/canvases)\/)([^?#]+)/,
    (_, route: string, name: string) => `${route}${name.replaceAll("/", "%2F")}`,
  );
