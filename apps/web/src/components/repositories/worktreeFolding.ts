import type { ProjectWorktree, ProjectWorktreeMaker } from "@t3tools/contracts";

import type { RepositoryCheckout } from "./repositoryTabs";

/**
 * Astrolabe: which of a project's worktrees its sidebar lists, and which fold under "more". Agents'
 * tools leave a worktree per run, so a busy repository has hundreds; the ones that matter are those
 * in use, opened, or touched lately.
 */

/** How long a worktree that moved stays listed. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

const HELD = new Set(["kept", "thread", "working", "terminal"]);

/** A checkout's name among the open tabs: its branch, or its folder. */
export const checkoutTag = (checkout: RepositoryCheckout) =>
  "branch" in checkout ? `branch:${checkout.branch}` : `cwd:${checkout.cwd}`;

export interface FoldContext {
  /** The checkouts of the project's open tabs (`checkoutTag`). */
  readonly openCheckouts: ReadonlySet<string>;
  readonly now: number;
}

/** Whether a worktree is listed: the main one, one in use, opened, changed, or recently moved. */
function listsWorktree(worktree: ProjectWorktree, context: FoldContext): boolean {
  if (worktree.isMain || worktree.number !== null) return true;
  if (worktree.holds.some((hold) => HELD.has(hold.kind))) return true;
  if ((worktree.changedFiles ?? 0) > 0) return true;
  if (worktree.branch !== null && context.openCheckouts.has(`branch:${worktree.branch}`)) {
    return true;
  }
  if (context.openCheckouts.has(`cwd:${worktree.path}`)) return true;
  const active = worktree.lastActiveAt === null ? Number.NaN : Date.parse(worktree.lastActiveAt);
  return context.now - active < RECENT_MS;
}

/** The worktrees listed, and the rest; the focused tab's (`outside`) is always listed. */
export function foldWorktrees<
  Entry extends { readonly worktree: ProjectWorktree; readonly outside: boolean },
>(entries: ReadonlyArray<Entry>, context: FoldContext) {
  const listed: Entry[] = [];
  const rest: Entry[] = [];
  for (const entry of entries) {
    (entry.outside || listsWorktree(entry.worktree, context) ? listed : rest).push(entry);
  }
  return { listed, rest };
}

const MAKERS: ReadonlyArray<{ readonly maker: ProjectWorktreeMaker; readonly label: string }> = [
  { maker: "astrolabe", label: "Astrolabe" },
  { maker: "claude-code", label: "Claude Code" },
  { maker: "t3-code", label: "T3 Code" },
  { maker: "codex", label: "Codex" },
  { maker: "other", label: "Other" },
];

/** Folded worktrees matching `query`, grouped by the tool that made them, most recent first. */
export function groupFolded<Entry extends { readonly worktree: ProjectWorktree }>(
  rest: ReadonlyArray<Entry>,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  const matching = rest
    .filter(
      ({ worktree }) =>
        needle === "" ||
        worktree.alias.toLowerCase().includes(needle) ||
        worktree.path.toLowerCase().includes(needle),
    )
    .toSorted((a, b) =>
      (b.worktree.lastActiveAt ?? "").localeCompare(a.worktree.lastActiveAt ?? ""),
    );
  return MAKERS.flatMap(({ maker, label }) => {
    const entries = matching.filter(({ worktree }) => (worktree.madeBy ?? "other") === maker);
    return entries.length === 0 ? [] : [{ maker, label, entries }];
  });
}
