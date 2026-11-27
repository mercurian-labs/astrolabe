import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { wikiListEntries } from "@t3tools/client-runtime/wikiList";
import { noteKey } from "@t3tools/client-runtime/wikiLogic";
import type { ProjectId } from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";

const COMPOSER_WIKI_NOTE_RESULT_LIMIT = 20;

/** A document of the composer's project in the `[[` menu; picking it mentions its file. */
export interface ComposerWikiNoteItem {
  readonly id: string;
  readonly type: "wiki-note";
  /** The file as the composer links it: from the thread's folder, else its whole path. */
  readonly path: string;
  readonly label: string;
  readonly description: string;
}

/**
 * The `[[` menu over the documents of the composer's project, across its folders, newest first
 * with names that start with the query ahead. A document under the thread's folder is linked from
 * there; one in another folder by its whole path.
 */
export function composerWikiNoteItems(input: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly projectId: ProjectId;
  readonly cwd: string | null;
  readonly query: string;
}): ComposerWikiNoteItem[] {
  const needle = noteKey(input.query.trim());
  const overviews = input.overviews.filter(
    (overview) => overview.wiki.projectId === input.projectId,
  );
  return wikiListEntries(overviews, null)
    .documents.flatMap((document) => {
      if (document.base) return [];
      const key = noteKey(document.name);
      if (!key.includes(needle)) return [];
      return [{ document, rank: key.startsWith(needle) ? 0 : 1 }];
    })
    .toSorted((a, b) => a.rank - b.rank)
    .slice(0, COMPOSER_WIKI_NOTE_RESULT_LIMIT)
    .map(({ document }): ComposerWikiNoteItem => {
      const absolute = `${document.wiki.root.replace(/\/+$/, "")}/${document.file}`;
      const relative = input.cwd === null ? null : workspaceRelativeFilePath(absolute, input.cwd);
      return {
        id: `wiki-note:${document.key}`,
        type: "wiki-note",
        path: relative === null || relative === "." ? absolute : relative,
        label: document.name,
        description: document.wiki.name,
      };
    });
}
