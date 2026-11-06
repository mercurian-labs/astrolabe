/**
 * Astrolabe: the Wikis screens' route params. A document is read from its wiki's main line,
 * or inside a change request when one is named.
 */
export type WikiDocumentParams = {
  readonly environmentId: string;
  readonly wikiId: string;
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
