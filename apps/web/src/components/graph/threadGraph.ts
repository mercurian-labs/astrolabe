import {
  clampStep,
  type CodeGraphView as AgentView,
  type CodeGraphViewStep,
} from "@t3tools/client-runtime/codeGraphViews";

import {
  expansionFor,
  rootsKey,
  type CodeGraphExpansion,
  type CodeGraphOptions,
} from "../codeGraph/codeGraphData";
import type { ThreadGraphState } from "./threadGraphStore";

const union = (left: readonly string[], right: readonly string[]) => [
  ...new Set([...left, ...right]),
];

/** What a thread's Graph tab draws now: an agent's view at a step, the reader's roots, or the changes. */
export interface ThreadGraphShown {
  readonly view: AgentView | null;
  readonly stepIndex: number;
  readonly step: CodeGraphViewStep | null;
  readonly roots: readonly [string, ...string[]] | null;
  /** Where the reader's own expansions are kept: per roots, or per a view's step. */
  readonly expansionKey: string;
  /** The reader's own expansions, before a step's are added. */
  readonly own: CodeGraphExpansion;
  readonly expansion: CodeGraphExpansion;
  readonly options: CodeGraphOptions;
}

/**
 * The tab's picture from its state: a shown view's step sets the level, the depth and what it
 * opened, and the reader's expansions go on top; else the reader's roots, else the changed files.
 */
export function threadGraphShown(input: {
  readonly state: ThreadGraphState;
  readonly views: ReadonlyArray<AgentView>;
  readonly changed: readonly string[];
  readonly options: CodeGraphOptions;
}): ThreadGraphShown {
  const { state, views, changed, options } = input;
  const view =
    state.view === null ? null : (views.find((each) => each.id === state.view?.id) ?? null);
  const stepIndex = view === null || state.view === null ? 0 : clampStep(view, state.view.step);
  const step = view?.steps[stepIndex] ?? null;
  const [first, ...rest] = changed;
  const roots = view?.roots ?? state.roots ?? (first === undefined ? null : [first, ...rest]);
  const expansionKey =
    view !== null ? `${view.id}:${stepIndex}` : roots === null ? "" : rootsKey(roots);
  const own = expansionFor(state.expansion, expansionKey);
  return {
    view,
    stepIndex,
    step,
    roots,
    expansionKey,
    own,
    expansion:
      step === null
        ? own
        : {
            neighbours: union(step.expandNeighbours, own.neighbours),
            contents: union(step.showContents, own.contents),
            collapsed: own.collapsed,
          },
    options: step === null ? options : { ...options, level: step.level, depth: step.depth },
  };
}

/** The reader's own part of an expansion the tab drew: what the step opened is the step's. */
export const ownExpansion = (
  step: CodeGraphViewStep | null,
  next: CodeGraphExpansion,
): CodeGraphExpansion =>
  step === null
    ? next
    : {
        neighbours: next.neighbours.filter((id) => !step.expandNeighbours.includes(id)),
        contents: next.contents.filter((id) => !step.showContents.includes(id)),
        collapsed: next.collapsed,
      };
