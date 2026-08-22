/** The checked-out root-to-tip thread through a planning history. */
import type { MercurianCommitId } from "@t3tools/contracts";

import { planNodeSummary } from "./planCheckpoints.ts";
import type { PlanGraph, PlanGraphNode } from "./planGraph.ts";

export interface ThreadSwitch {
  readonly options: ReadonlyArray<MercurianCommitId>;
  readonly index: number;
}

export interface ThreadRow extends PlanGraphNode {
  readonly siblings?: ThreadSwitch;
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
