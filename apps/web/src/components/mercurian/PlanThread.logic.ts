/**
 * The checked-out thread through a planning history: one root-to-tip path,
 * with the places where that reading can switch to another line.
 *
 * The current commit divides the walk in two. Its ancestry follows the chosen
 * incoming line at merges, while its future follows the first child exactly as
 * a live planning position does. Everything here is a pure reading of the
 * graph; choosing a switch remains a concern of the view.
 */
import type { MercurianCommitId } from "@t3tools/contracts";

import { planNodeSummary } from "./PlanCheckpoints.logic";
import type { PlanGraph, PlanGraphNode } from "./PlanGraph.logic";

export interface ThreadSwitch {
  readonly options: ReadonlyArray<MercurianCommitId>;
  /** Zero-based index of the line this row currently follows. */
  readonly index: number;
}

export interface ThreadRow extends PlanGraphNode {
  /** The children offered by this row's on-path parent. */
  readonly siblings?: ThreadSwitch;
  /** The incoming lines offered by this merge. */
  readonly parentLines?: ThreadSwitch;
}

export interface ThreadLayout {
  readonly rows: ReadonlyArray<ThreadRow>;
}

export interface BranchOption {
  readonly branchRootId: MercurianCommitId;
  readonly tipId: MercurianCommitId;
  readonly summary: string;
  readonly lastActiveAt: string;
  readonly published: boolean;
}

const EMPTY_THREAD_LAYOUT: ThreadLayout = { rows: [] };

/**
 * The one line through where the planning surface stands, root first.
 *
 * Parent choices only affect the ancestry above their merge. Below the current
 * commit, first-child order stays aligned with the live position's follow
 * rule. Bounds and missing-node checks make a partial graph truncate cleanly.
 */
export function threadLayout(
  graph: PlanGraph,
  head: MercurianCommitId | null,
  parentChoices: ReadonlyMap<string, MercurianCommitId>,
): ThreadLayout {
  if (head === null) return EMPTY_THREAD_LAYOUT;
  const headNode = graph.byId.get(head);
  if (headNode === undefined) return EMPTY_THREAD_LAYOUT;

  const ancestry: Array<PlanGraphNode> = [headNode];
  const seenAbove = new Set<string>([headNode.commitId]);
  let current = headNode;

  for (let step = 1; step < graph.nodes.length; step += 1) {
    const preferred = current.isMerge ? parentChoices.get(current.commitId) : undefined;
    const parentId =
      preferred !== undefined && current.parents.includes(preferred)
        ? preferred
        : current.parents[0];
    if (parentId === undefined || seenAbove.has(parentId)) break;
    const parent = graph.byId.get(parentId);
    if (parent === undefined) break;
    ancestry.push(parent);
    seenAbove.add(parentId);
    current = parent;
  }

  ancestry.reverse();
  const path = ancestry;
  const seenBelow = new Set<string>(path.map((node) => node.commitId));
  current = headNode;

  for (let step = 1; step < graph.nodes.length; step += 1) {
    const childId = current.childrenIds[0];
    if (childId === undefined || seenBelow.has(childId)) break;
    const child = graph.byId.get(childId);
    if (child === undefined) break;
    path.push(child);
    seenBelow.add(childId);
    current = child;
  }

  return {
    rows: path.map((node, index): ThreadRow => {
      const parent = path[index - 1];
      const siblingIndex = parent?.childrenIds.indexOf(node.commitId) ?? -1;
      const parentLineIndex = node.isMerge
        ? node.parents.findIndex((parentId) => parentId === parent?.commitId)
        : -1;

      return {
        ...node,
        ...(parent !== undefined && parent.childrenIds.length > 1 && siblingIndex >= 0
          ? { siblings: { options: parent.childrenIds, index: siblingIndex } }
          : {}),
        ...(node.isMerge && parentLineIndex >= 0
          ? { parentLines: { options: node.parents, index: parentLineIndex } }
          : {}),
      };
    }),
  };
}

/**
 * The most recently active leaf below a branch root. Sequence, rather than
 * child order, decides between leaves; child order only makes the breadth-first
 * walk deterministic.
 */
export function mostRecentTip(graph: PlanGraph, commitId: MercurianCommitId): MercurianCommitId {
  const root = graph.byId.get(commitId);
  if (root === undefined) return commitId;

  const pending: Array<PlanGraphNode> = [root];
  const seen = new Set<string>();
  let cursor = 0;
  let mostRecent: PlanGraphNode | undefined;

  while (cursor < pending.length && seen.size < graph.nodes.length) {
    const node = pending[cursor];
    cursor += 1;
    if (node === undefined || seen.has(node.commitId)) continue;
    seen.add(node.commitId);

    if (
      node.childrenIds.length === 0 &&
      (mostRecent === undefined || node.item.sequence > mostRecent.item.sequence)
    ) {
      mostRecent = node;
    }
    for (const childId of node.childrenIds) {
      const child = graph.byId.get(childId);
      if (child !== undefined && !seen.has(childId)) pending.push(child);
    }
  }

  return mostRecent?.commitId ?? commitId;
}

/** What one branch switch says, and the tip choosing it will stand on. */
export function branchOption(graph: PlanGraph, branchRootId: MercurianCommitId): BranchOption {
  const branchRoot = graph.byId.get(branchRootId);
  if (branchRoot === undefined) {
    throw new Error(`Branch root ${branchRootId} is not present in the plan graph`);
  }
  const tipId = mostRecentTip(graph, branchRootId);
  const tip = graph.byId.get(tipId) ?? branchRoot;

  return {
    branchRootId,
    tipId,
    summary: planNodeSummary(branchRoot),
    lastActiveAt: tip.item.createdAt,
    published: branchRoot.item.published,
  };
}
