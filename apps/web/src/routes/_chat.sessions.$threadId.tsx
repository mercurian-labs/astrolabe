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

function SessionRoute() {
  const navigate = useNavigate();
  const { threadId: rawThreadId } = Route.useParams();
  const threadId = ThreadId.make(rawThreadId);
  const { snapshot, isPending } = useMercurianTree();
  const target = useMemo(
    () => resolveSessionThreadRedirect(snapshot, threadId),
    [snapshot, threadId],
  );

  useEffect(() => {
    if (target !== null) {
      void navigate({
        to: "/threads/$planId",
        params: { planId: target.planId },
        search: target.line === undefined ? {} : { line: target.line },
        replace: true,
      });
      return;
    }
    if (!isPending) void navigate({ to: "/", replace: true });
  }, [isPending, navigate, target]);

  return null;
}

export const Route = createFileRoute("/_chat/sessions/$threadId")({
  component: SessionRoute,
});
