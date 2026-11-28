import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import {
  isAppModalPage,
  isIssuesPath,
  isPullRequestsPath,
  isRepositoriesPath,
  useSectionPathname,
} from "../components/sidebar/mainAppLocation";
import { useWorkspaceStarting } from "../panes/workspace";
import { WorkspaceView } from "../panes/WorkspaceView";
import { GlobalVoiceInputIndicator } from "../components/chat/GlobalVoiceInputIndicator";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();
  // Astrolabe: Agents, Projects, Changes and Issues share one set of panes; their routes only say which
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
    isPullRequestsPath(sectionPathname) ||
    isIssuesPath(sectionPathname);
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
      <GlobalVoiceInputIndicator hidden={modalOpen} />
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
