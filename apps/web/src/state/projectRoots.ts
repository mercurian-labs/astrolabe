import { createProjectRootsEnvironmentAtoms } from "@t3tools/client-runtime/state/projectRoots";
import type { EnvironmentId, WikiIndexResult, WikiReadScope } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { wikiEnvironment } from "./wiki";

/** Astrolabe: a project's roots, and what the Projects tree's Docs filter keeps of one. */
export const projectRootsEnvironment = createProjectRootsEnvironmentAtoms(connectionAtomRuntime);

/** One root's index as a project document reads it, under the root's key. */
interface ProjectIndexRead {
  readonly key: string;
  readonly input: WikiReadScope;
}

/**
 * The indexes of a project's roots in `key` (JSON of an environment id and `ProjectIndexRead`s),
 * each null until it arrives. Reads the same queries a document's own view reads, so they share
 * caches and refreshes.
 */
export const projectIndexesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const { environmentId, reads } = JSON.parse(key) as {
      readonly environmentId: EnvironmentId;
      readonly reads: ReadonlyArray<ProjectIndexRead>;
    };
    return reads.map(({ key: root, input }): readonly [string, WikiIndexResult | null] => [
      root,
      Option.getOrNull(AsyncResult.value(get(wikiEnvironment.index({ environmentId, input })))),
    ]);
  }).pipe(Atom.withLabel(`project-indexes:${key}`)),
);
