/**
 * Where a plan's mentions look, and what they insert.
 *
 * A planning space reaches for the repositories its project is working in —
 * the set as context, exactly as resolved. With none, the menu never opens,
 * which is the same thing it did before the registry existed. With more than
 * one, every root is searched and the results merge into one list, each entry
 * saying which repository it came from.
 *
 * The search itself is the app's existing path-search door pointed at each
 * repository root; nothing here reads a filesystem.
 */

interface RepositoryFields {
  readonly repositoryId: string;
  readonly name: string;
  readonly path: string;
}

export interface MentionSearchTarget {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly cwd: string;
}

/**
 * One target per repository in the set. An empty query is still a target —
 * the path-search door decides whether an empty query is worth answering.
 */
export function buildMentionSearchTargets(
  repositories: ReadonlyArray<RepositoryFields>,
): ReadonlyArray<MentionSearchTarget> {
  return repositories.map((repository) => ({
    repositoryId: repository.repositoryId,
    repositoryName: repository.name,
    cwd: repository.path,
  }));
}

export type MentionCandidate =
  | {
      readonly kind: "file";
      /** What the token carries: the path as the search returned it. */
      readonly path: string;
      readonly label: string;
      readonly repositoryName: string | null;
      readonly key: string;
    }
  | {
      readonly kind: "note";
      readonly name: string;
      readonly label: string;
      readonly repositoryName: null;
      readonly key: string;
    };

export interface MentionSearchResult {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly entries: ReadonlyArray<{ readonly path: string }>;
}

const MENTION_CANDIDATE_LIMIT = 20;

/**
 * The menu's list: every repository's answers interleaved so a plural set does
 * not let one root's alphabet crowd out another's, capped where a menu stops
 * being a menu.
 */
export function mergeMentionCandidates(
  results: ReadonlyArray<MentionSearchResult>,
  options: {
    readonly limit?: number;
    readonly noteNames?: ReadonlyArray<string>;
    readonly query?: string;
  } = {},
): ReadonlyArray<MentionCandidate> {
  const limit = options.limit ?? MENTION_CANDIDATE_LIMIT;
  const labelRepository = results.length > 1;
  const candidates: Array<{ candidate: MentionCandidate; sourceIndex: number }> = [];
  const seen = new Set<string>();
  let sourceIndex = 0;

  const depth = Math.max(0, ...results.map((result) => result.entries.length));
  for (let index = 0; index < depth; index += 1) {
    for (const result of results) {
      const entry = result.entries[index];
      if (entry === undefined) continue;
      const key = `${result.repositoryId}:${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        candidate: {
          kind: "file",
          path: entry.path,
          label: entry.path,
          repositoryName: labelRepository ? result.repositoryName : null,
          key,
        },
        sourceIndex: sourceIndex++,
      });
    }
  }

  for (const name of options.noteNames ?? []) {
    const key = `note:${name.toLocaleLowerCase()}`;
    if (seen.has(key) || !mentionMatch(name, options.query ?? "")) continue;
    seen.add(key);
    candidates.push({
      candidate: { kind: "note", name, label: name, repositoryName: null, key },
      sourceIndex: sourceIndex++,
    });
  }

  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return candidates
    .toSorted(
      (left, right) =>
        mentionRank(right.candidate.label, query) - mentionRank(left.candidate.label, query) ||
        left.sourceIndex - right.sourceIndex,
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function mentionMatch(value: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = value.toLocaleLowerCase();
  if (haystack.includes(needle)) return true;
  let queryIndex = 0;
  for (const character of haystack) {
    if (character === needle[queryIndex]) queryIndex += 1;
    if (queryIndex === needle.length) return true;
  }
  return false;
}

function mentionRank(value: string, query: string): number {
  if (!query) return 0;
  const normalized = value.toLocaleLowerCase();
  if (normalized === query) return 4;
  if (normalized.startsWith(query)) return 3;
  if (normalized.includes(query)) return 2;
  return mentionMatch(normalized, query) ? 1 : 0;
}

/**
 * A mention as the prompt carries it. Quoted when the path has whitespace,
 * because the token's own grammar ends at one — the trailing space is part of
 * the insertion, so the caret lands ready for the next word.
 */
export function formatMentionToken(path: string): string {
  const needsQuotes = /[\s"]/.test(path);
  if (!needsQuotes) return `@${path} `;
  return `@"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" `;
}

export function formatMentionCandidate(candidate: MentionCandidate): string {
  return candidate.kind === "note" ? `[[${candidate.name}]] ` : formatMentionToken(candidate.path);
}

/** Wrap-around movement, so a menu of one still answers both arrow keys. */
export function moveMentionHighlight(
  currentIndex: number,
  count: number,
  direction: "up" | "down",
): number {
  if (count === 0) return 0;
  const delta = direction === "down" ? 1 : -1;
  return (currentIndex + delta + count) % count;
}
