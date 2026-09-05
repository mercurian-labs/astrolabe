import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { resolveDraftPromotionNavigationTarget } from "../components/ChatView.logic";
import { waitForDraftHeroTransition } from "../components/chat/draftHeroTransition";
import { ThreadSpaceView } from "../components/mercurian/ThreadSpaceChrome";
import { ThreadSpaceProvider } from "../components/mercurian/ThreadSpaceContext";
import { SidebarInset } from "../components/ui/sidebar";
import {
  DraftId,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useThread, useThreadRefs } from "../state/entities";
import { useMercurianTree, usePlanForThread } from "../state/mercurian";

function DraftMercurianThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const { snapshot: treeSnapshot } = useMercurianTree();
  const mercurianProject = useMemo(
    () =>
      treeSnapshot.projects.find(
        (project) => project.orchestrationProjectId === draftSession?.projectId,
      ) ?? null,
    [draftSession?.projectId, treeSnapshot.projects],
  );
  const threadRefs = useThreadRefs();
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef = draftSession?.promotedTo ?? inferredThreadRef;
  const serverThread = useThread(serverThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(serverThreadRef);
  const canonicalThreadRef = resolveDraftPromotionNavigationTarget({
    serverThreadRef,
    serverThread,
    backgroundSubmissionPending,
  });
  const planId = usePlanForThread(canonicalThreadRef?.threadId ?? null);

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) return;
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef || planId === null) return;

    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) return;
      void navigate({
        to: "/threads/$planId",
        params: { planId },
        search: { line: canonicalThreadRef.threadId },
        replace: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate, planId]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) return;
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (!draftSession) return null;

  return (
    <ThreadSpaceProvider
      value={{
        planId: null,
        projectId: mercurianProject?.projectId ?? null,
        threadId: draftSession.threadId,
        environmentId: draftSession.environmentId,
        detail: null,
        search: {},
      }}
    >
      <SidebarInset className="relative h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ThreadSpaceView routeKind="draft" draftId={draftId} />
      </SidebarInset>
    </ThreadSpaceProvider>
  );
}

export const Route = createFileRoute("/_chat/threads/draft/$draftId")({
  component: DraftMercurianThreadRouteView,
});
