import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { ProjectId, ServerSettings } from "@t3tools/contracts";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";
import type { ThreadPullRequestBadge } from "@t3tools/shared/threadPullRequests";

/**
 * Astrolabe: what a sidebar thread row's second line says. The first line names the thread
 * (project picture, title, age); the second shows only what sets it apart from the rows around
 * it: an unsent draft, a branch that is not the default one, its pull request, and its agent when
 * that is not the one its project's new threads start with. A row with none of these takes one
 * line. The hover card keeps the full context (repository, machine, branch, model).
 *
 * The default branch is known only from the row's own git status, which a row fetches once it
 * nears the viewport. Until then, and for a local thread whose checkout has moved to another
 * branch, only main and master count as default; so in a repository whose default is another
 * name, a row on it shows its branch until the status arrives, then drops to one line.
 */

export interface AgentRowSummary {
  readonly draft: boolean;
  /** The branch without its repository-name prefix; `worktree` when the thread has its own. */
  readonly branch: { readonly text: string; readonly worktree: boolean } | null;
  /** "PR #130 open", "3 PRs merged", "2 stacked PRs open". */
  readonly pullRequest: string | null;
  /** The agent's display name. */
  readonly agent: string | null;
}

interface AgentThread {
  readonly runtime: { readonly providerInstanceId: string } | null;
  readonly modelSelection: { readonly instanceId: string };
}

interface RepositoryProject {
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | {
        readonly name?: string | undefined;
        readonly rootPath?: string | undefined;
        readonly origin?: { readonly displayName?: string | undefined } | undefined;
      }
    | null
    | undefined;
}

export interface AgentRowSummaryInput {
  readonly thread: AgentThread & {
    readonly branch: string | null;
    readonly worktreePath: string | null;
  };
  readonly project: RepositoryProject | null;
  readonly hasUnsentDraft: boolean;
  /** The thread's checkout status, while the row has it. */
  readonly checkout: { readonly refName: string | null; readonly isDefaultRef: boolean } | null;
  readonly pullRequest: {
    /** The badge for servers that link several pull requests to a thread. */
    readonly badge: ThreadPullRequestBadge | null;
    /** The pull request's live status, while the row has it. */
    readonly status: {
      readonly pr: {
        readonly number: number;
        readonly state: "open" | "merged" | "closed";
        readonly isDraft?: boolean | undefined;
      };
      readonly sourceControlProvider: { readonly kind: string };
    } | null;
    /** The thread's current link, on servers that link several. */
    readonly link: { readonly number: number } | null;
  };
  /** The agent the thread's project usually runs, from `resolveUsualAgentInstanceIds`. */
  readonly usualAgentInstanceId: string | null;
  readonly agentName: string | null;
}

/** Null when the row has nothing for its second line. */
export function resolveAgentRowSummary(input: AgentRowSummaryInput): AgentRowSummary | null {
  const agentName = input.agentName?.trim();
  const summary: AgentRowSummary = {
    draft: input.hasUnsentDraft,
    branch: resolveBranch(input),
    pullRequest: resolvePullRequestText(input.pullRequest),
    agent:
      agentName &&
      input.usualAgentInstanceId !== null &&
      threadAgentInstanceId(input.thread) !== input.usualAgentInstanceId
        ? agentName
        : null,
  };
  return summary.draft || summary.branch || summary.pullRequest || summary.agent ? summary : null;
}

const DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);

function resolveBranch(input: AgentRowSummaryInput): AgentRowSummary["branch"] {
  const branch = input.thread.branch?.trim();
  if (!branch) return null;
  // The checkout's status is authoritative, but only for the branch it reports.
  const isDefault =
    input.checkout !== null && input.checkout.refName === branch
      ? input.checkout.isDefaultRef
      : DEFAULT_BRANCH_NAMES.has(branch);
  if (isDefault) return null;
  return {
    text: stripRepositoryPrefix(branch, repositoryShortNames(input.project)),
    worktree: Boolean(input.thread.worktreePath?.trim()),
  };
}

function stripRepositoryPrefix(branch: string, repositoryNames: ReadonlyArray<string>): string {
  const lower = branch.toLowerCase();
  const prefix = repositoryNames.find((name) => lower.startsWith(`${name.toLowerCase()}/`));
  if (prefix === undefined) return branch;
  return branch.slice(prefix.length + 1) || branch;
}

function resolvePullRequestText(pullRequest: AgentRowSummaryInput["pullRequest"]): string | null {
  const { badge, status, link } = pullRequest;
  const shortLabel = sourceControlClients.get(status?.sourceControlProvider.kind).changeRequest
    .shortLabel;
  // Mirrors the badge's own choice (`resolveThreadPullRequestBadgePresentation`), so the text
  // matches the icon and colour it is drawn with.
  if (badge?.kind === "stack") return `${badge.layers} stacked ${shortLabel}s ${badge.state}`;
  const number = status?.pr.number ?? link?.number ?? null;
  if (number === null) return null;
  if (badge?.kind === "pull-request" && badge.others > 0) {
    return `${badge.others + 1} ${shortLabel}s ${badge.state}`;
  }
  const single = `${shortLabel} #${number}`;
  if (status === null) return single;
  const { state, isDraft } = status.pr;
  return `${single} ${state === "open" && isDraft === true ? "draft" : state}`;
}

/**
 * The names a project's repository goes by: its git identity's, its own remote's when the identity
 * is the upstream a fork tracks, and its folder's.
 */
function repositoryShortNames(project: RepositoryProject | null): ReadonlyArray<string> {
  if (project === null) return [];
  const identity = project.repositoryIdentity;
  return [
    identity?.name,
    identity?.origin?.displayName && lastSegment(identity.origin.displayName),
    identity?.rootPath && lastSegment(identity.rootPath),
    lastSegment(project.workspaceRoot),
  ].flatMap((name) => (name?.trim() ? [name.trim()] : []));
}

function lastSegment(path: string): string | undefined {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0);
}

/** The agent a thread runs with now: its live runtime's, or the one it was started with. */
function threadAgentInstanceId(thread: AgentThread): string {
  return thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
}

/** The key `resolveUsualAgentInstanceIds` files a project under. */
export function usualAgentKey(thread: {
  readonly environmentId: string;
  readonly projectId: string;
}): string {
  return `${thread.environmentId}:${thread.projectId}`;
}

/**
 * The agent each listed project's threads usually run with, by `usualAgentKey`: the default its
 * new threads start with (the project's own, else its environment's), or, when settings name
 * none, the one most of the environment's listed threads run with. Instance ids are driver slugs
 * that repeat across environments, so counts stay per environment; a tie goes to the id that
 * sorts first, so the choice does not move as rows reorder.
 */
export function resolveUsualAgentInstanceIds(
  listedThreads: ReadonlyArray<
    ReadonlyArray<AgentThread & { readonly environmentId: string; readonly projectId: ProjectId }>
  >,
  serverConfigs: ReadonlyMap<string, { readonly settings: ServerSettings }>,
  projectByKey: ReadonlyMap<string, LegacyProjectSettingsFields>,
): ReadonlyMap<string, string> {
  const counts = new Map<string, Map<string, number>>();
  const projects = new Map<string, { readonly environmentId: string; readonly id: ProjectId }>();
  for (const list of listedThreads) {
    for (const thread of list) {
      const { environmentId } = thread;
      projects.set(usualAgentKey(thread), { environmentId, id: thread.projectId });
      const instanceId = threadAgentInstanceId(thread);
      let environmentCounts = counts.get(environmentId);
      if (environmentCounts === undefined) {
        environmentCounts = new Map();
        counts.set(environmentId, environmentCounts);
      }
      environmentCounts.set(instanceId, (environmentCounts.get(instanceId) ?? 0) + 1);
    }
  }
  const mostCommon = new Map<string, string>();
  for (const [environmentId, environmentCounts] of counts) {
    let best: { readonly instanceId: string; readonly count: number } | null = null;
    for (const [instanceId, count] of environmentCounts) {
      if (
        best === null ||
        count > best.count ||
        (count === best.count && instanceId < best.instanceId)
      ) {
        best = { instanceId, count };
      }
    }
    if (best !== null) mostCommon.set(environmentId, best.instanceId);
  }
  const result = new Map<string, string>();
  for (const [key, project] of projects) {
    const settings = serverConfigs.get(project.environmentId)?.settings;
    const configured =
      settings === undefined
        ? undefined
        : resolveProjectSettings(settings, project.id, projectByKey.get(key)).settings
            .defaultModelSelection?.instanceId;
    const usual = configured ?? mostCommon.get(project.environmentId);
    if (usual !== undefined) result.set(key, usual);
  }
  return result;
}
