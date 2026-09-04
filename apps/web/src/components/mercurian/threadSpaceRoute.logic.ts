import type {
  MercurianCommitId,
  PlanDetail,
  PlanLineRuntimeRecord,
  ThreadId,
} from "@t3tools/contracts";

export type ThreadSpaceRouteResolution =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "needsOpen"; readonly lineRootCommitId: MercurianCommitId };

const MISSING_PLAN_NAVIGATION = { to: "/" as const, replace: true as const };

export function resolveThreadSpaceRouteNavigation(resolution: ThreadSpaceRouteResolution) {
  return resolution.kind === "missing" ? MISSING_PLAN_NAVIGATION : null;
}

function runtimeForThread(
  lineRuntimes: ReadonlyArray<PlanLineRuntimeRecord>,
  threadId: ThreadId | undefined,
) {
  return threadId === undefined
    ? undefined
    : lineRuntimes.find((runtime) => runtime.threadId === threadId);
}

type ThreadSpacePlanDetail = Pick<PlanDetail, "timeline" | "lineRuntimes" | "lastVisitedThreadId">;

function firstLineRoot(detail: ThreadSpacePlanDetail): MercurianCommitId | null {
  return (
    detail.timeline
      .filter((item) => item.parents.length === 0)
      .toSorted((left, right) => left.sequence - right.sequence)[0]?.commitId ?? null
  );
}

export function resolveThreadSpaceRoute(input: {
  readonly detail: ThreadSpacePlanDetail | null;
  readonly isPending: boolean;
  readonly search: { readonly line?: ThreadId; readonly at?: MercurianCommitId };
}): ThreadSpaceRouteResolution {
  if (input.detail === null) return { kind: input.isPending ? "loading" : "missing" };

  const { detail } = input;
  const selectedRuntime =
    runtimeForThread(detail.lineRuntimes, input.search.line) ??
    runtimeForThread(detail.lineRuntimes, detail.lastVisitedThreadId);
  if (selectedRuntime !== undefined) {
    return { kind: "thread", threadId: selectedRuntime.threadId };
  }

  const firstRoot = firstLineRoot(detail);
  if (firstRoot !== null) {
    const firstRuntime = detail.lineRuntimes.find(
      (runtime) => runtime.lineRootCommitId === firstRoot,
    );
    return firstRuntime === undefined
      ? { kind: "needsOpen", lineRootCommitId: firstRoot }
      : { kind: "thread", threadId: firstRuntime.threadId };
  }

  const pendingRuntime = detail.lineRuntimes[0];
  return pendingRuntime === undefined
    ? { kind: "loading" }
    : { kind: "thread", threadId: pendingRuntime.threadId };
}
