import { locateProjectRoot } from "@t3tools/client-runtime/projectDocEditTarget";
import { isWikiDocument } from "@mercurian/wiki/resolve-link";
import type { ProjectEntry, ProjectRootCheckout } from "@t3tools/contracts";

import type { WikiDocumentParams } from "../wikis/wikiRoutes";

/**
 * Astrolabe: the tree the Docs filter shows: each of `paths` (notes, canvases, bases, skill maps
 * and the files they link), the folders holding them, and the open file with its folders, so
 * narrowing the tree never hides the file that is open. Folders come first, as the tree's do.
 */
export function docsTreeEntries(
  paths: ReadonlyArray<string>,
  selectedPath: string | null,
): ReadonlyArray<ProjectEntry> {
  const folders = new Set<string>();
  const files = new Set<string>();
  for (const path of selectedPath === null ? paths : [...paths, selectedPath]) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      folders.add(path.slice(0, slash));
    }
    files.add(path);
  }
  return [
    ...[...folders].map((path) => ({ path, kind: "directory" as const })),
    ...[...files]
      .filter((path) => !folders.has(path))
      .map((path) => ({ path, kind: "file" as const })),
  ];
}

/**
 * The document screen a file opens on, found from the project's roots: the deepest one holding
 * it, read in the folder it was opened from. Null for a file that's no document, or in no root.
 */
export function projectDocumentParams(input: {
  readonly environmentId: string;
  readonly projectId: string;
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly absolutePath: string;
}): WikiDocumentParams | null {
  const located = locateProjectRoot(input.roots, input.absolutePath);
  if (located === null || !isWikiDocument(located.path)) return null;
  const ownFolder =
    located.folder.replace(/[\\/]+$/, "") === located.root.path.replace(/[\\/]+$/, "");
  return {
    environmentId: input.environmentId,
    projectId: input.projectId,
    rootKey: located.root.key,
    name: located.path,
    ...(ownFolder ? {} : { checkout: located.folder }),
  };
}
