import {
  projectDocEditTarget,
  type ProjectDocEditTarget,
} from "@t3tools/client-runtime/projectDocEditTarget";
import {
  DEFAULT_WIKI_LOCATION_SETTINGS,
  ProjectId,
  projectRootId,
  RootKey,
  WikiId,
  type EnvironmentId,
  type ProjectRootCheckout,
  type WikiChangeRequestId,
  type WikiIndexResult,
  type WikiLocationSettings,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { useEnvironments } from "../../../state/environments";
import { projectRootsEnvironment } from "../../../state/projectRoots";
import { useEnvironmentQuery } from "../../../state/query";
import { vcsEnvironment } from "../../../state/vcs";
import { wikiEnvironment } from "../../../state/wiki";
import type { WikiDocumentParams } from "../wikiRoutes";

/** Where a server puts a project's new notes, as Settings on a computer says. */
export function useWikiPlacement(environmentId: string): WikiLocationSettings {
  const { environments } = useEnvironments();
  return (
    environments.find((each) => each.environmentId === environmentId)?.serverConfig?.settings
      .wikiLocations ?? DEFAULT_WIKI_LOCATION_SETTINGS
  );
}

const sameFolder = (left: string, right: string) =>
  left.replace(/[\\/]+$/, "") === right.replace(/[\\/]+$/, "");

/**
 * Astrolabe: one document of a project root, and where its reads and the person's edits go. A
 * named change request is read and edited in place; otherwise `projectDocEditTarget` picks a
 * draft (a hosted repository's main checkout on its default branch) or the folder on disk.
 */
export function useProjectDocument(params: WikiDocumentParams) {
  const environmentId = params.environmentId as EnvironmentId;
  const projectId = ProjectId.make(params.projectId);
  const rootKey = RootKey.make(params.rootKey);
  const wikiId = WikiId.make(projectRootId(projectId, rootKey));
  const routeChangeRequestId = params.changeRequestId as WikiChangeRequestId | undefined;
  const list = useEnvironmentQuery(
    projectRootsEnvironment.list({ environmentId, input: { projectId } }),
  );
  const roots = list.data?.roots ?? null;
  const root = roots?.find((each) => each.key === rootKey) ?? null;
  const asksBranch =
    routeChangeRequestId === undefined &&
    root !== null &&
    root.state === "git" &&
    root.hostBacked &&
    (params.checkout === undefined || sameFolder(params.checkout, root.path));
  const status = useEnvironmentQuery(
    asksBranch ? vcsEnvironment.status({ environmentId, input: { cwd: root.path } }) : null,
  );
  const onDefaultBranch =
    status.data !== null ? status.data.isDefaultRef : status.error !== null ? false : null;
  const target: ProjectDocEditTarget =
    routeChangeRequestId !== undefined
      ? { kind: "draft" }
      : root !== null
        ? projectDocEditTarget({
            root,
            checkout: params.checkout ?? null,
            onDefaultBranch,
            file: params.name,
          })
        : list.error !== null
          ? // A server that can't list its roots reads as it did before roots: the draft.
            params.checkout === undefined
            ? { kind: "draft" }
            : { kind: "disk", folder: params.checkout }
          : { kind: "pending" };
  const disk = target.kind === "disk" ? target.folder : null;
  return {
    environmentId,
    projectId,
    rootKey,
    wikiId,
    routeChangeRequestId,
    roots,
    root,
    target,
    /** The folder reads and edits go to on disk; null for the draft or a change request. */
    disk,
    placement: useWikiPlacement(environmentId),
  };
}

export type ProjectDocument = ReturnType<typeof useProjectDocument>;

type IndexRead = { readonly key: string; readonly wikiId: WikiId; readonly checkout?: string };

const projectIndexesAtom = Atom.family((key: string) => {
  const [environmentId, reads] = JSON.parse(key) as [EnvironmentId, ReadonlyArray<IndexRead>];
  return Atom.make((get) => {
    const indexes = new Map<string, WikiIndexResult>();
    for (const read of reads) {
      const input = {
        wikiId: read.wikiId,
        ...(read.checkout === undefined ? {} : { checkout: read.checkout }),
      };
      const index = Option.getOrNull(
        AsyncResult.value(get(wikiEnvironment.index({ environmentId, input }))),
      );
      if (index !== null) indexes.set(read.key, index);
    }
    return indexes;
  }).pipe(Atom.withLabel(`project-doc-indexes:${key}`));
});

/**
 * Every root's index, by key, for links that cross roots: the document's own as the screen reads
 * it, the others on disk when it is, else from their main line. A root still loading is left out.
 */
export function useProjectLinkRoots(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly roots: ReadonlyArray<ProjectRootCheckout> | null;
  readonly rootKey: string;
  readonly ownIndex: WikiIndexResult | null;
  readonly disk: boolean;
}): ReadonlyMap<string, WikiIndexResult> | null {
  const { environmentId, projectId, roots, rootKey, ownIndex, disk } = input;
  const key = JSON.stringify([
    environmentId,
    (roots ?? [])
      .filter((root) => root.key !== rootKey && root.state !== "missing")
      .map((root): IndexRead => ({
        key: root.key,
        wikiId: WikiId.make(projectRootId(projectId, root.key)),
        ...(disk || root.state === "plain" ? { checkout: root.path } : {}),
      })),
  ]);
  const others = useAtomValue(projectIndexesAtom(key));
  return useMemo(
    () => (ownIndex === null ? null : new Map([[rootKey, ownIndex], ...others])),
    [ownIndex, others, rootKey],
  );
}
