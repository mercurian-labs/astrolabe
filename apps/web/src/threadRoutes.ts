import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PlanId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "./composerDraftStore";
import type { AppRouter } from "./router";
import { planForThread } from "./state/mercurian";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
      planId?: PlanId;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

type DraftThreadRouteState = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  promotedTo?: ScopedThreadRef | null;
};

export type ThreadRouteRenderState = "loading" | "ready" | "missing";

export function resolveThreadRouteRenderState(input: {
  bootstrapComplete: boolean;
  serverThreadShellExists: boolean;
  serverThreadDetailExists: boolean;
  serverThreadDetailDeleted: boolean;
  draftThreadExists: boolean;
}): ThreadRouteRenderState {
  if (!input.bootstrapComplete) {
    return "loading";
  }
  if (input.serverThreadDetailExists || input.draftThreadExists) {
    return "ready";
  }
  if (input.serverThreadDetailDeleted) {
    return "missing";
  }
  return input.serverThreadShellExists ? "loading" : "missing";
}

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

export function navigateToThreadRoute(
  router: Pick<AppRouter, "navigate">,
  target: ThreadRouteTarget,
  options?: { readonly replace?: boolean },
): Promise<void> {
  const historyOptions = options?.replace === undefined ? {} : { replace: options.replace };
  if (target.kind === "draft") {
    return router.navigate({
      to: "/threads/draft/$draftId",
      params: buildDraftThreadRouteParams(target.draftId),
      ...historyOptions,
    });
  }

  const planId = target.planId ?? planForThread(target.threadRef.threadId);
  if (planId !== null) {
    return router.navigate({
      to: "/threads/$planId",
      params: { planId },
      search: { line: target.threadRef.threadId },
      ...historyOptions,
    });
  }

  return router.navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(target.threadRef),
    ...historyOptions,
  });
}

export function resolveThreadRouteRef(
  params: Partial<Record<string, string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId);
}

export function resolveThreadRouteTarget(
  params: Partial<Record<string, string | undefined>>,
): ThreadRouteTarget | null {
  if (params.environmentId && params.threadId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}

/**
 * Resolves the thread represented by either a canonical thread route or a
 * draft route whose promotion to a server thread has been recorded.
 */
export function resolveActiveThreadRouteRef(
  target: ThreadRouteTarget | null,
  draftThread: DraftThreadRouteState | null,
): ScopedThreadRef | null {
  if (target?.kind === "server") {
    return target.threadRef;
  }
  if (target?.kind !== "draft" || !draftThread?.promotedTo) {
    return null;
  }
  return draftThread.promotedTo;
}
