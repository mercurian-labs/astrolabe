import { documentFile } from "@t3tools/client-runtime/wikiLogic";
import { parseProjectRootId } from "@t3tools/contracts";

/**
 * Astrolabe: a document in one root of a project, as the document screens read it. With
 * `checkout`, read and written on disk in that folder; without one, read from the root's main
 * line with the person's draft over it, or inside `changeRequestId` when one is named.
 */
export type WikiDocumentParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly rootKey: string;
  /** The document's path from the root. */
  readonly name: string;
  readonly checkout?: string;
  readonly changeRequestId?: string;
};

/**
 * Links from when wikis had their own section, kept for one release: each opens the document in
 * its project's root, or Projects when that can't be found.
 */
export type LegacyWikiParams = {
  readonly environmentId: string;
  readonly wikiId: string;
  /** Absent for a change request, which no longer has a screen of its own. */
  readonly name?: string;
  readonly changeRequestId?: string;
};

export type LegacyWikiRedirect =
  | { readonly kind: "document"; readonly params: WikiDocumentParams }
  | { readonly kind: "projects"; readonly projectId: string | null };

/**
 * Where an old wiki link goes. `resolvedRootId` is the root id the server answered for an old
 * wiki id, null while unknown or when it couldn't say.
 */
export function legacyWikiRedirect(
  params: LegacyWikiParams,
  resolvedRootId: string | null,
): LegacyWikiRedirect {
  const root =
    parseProjectRootId(params.wikiId) ??
    (resolvedRootId === null ? null : parseProjectRootId(resolvedRootId));
  if (root === null) return { kind: "projects", projectId: null };
  if (params.name === undefined) return { kind: "projects", projectId: root.projectId };
  return {
    kind: "document",
    params: {
      environmentId: params.environmentId,
      projectId: root.projectId,
      rootKey: root.rootKey,
      // A link from before wikis had folders holds a note's bare name.
      name: documentFile(params.name),
      ...(params.changeRequestId === undefined ? {} : { changeRequestId: params.changeRequestId }),
    },
  };
}

/**
 * A deep link with a document's path spelled out, which a `:name` segment can't hold: its route
 * reads `/` only as `%2F`, so `documents/a/Plan.md` would match nothing.
 */
export const wikiDocumentLink = (path: string): string =>
  path.replace(
    /^(\/?(?:wikis\/[^/]+\/[^/]+\/(?:documents|changes\/[^/]+\/canvases)|projects\/[^/]+\/[^/]+\/[^/]+\/documents)\/)([^?#]+)/,
    (_, route: string, name: string) => `${route}${name.replaceAll("/", "%2F")}`,
  );
