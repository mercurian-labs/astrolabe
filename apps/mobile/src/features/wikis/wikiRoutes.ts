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

export type WikiChangeRequestParams = {
  readonly environmentId: string;
  readonly wikiId: string;
  readonly changeRequestId: string;
};
