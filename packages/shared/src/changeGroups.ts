import {
  changeGroupMemberKey,
  type ChangeGroupDecisions,
  type ChangeGroupGroupingSettings,
  type ChangeGroupMemberRef,
  type ChangeGroupReason,
  type ThreadPullRequestLink,
  type WikiChangeRequest,
} from "@t3tools/contracts";

/**
 * Astrolabe: change groups, derived. A thread's change requests are one effort; so are those of
 * a coordinator's children (`subagent`) and of a thread's forks (`fork`), each rule as the
 * environment's settings allow. Titles that share an issue key (`M-123`) join too. What people
 * decided on top (`ChangeGroupDecisions`) moves members in and out: a change request is in one
 * group at a time. A group's threads are the ones working on the effort: those that opened its
 * change requests, their family, threads on its pull requests' branches, threads naming its issue
 * key, and those people or agents added; a thread can be in several groups. The server and every
 * client derive the same groups from the same data.
 */

export interface ChangeGroupThread {
  readonly id: string;
  readonly title: string;
  readonly lineage: {
    readonly parentThreadId: string | null;
    readonly relationshipToParent: "fork" | "subagent" | null;
  };
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  /** The branch the thread works on, if any. */
  readonly branch: string | null;
}

export interface ChangeGroupWikiChange {
  readonly wikiName: string;
  readonly changeRequest: Pick<
    WikiChangeRequest,
    "changeRequestId" | "wikiId" | "title" | "status" | "threadId" | "updatedAt"
  >;
}

export type ChangeGroupMemberState = "open" | "draft" | "merged" | "closed";

export interface ChangeGroupMember {
  readonly key: string;
  readonly ref: ChangeGroupMemberRef;
  /** Code (a pull request) or documentation (a wiki's change request). */
  readonly side: "code" | "docs";
  readonly reason: ChangeGroupReason;
  /** What an agent said, for a suggested member. */
  readonly note: string;
  readonly title: string;
  /** Where it lives: the repository, or the wiki's name. */
  readonly place: string;
  readonly state: ChangeGroupMemberState;
  readonly url: string | null;
  readonly threadId: string | null;
  readonly updatedAt: string | null;
  /** A pull request's head and base branches; null for documentation or before a host sync. */
  readonly branch: string | null;
  readonly baseBranch: string | null;
}

/** Why a thread is in a group. */
export type ChangeGroupThreadReason =
  /** The thread the group started from. */
  | "root"
  /** It opened one of the group's change requests. */
  | "opened"
  /** A fork of one of the group's threads. */
  | "fork"
  /** A coordinator's child of one of the group's threads. */
  | "coordinator"
  /** It works on a member pull request's branch. */
  | "same-branch"
  /** Its title or branch names the group's issue key. */
  | "reference"
  | "manual"
  | "suggested";

export const CHANGE_GROUP_THREAD_REASON_LABELS: Readonly<Record<ChangeGroupThreadReason, string>> =
  {
    root: "Started the group",
    opened: "Opened a change request",
    fork: "A fork",
    coordinator: "A coordinator's child",
    "same-branch": "Same branch",
    reference: "Names the issue",
    manual: "Added",
    suggested: "Suggested",
  };

export interface ChangeGroupThreadEntry {
  readonly threadId: string;
  readonly title: string;
  readonly reason: ChangeGroupThreadReason;
  /** What an agent said, for a suggested thread. */
  readonly note: string;
}

/** The group's state in one word, for its card and its tab. */
export type ChangeGroupState =
  | "in-sync"
  | "docs-behind"
  | "waiting-on-code"
  | "docs-missing"
  | "merged";

export const CHANGE_GROUP_STATE_LABELS: Readonly<Record<ChangeGroupState, string>> = {
  "in-sync": "In sync",
  "docs-behind": "Docs behind",
  "waiting-on-code": "Waiting on code",
  "docs-missing": "Docs missing",
  merged: "Merged",
};

export interface ChangeGroup {
  readonly groupId: string;
  readonly title: string;
  /** The threads working on the effort, the group's own first. */
  readonly threads: ReadonlyArray<ChangeGroupThreadEntry>;
  /** Their ids, in the same order. */
  readonly threadIds: ReadonlyArray<string>;
  readonly members: ReadonlyArray<ChangeGroupMember>;
  readonly state: ChangeGroupState;
  /** Whether the documentation merges the moment the code has. */
  readonly armed: boolean;
}

const ISSUE_KEY = /\b[A-Z][A-Z0-9]*-\d+\b/g;
const issueKeys = (title: string) => new Set(title.match(ISSUE_KEY) ?? []);
/** A thread's issue keys: its title's, and its branch's, which are usually lower case. */
const threadIssueKeys = (thread: ChangeGroupThread) =>
  new Set([...issueKeys(thread.title), ...issueKeys((thread.branch ?? "").toUpperCase())]);

function pullRequestMember(
  link: ThreadPullRequestLink,
  reason: ChangeGroupReason,
  threadId: string | null,
  note = "",
): ChangeGroupMember {
  const ref: ChangeGroupMemberRef = {
    kind: "pull-request",
    host: link.host,
    repository: link.repository,
    number: link.number,
  };
  const snapshot = link.snapshot;
  return {
    key: changeGroupMemberKey(ref),
    ref,
    side: "code",
    reason,
    note,
    title: snapshot?.title ?? `#${link.number}`,
    place: link.repository,
    state:
      snapshot === null
        ? "open"
        : snapshot.state === "open" && snapshot.isDraft
          ? "draft"
          : snapshot.state,
    url: link.url,
    threadId,
    updatedAt: snapshot?.updatedAt ?? null,
    branch: snapshot?.headBranch ?? null,
    baseBranch: snapshot?.baseBranch ?? null,
  };
}

function wikiMember(
  change: ChangeGroupWikiChange,
  reason: ChangeGroupReason,
  note = "",
): ChangeGroupMember {
  const { changeRequest } = change;
  const ref: ChangeGroupMemberRef = {
    kind: "wiki-change-request",
    wikiId: changeRequest.wikiId,
    changeRequestId: changeRequest.changeRequestId,
  };
  return {
    key: changeGroupMemberKey(ref),
    ref,
    side: "docs",
    reason,
    note,
    title: changeRequest.title,
    place: change.wikiName,
    state: changeRequest.status,
    url: null,
    threadId: changeRequest.threadId,
    updatedAt: changeRequest.updatedAt,
    branch: null,
    baseBranch: null,
  };
}

/**
 * The thread a thread's change requests group under: up its parents while each step is one the
 * settings follow (a coordinator's child, a fork), to the first it may not climb past.
 */
function changeGroupRootOf(
  threadId: string,
  threads: ReadonlyMap<string, ChangeGroupThread>,
  settings: Pick<ChangeGroupGroupingSettings, "coordinator" | "lineage">,
): { readonly rootId: string; readonly reason: ChangeGroupReason } {
  let current = threads.get(threadId);
  let reason: ChangeGroupReason = "same-thread";
  const seen = new Set<string>([threadId]);
  while (current) {
    const { parentThreadId, relationshipToParent } = current.lineage;
    if (parentThreadId === null || seen.has(parentThreadId)) break;
    const follows =
      (relationshipToParent === "subagent" && settings.coordinator) ||
      (relationshipToParent === "fork" && settings.lineage);
    const parent = threads.get(parentThreadId);
    if (!follows || !parent) break;
    // The reason a member is in its group is the step nearest the member.
    if (reason === "same-thread")
      reason = relationshipToParent === "subagent" ? "coordinator" : "lineage";
    seen.add(parentThreadId);
    current = parent;
  }
  return { rootId: current?.id ?? threadId, reason };
}

/** The state a group's members add up to. */
function changeGroupState(
  members: ReadonlyArray<ChangeGroupMember>,
  settings: Pick<ChangeGroupGroupingSettings, "flagDocsBehind">,
): ChangeGroupState {
  const live = members.filter((member) => member.state !== "closed");
  if (live.length > 0 && live.every((member) => member.state === "merged")) return "merged";
  const code = live.filter((member) => member.side === "code");
  const docs = live.filter((member) => member.side === "docs");
  const openCode = code.filter((member) => member.state !== "merged");
  if (code.length > 0 && docs.length === 0) return "docs-missing";
  if (openCode.length > 0 && docs.some((member) => member.state === "merged")) {
    return "waiting-on-code";
  }
  if (settings.flagDocsBehind) {
    const latestCode = newest(code.map((member) => member.updatedAt));
    const behind = docs.some(
      (member) =>
        member.state !== "merged" &&
        latestCode !== undefined &&
        member.updatedAt !== null &&
        member.updatedAt < latestCode,
    );
    if (behind) return "docs-behind";
  }
  return "in-sync";
}

/**
 * Every group on one environment: the rules' members, moved in and out by the decisions. A group
 * shows once it holds two members, or once someone decided something about it.
 */
export function deriveChangeGroups(input: {
  readonly threads: ReadonlyArray<ChangeGroupThread>;
  readonly wikiChanges: ReadonlyArray<ChangeGroupWikiChange>;
  readonly decisions: ReadonlyArray<ChangeGroupDecisions>;
  readonly settings: ChangeGroupGroupingSettings;
}): ReadonlyArray<ChangeGroup> {
  const { settings } = input;
  const threads = new Map(input.threads.map((thread) => [thread.id, thread]));
  const decisions = new Map(input.decisions.map((decision) => [decision.groupId, decision]));
  const removed = new Set(input.decisions.flatMap((decision) => decision.removed));
  const added = new Map<
    string,
    { readonly groupId: string; readonly reason: ChangeGroupReason; readonly note: string }
  >();
  for (const decision of input.decisions) {
    for (const entry of decision.added) {
      // Threads are not change requests: they join groups below, and can join several.
      if (entry.member.kind === "thread") continue;
      added.set(changeGroupMemberKey(entry.member), {
        groupId: decision.groupId,
        reason: entry.reason,
        note: entry.note,
      });
    }
  }

  const members = new Map<string, ChangeGroupMember[]>();
  const threadIds = new Map<string, string[]>();
  const place = (groupId: string, member: ChangeGroupMember) => {
    // Taken out by hand, or moved to another group by hand: the rules leave it there.
    if (removed.has(member.key)) return;
    const moved = added.get(member.key);
    if (moved && moved.groupId !== groupId) return;
    const list = members.get(groupId) ?? [];
    if (list.some((existing) => existing.key === member.key)) return;
    list.push(moved ? { ...member, reason: moved.reason, note: moved.note } : member);
    members.set(groupId, list);
  };
  const noteThread = (groupId: string, threadId: string) => {
    const list = threadIds.get(groupId) ?? [];
    if (!list.includes(threadId)) list.push(threadId);
    threadIds.set(groupId, list);
  };

  // Every change request, with the thread that wrote it, if any.
  const pullRequests = input.threads.flatMap((thread) =>
    thread.pullRequests
      .filter((link) => link.source !== "stack-dismissed")
      .map((link) => ({ thread, link })),
  );
  const ungrouped: ChangeGroupMember[] = [];
  if (settings.sameThread) {
    for (const { thread, link } of pullRequests) {
      const { rootId, reason } = changeGroupRootOf(thread.id, threads, settings);
      noteThread(rootId, rootId);
      noteThread(rootId, thread.id);
      place(rootId, pullRequestMember(link, reason, thread.id));
    }
    for (const change of input.wikiChanges) {
      const threadId = change.changeRequest.threadId;
      if (threadId === null || !threads.has(threadId)) {
        ungrouped.push(wikiMember(change, "reference"));
        continue;
      }
      const { rootId, reason } = changeGroupRootOf(threadId, threads, settings);
      noteThread(rootId, rootId);
      noteThread(rootId, threadId);
      place(rootId, wikiMember(change, reason));
    }
  } else {
    for (const { thread, link } of pullRequests) {
      ungrouped.push(pullRequestMember(link, "reference", thread.id));
    }
    for (const change of input.wikiChanges) ungrouped.push(wikiMember(change, "reference"));
  }

  // Members someone added: wherever the rules would have put them, they are here.
  const everything = new Map<string, ChangeGroupMember>();
  for (const { thread, link } of pullRequests) {
    const member = pullRequestMember(link, "manual", thread.id);
    everything.set(member.key, member);
  }
  for (const change of input.wikiChanges) {
    const member = wikiMember(change, "manual");
    everything.set(member.key, member);
  }
  for (const [key, entry] of added) {
    const member = everything.get(key);
    if (member) place(entry.groupId, { ...member, reason: entry.reason, note: entry.note });
  }

  // A change request with no group joins one whose titles share its issue key.
  if (settings.references) {
    const grouped = new Set([...members.values()].flat().map((member) => member.key));
    for (const member of ungrouped) {
      if (grouped.has(member.key) || removed.has(member.key)) continue;
      const keys = issueKeys(member.title);
      if (keys.size === 0) continue;
      for (const [groupId, list] of members) {
        if (list.some((other) => [...issueKeys(other.title)].some((key) => keys.has(key)))) {
          place(groupId, { ...member, reason: "reference" });
          grouped.add(member.key);
          break;
        }
      }
    }
  }

  const groups: ChangeGroup[] = [];
  for (const [groupId, list] of members) {
    const decision = decisions.get(groupId);
    if (list.length < 2 && decision === undefined) continue;
    const groupThreads = groupThreadsOf({
      groupId,
      openers: threadIds.get(groupId) ?? [groupId],
      members: list,
      title: decision?.title ?? null,
      decision,
      threads,
      settings,
    });
    groups.push({
      groupId,
      title: decision?.title ?? threads.get(groupId)?.title ?? list[0]?.title ?? "Change group",
      threads: groupThreads,
      threadIds: groupThreads.map((entry) => entry.threadId),
      members: list,
      state: changeGroupState(list, settings),
      armed: decision?.armed ?? settings.armByDefault,
    });
  }
  // Copies sorted, not `toSorted`: the phone's Hermes has no ES2023 methods.
  return [...groups].sort((a, b) =>
    (newest(b.members.map((m) => m.updatedAt)) ?? "").localeCompare(
      newest(a.members.map((m) => m.updatedAt)) ?? "",
    ),
  );
}

/** Branches too common to say two threads work on the same thing. */
const SHARED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

/**
 * A group's threads: the one it started from, those that opened its change requests, their
 * forks and coordinator's children, threads on its pull requests' branches and threads naming
 * its issue key (each as the settings allow), then those people or agents added; minus those
 * taken out of this group.
 */
function groupThreadsOf(input: {
  readonly groupId: string;
  /** The threads whose change requests the rules placed here, the group's own first. */
  readonly openers: ReadonlyArray<string>;
  readonly members: ReadonlyArray<ChangeGroupMember>;
  readonly title: string | null;
  readonly decision: ChangeGroupDecisions | undefined;
  readonly threads: ReadonlyMap<string, ChangeGroupThread>;
  readonly settings: ChangeGroupGroupingSettings;
}): ReadonlyArray<ChangeGroupThreadEntry> {
  const { threads, settings, decision } = input;
  const removed = new Set(decision?.removed ?? []);
  const entries = new Map<string, { reason: ChangeGroupThreadReason; note: string }>();
  const add = (threadId: string, reason: ChangeGroupThreadReason, note = "") => {
    if (!threads.has(threadId) || entries.has(threadId)) return;
    if (removed.has(changeGroupMemberKey({ kind: "thread", threadId }))) return;
    entries.set(threadId, { reason, note });
  };

  const openedBy = new Set(
    input.members.flatMap((member) => (member.threadId === null ? [] : [member.threadId])),
  );
  add(input.groupId, openedBy.has(input.groupId) ? "opened" : "root");
  for (const threadId of input.openers) add(threadId, "opened");
  for (const threadId of openedBy) add(threadId, "opened");

  // The family of the threads so far: forks and coordinator's children, all the way down.
  const children = new Map<string, ChangeGroupThread[]>();
  for (const thread of threads.values()) {
    const parent = thread.lineage.parentThreadId;
    if (parent === null) continue;
    const list = children.get(parent) ?? [];
    list.push(thread);
    children.set(parent, list);
  }
  const queue = [...entries.keys()];
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]!) ?? []) {
      const relationship = child.lineage.relationshipToParent;
      const follows =
        (relationship === "fork" && settings.lineage) ||
        (relationship === "subagent" && settings.coordinator);
      if (!follows || entries.has(child.id)) continue;
      add(child.id, relationship === "fork" ? "fork" : "coordinator");
      if (entries.has(child.id)) queue.push(child.id);
    }
  }

  if (settings.sameBranch) {
    const branches = new Set(
      input.members.flatMap((member) =>
        member.side === "code" &&
        member.branch !== null &&
        member.branch !== member.baseBranch &&
        !SHARED_BRANCHES.has(member.branch)
          ? [member.branch]
          : [],
      ),
    );
    for (const thread of threads.values()) {
      if (thread.branch !== null && branches.has(thread.branch)) add(thread.id, "same-branch");
    }
  }

  if (settings.references) {
    const keys = new Set([
      ...issueKeys(input.title ?? ""),
      ...input.members.flatMap((member) => [...issueKeys(member.title)]),
    ]);
    if (keys.size > 0) {
      for (const thread of threads.values()) {
        if ([...threadIssueKeys(thread)].some((key) => keys.has(key))) add(thread.id, "reference");
      }
    }
  }

  for (const entry of decision?.added ?? []) {
    if (entry.member.kind === "thread") add(entry.member.threadId, entry.reason, entry.note);
  }

  return [...entries].map(([threadId, entry]) => ({
    threadId,
    title: threads.get(threadId)?.title ?? threadId,
    reason: entry.reason,
    note: entry.note,
  }));
}

/** The latest of some ISO timestamps, if any. */
function newest(timestamps: ReadonlyArray<string | null>): string | undefined {
  let latest: string | undefined;
  for (const at of timestamps)
    if (at !== null && (latest === undefined || at > latest)) latest = at;
  return latest;
}

/** Which of a client's six group colours a group takes, the same on every client. */
export function changeGroupColorIndex(groupKey: string): number {
  let hash = 0;
  for (const char of groupKey) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
}

/** Every change request on an environment, as a group would show it: a candidate to add. */
export function changeGroupCandidates(input: {
  readonly threads: ReadonlyArray<ChangeGroupThread>;
  readonly wikiChanges: ReadonlyArray<ChangeGroupWikiChange>;
}): ReadonlyArray<ChangeGroupMember> {
  return [
    ...input.threads.flatMap((thread) =>
      thread.pullRequests
        .filter((link) => link.source !== "stack-dismissed")
        .map((link) => pullRequestMember(link, "manual", thread.id)),
    ),
    ...input.wikiChanges.map((change) => wikiMember(change, "manual")),
  ];
}
