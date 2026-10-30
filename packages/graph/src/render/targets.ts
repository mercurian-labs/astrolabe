/**
 * Where every node and edge should head for a view, the same for every
 * renderer: what is shown and how prominently, each note's radius and its
 * offset from home, and each edge's visibility and attention. Renderers ease
 * toward these targets on the node state's springs and the edge style.
 */
import type { Offset } from "../layout/offsets.ts";
import { edgeAttentions, storyNodes } from "../model/attention.ts";
import { playEdge, type PlayFocus } from "../model/plays.ts";
import type { GraphView } from "../model/view.ts";
import type { EdgeStyle } from "./edgeStyle.ts";
import { type NodeState, StyleChannel } from "./nodeState.ts";
import type { DrawnGraph } from "./workingSet.ts";

/** Hover recedes everything outside the hovered note's links to this share. */
export const HOVER_RECEDE = 0.3;

export interface TargetInput {
  readonly view: GraphView;
  /** The drawn graph: node and edge slots, each edge's ends as node slots. */
  readonly universe: DrawnGraph;
  readonly edgesOf: ReadonlyArray<ReadonlyArray<number>>;
  readonly state: NodeState;
  readonly edgeStyle: EdgeStyle;
  /** The hovered note, or -1. */
  readonly hover: number;
  readonly storyLit: boolean;
  readonly play: PlayFocus | null;
  /** A local graph: its links draw at rest. */
  readonly linksAtRest?: boolean;
  /** The drawn radius of a note of this degree. */
  readonly radiusFor: (degree: number) => number;
  /** Where node `index` goes, relative to its home: gathering, pull, and drag. */
  readonly offsetFor: (index: number) => Offset;
}

export function applyTargets(input: TargetInput): void {
  const { view, universe, state, edgeStyle, hover, play } = input;
  const picked = view.focus?.index ?? -1;
  const near = new Set<number>();
  if (hover >= 0) {
    near.add(hover);
    for (const edge of input.edgesOf[hover] ?? []) {
      if (view.edgeVisible[edge] !== 1) continue;
      const other = universe.edges[edge];
      if (other !== undefined) near.add(other.a === hover ? other.b : other.a);
    }
  }
  const target = [0, 0, 0, 0];
  const story = storyNodes(view, universe.edges, input.storyLit, play);
  for (let index = 0; index < state.count; index += 1) {
    let emphasis = view.nodeEmphasis[index] ?? 0;
    if (hover >= 0) {
      emphasis = near.has(index) ? Math.max(emphasis, 0.95) : emphasis * HOVER_RECEDE;
    }
    target[StyleChannel.visibility] = view.nodeVisible[index] ?? 0;
    target[StyleChannel.emphasis] = emphasis;
    target[StyleChannel.glow] = view.nodeGlow[index] ?? 0;
    target[StyleChannel.hover] = index === hover ? 1 : 0;
    state.style.setTarget(index, target);
    // The story's notes, the play's, and the hovered or picked note stand out
    // alike (full ink, outlined label); only the hovered or picked one grows.
    const prominent = story.has(index) || index === hover || index === picked;
    state.prominence.setScalarTarget(index, prominent ? 1 : 0);
    state.grow.setScalarTarget(index, index === hover || index === picked ? 1 : 0);
    state.radius.setScalarTarget(index, input.radiusFor(view.nodeDegree[index] ?? 0));
    state.offsets.setTarget(index, input.offsetFor(index));
  }
  // Edges are lit by attention: a hover, a pick, a search, a lens, or the
  // landing turn's story. Worked notes glow but never light their links.
  const attention = edgeAttentions(view, universe.edges, {
    hover,
    picked,
    storyLit: input.storyLit,
    play,
    linksAtRest: input.linksAtRest === true,
  });
  attention.forEach((value, index) => {
    edgeStyle.setTarget(index, playEdge(view, play, index).visible, value);
  });
}

/** Each edge's kind (plain, new, broken) as the checkpoint has it, the selected play's edge by the play. */
export function edgeKinds(
  view: GraphView,
  play: PlayFocus | null,
  out: { [index: number]: number; length: number },
): void {
  for (let index = 0; index < out.length; index += 1) out[index] = view.edgeKind[index] ?? 0;
  for (const { edge } of play?.links ?? []) {
    if (edge >= 0) out[edge] = playEdge(view, play, edge).kind;
  }
}
