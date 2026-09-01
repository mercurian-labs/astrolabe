import type { MemoryMap, MemoryMapEdge } from "@t3tools/contracts";
import { graphStratify, sugiyama } from "d3-dag";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";

interface SkillMapFlowInputNode {
  readonly name: string;
  readonly parents: ReadonlyArray<string>;
}

export interface SkillMapGraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }>;
  readonly edges: ReadonlyArray<{ readonly edge: MemoryMapEdge; readonly index: number }>;
}

const NODE_WIDTH = 144;
const NODE_HEIGHT = 40;
const WEB_TICKS = 300;

const namesInFileOrder = (map: MemoryMap): ReadonlyArray<string> => {
  const names: Array<string> = [];
  const named = new Set<string>();
  for (const edge of map.edges) {
    for (const name of [edge.from, edge.to]) {
      if (named.has(name)) continue;
      named.add(name);
      names.push(name);
    }
  }
  return names;
};

const emptyLayout = (): SkillMapGraphLayout => ({ width: 0, height: 0, nodes: [], edges: [] });

const normalizeLayout = (
  map: MemoryMap,
  nodes: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }>,
): SkillMapGraphLayout => {
  if (nodes.length === 0) return emptyLayout();
  const minX = Math.min(...nodes.map(({ x }) => x));
  const maxX = Math.max(...nodes.map(({ x }) => x));
  const minY = Math.min(...nodes.map(({ y }) => y));
  const maxY = Math.max(...nodes.map(({ y }) => y));
  return {
    width: maxX - minX + NODE_WIDTH,
    height: maxY - minY + NODE_HEIGHT,
    nodes: nodes.map((node) => ({
      name: node.name,
      x: node.x - minX + NODE_WIDTH / 2,
      y: node.y - minY + NODE_HEIGHT / 2,
    })),
    edges: map.edges.map((edge, index) => ({ edge, index })),
  };
};

export function layoutSkillMapFlow(map: MemoryMap): SkillMapGraphLayout {
  const names = namesInFileOrder(map);
  if (names.length === 0) return emptyLayout();
  const parentSets = new Map(names.map((name) => [name, new Set<string>()]));
  for (const edge of map.edges) parentSets.get(edge.to)?.add(edge.from);
  const input: ReadonlyArray<SkillMapFlowInputNode> = names.map((name) => ({
    name,
    parents: [...(parentSets.get(name) ?? [])],
  }));
  const dag = graphStratify()
    .id((node: SkillMapFlowInputNode) => node.name)
    .parentIds((node: SkillMapFlowInputNode) => node.parents)(input);
  sugiyama()
    .nodeSize([NODE_WIDTH, NODE_HEIGHT])
    .gap([NODE_WIDTH * 2, NODE_HEIGHT * 2])(dag);
  return normalizeLayout(
    map,
    [...dag.nodes()].map((node) => ({ name: node.data.name, x: node.x, y: node.y })),
  );
}

interface SkillMapForceNode {
  readonly name: string;
  x?: number;
  y?: number;
}

export function layoutSkillMapWeb(map: MemoryMap): SkillMapGraphLayout {
  const nodes: Array<SkillMapForceNode> = namesInFileOrder(map).map((name) => ({ name }));
  if (nodes.length === 0) return emptyLayout();
  const links = map.edges
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => ({ source: edge.from, target: edge.to }));
  forceSimulation(nodes)
    .force(
      "link",
      forceLink(links)
        .id((node: SkillMapForceNode) => node.name)
        .distance(180),
    )
    .force("charge", forceManyBody().strength(-600))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(Math.hypot(NODE_WIDTH, NODE_HEIGHT) / 2 + 12))
    .stop()
    .tick(WEB_TICKS);
  return normalizeLayout(
    map,
    nodes.map((node) => ({ name: node.name, x: node.x ?? 0, y: node.y ?? 0 })),
  );
}

export const SKILL_MAP_GRAPH_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT } as const;
