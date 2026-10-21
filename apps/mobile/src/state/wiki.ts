import type { EnvironmentId } from "@t3tools/contracts";
import { createWikiEnvironmentAtoms } from "@t3tools/client-runtime/state/wiki";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

// Astrolabe: wikis, read and changed through the same queries and commands as the web app.
export const wikiEnvironment = createWikiEnvironmentAtoms(connectionAtomRuntime);

/**
 * Every wiki on each server in `key` (a JSON array of environment ids), per server in order;
 * null for a server whose list is still loading.
 */
export const wikiOverviewsAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as EnvironmentId[]).map((environmentId) =>
      get(wikiEnvironment.overview(environmentId)),
    ),
  ).pipe(Atom.withLabel(`wiki-overviews:${key}`)),
);

/**
 * Astrolabe: whether the Change requests tab lists only the wikis' change requests, as its
 * filter's wiki choices ask. Which wiki is the workspace's wiki filter, shared with Wikis.
 */
export const changeRequestWikisOnlyAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("change-request-wikis-only"),
);
