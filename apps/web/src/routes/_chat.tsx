import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Outlet, createFileRoute, redirect, useMatches } from "@tanstack/react-router";
import { useState } from "react";

import {
  isAppModalPage,
  isRepositoriesPath,
  isWikisPath,
  useSectionPathname,
} from "../components/sidebar/mainAppLocation";
import { useWorkspaceStarting } from "../panes/workspace";
import { WorkspaceView } from "../panes/WorkspaceView";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

function threadRouteTargetKey(target: ThreadRouteTarget | null) {
  if (!target) return null;
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
}

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const threadTarget = useThreadRouteTarget();
  // Read matches, not location, so this agrees with the params useThreadRouteTarget reads.
  const modalOpen = useMatches({
    select: (matches) => matches.some((match) => isAppModalPage(match.pathname)),
  });
  // Settings and Usage render over the thread that opened them, so ChatView never remounts.
  const [backgroundTarget, setBackgroundTarget] = useState(threadTarget);
  if (!modalOpen && threadRouteTargetKey(backgroundTarget) !== threadRouteTargetKey(threadTarget)) {
    setBackgroundTarget(threadTarget);
  }
  const shownTarget = modalOpen ? backgroundTarget : threadTarget;
  // Astrolabe: Agents, Repositories and Wikis share one set of panes; their routes only say which
  // sidebar shows and, in Agents, which thread it selects. The start page is Agents with no
  // thread selected; only with nothing in the panes does it start a draft, as T3 Code's does.
  const sectionPathname = useSectionPathname();
  const starting = useWorkspaceStarting();
  const onStartPage = sectionPathname === "/";
  const agents = shownTarget !== null || onStartPage;
  const inWorkspace =
    shownTarget !== null ||
    (onStartPage && !starting) ||
    isRepositoriesPath(sectionPathname) ||
    isWikisPath(sectionPathname);
  return (
    <>
      {shownTarget?.kind === "server" && !modalOpen ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {inWorkspace ? (
        <WorkspaceView routeTarget={shownTarget} agents={agents} background={modalOpen} />
      ) : modalOpen ? (
        <SidebarInset className="h-dvh" />
      ) : null}
      {modalOpen || !inWorkspace || (shownTarget === null && !onStartPage) ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
