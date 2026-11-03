export interface ListedWorktree {
  readonly path: string;
  readonly isMain: boolean;
  readonly branch: string | null;
  readonly head: string | null;
  /** A folder git knows nothing about, listed as its own checkout. */
  readonly plainFolder?: true;
}

/** `git worktree list --porcelain -z`: the first record is the repository's own checkout. */
export function parseWorktreeList(stdout: string): ReadonlyArray<ListedWorktree> {
  const listed: ListedWorktree[] = [];
  for (const record of stdout.split("\0\0")) {
    const fields = record.split("\0").filter(Boolean);
    const worktree = fields.find((field) => field.startsWith("worktree "));
    if (worktree === undefined) continue;
    const isMain = listed.length === 0;
    // A bare main still counts as first; a prunable record's directory is gone.
    if (fields.includes("bare") || fields.some((field) => field.startsWith("prunable"))) {
      if (isMain) listed.push({ path: "", isMain, branch: null, head: null });
      continue;
    }
    const head = fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? null;
    const branchRef = fields.find((field) => field.startsWith("branch "))?.slice(7) ?? null;
    listed.push({
      path: worktree.slice("worktree ".length),
      isMain,
      head,
      branch: branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : null,
    });
  }
  return listed.filter((entry) => entry.path !== "");
}

/** `git status --porcelain=v1 -z`: renames and copies carry a second path. */
export function countStatusFiles(stdout: string): number {
  const records = stdout.split("\0").filter(Boolean);
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    count++;
    if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
  }
  return count;
}
