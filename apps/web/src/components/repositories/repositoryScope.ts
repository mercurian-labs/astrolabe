import { storedChoice, storedName } from "../projects/storedChoice";

/**
 * Astrolabe: the Repositories sidebar's choices, kept on the device: the repository it shows
 * (`environmentId:projectId`, or every repository), the list or the whole file tree, and the
 * checkout it reads, a thread's working tree or, by default, the repository's own.
 */
export const repositoryScope = storedChoice<string | null>({
  storageKey: "astrolabe:repository-scope:v1",
  fallback: null,
  parse: (stored) => stored,
  serialize: (scope) => scope ?? "",
});

export const repositoryView = storedName("astrolabe:repository-view:v1", ["list", "tree"] as const);

export const repositoryCheckout = storedChoice<string | null>({
  storageKey: "astrolabe:repository-checkout:v1",
  fallback: null,
  parse: (stored) => stored,
  serialize: (cwd) => cwd ?? "",
});
