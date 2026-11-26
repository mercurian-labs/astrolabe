import type { CanvasCodeReference } from "@mercurian/wiki/canvas";
import {
  projectRootId,
  type EnvironmentId,
  type ProjectId,
  type ProjectRootCheckout,
} from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";

import type { RepositoryFileTab } from "../repositories/repositoryTabs";

/**
 * Astrolabe: where a thread's code card opens. A card of the thread's own folder, or of a folder
 * inside it, opens in the thread's file panel; one of a folder outside it (`root:path`) opens that
 * folder's file in a Projects tab, in the thread's checkout of it. Null when the card names a
 * folder the project doesn't have, or the folders aren't read yet.
 */
export function codeCardTarget(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The project's roots as the thread has them. */
  readonly roots: ReadonlyArray<ProjectRootCheckout> | null;
  readonly code: Pick<CanvasCodeReference, "root" | "path">;
}):
  | { readonly kind: "panel"; readonly path: string }
  | { readonly kind: "tab"; readonly tab: RepositoryFileTab }
  | null {
  const { environmentId, projectId, roots, code } = input;
  if (code.root === undefined) return { kind: "panel", path: code.path };
  const root = roots?.find((each) => each.key === code.root);
  if (root === undefined || root.state === "missing") return null;
  const own = roots?.find((each) => each.kind === "workspace");
  const checkout = root.checkout ?? root.path;
  const inside = workspaceRelativeFilePath(checkout, own?.checkout ?? own?.path ?? null);
  if (inside !== null) {
    return { kind: "panel", path: inside === "." ? code.path : `${inside}/${code.path}` };
  }
  return {
    kind: "tab",
    tab: {
      kind: "file",
      environmentId,
      ...(root.kind === "workspace"
        ? { projectId }
        : { wikiId: projectRootId(projectId, root.key) }),
      checkout: { cwd: checkout },
      path: code.path,
    },
  };
}
