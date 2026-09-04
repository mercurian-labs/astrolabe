import { ThreadId, type PlanningTreeSnapshot } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { threadPlanLinkForThread, useMercurianTree } from "../state/mercurian";

export function resolveSessionThreadRedirect(snapshot: PlanningTreeSnapshot, threadId: ThreadId) {
  const link = threadPlanLinkForThread(threadId, snapshot);
  if (link === null) return null;
  return {
    planId: link.planId,
    ...(link.lineRootCommitId === undefined ? {} : { line: threadId }),
  };
}

export function resolveSessionRouteNavigation(
  snapshot: PlanningTreeSnapshot,
  threadId: ThreadId,
  isPending: boolean,
) {
  const target = resolveSessionThreadRedirect(snapshot, threadId);
  if (target !== null) {
    return {
      to: "/threads/$planId" as const,
      params: { planId: target.planId },
      search: target.line === undefined ? {} : { line: target.line },
      replace: true as const,
    };
  }
  return isPending ? null : ({ to: "/" as const, replace: true as const } as const);
}

function SessionRoute() {
  const navigate = useNavigate();
  const { threadId: rawThreadId } = Route.useParams();
  const threadId = ThreadId.make(rawThreadId);
  const { snapshot, isPending } = useMercurianTree();
  const navigation = useMemo(
    () => resolveSessionRouteNavigation(snapshot, threadId, isPending),
    [isPending, snapshot, threadId],
  );

  useEffect(() => {
    if (navigation !== null) void navigate(navigation);
  }, [navigate, navigation]);

  return null;
}

export const Route = createFileRoute("/_chat/sessions/$threadId")({
  component: SessionRoute,
});
