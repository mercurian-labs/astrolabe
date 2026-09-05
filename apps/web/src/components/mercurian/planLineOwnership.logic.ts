import type {
  MercurianCommitId,
  MercurianThreadPlanLink,
  PlanDetail,
  PlanLineRuntimeRecord,
  ThreadId,
} from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";

type LineOwnershipDetail = Readonly<{
  plan: Pick<PlanDetail["plan"], "planId">;
  lineRuntimes: PlanDetail["lineRuntimes"];
  checkpoints?: PlanDetail["checkpoints"];
}>;

export function knownLineRootIds(
  detail: LineOwnershipDetail,
  threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>,
) {
  return new Set<string>([
    ...(detail.checkpoints ?? []).flatMap((record) =>
      record.lineRootCommitId === undefined ? [] : [record.lineRootCommitId],
    ),
    ...detail.lineRuntimes.flatMap((runtime) =>
      runtime.lineRootCommitId === null ? [] : [runtime.lineRootCommitId],
    ),
    ...threadPlanLinks.flatMap((link) =>
      link.planId !== detail.plan.planId || link.lineRootCommitId == null
        ? []
        : [link.lineRootCommitId],
    ),
  ]);
}

export function lineRootCommitIdFor(
  graph: PlanGraph,
  commitId: MercurianCommitId,
  lineRootIds: ReadonlySet<string>,
): MercurianCommitId | null {
  const planRoot = graph.nodes.find(
    (node) => node.item._tag !== "coding-session" && node.parents.length === 0,
  )?.commitId;
  let current: MercurianCommitId | undefined = commitId;
  while (current !== undefined) {
    if (lineRootIds.has(current)) return current;
    current = graph.byId.get(current)?.parents[0];
  }
  return planRoot ?? null;
}

export function resolveLineTip(
  detail: LineOwnershipDetail | null,
  graph: PlanGraph,
  runtime: PlanLineRuntimeRecord | null,
  threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>,
): MercurianCommitId | null {
  if (runtime === null) return null;
  if (runtime.lineRootCommitId === null) return runtime.forkParentCommitId ?? null;
  if (detail === null) return null;
  const lineRootIds = knownLineRootIds(detail, threadPlanLinks);
  return (
    graph.nodes
      .filter(
        (node) =>
          node.item._tag !== "coding-session" &&
          lineRootCommitIdFor(graph, node.commitId, lineRootIds) === runtime.lineRootCommitId,
      )
      .toSorted((left, right) => right.item.sequence - left.item.sequence)[0]?.commitId ?? null
  );
}

export function lineThreadIdForCommit(input: {
  readonly commitId: MercurianCommitId;
  readonly detail: LineOwnershipDetail;
  readonly graph: PlanGraph;
  readonly threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>;
}): ThreadId | null {
  const lineRootIds = knownLineRootIds(input.detail, input.threadPlanLinks);
  const owner = lineRootCommitIdFor(input.graph, input.commitId, lineRootIds);
  if (owner === null) return null;

  return (
    input.detail.lineRuntimes.find((runtime) => runtime.lineRootCommitId === owner)?.threadId ??
    input.threadPlanLinks.find(
      (link) => link.planId === input.detail.plan.planId && link.lineRootCommitId === owner,
    )?.threadId ??
    null
  );
}
