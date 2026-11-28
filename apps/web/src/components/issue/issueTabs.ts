/**
 * Astrolabe: an issue's tab names it in full (server, project, tracker, host, scope and key), so
 * it reads on its own in any pane and after a reload. Showing one is `issueWorkspace.ts`.
 */

export interface IssueTabTarget {
  readonly environmentId: string;
  readonly projectId: string;
  readonly tracker: string;
  /** Absent where the tracker has one host only, as an issue reference allows. */
  readonly host?: string | undefined;
  readonly scope: string;
  readonly key: string;
}

const ISSUE_TAB_PREFIX = "issue:";

// Unlike a thread's issue surface id, the scope keeps its case: a Linear team key is read as typed.
export function issueTabKey(target: IssueTabTarget): string {
  return `${ISSUE_TAB_PREFIX}${[
    target.environmentId,
    target.projectId,
    target.tracker,
    target.host?.toLowerCase() ?? "",
    target.scope,
    target.key,
  ]
    .map(encodeURIComponent)
    .join(":")}`;
}

/** The issue a tab key names; null for any other key. */
export function issueTargetOfKey(key: string): IssueTabTarget | null {
  if (!key.startsWith(ISSUE_TAB_PREFIX)) return null;
  const parts = key.slice(ISSUE_TAB_PREFIX.length).split(":");
  if (parts.length !== 6) return null;
  try {
    const [environmentId, projectId, tracker, host, scope, issueKey] = parts.map((part) =>
      decodeURIComponent(part),
    );
    if (!environmentId || !projectId || !tracker || !scope || !issueKey) return null;
    return { environmentId, projectId, tracker, ...(host ? { host } : {}), scope, key: issueKey };
  } catch {
    return null;
  }
}

/** A tab's title before the issue is read: `#7 owner/repo` for a numbered key, else the key. */
export function issueTabTitle(target: IssueTabTarget): string {
  return /^\d+$/.test(target.key) ? `#${target.key} ${target.scope}` : target.key;
}
