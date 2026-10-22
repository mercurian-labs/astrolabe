import { Atom } from "effect/reactivity";

/** Astrolabe: the repository the Repositories tab shows (`environmentId:projectId`), or all. */
export const repositoryScopeAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("repository-scope"),
);
