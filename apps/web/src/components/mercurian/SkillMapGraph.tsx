import type { MemoryMap } from "@t3tools/contracts";
import { useMemo } from "react";

import {
  layoutSkillMapFlow,
  layoutSkillMapWeb,
  SKILL_MAP_GRAPH_NODE_SIZE,
  type SkillMapGraphLayout,
} from "./SkillMapGraph.logic";
import {
  SpatialMapCanvas,
  type SpatialMapCanvasEdge,
  type SpatialMapCanvasNode,
} from "./SpatialMapCanvas";

export function SkillMapGraph({
  map,
  onOpenNote,
  view,
}: {
  readonly map: MemoryMap;
  readonly onOpenNote: (name: string) => void;
  readonly view: "flow" | "web";
}) {
  const layout = useMemo(
    () => (view === "flow" ? layoutSkillMapFlow(map) : layoutSkillMapWeb(map)),
    [map, view],
  );
  const nodes = useMemo<ReadonlyArray<SpatialMapCanvasNode>>(
    () =>
      layout.nodes.map((node) => ({
        id: node.name,
        x: node.x,
        y: node.y,
        ...SKILL_MAP_GRAPH_NODE_SIZE,
        render: () => (
          <g
            className="cursor-pointer outline-none focus-visible:[&_rect]:stroke-primary"
            onClick={() => onOpenNote(node.name)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenNote(node.name);
              }
            }}
            role="button"
            tabIndex={0}
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
        ),
      })),
    [layout.nodes, onOpenNote],
  );
  const edges = useMemo<ReadonlyArray<SpatialMapCanvasEdge>>(() => {
    const positions = new Map(layout.nodes.map((node) => [node.name, node]));
    return layout.edges.flatMap(({ edge, index }) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (from === undefined || to === undefined) return [];
      const geometry = edgeGeometry(from, to, view);
      return [
        {
          id: `${edge.from}-${edge.type}-${edge.to}-${index}`,
          from,
          to,
          ...(map.types.length > 1 ? { label: edge.type } : {}),
          render: ({ markerId }) => (
            <>
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
            </>
          ),
        },
      ];
    });
  }, [layout.edges, layout.nodes, map.types.length, view]);
  if (layout.nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">This map has no arranged notes yet.</p>;
  }
  return (
    <SpatialMapCanvas
      ariaLabel={`${map.name} arrangement ${view}`}
      bounds={{ minX: 0, minY: 0, maxX: layout.width, maxY: layout.height }}
      className="h-[28rem] max-h-[60vh]"
      edges={edges}
      nodes={nodes}
    />
  );
}

function edgeGeometry(
  from: SkillMapGraphLayout["nodes"][number],
  to: SkillMapGraphLayout["nodes"][number],
  view: "flow" | "web",
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
  if (view === "web") {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const boundaryScale = Math.min(
      SKILL_MAP_GRAPH_NODE_SIZE.width / 2 / Math.abs(deltaX || 1),
      SKILL_MAP_GRAPH_NODE_SIZE.height / 2 / Math.abs(deltaY || 1),
    );
    const startX = from.x + deltaX * boundaryScale;
    const startY = from.y + deltaY * boundaryScale;
    const endX = to.x - deltaX * boundaryScale;
    const endY = to.y - deltaY * boundaryScale;
    const distance = Math.hypot(deltaX, deltaY);
    const curveX = (startX + endX) / 2 + (-deltaY / distance) * 18;
    const curveY = (startY + endY) / 2 + (deltaX / distance) * 18;
    return {
      path: `M ${startX} ${startY} Q ${curveX} ${curveY}, ${endX} ${endY}`,
      labelX: (startX + endX + curveX * 2) / 4,
      labelY: (startY + endY + curveY * 2) / 4,
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
