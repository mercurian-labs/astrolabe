import { storedChoice, storedName } from "../projects/storedChoice";

/**
 * Astrolabe: the Repositories sidebar's choices, kept on the device: the repository it shows
 * (`environmentId:projectId`, or every repository), and the list or the file trees.
 */
export const repositoryScope = storedChoice<string | null>({
  storageKey: "astrolabe:repository-scope:v1",
  fallback: null,
  parse: (stored) => stored,
  serialize: (scope) => scope ?? "",
});

export const repositoryView = storedName("astrolabe:repository-view:v1", ["list", "tree"] as const);
