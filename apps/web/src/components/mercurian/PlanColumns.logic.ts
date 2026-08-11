/**
 * The planning history as standing branch segments: one pane for every linear
 * run on the line being read, and one explicit choice wherever that line
 * forks.
 *
 * The current commit decides the opening line. Choices above it lead through
 * its ancestry; choices below it take the first child, matching the planning
 * position and the thread view. The view may then replace any of those choices
 * without changing the graph or navigating the planning surface.
 */
import type { MercurianCommitId } from "@t3tools/contracts";

import { ancestorClosure, type PlanGraph, type PlanGraphNode } from "./PlanGraph.logic";
import { branchOption, type BranchOption } from "./PlanThread.logic";

export interface ColumnBranchOption extends BranchOption {
  /** This child is the real merge row later on the displayed path. */
  readonly onPathMerge: boolean;
}

export interface ForkTerminal {
  readonly kind: "fork";
  readonly options: ReadonlyArray<ColumnBranchOption>;
  readonly chosenChildId: MercurianCommitId;
}

export interface LeafTerminal {
  readonly kind: "leaf";
}

export interface MergeEntryTerminal {
  readonly kind: "merge-entry";
  readonly mergeCommitId: MercurianCommitId;
}

export type PaneTerminal = ForkTerminal | LeafTerminal | MergeEntryTerminal;

export interface Pane {
  readonly rows: ReadonlyArray<PlanGraphNode>;
  readonly terminal: PaneTerminal;
}

export interface ColumnLayout {
  readonly panes: ReadonlyArray<Pane>;
}

const EMPTY_COLUMN_LAYOUT: ColumnLayout = { panes: [] };

const COLUMN_STRIP_WIDTH = 32;
const COLUMN_PANE_WIDTH = 224;
const COLUMN_LAST_PANE_MAX_WIDTH = 336;
const COLUMN_SEPARATOR_WIDTH = 1;

/**
 * The most horizontal space the visible pane model can use. Earlier panes are
 * strips except for the one a user reopened; the final pane takes the spare
 * room up to its reading width. Separators are counted independently so this
 * remains a description of the layout rather than its Tailwind box model.
 */
export function columnViewWidthCap(
  panes: ReadonlyArray<Pane>,
  activePaneIndex: number,
  expandedPaneIndex: number,
): number {
  if (panes.length === 0) return 0;

  const paneWidths = panes.map((_, paneIndex) => {
    const compressed = paneIndex < activePaneIndex && paneIndex !== expandedPaneIndex;
    if (compressed) return COLUMN_STRIP_WIDTH;
    if (paneIndex === panes.length - 1) return COLUMN_LAST_PANE_MAX_WIDTH;
    return COLUMN_PANE_WIDTH;
  });

  return (
    paneWidths.reduce((total, paneWidth) => total + paneWidth, 0) +
    (panes.length - 1) * COLUMN_SEPARATOR_WIDTH
  );
}

/**
 * The branch selections a columns view opens with.
 *
 * A fork in the head's ancestry follows the first child that can reach the
 * head. Once the walk reaches the head, first-child order carries it onward to
 * a leaf. Parallel ancestral lines receive defaults too, so choosing one later
 * still knows how to continue toward the head.
 */
export function defaultBranchChoices(
  graph: PlanGraph,
  head: MercurianCommitId | null,
): ReadonlyMap<string, MercurianCommitId> {
  const choices = new Map<string, MercurianCommitId>();
  if (head === null || !graph.byId.has(head)) return choices;
  const ancestry = ancestorClosure(graph, head);
  const descendants = descendantClosure(graph, head);

  for (const node of graph.nodes) {
    if (node.childrenIds.length < 2) continue;
    const childId = ancestry.has(node.commitId)
      ? preferredChild(node, ancestry)
      : descendants.has(node.commitId)
        ? node.childrenIds[0]
        : undefined;
    if (childId !== undefined) choices.set(node.commitId, childId);
  }

  return choices;
}

/** The head and everything below it, bounded so partial cyclic input stays tame. */
function descendantClosure(graph: PlanGraph, head: MercurianCommitId): ReadonlySet<string> {
  const descendants = new Set<string>();
  const pending: Array<MercurianCommitId> = [head];
  let cursor = 0;

  while (cursor < pending.length && descendants.size < graph.nodes.length) {
    const commitId = pending[cursor];
    cursor += 1;
    if (commitId === undefined || descendants.has(commitId)) continue;
    const node = graph.byId.get(commitId);
    if (node === undefined) continue;
    descendants.add(commitId);
    pending.push(...node.childrenIds);
  }
  return descendants;
}

/**
 * The root-to-tip line selected by the standing branch choices, divided at
 * every fork. Missing edges and cycles simply end the last readable run.
 *
 * A merge belongs to the pane of the parent the walk came through. When the
 * same merge is also a direct, unchosen child of an earlier on-path fork, that
 * fork keeps every option and marks the merge option as a reference to the one
 * real row.
 */
export function columnLayout(
  graph: PlanGraph,
  head: MercurianCommitId | null,
  branchChoices: ReadonlyMap<string, MercurianCommitId>,
): ColumnLayout {
  if (graph.nodes.length === 0) return EMPTY_COLUMN_LAYOUT;

  const defaults = defaultBranchChoices(graph, head);
  const ancestry = head === null ? new Set<string>() : ancestorClosure(graph, head);
  const root = rootFor(graph, ancestry);
  if (root === undefined) return EMPTY_COLUMN_LAYOUT;

  const panes: Array<Pane> = [];
  const seen = new Set<string>();
  let rows: Array<PlanGraphNode> = [];
  let current: PlanGraphNode | undefined = root;

  for (let step = 0; current !== undefined && step < graph.nodes.length; step += 1) {
    if (seen.has(current.commitId)) break;
    seen.add(current.commitId);
    rows.push(current);

    if (current.childrenIds.length === 0) {
      panes.push({ rows, terminal: { kind: "leaf" } });
      return finishColumnLayout(graph, panes);
    }

    if (current.isMerge && current.childrenIds.length === 1) {
      panes.push({
        rows,
        terminal: { kind: "merge-entry", mergeCommitId: current.commitId },
      });
      rows = [];
      const childId: MercurianCommitId | undefined = current.childrenIds[0];
      current = childId === undefined ? undefined : graph.byId.get(childId);
      if (current === undefined) {
        replaceLastTerminalWithLeaf(panes);
        return finishColumnLayout(graph, panes);
      }
      continue;
    }

    if (current.childrenIds.length > 1) {
      const override = branchChoices.get(current.commitId);
      const fallback = defaults.get(current.commitId) ?? current.childrenIds[0];
      const chosenChildId =
        override !== undefined && current.childrenIds.includes(override) ? override : fallback;
      if (chosenChildId === undefined) {
        panes.push({ rows, terminal: { kind: "leaf" } });
        return finishColumnLayout(graph, panes);
      }

      panes.push({
        rows,
        terminal: {
          kind: "fork",
          options: current.childrenIds.flatMap((childId) => {
            if (!graph.byId.has(childId)) return [];
            return [{ ...branchOption(graph, childId), onPathMerge: false }];
          }),
          chosenChildId,
        },
      });
      rows = [];
      current = graph.byId.get(chosenChildId);
      if (current === undefined) {
        replaceLastTerminalWithLeaf(panes);
        return finishColumnLayout(graph, panes);
      }
      continue;
    }

    const childId: MercurianCommitId | undefined = current.childrenIds[0];
    const child: PlanGraphNode | undefined =
      childId === undefined ? undefined : graph.byId.get(childId);
    if (child === undefined || seen.has(child.commitId)) {
      panes.push({ rows, terminal: { kind: "leaf" } });
      return finishColumnLayout(graph, panes);
    }
    current = child;
  }

  if (rows.length > 0) panes.push({ rows, terminal: { kind: "leaf" } });
  return finishColumnLayout(graph, panes);
}

/** Mark merge references only after the one real path is known in full. */
function finishColumnLayout(graph: PlanGraph, panes: ReadonlyArray<Pane>): ColumnLayout {
  const realRows = new Set(panes.flatMap((pane) => pane.rows.map((row) => row.commitId)));
  return {
    panes: panes.map((pane): Pane => {
      if (pane.terminal.kind !== "fork") return pane;
      const terminal = pane.terminal;
      return {
        ...pane,
        terminal: {
          ...terminal,
          options: terminal.options.map((option) => ({
            ...option,
            onPathMerge:
              option.branchRootId !== terminal.chosenChildId &&
              realRows.has(option.branchRootId) &&
              graph.byId.get(option.branchRootId)?.isMerge === true,
          })),
        },
      };
    }),
  };
}

/** The root on the head's line, falling back to sequence order off that line. */
function rootFor(graph: PlanGraph, ancestry: ReadonlySet<string>): PlanGraphNode | undefined {
  const rootId = graph.roots.find((candidate) => ancestry.has(candidate)) ?? graph.roots[0];
  return rootId === undefined ? graph.nodes[0] : graph.byId.get(rootId);
}

/** First child through the head while above it, first child everywhere else. */
function preferredChild(
  node: PlanGraphNode,
  ancestry: ReadonlySet<string>,
): MercurianCommitId | undefined {
  return node.childrenIds.find((childId) => ancestry.has(childId)) ?? node.childrenIds[0];
}

/** A dangling chosen child ends the readable line rather than leaving a fork open. */
function replaceLastTerminalWithLeaf(panes: Array<Pane>): void {
  const index = panes.length - 1;
  const pane = panes[index];
  if (pane !== undefined) panes[index] = { ...pane, terminal: { kind: "leaf" } };
}
