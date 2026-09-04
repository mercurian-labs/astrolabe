import type { EnvironmentId, PlanDetail, PlanId, ThreadId } from "@t3tools/contracts";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { buildPlanGraph, type PlanGraph } from "./PlanGraph.logic";
import type { ThreadSpaceRouteSearch } from "./threadSpaceSearch";

const EMPTY_TIMELINE = [] as const;

export type ThreadSpaceValue = Readonly<{
  planId: PlanId;
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
  const { planId, threadId, environmentId, detail, search } = value;
  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const contextValue = useMemo<ThreadSpaceValue>(
    () => ({ planId, threadId, environmentId, detail, graph, search }),
    [detail, environmentId, graph, planId, search, threadId],
  );

  return <ThreadSpaceContext.Provider value={contextValue}>{children}</ThreadSpaceContext.Provider>;
}

export function useThreadSpace(): ThreadSpaceValue {
  const value = useContext(ThreadSpaceContext);
  if (value === null) {
    throw new Error("useThreadSpace must be used within a ThreadSpaceProvider.");
  }
  return value;
}
