import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";
import type { PlanGraph, PlanGraphNode } from "@t3tools/client-runtime/state/plan-graph";
import { hasFork } from "@t3tools/client-runtime/state/plan-graph";
import { graphStratify, grid, sugiyama, zherebko } from "d3-dag";

export * from "@t3tools/client-runtime/state/plan-graph";

export type PlanExplorerView = "thread" | "columns" | "graph";

export function effectivePlanExplorerView(
  graph: PlanGraph,
  storedView: PlanExplorerView,
): PlanExplorerView {
  return storedView === "columns" && !hasFork(graph) ? "thread" : storedView;
}

const DAG_NODE_SIZE = [32, 32] as const;
const DAG_GAP = [64, 64] as const;

export interface SpatialPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpatialNode extends SpatialPoint {
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
}

export interface SpatialEdge {
  readonly fromCommitId: MercurianCommitId;
  readonly toCommitId: MercurianCommitId;
  readonly points: ReadonlyArray<SpatialPoint>;
}

export interface SpatialLayout {
  readonly nodes: ReadonlyArray<SpatialNode>;
  readonly positions: ReadonlyMap<string, SpatialPoint>;
  readonly edges: ReadonlyArray<SpatialEdge>;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
}

const EMPTY_SPATIAL_LAYOUT: SpatialLayout = {
  nodes: [],
  positions: new Map(),
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
};

export type DagLayoutName = "sugiyama" | "grid" | "zherebko";

export interface DagLayoutOptions {
  readonly layout: DagLayoutName;
}

export function dagLayout(graph: PlanGraph, options: DagLayoutOptions): SpatialLayout {
  if (graph.nodes.length === 0) return EMPTY_SPATIAL_LAYOUT;

  const dag = graphStratify()
    .id((node: PlanGraphNode) => node.commitId)
    .parentIds((node: PlanGraphNode) => node.parents)(graph.nodes);
  switch (options.layout) {
    case "sugiyama":
      sugiyama().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
    case "grid":
      grid().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
    case "zherebko":
      zherebko().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
  }

  const dagNodes = [...dag.nodes()];
  const dagLinks = [...dag.links()];
  const orientation = orientations.find((orient) =>
    dagLinks.every((link) => orient(link.source).y < orient(link.target).y),
  );
  if (orientation === undefined) {
    throw new Error(`The ${options.layout} layout has no strictly downward flow axis.`);
  }

  const laidOutById = new Map(dagNodes.map((node) => [node.data.commitId as string, node]));
  const positions = new Map<string, SpatialPoint>();
  const nodes = graph.nodes.map((node): SpatialNode => {
    const laidOut = laidOutById.get(node.commitId);
    if (laidOut === undefined) throw new Error(`The layout dropped commit ${node.commitId}.`);
    const oriented = orientation(laidOut);
    const point = { x: round(oriented.x), y: round(oriented.y) };
    positions.set(node.commitId, point);
    return {
      commitId: node.commitId,
      item: node.item,
      isBranchPoint: node.isBranchPoint,
      isMerge: node.isMerge,
      ...point,
    };
  });

  const linksById = new Map(
    dagLinks.map((link) => [edgeKey(link.source.data.commitId, link.target.data.commitId), link]),
  );
  const edges = graph.nodes.flatMap((node) =>
    node.parents.flatMap((parentId): ReadonlyArray<SpatialEdge> => {
      const link = linksById.get(edgeKey(parentId, node.commitId));
      if (link === undefined) return [];
      return [
        {
          fromCommitId: parentId,
          toCommitId: node.commitId,
          points: link.points.map(([x, y]) => {
            const point = orientation({ x, y });
            return { x: round(point.x), y: round(point.y) };
          }),
        },
      ];
    }),
  );
  const extentPoints: ReadonlyArray<SpatialPoint> = [
    ...nodes,
    ...edges.flatMap((edge) => edge.points),
  ];

  return {
    nodes,
    positions,
    edges,
    bounds: {
      minX: Math.min(...extentPoints.map((point) => point.x)),
      minY: Math.min(...extentPoints.map((point) => point.y)),
      maxX: Math.max(...extentPoints.map((point) => point.x)),
      maxY: Math.max(...extentPoints.map((point) => point.y)),
    },
  };
}

type LayoutCoordinate = { readonly x: number; readonly y: number };
type Orientation = (point: LayoutCoordinate) => SpatialPoint;

const orientations: ReadonlyArray<Orientation> = [
  ({ x, y }) => ({ x, y }),
  ({ x, y }) => ({ x: y, y: x }),
  ({ x, y }) => ({ x, y: -y }),
  ({ x, y }) => ({ x: y, y: -x }),
];

const edgeKey = (from: MercurianCommitId, to: MercurianCommitId) => `${from}\0${to}`;
const round = (value: number) => Math.round(value * 100) / 100;
