import type { MemoryMap } from "@t3tools/contracts";
import { useId, useMemo } from "react";

import {
  layoutSkillMapGraph,
  SKILL_MAP_GRAPH_NODE_SIZE,
  type SkillMapGraphLayout,
} from "./SkillMapGraph.logic";

export function SkillMapGraph({
  map,
  onOpenNote,
}: {
  readonly map: MemoryMap;
  readonly onOpenNote: (name: string) => void;
}) {
  const layout = useMemo(() => layoutSkillMapGraph(map), [map]);
  const markerId = `skill-map-arrow-${useId().replaceAll(":", "")}`;
  const positions = new Map(layout.nodes.map((node) => [node.name, node]));
  if (layout.nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">This map has no arranged notes yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-muted/10 p-2">
      <svg
        aria-label={`${map.name} arrangement graph`}
        className="block max-w-none"
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <title>{map.name} arrangement graph</title>
        <defs>
          <marker
            id={markerId}
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="6"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path className="fill-muted-foreground" d="M 0 0 L 7 3.5 L 0 7 z" />
          </marker>
        </defs>
        {layout.edges.map(({ edge, index }) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (from === undefined || to === undefined) return null;
          const geometry = edgeGeometry(from, to);
          return (
            <g key={`${edge.from}-${edge.type}-${edge.to}-${index}`}>
              <path
                className="fill-none stroke-muted-foreground"
                d={geometry.path}
                markerEnd={`url(#${markerId})`}
                strokeWidth="1.25"
              />
              {map.types.length > 1 ? (
                <text
                  className="fill-muted-foreground text-[10px]"
                  textAnchor="middle"
                  x={geometry.labelX}
                  y={geometry.labelY - 4}
                >
                  {edge.type}
                </text>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((node) => (
          <g
            className="cursor-pointer outline-none focus-visible:[&_rect]:stroke-primary"
            key={node.name}
            onClick={() => onOpenNote(node.name)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenNote(node.name);
              }
            }}
            role="button"
            tabIndex={0}
            transform={`translate(${node.x - SKILL_MAP_GRAPH_NODE_SIZE.width / 2} ${node.y - SKILL_MAP_GRAPH_NODE_SIZE.height / 2})`}
          >
            <rect
              className="fill-background stroke-border"
              height={SKILL_MAP_GRAPH_NODE_SIZE.height}
              rx="6"
              width={SKILL_MAP_GRAPH_NODE_SIZE.width}
            />
            <text
              className="fill-primary text-xs font-medium"
              dominantBaseline="middle"
              textAnchor="middle"
              x={SKILL_MAP_GRAPH_NODE_SIZE.width / 2}
              y={SKILL_MAP_GRAPH_NODE_SIZE.height / 2}
            >
              {truncateLabel(node.name)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function edgeGeometry(
  from: SkillMapGraphLayout["nodes"][number],
  to: SkillMapGraphLayout["nodes"][number],
) {
  if (from.name === to.name) {
    const startX = from.x + SKILL_MAP_GRAPH_NODE_SIZE.width / 3;
    const startY = from.y - SKILL_MAP_GRAPH_NODE_SIZE.height / 2;
    return {
      path: `M ${startX} ${startY} C ${from.x + 100} ${from.y - 80}, ${from.x - 100} ${from.y - 80}, ${from.x - SKILL_MAP_GRAPH_NODE_SIZE.width / 3} ${startY}`,
      labelX: from.x,
      labelY: from.y - 72,
    };
  }
  const downward = to.y >= from.y;
  const startY =
    from.y +
    (downward ? SKILL_MAP_GRAPH_NODE_SIZE.height / 2 : -SKILL_MAP_GRAPH_NODE_SIZE.height / 2);
  const endY =
    to.y +
    (downward ? -SKILL_MAP_GRAPH_NODE_SIZE.height / 2 : SKILL_MAP_GRAPH_NODE_SIZE.height / 2);
  const midpointY = (startY + endY) / 2;
  return {
    path: `M ${from.x} ${startY} C ${from.x} ${midpointY}, ${to.x} ${midpointY}, ${to.x} ${endY}`,
    labelX: (from.x + to.x) / 2,
    labelY: midpointY,
  };
}

const truncateLabel = (label: string) => (label.length > 22 ? `${label.slice(0, 21)}…` : label);
