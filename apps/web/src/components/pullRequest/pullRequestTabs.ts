import { surfaceIdOf } from "~/panes/arrangement";
import { pullRequestSurface, pullRequestSurfaceId } from "~/rightPanelStore";

/**
 * Astrolabe: a pull request's tab names it in full, so it reads on its own in any pane and after
 * a reload. Showing one is `pullRequestWorkspace.ts`.
 */

/** What names a pull request: the server, project, host, repository and number. */
export type PullRequestTarget = Parameters<typeof pullRequestSurface>[0];

/** A pull request named in full, as a tab key that reads on its own names it. */
export type FullPullRequestTarget = PullRequestTarget & {
  readonly environmentId: string;
  readonly host: string;
};

const PULL_REQUEST_ID_PREFIX = "pull-request:";

/**
 * The pull request a tab key names, read from the key alone, so its tab comes back after a reload
 * and can show in any section's panes. Only a key naming its server and host reads: a thread's
 * right panel leaves those out of its own pull requests and takes them from the thread.
 */
export function pullRequestTargetOfKey(key: string): FullPullRequestTarget | null {
  const id = surfaceIdOf(key);
  if (id === null || !id.startsWith(PULL_REQUEST_ID_PREFIX)) return null;
  const parts = id.slice(PULL_REQUEST_ID_PREFIX.length).split(":");
  if (parts.length !== 5) return null;
  try {
    const [environmentId, projectId, host, repository, raw] = parts.map((part) =>
      decodeURIComponent(part),
    );
    const number = Number(raw);
    if (!environmentId || !projectId || !host || !repository) return null;
    if (!Number.isSafeInteger(number) || number <= 0) return null;
    const target = { environmentId, projectId, host, repository, number };
    return pullRequestSurfaceId(target) === id ? target : null;
  } catch {
    return null;
  }
}
