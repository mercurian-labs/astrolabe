import { isWikiDocument } from "@mercurian/wiki/resolve-link";
import type { ProjectRoot } from "@t3tools/contracts";

/**
 * Astrolabe: where a person's edit to a project's file lands outside a thread, shared by the web
 * and mobile clients. A document in a hosted repository's main checkout, on its default branch,
 * goes to a draft that becomes a pull request only when they open one; everything else, code
 * always, is written on disk in the folder it was opened from.
 */
export type ProjectDocEditTarget =
  | { readonly kind: "draft" }
  | { readonly kind: "disk"; readonly folder: string }
  /** Waiting to learn whether the checkout is on its default branch. */
  | { readonly kind: "pending" };

const trimmed = (folder: string) => folder.replace(/[\\/]+$/, "");

export function projectDocEditTarget(input: {
  readonly root: Pick<ProjectRoot, "path" | "state" | "hostBacked">;
  /** The folder the file was opened from; null for the root's own folder. */
  readonly checkout: string | null;
  /** Whether that folder is on its repository's default branch; null while unknown. */
  readonly onDefaultBranch: boolean | null;
  /** The file's path from the root. */
  readonly file: string;
}): ProjectDocEditTarget {
  const folder = input.checkout ?? input.root.path;
  const disk = { kind: "disk", folder } as const;
  if (!isWikiDocument(input.file) || input.root.state !== "git" || !input.root.hostBacked) {
    return disk;
  }
  if (trimmed(folder) !== trimmed(input.root.path)) return disk;
  if (input.onDefaultBranch === null) return { kind: "pending" };
  return input.onDefaultBranch ? { kind: "draft" } : disk;
}

/** A `ProjectRootCheckout`, or anything shaped like one. */
interface LocatableRoot {
  readonly key: string;
  readonly path: string;
  readonly checkout: string | null;
}

/**
 * The root an absolute path is in, as `ProjectRoots.locate` picks it: the deepest folder holding
 * it, a root's checkout or its own folder, so a repository inside the project's folder wins.
 */
export function locateProjectRoot<R extends LocatableRoot>(
  roots: ReadonlyArray<R>,
  absolutePath: string,
): { readonly root: R; readonly folder: string; readonly path: string } | null {
  let best: { readonly root: R; readonly folder: string; readonly path: string } | null = null;
  for (const root of roots) {
    for (const candidate of new Set([root.checkout, root.path])) {
      if (candidate === null) continue;
      const folder = trimmed(candidate);
      const inside =
        absolutePath === folder ||
        absolutePath.startsWith(`${folder}/`) ||
        absolutePath.startsWith(`${folder}\\`);
      if (!inside || (best !== null && best.folder.length >= folder.length)) continue;
      best = {
        root,
        folder: candidate,
        path: absolutePath.slice(folder.length + 1).replaceAll("\\", "/"),
      };
    }
  }
  return best;
}
