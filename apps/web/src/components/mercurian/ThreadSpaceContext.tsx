import type {
  EnvironmentId,
  MercurianProjectId,
  PlanDetail,
  PlanId,
  ThreadId,
} from "@t3tools/contracts";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { buildPlanGraph, type PlanGraph } from "./PlanGraph.logic";
import type { ThreadSpaceRouteSearch } from "./threadSpaceSearch";

const EMPTY_TIMELINE = [] as const;

export type ThreadSpaceValue = Readonly<{
  planId: PlanId | null;
  projectId: MercurianProjectId | null;
  threadId: ThreadId;
  environmentId: EnvironmentId;
  detail: PlanDetail | null;
  graph: PlanGraph;
  search: ThreadSpaceRouteSearch;
}>;

type ThreadSpaceProviderProps = Readonly<{
  value: Omit<ThreadSpaceValue, "graph">;
  children: ReactNode;
}>;

const ThreadSpaceContext = createContext<ThreadSpaceValue | null>(null);

export function ThreadSpaceProvider({ value, children }: ThreadSpaceProviderProps) {
  const { planId, projectId, threadId, environmentId, detail, search } = value;
  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const contextValue = useMemo<ThreadSpaceValue>(
    () => ({ planId, projectId, threadId, environmentId, detail, graph, search }),
    [detail, environmentId, graph, planId, projectId, search, threadId],
  );

  return <ThreadSpaceContext.Provider value={contextValue}>{children}</ThreadSpaceContext.Provider>;
}

/** For surfaces that also render outside a thread space, such as catalogs and tests. */
export function useOptionalThreadSpace(): ThreadSpaceValue | null {
  return useContext(ThreadSpaceContext);
}

export function useThreadSpace(): ThreadSpaceValue {
  const value = useContext(ThreadSpaceContext);
  if (value === null) {
    throw new Error("useThreadSpace must be used within a ThreadSpaceProvider.");
  }
  return value;
}
