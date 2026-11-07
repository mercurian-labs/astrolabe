import { storedChoice } from "../projects/storedChoice";

/** Astrolabe: how this client lists a wiki's documents. */
export interface WikiTreeView {
  /** A flat list, newest first, in place of the folders. */
  readonly newestFirst: boolean;
  /** Files and folders starting with a dot, which most file trees leave out. */
  readonly showHidden: boolean;
}

const HIDDEN_BY_DEFAULT: WikiTreeView = { newestFirst: false, showHidden: false };

function parseWikiTreeView(stored: string): WikiTreeView | null {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { newestFirst, showHidden } = parsed as Record<string, unknown>;
    return { newestFirst: newestFirst === true, showHidden: showHidden === true };
  } catch {
    return null;
  }
}

const wikiTreeViewStore = storedChoice<WikiTreeView>({
  storageKey: "astrolabe:wiki-tree-view:v1",
  fallback: HIDDEN_BY_DEFAULT,
  parse: parseWikiTreeView,
  serialize: (view) => JSON.stringify(view),
});

export const useWikiTreeView = wikiTreeViewStore.useValue;

export const storeWikiTreeView = (view: WikiTreeView) => wikiTreeViewStore.set(view);
