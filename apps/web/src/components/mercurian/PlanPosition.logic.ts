/**
 * Where the planning surface is standing, and how standing there moves.
 *
 * Per-window and transient — not persisted, not server-owned. Nothing ranks or
 * rolls up from where a window is pointed, so position is scroll-state-shaped
 * (ADR 002 §5): two windows on one plan may stand in two different places, and
 * on two different branches, while agreeing on every fact the server owns.
 *
 * Everything here is pure, and everything the surface asks about position is
 * one of these four questions.
 */
import type { MercurianCommitId } from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";

export type PlanPosition =
  /** The landing default: the path through the highest-sequence commit. */
  | { readonly _tag: "latest" }
  /**
   * Somewhere you stood deliberately. `live` says which kind of standing it
   * is: at a branch tip you are *in* that conversation and the surface follows
   * the line as it grows; at an interior commit you are looking back, and
   * nothing that lands afterwards moves you.
   */
  | { readonly _tag: "at"; readonly commitId: MercurianCommitId; readonly live: boolean };

export const LATEST: PlanPosition = { _tag: "latest" };

/**
 * The commit the composer acts from — the parent a send names.
 *
 * A position whose commit the graph does not carry falls back to the latest
 * one. That happens only in the gap between a plan switch and its first
 * snapshot, and answering with the wrong branch beats answering with nothing.
 */
export function resolveHead(graph: PlanGraph, position: PlanPosition): MercurianCommitId | null {
  if (position._tag === "latest") return graph.latest;
  return graph.byId.has(position.commitId) ? position.commitId : graph.latest;
}

/** Coding-session commits are inspectable leaves; planning continues from their sole parent. */
export function resolveActingHead(
  graph: PlanGraph,
  viewedHead: MercurianCommitId | null,
): MercurianCommitId | null {
  if (viewedHead === null) return null;
  const node = graph.byId.get(viewedHead);
  if (node?.item._tag !== "coding-session") return viewedHead;
  return node.parents[0] ?? viewedHead;
}

/**
 * Where picking a commit in the explorer puts you.
 *
 * A leaf is a branch tip, so picking one stands you live in that conversation
 * — including when it happens to be the newest commit in the whole plan.
 * Deliberately not collapsing that case back to {@link LATEST}: `latest`
 * follows the globally-latest commit, and a window that has chosen a branch
 * must not be yanked onto another one because that one grew.
 */
export function positionAfterPick(graph: PlanGraph, commitId: MercurianCommitId): PlanPosition {
  const node = graph.byId.get(commitId);
  if (node === undefined) return LATEST;
  return { _tag: "at", commitId, live: node.childrenIds.length === 0 };
}

/**
 * The follow step: a live position rides its branch forward as commits land on
 * it, resting when it reaches a leaf again.
 *
 * Only ever forward, and only ever along this line — a commit landing
 * elsewhere in the DAG moves nothing here. At a fork the first-born wins,
 * which is what a window that sat passively through someone else's fork
 * should see; a window that sent the second sibling set its own position from
 * the send and never consults this.
 *
 * Idempotent, so running it after a send that already placed the position
 * costs nothing and settles the race where the subscription echo beats the
 * RPC result.
 */
export function advance(graph: PlanGraph, position: PlanPosition): PlanPosition {
  if (position._tag === "latest" || !position.live) return position;

  let head = position.commitId;
  // A DAG cannot cycle, but the bound keeps a malformed graph from hanging
  // the render loop.
  for (let step = 0; step < graph.nodes.length; step += 1) {
    const child = graph.byId.get(head)?.childrenIds[0];
    if (child === undefined) break;
    head = child;
  }

  return head === position.commitId ? position : { _tag: "at", commitId: head, live: true };
}

/**
 * Whether the surface is looking back — the one state that changes what the
 * composer promises, because sending from there starts a new branch.
 */
export function isViewingPast(graph: PlanGraph, position: PlanPosition): boolean {
  if (position._tag === "latest") return false;
  return !position.live && graph.byId.has(position.commitId);
}
