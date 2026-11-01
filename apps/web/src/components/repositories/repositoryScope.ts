import { storedChoice, storedName } from "../projects/storedChoice";

/**
 * Astrolabe: the Repos sidebar's choices kept on the device, besides its filter
 * (`repositoryFilter`): the worktrees showing their files, and where a branch opens.
 */
const NO_KEYS: ReadonlyArray<string> = [];

/** Worktrees showing their file tree in place of their changes, by `worktreeFilesKey`. */
export const repositoryWorktreeFiles = storedChoice<ReadonlyArray<string>>({
  storageKey: "astrolabe:repository-worktree-files:v1",
  fallback: NO_KEYS,
  parse: (stored) => {
    try {
      const keys: unknown = JSON.parse(stored);
      return Array.isArray(keys) && keys.every((key) => typeof key === "string") ? keys : null;
    } catch {
      return null;
    }
  },
  serialize: (keys) => JSON.stringify(keys),
});

export const worktreeFilesKey = (environmentId: string, worktreePath: string) =>
  `${environmentId}:${worktreePath}`;

/** Shows a worktree's file tree, or its changes again. */
export function showWorktreeFiles(key: string, shown: boolean) {
  const keys = repositoryWorktreeFiles.get().filter((entry) => entry !== key);
  repositoryWorktreeFiles.set(shown ? [...keys, key] : keys.length === 0 ? NO_KEYS : keys);
}

/** Whether opening a branch makes a worktree of its own even when one is free. */
export const openInNewWorktree = storedName("astrolabe:open-in-new-worktree:v1", [
  "reuse",
  "new",
] as const);
