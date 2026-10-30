import type { EnvironmentId, ProjectId, WikiId, WikiSummary } from "@t3tools/contracts";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { wikiListEntries } from "@t3tools/client-runtime/wikiList";
import { noteKey } from "@t3tools/client-runtime/wikiLogic";

const COMPOSER_WIKI_NOTE_RESULT_LIMIT = 20;

export interface ComposerWikiNoteItem {
  readonly id: string;
  readonly type: "wiki-note";
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly wikiName: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

export interface ComposerWikiLinkItem {
  readonly id: string;
  readonly type: "wiki-link";
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly projectId: ProjectId;
  readonly label: string;
  readonly description: string;
}

/**
 * The `[[` menu over one server's wikis: notes of wikis linked to the composer's project first,
 * then every other wiki's, newest first with names that start with the query ahead. While the
 * project has no linked wiki, an empty query also offers to link each wiki to it.
 */
export function composerWikiNoteItems(input: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly project: { readonly id: ProjectId; readonly title: string } | null;
  readonly query: string;
  readonly canLink: boolean;
}): Array<ComposerWikiNoteItem | ComposerWikiLinkItem> {
  const { project } = input;
  const isLinked = (wiki: WikiSummary) => project !== null && wiki.projectIds.includes(project.id);
  const needle = noteKey(input.query.trim());
  const linkItems: ComposerWikiLinkItem[] =
    project !== null &&
    input.canLink &&
    needle === "" &&
    !input.overviews.some((overview) => isLinked(overview.wiki))
      ? input.overviews.map(({ environmentId, wiki }) => ({
          id: `wiki-link:${environmentId}:${wiki.wikiId}`,
          type: "wiki-link",
          environmentId,
          wikiId: wiki.wikiId,
          projectId: project.id,
          label: `Link ${wiki.name} to ${project.title}`,
          description: "Its notes list first in this project",
        }))
      : [];
  const noteItems = wikiListEntries(input.overviews, null)
    .documents.flatMap((document) => {
      const key = noteKey(document.name);
      if (!key.includes(needle)) return [];
      const rank = (isLinked(document.wiki) ? 0 : 2) + (key.startsWith(needle) ? 0 : 1);
      return [{ document, rank }];
    })
    .toSorted((a, b) => a.rank - b.rank)
    .slice(0, COMPOSER_WIKI_NOTE_RESULT_LIMIT)
    .map(({ document }): ComposerWikiNoteItem => ({
      id: `wiki-note:${document.key}`,
      type: "wiki-note",
      environmentId: document.environmentId,
      wikiId: document.wiki.wikiId,
      wikiName: document.wiki.name,
      name: document.name,
      label: document.name,
      description: document.wiki.name,
    }));
  return [...linkItems, ...noteItems];
}
