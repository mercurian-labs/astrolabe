import type { ThreadPullRequestLink, WikiChangeRequest } from "@t3tools/contracts";

/**
 * Astrolabe: a wiki change request and the pull requests of the thread that wrote it. They are
 * two things that know about each other, reviewed and merged in their own places; nothing merges
 * or closes on its own. When the code's pull request settles, the change request offers to
 * follow it, and merging the docs before the code warns first.
 */

/** The pull requests a thread holds, as its change request shows them; dismissed ones left out. */
export function changeRequestPullRequests(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<ThreadPullRequestLink> {
  return links.filter((link) => link.source !== "stack-dismissed");
}

const stateOf = (link: ThreadPullRequestLink) => link.snapshot?.state ?? null;

/** What the change request offers once its pull requests settle: merge with them, or close. */
export type PullRequestNudge =
  | { readonly kind: "merge"; readonly pullRequest: ThreadPullRequestLink }
  | { readonly kind: "close"; readonly pullRequest: ThreadPullRequestLink };

/**
 * An open change request offers to merge once one of its pull requests merged, and to close once
 * every one of them closed without merging. Nothing while any is still open or unread.
 */
export function pullRequestNudge(
  status: WikiChangeRequest["status"],
  links: ReadonlyArray<ThreadPullRequestLink>,
): PullRequestNudge | null {
  if (status !== "open") return null;
  const linked = changeRequestPullRequests(links);
  const merged = linked.find((link) => stateOf(link) === "merged");
  if (merged) return { kind: "merge", pullRequest: merged };
  const [first] = linked;
  if (first && linked.every((link) => stateOf(link) === "closed")) {
    return { kind: "close", pullRequest: first };
  }
  return null;
}

/** The pull requests not merged yet, which merging the docs first asks about. */
export function unmergedPullRequests(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<ThreadPullRequestLink> {
  return changeRequestPullRequests(links).filter((link) => stateOf(link) === "open");
}
