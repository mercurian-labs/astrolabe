import type { MemoryLocalGraph } from "@t3tools/contracts";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";

import type { MapPoint } from "./DagExplorer.logic";

/**
 * Sized for a right panel a few hundred pixels wide: a handful of notes must fit
 * at a zoom where the 12px label still reads, so nodes are compact and sit close.
 */
export const MEMORY_GRAPH_NODE_SIZE = { width: 128, height: 40 } as const;
/** Fit for the memory graph: tight padding, and never zoomed past a readable label size. */
export const MEMORY_GRAPH_FIT = { padding: 12, maxZoom: 1.25 } as const;
/**
 * A panel under about 300px cannot show four notes at label size at once. The
 * graph opens at authored size, centered, rather than shrunk to fit; Fit gives
 * the overview and panning or a selection brings any note in.
 */
export const MEMORY_GRAPH_MIN_OPENING_ZOOM = 1;
const TICKS = 300;
const LINK_DISTANCE = 104;

export interface MemoryGraphLayoutNode extends MapPoint {
  readonly id: string;
  readonly name: string;
}

export interface MemoryGraphLayoutEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly status: MemoryLocalGraph["edges"][number]["status"];
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly start: MapPoint;
  readonly end: MapPoint;
}

export interface MemoryGraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyArray<MemoryGraphLayoutNode>;
  readonly edges: ReadonlyArray<MemoryGraphLayoutEdge>;
}

interface ForceNode {
  readonly id: string;
  readonly name: string;
  x?: number;
  y?: number;
}

/**
 * A bounded, stopped force layout: a fixed tick budget, then positions are
 * final. Isolates and disconnected components are pulled toward the origin
 * so nothing drifts out of reach, and every input node keeps a place.
 */
export function layoutMemoryLocalGraph(graph: MemoryLocalGraph): MemoryGraphLayout {
  if (graph.nodes.length === 0) return { width: 0, height: 0, nodes: [], edges: [] };
  const nodes: Array<ForceNode> = graph.nodes.map((node) => ({ id: node.id, name: node.name }));
  const known = new Set(nodes.map((node) => node.id));
  const links = graph.edges
    .filter((edge) => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to }));
  const radius = Math.max(120, 70 * Math.sqrt(nodes.length) + 80);
  forceSimulation(nodes)
    .force(
      "link",
      forceLink(links)
        .id((node: ForceNode) => node.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(-220))
    .force("x", forceX(0).strength(0.09))
    .force("y", forceY(0).strength(0.09))
    .force(
      "collide",
      forceCollide(Math.hypot(MEMORY_GRAPH_NODE_SIZE.width, MEMORY_GRAPH_NODE_SIZE.height) / 2 + 4),
    )
    .stop()
    .tick(TICKS);
  const clamp = (value: number) => Math.max(-radius * 2, Math.min(radius * 2, value));
  const positioned = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    x: clamp(node.x ?? 0),
    y: clamp(node.y ?? 0),
  }));
  const minX = Math.min(...positioned.map(({ x }) => x));
  const minY = Math.min(...positioned.map(({ y }) => y));
  const maxX = Math.max(...positioned.map(({ x }) => x));
  const maxY = Math.max(...positioned.map(({ y }) => y));
  const layoutNodes = positioned.map((node) => ({
    ...node,
    x: node.x - minX + MEMORY_GRAPH_NODE_SIZE.width / 2,
    y: node.y - minY + MEMORY_GRAPH_NODE_SIZE.height / 2,
  }));
  const byId = new Map(layoutNodes.map((node) => [node.id, node]));
  return {
    width: maxX - minX + MEMORY_GRAPH_NODE_SIZE.width,
    height: maxY - minY + MEMORY_GRAPH_NODE_SIZE.height,
    nodes: layoutNodes,
    edges: graph.edges.flatMap((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from === undefined || to === undefined) return [];
      return [
        {
          id: `${edge.from}>${edge.to}`,
          from: edge.from,
          to: edge.to,
          status: edge.status,
          ...edgeGeometry(from, to),
        },
      ];
    }),
  };
}

function edgeGeometry(
  from: MapPoint,
  to: MapPoint,
): Pick<MemoryGraphLayoutEdge, "path" | "labelX" | "labelY" | "start" | "end"> {
  const { width, height } = MEMORY_GRAPH_NODE_SIZE;
  if (from.x === to.x && from.y === to.y) {
    const start = { x: from.x + width / 3, y: from.y - height / 2 };
    const end = { x: from.x - width / 3, y: from.y - height / 2 };
    return {
      path: `M ${start.x} ${start.y} C ${from.x + 90} ${from.y - 80}, ${from.x - 90} ${from.y - 80}, ${end.x} ${end.y}`,
      labelX: from.x,
      labelY: from.y - 66,
      start,
      end,
    };
  }
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const boundaryScale = Math.min(
    width / 2 / Math.abs(deltaX || 1),
    height / 2 / Math.abs(deltaY || 1),
  );
  const start = { x: from.x + deltaX * boundaryScale, y: from.y + deltaY * boundaryScale };
  const end = { x: to.x - deltaX * boundaryScale, y: to.y - deltaY * boundaryScale };
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const curveX = (start.x + end.x) / 2 + (-deltaY / distance) * 16;
  const curveY = (start.y + end.y) / 2 + (deltaX / distance) * 16;
  return {
    path: `M ${start.x} ${start.y} Q ${curveX} ${curveY}, ${end.x} ${end.y}`,
    labelX: (start.x + end.x + curveX * 2) / 4,
    labelY: (start.y + end.y + curveY * 2) / 4,
    start,
    end,
  };
}

/**
 * Geometry outlives labels. A cached layout keeps its coordinates while the
 * current graph supplies names and link statuses, so a review-only refresh
 * never moves a node and never shows a stale label or stroke.
 */
export function projectMemoryGraphLayout(
  layout: MemoryGraphLayout,
  graph: MemoryLocalGraph,
): MemoryGraphLayout {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const statuses = new Map(graph.edges.map((edge) => [`${edge.from}>${edge.to}`, edge.status]));
  return {
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes.map((node) => {
      const name = names.get(node.id);
      return name === undefined || name === node.name ? node : { ...node, name };
    }),
    edges: layout.edges.map((edge) => {
      const status = statuses.get(edge.id);
      return status === undefined || status === edge.status ? edge : { ...edge, status };
    }),
  };
}

export function memoryGraphEdgeStatusLabel(
  status: MemoryLocalGraph["edges"][number]["status"],
): string {
  switch (status) {
    case "added":
      return "link added";
    case "removed":
      return "link removed";
    case "unchanged":
      return "link unchanged";
  }
}

/** Every component, including a lone isolate, is listed so counts stay honest beyond the picture. */
export function memoryGraphComponents(
  graph: MemoryLocalGraph,
): ReadonlyArray<ReadonlyArray<string>> {
  const adjacency = new Map<string, Set<string>>(graph.nodes.map((node) => [node.id, new Set()]));
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const seen = new Set<string>();
  const components: Array<Array<string>> = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const component: Array<string> = [];
    const stack = [node.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) stack.push(next);
    }
    components.push(component.sort());
  }
  return components;
}
