/**
 * At rest no edge is drawn, so no label has a line under it, except in a local graph (`linksAtRest`),
 * which is its links. Otherwise only attention (hover, pick, search, a shown lens) or a landing turn's
 * story lights links, and the story only those the turn made or broke. The levels are the AI Coding
 * Dictionary's.
 */
import type { PlayFocus } from "./plays.ts";
import { NodeFlag, type GraphView } from "./view.ts";

export const EdgeAttention = {
  rest: 0,
  touched: 0.6,
  searchMatch: 0.28,
  searchMiss: 0,
  storyNew: 1,
  /** A link the story has already told: lit, quietly, without beads. */
  storyQuiet: 0.45,
  /** Inside a container opened past the landing's level, an edge that stood there: quieter still. */
  structure: 0.3,
  lensFloor: 0.35,
  /** A local graph's link at rest (`linksAtRest`): drawn, below a hover's. */
  localRest: 0.38,
} as const;

/** Whether an edge is the story's (a link the turn made or broke, or the selected play's), while it is lit. */
export type StoryLevel = "none" | "new" | "quiet";

export interface EdgeAttentionInput {
  /** The edge's part in the story while it is lit: a link the landing turn made or broke. */
  readonly story: StoryLevel;
  /** A search is narrowing the graph. */
  readonly searching: boolean;
  /** Both ends match the search. */
  readonly bothMatch: boolean;
  /** The edge touches the hovered or picked note. */
  readonly touched: boolean;
  /** A shown lens arranges this edge. */
  readonly lens: boolean;
  /** It stood among what shows inside an opened container (see `GraphView.edgeStructure`). */
  readonly structure?: boolean;
  /** The graph is a local graph, whose links draw at rest. */
  readonly linksAtRest?: boolean;
}

/**
 * An edge's attention target, before visibility is applied. The story's links
 * win while it is lit; otherwise a search narrows the web (lens or not), then a
 * hover or pick lights its links, with the lens floor last.
 */
export function edgeAttention(input: EdgeAttentionInput): number {
  if (input.story === "new") return EdgeAttention.storyNew;
  if (input.story === "quiet") return EdgeAttention.storyQuiet;
  if (input.searching) {
    return input.bothMatch ? EdgeAttention.searchMatch : EdgeAttention.searchMiss;
  }
  const rest = input.linksAtRest === true ? EdgeAttention.localRest : EdgeAttention.rest;
  const base = input.touched ? EdgeAttention.touched : rest;
  const lensed = input.lens ? Math.max(base, EdgeAttention.lensFloor) : base;
  return input.structure === true ? Math.max(lensed, EdgeAttention.structure) : lensed;
}

export interface AttentionState {
  /** The hovered note, or -1. */
  readonly hover: number;
  /** The picked note, or -1. */
  readonly picked: number;
  /** The landing turn's story is lit: its new and broken links. */
  readonly storyLit: boolean;
  /**
   * A selected play: it is the story, held like a pick. Its link alone reads in
   * full; the rest of the turn's links stay dark.
   */
  readonly play: PlayFocus | null;
  /** A local graph: its links draw at rest. */
  readonly linksAtRest?: boolean;
}

/** An edge's part in the story, given what is lit and what play is selected. */
function storyLevel(view: GraphView, state: AttentionState, index: number): StoryLevel {
  if (state.play !== null) {
    if (state.play.links.some((link) => link.edge === index)) return "new";
    return state.play.quiet?.includes(index) === true ? "quiet" : "none";
  }
  return state.storyLit && view.edgeCurrent[index] === 1 ? "new" : "none";
}

/**
 * Every edge's attention target for a view. A worked note glows, but its
 * links stay dark unless something above lights them.
 */
export function edgeAttentions(
  view: GraphView,
  edges: ReadonlyArray<{ readonly a: number; readonly b: number }>,
  state: AttentionState,
): Float32Array {
  const out = new Float32Array(edges.length);
  const matches = (node: number) => ((view.nodeFlags[node] ?? 0) & NodeFlag.match) !== 0;
  const touched = (node: number) => node === state.hover || node === state.picked;
  edges.forEach((edge, index) => {
    out[index] = edgeAttention({
      story: storyLevel(view, state, index),
      searching: view.searching,
      bothMatch: matches(edge.a) && matches(edge.b),
      touched: touched(edge.a) || touched(edge.b),
      lens: (view.edgeSlot[index] ?? -1) >= 0,
      structure: view.edgeStructure[index] === 1,
      linksAtRest: state.linksAtRest === true,
    });
  });
  return out;
}

/**
 * The story's notes while it is lit: the notes the landing turn worked, and
 * both ends of every link it made or broke. Empty when the story is dark. A
 * selected play is the story instead, lit or not: its notes alone.
 */
export function storyNodes(
  view: GraphView,
  edges: ReadonlyArray<{ readonly a: number; readonly b: number }>,
  storyLit: boolean,
  play: PlayFocus | null = null,
): Set<number> {
  const nodes = new Set<number>();
  if (play !== null) {
    for (const node of play.nodes) if (view.nodeVisible[node] === 1) nodes.add(node);
    return nodes;
  }
  if (!storyLit) return nodes;
  view.nodeGlow.forEach((glow, index) => {
    if (glow > 0.5 && view.nodeVisible[index] === 1) nodes.add(index);
  });
  edges.forEach((edge, index) => {
    if (view.edgeCurrent[index] !== 1 || view.edgeVisible[index] !== 1) return;
    nodes.add(edge.a);
    nodes.add(edge.b);
  });
  return nodes;
}
