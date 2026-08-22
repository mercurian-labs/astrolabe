import { useAtomValue } from "@effect/atom-react";
import {
  advance,
  LATEST,
  positionAfterPick,
  type PlanPosition,
} from "@t3tools/client-runtime/state/plan-position";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import type { EnvironmentId, MercurianCommitId, PlanId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect } from "react";

import { appAtomRegistry } from "./atom-registry";

export interface MobilePlanPositionState {
  readonly position: PlanPosition;
  readonly parentChoices: ReadonlyMap<string, MercurianCommitId>;
}

const emptyPlanPositionState = (): MobilePlanPositionState => ({
  position: LATEST,
  parentChoices: new Map(),
});

export function planPositionKey(environmentId: EnvironmentId, planId: PlanId): string {
  return `${environmentId}:${planId}`;
}

export const planPositionStateAtom = Atom.family((key: string) =>
  Atom.make<MobilePlanPositionState>(emptyPlanPositionState()).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mobile:plan-position:${key}`),
  ),
);

function updatePlanPositionState(
  key: string,
  update: (state: MobilePlanPositionState) => MobilePlanPositionState,
): void {
  const atom = planPositionStateAtom(key);
  const current = appAtomRegistry.get(atom);
  const next = update(current);
  if (next !== current) appAtomRegistry.set(atom, next);
}

export function advancePlanPosition(key: string, graph: PlanGraph): void {
  updatePlanPositionState(key, (state) => {
    const position = advance(graph, state.position);
    return position === state.position ? state : { ...state, position };
  });
}

export function pickPlanPosition(key: string, graph: PlanGraph, commitId: MercurianCommitId): void {
  updatePlanPositionState(key, (state) => ({
    ...state,
    position: positionAfterPick(graph, commitId),
  }));
}

export function standAtPlanPosition(key: string, commitId: MercurianCommitId): void {
  updatePlanPositionState(key, (state) => ({
    ...state,
    position: { _tag: "at", commitId, live: true },
  }));
}

export function backToNowPlanPosition(key: string): void {
  updatePlanPositionState(key, (state) =>
    state.position._tag === "latest" ? state : { ...state, position: LATEST },
  );
}

export function choosePlanParentLine(
  key: string,
  commitId: MercurianCommitId,
  parentId: MercurianCommitId,
): void {
  updatePlanPositionState(key, (state) => {
    if (state.parentChoices.get(commitId) === parentId) return state;
    const parentChoices = new Map(state.parentChoices);
    parentChoices.set(commitId, parentId);
    return { ...state, parentChoices };
  });
}

export function resetPlanPosition(key: string): void {
  appAtomRegistry.set(planPositionStateAtom(key), emptyPlanPositionState());
}

export function usePlanPosition(environmentId: EnvironmentId, planId: PlanId, graph: PlanGraph) {
  const key = planPositionKey(environmentId, planId);
  const state = useAtomValue(planPositionStateAtom(key));

  useEffect(() => advancePlanPosition(key, graph), [graph, key]);

  return {
    ...state,
    pick: useCallback(
      (commitId: MercurianCommitId) => pickPlanPosition(key, graph, commitId),
      [graph, key],
    ),
    standAt: useCallback(
      (commitId: MercurianCommitId) => standAtPlanPosition(key, commitId),
      [key],
    ),
    backToNow: useCallback(() => backToNowPlanPosition(key), [key]),
    chooseParentLine: useCallback(
      (commitId: MercurianCommitId, parentId: MercurianCommitId) =>
        choosePlanParentLine(key, commitId, parentId),
      [key],
    ),
  };
}
