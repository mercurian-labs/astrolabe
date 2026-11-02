import { storedChoice, storedName } from "../projects/storedChoice";

/**
 * Astrolabe: the Projects sidebar's choices kept on the device, besides its filter
 * (`repositoryFilter`): the worktrees showing their files, and where a branch opens.
 */
const NO_CHOICES: Readonly<Record<string, boolean>> = {};

/** Whether each worktree shows its file tree (true) or its rows (false), by `worktreeFilesKey`. */
export const storedWorktreeFiles = (storageKey: string) =>
  storedChoice<Readonly<Record<string, boolean>>>({
    storageKey,
    fallback: NO_CHOICES,
    parse: (stored) => {
      try {
        const choices: unknown = JSON.parse(stored);
        if (typeof choices !== "object" || choices === null || Array.isArray(choices)) return null;
        const picked: Record<string, boolean> = {};
        for (const [key, shown] of Object.entries(choices)) {
          if (typeof shown === "boolean") picked[key] = shown;
        }
        return picked;
      } catch {
        return null;
      }
    },
    serialize: (choices) => JSON.stringify(choices),
  });

/**
 * A Projects worktree's pick, once someone has made one; until then the main checkout shows its
 * files and the others their changes.
 */
export const repositoryWorktreeFiles = storedWorktreeFiles(
  "astrolabe:repository-worktree-files:v2",
);

export const worktreeFilesKey = (environmentId: string, worktreePath: string) =>
  `${environmentId}:${worktreePath}`;

/** Whether a worktree shows its file tree, as picked or else `fallback`. */
export const worktreeFilesShown = (
  choices: Readonly<Record<string, boolean>>,
  key: string,
  fallback: boolean,
) => choices[key] ?? fallback;

/** Shows a worktree's file tree, or its changes. */
export function showWorktreeFiles(key: string, shown: boolean) {
  repositoryWorktreeFiles.set({ ...repositoryWorktreeFiles.get(), [key]: shown });
}

/** Whether opening a branch makes a worktree of its own even when one is free. */
export const openInNewWorktree = storedName("astrolabe:open-in-new-worktree:v1", [
  "reuse",
  "new",
] as const);
