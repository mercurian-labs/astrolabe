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
 * Astrolabe: which kind of project the Change requests tab lists while no one project is picked:
 * all, the repositories' pull requests, or the wikis' change requests.
 */
export const changeRequestProjectKindAtom = Atom.make<"all" | "repositories" | "wikis">("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("change-request-project-kind"),
);

/**
 * The wiki the Change requests tab's filter picked (its `wikiScopeKey`), or null for every wiki.
 * The tab's own, not the Wikis tab's filter, so narrowing one never narrows the other.
 */
export const changeRequestWikiScopeAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("change-request-wiki-scope"),
);
