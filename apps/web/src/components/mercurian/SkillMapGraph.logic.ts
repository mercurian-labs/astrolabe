import type { MemoryMap, MemoryMapEdge } from "@t3tools/contracts";
import { graphStratify, sugiyama } from "d3-dag";

export interface SkillMapLayoutInputNode {
  readonly name: string;
  readonly parents: ReadonlyArray<string>;
}

export interface SkillMapGraphPreparation {
  readonly nodes: ReadonlyArray<SkillMapLayoutInputNode>;
  readonly layoutEdges: ReadonlyArray<MemoryMapEdge>;
  readonly feedbackEdges: ReadonlyArray<MemoryMapEdge>;
  readonly feedbackEdgeIndexes: ReadonlySet<number>;
}

export function prepareSkillMapGraph(map: MemoryMap): SkillMapGraphPreparation {
  const names: Array<string> = [];
  const named = new Set<string>();
  const outgoing = new Map<
    string,
    Array<{ readonly edge: MemoryMapEdge; readonly index: number }>
  >();
  for (const [index, edge] of map.edges.entries()) {
    for (const name of [edge.from, edge.to]) {
      if (named.has(name)) continue;
      named.add(name);
      names.push(name);
    }
    const entries = outgoing.get(edge.from) ?? [];
    entries.push({ edge, index });
    outgoing.set(edge.from, entries);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const feedbackEdgeIndexes = new Set<number>();
  const visit = (name: string) => {
    visiting.add(name);
    for (const { edge, index } of outgoing.get(name) ?? []) {
      if (visiting.has(edge.to)) feedbackEdgeIndexes.add(index);
      else if (!visited.has(edge.to)) visit(edge.to);
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of names) {
    if (!visited.has(name)) visit(name);
  }

  const layoutEdges = map.edges.filter((_edge, index) => !feedbackEdgeIndexes.has(index));
  const parentSets = new Map(names.map((name) => [name, new Set<string>()]));
  for (const edge of layoutEdges) parentSets.get(edge.to)?.add(edge.from);
  return {
    nodes: names.map((name) => ({ name, parents: [...(parentSets.get(name) ?? [])] })),
    layoutEdges,
    feedbackEdges: map.edges.filter((_edge, index) => feedbackEdgeIndexes.has(index)),
    feedbackEdgeIndexes,
  };
}

export interface SkillMapGraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }>;
  readonly edges: ReadonlyArray<{
    readonly edge: MemoryMapEdge;
    readonly feedback: boolean;
    readonly index: number;
  }>;
}

const NODE_WIDTH = 144;
const NODE_HEIGHT = 40;
const PADDING = 96;

export function layoutSkillMapGraph(map: MemoryMap): SkillMapGraphLayout {
  const prepared = prepareSkillMapGraph(map);
  if (prepared.nodes.length === 0) return { width: 0, height: 0, nodes: [], edges: [] };
  const dag = graphStratify()
    .id((node: SkillMapLayoutInputNode) => node.name)
    .parentIds((node: SkillMapLayoutInputNode) => node.parents)(prepared.nodes);
  sugiyama().nodeSize([NODE_WIDTH, NODE_HEIGHT]).gap([36, 64])(dag);
  const rawNodes = [...dag.nodes()];
  const minX = Math.min(...rawNodes.map(({ x }) => x));
  const maxX = Math.max(...rawNodes.map(({ x }) => x));
  const minY = Math.min(...rawNodes.map(({ y }) => y));
  const maxY = Math.max(...rawNodes.map(({ y }) => y));
  return {
    width: maxX - minX + NODE_WIDTH + PADDING * 2,
    height: maxY - minY + NODE_HEIGHT + PADDING * 2,
    nodes: rawNodes.map((node) => ({
      name: node.data.name,
      x: node.x - minX + NODE_WIDTH / 2 + PADDING,
      y: node.y - minY + NODE_HEIGHT / 2 + PADDING,
    })),
    edges: map.edges.map((edge, index) => ({
      edge,
      feedback: prepared.feedbackEdgeIndexes.has(index),
      index,
    })),
  };
}

export const SKILL_MAP_GRAPH_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT } as const;
