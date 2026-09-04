import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PlanId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { threadHasStarted } from "../components/ChatView.logic";
import { ThreadSpaceView } from "../components/mercurian/ThreadSpaceChrome";
import { ThreadSpaceProvider } from "../components/mercurian/ThreadSpaceContext";
import {
  resolveThreadSpaceRoute,
  resolveThreadSpaceRouteNavigation,
} from "../components/mercurian/threadSpaceRoute.logic";
import { validateThreadSpaceSearch } from "../components/mercurian/threadSpaceSearch";
import { SidebarInset } from "../components/ui/sidebar";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../state/entities";
import { useOpenLine, usePlanDetail, useVisitPlan } from "../state/mercurian";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";

function MercurianThreadRouteView() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const { planId: rawPlanId } = Route.useParams();
  const planId = PlanId.make(rawPlanId);
  const search = Route.useSearch();
  const { detail, isPending } = usePlanDetail(planId);
  const resolution = useMemo(
    () =>
      resolveThreadSpaceRoute({ detail, isPending: environmentId === null || isPending, search }),
    [detail, environmentId, isPending, search],
  );
  const missingPlanNavigation = resolveThreadSpaceRouteNavigation(resolution);
  const openLine = useOpenLine();
  const visitPlan = useVisitPlan();
  const openedLines = useRef(new Set<string>());
  const threadId = resolution.kind === "thread" ? resolution.threadId : null;
  const threadRef =
    environmentId === null || threadId === null ? null : scopeThreadRef(environmentId, threadId);
  const shell = useEnvironmentQuery(
    environmentId === null ? null : environmentShell.stateAtom(environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const serverThreadStatus = useThreadStatus(threadRef);
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);

  useEffect(() => {
    if (missingPlanNavigation === null) return;
    void navigate(missingPlanNavigation);
  }, [missingPlanNavigation, navigate]);

  useEffect(() => {
    if (resolution.kind !== "needsOpen") return;
    const key = `${planId}:${resolution.lineRootCommitId}`;
    if (openedLines.current.has(key)) return;
    openedLines.current.add(key);
    void openLine({ planId, lineRootCommitId: resolution.lineRootCommitId });
  }, [openLine, planId, resolution]);

  useEffect(() => {
    if (threadId === null) return;
    void visitPlan({ planId, threadId });
  }, [planId, threadId, visitPlan]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) return;
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);

  if (threadRef === null) return null;

  return (
    <ThreadSpaceProvider
      value={{ planId, projectId: detail?.plan.projectId ?? null, ...threadRef, detail, search }}
    >
      <SidebarInset className="relative h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        {renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
          <ThreadSpaceView routeKind="server" threadSyncPhase={threadSyncPhase} />
        ) : null}
      </SidebarInset>
    </ThreadSpaceProvider>
  );
}

export const Route = createFileRoute("/_chat/threads/$planId")({
  validateSearch: validateThreadSpaceSearch,
  component: MercurianThreadRouteView,
});
