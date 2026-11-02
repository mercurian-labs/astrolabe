import { storedChoice, storedName } from "../projects/storedChoice";

/**
 * Astrolabe: the Projects sidebar's choices kept on the device, besides its filter
 * (`repositoryFilter`): the worktrees showing their files, and where a branch opens.
 */
const NO_CHOICES: Readonly<Record<string, boolean>> = {};

/**
 * Whether a worktree shows its file tree (true) or its changes (false), by `worktreeFilesKey`, once
 * someone has picked; until then the main checkout shows its files and the others their changes.
 */
export const repositoryWorktreeFiles = storedChoice<Readonly<Record<string, boolean>>>({
  storageKey: "astrolabe:repository-worktree-files:v2",
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

export const worktreeFilesKey = (environmentId: string, worktreePath: string) =>
  `${environmentId}:${worktreePath}`;

/** Whether a worktree shows its file tree, as picked or by default. */
export const worktreeFilesShown = (
  choices: Readonly<Record<string, boolean>>,
  key: string,
  isMain: boolean,
) => choices[key] ?? isMain;

/** Shows a worktree's file tree, or its changes. */
export function showWorktreeFiles(key: string, shown: boolean) {
  repositoryWorktreeFiles.set({ ...repositoryWorktreeFiles.get(), [key]: shown });
}

/** Whether opening a branch makes a worktree of its own even when one is free. */
export const openInNewWorktree = storedName("astrolabe:open-in-new-worktree:v1", [
  "reuse",
  "new",
] as const);
