import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type EnvironmentId, type PlanId } from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";

import ChatView from "../components/ChatView";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../state/entities";
import { useMercurianTree } from "../state/mercurian";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { resolveThreadRouteRenderState, type ThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase, type ThreadSyncPhase } from "../threadSync";

export function SessionThreadRouteContent(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadSyncPhase: ThreadSyncPhase | null;
  readonly renderState: ThreadRouteRenderState;
  readonly shellExists: boolean;
  readonly planId: PlanId | null;
}) {
  const backToPlanLink =
    props.planId === null ? (
      <Link
        className="mt-3 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        to="/"
      >
        Back to plan
      </Link>
    ) : (
      <Link
        className="mt-3 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        to="/plans/$planId"
        params={{ planId: props.planId }}
      >
        Back to plan
      </Link>
    );

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {props.renderState === "ready" || (props.renderState === "loading" && props.shellExists) ? (
        <ChatView
          environmentId={props.environmentId}
          threadId={props.threadId}
          routeKind="server"
          threadSyncPhase={props.threadSyncPhase}
        />
      ) : props.renderState === "missing" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <Empty className="flex-1">
            <EmptyHeader className="max-w-md">
              <EmptyTitle className="text-foreground text-xl">Session unavailable</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                This coding session&apos;s thread is no longer available.
              </EmptyDescription>
              {backToPlanLink}
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}
    </SidebarInset>
  );
}

export function SessionThreadRouteView({ threadId }: { readonly threadId: ThreadId }) {
  const environmentId = usePrimaryEnvironmentId();
  const threadRef = environmentId === null ? null : scopeThreadRef(environmentId, threadId);
  const shellState = useEnvironmentQuery(
    environmentId === null ? null : environmentShell.stateAtom(environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const serverThreadStatus = useThreadStatus(threadRef);
  const tree = useMercurianTree();
  const planId =
    tree.snapshot.plans.find((plan) =>
      plan.codingSessions.some((session) => session.threadId === threadId),
    )?.planId ?? null;

  if (environmentId === null) return null;

  const bootstrapComplete = shellState.data?.snapshot._tag === "Some";
  const renderState =
    serverThreadStatus === "deleted"
      ? "missing"
      : resolveThreadRouteRenderState({
          bootstrapComplete,
          serverThreadShellExists: serverThreadShell !== null,
          serverThreadDetailExists: serverThreadDetail !== null,
          serverThreadDetailDeleted: false,
          draftThreadExists: false,
        });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });

  return (
    <SessionThreadRouteContent
      environmentId={environmentId}
      threadId={threadId}
      threadSyncPhase={threadSyncPhase}
      renderState={renderState}
      shellExists={serverThreadShell !== null}
      planId={planId}
    />
  );
}

function SessionRoute() {
  const { threadId } = Route.useParams();
  return <SessionThreadRouteView threadId={ThreadId.make(threadId)} />;
}

export const Route = createFileRoute("/_chat/sessions/$threadId")({
  component: SessionRoute,
});
