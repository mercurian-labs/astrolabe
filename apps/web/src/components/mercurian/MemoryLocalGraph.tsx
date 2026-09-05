import type {
  MemoryChangedDocument,
  MemoryLocalGraph as MemoryLocalGraphData,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import {
  layoutMemoryLocalGraph,
  MEMORY_GRAPH_FIT,
  MEMORY_GRAPH_MIN_OPENING_ZOOM,
  MEMORY_GRAPH_NODE_SIZE,
  memoryGraphComponents,
  memoryGraphEdgeStatusLabel,
  projectMemoryGraphLayout,
  type MemoryGraphLayout,
} from "./MemoryLocalGraph.logic";
import { memoryDocumentStatusLabel, memoryGraphStructureKey } from "./MemoryTab.logic";
import {
  SpatialMapCanvas,
  type SpatialMapCanvasEdge,
  type SpatialMapCanvasNode,
} from "./SpatialMapCanvas";

/**
 * Geometry is keyed on structure alone: only a different node or edge set
 * computes new positions. Names and link statuses are projected from the
 * current graph onto that geometry, so a review-only refresh keeps the
 * picture in place yet never shows a stale label.
 */
function useMemoryGraphLayout(graph: MemoryLocalGraphData): MemoryGraphLayout {
  const key = memoryGraphStructureKey(graph);
  const [cache, setCache] = useState(() => ({ key, layout: layoutMemoryLocalGraph(graph) }));
  let geometry = cache.layout;
  if (cache.key !== key) {
    const next = { key, layout: layoutMemoryLocalGraph(graph) };
    setCache(next);
    geometry = next.layout;
  }
  return useMemo(() => projectMemoryGraphLayout(geometry, graph), [geometry, graph]);
}

const truncate = (label: string) => (label.length > 18 ? `${label.slice(0, 17)}…` : label);

export function MemoryLocalGraph({
  graph,
  documents,
  selectedDocumentIds,
  onSelectDocument,
}: {
  readonly graph: MemoryLocalGraphData;
  readonly documents: ReadonlyArray<MemoryChangedDocument>;
  readonly selectedDocumentIds: ReadonlySet<string>;
  readonly onSelectDocument: (documentId: string) => void;
}) {
  const layout = useMemoryGraphLayout(graph);
  const statusById = useMemo(
    () => new Map(documents.map((document) => [document.id, memoryDocumentStatusLabel(document)])),
    [documents],
  );
  const components = useMemo(() => memoryGraphComponents(graph), [graph]);
  const nodes = useMemo<ReadonlyArray<SpatialMapCanvasNode>>(
    () =>
      layout.nodes.map((node) => {
        const selected = selectedDocumentIds.has(node.id);
        const status = statusById.get(node.id) ?? "Changed";
        return {
          id: node.id,
          x: node.x,
          y: node.y,
          ...MEMORY_GRAPH_NODE_SIZE,
          render: () => (
            <g
              aria-label={`${node.name}, ${status.toLocaleLowerCase()}`}
              aria-pressed={selected}
              className="cursor-pointer outline-none focus-visible:[&_rect]:stroke-ring focus-visible:[&_rect]:stroke-2"
              data-memory-node={node.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDocument(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDocument(node.id);
                }
              }}
            >
              <rect
                className={cn(
                  "stroke-border",
                  selected ? "fill-primary/10 stroke-primary" : "fill-background",
                )}
                height={MEMORY_GRAPH_NODE_SIZE.height}
                rx="6"
                strokeWidth={selected ? 1.5 : 1}
                width={MEMORY_GRAPH_NODE_SIZE.width}
              />
              <text
                className="fill-foreground text-xs font-medium"
                textAnchor="middle"
                x={MEMORY_GRAPH_NODE_SIZE.width / 2}
                y={18}
              >
                {truncate(node.name)}
              </text>
              <text
                className="fill-muted-foreground text-[10px]"
                textAnchor="middle"
                x={MEMORY_GRAPH_NODE_SIZE.width / 2}
                y={33}
              >
                {status}
              </text>
            </g>
          ),
        };
      }),
    [layout.nodes, onSelectDocument, selectedDocumentIds, statusById],
  );
  const edges = useMemo<ReadonlyArray<SpatialMapCanvasEdge>>(
    () =>
      layout.edges.map((edge) => {
        const label = memoryGraphEdgeStatusLabel(edge.status);
        const highlighted = selectedDocumentIds.has(edge.from) || selectedDocumentIds.has(edge.to);
        return {
          id: edge.id,
          from: edge.start,
          to: edge.end,
          label,
          render: ({ markerId }) => (
            <g aria-label={label} role="img">
              <title>{label}</title>
              <path
                className={cn(
                  "fill-none",
                  edge.status === "added"
                    ? "stroke-success-foreground"
                    : edge.status === "removed"
                      ? "stroke-muted-foreground/70"
                      : "stroke-muted-foreground",
                  highlighted && "stroke-primary",
                )}
                d={edge.path}
                markerEnd={`url(#${markerId})`}
                strokeDasharray={edge.status === "removed" ? "4 3" : undefined}
                strokeWidth={edge.status === "added" ? 1.75 : 1.25}
              />
              {edge.status === "unchanged" ? null : (
                <text
                  className="fill-muted-foreground text-[10px]"
                  textAnchor="middle"
                  x={edge.labelX}
                  y={edge.labelY - 4}
                >
                  {edge.status}
                </text>
              )}
            </g>
          ),
        };
      }),
    [layout.edges, selectedDocumentIds],
  );
  // The camera follows a selection made elsewhere (a document row, an amendment) only when
  // that node is out of view, so the picture stays put during ordinary review.
  const focus = useMemo(() => {
    const node = layout.nodes.find((candidate) => selectedDocumentIds.has(candidate.id));
    return node === undefined ? null : { id: node.id, point: { x: node.x, y: node.y } };
  }, [layout.nodes, selectedDocumentIds]);
  if (layout.nodes.length === 0) return null;
  const isolates = components.filter((component) => component.length === 1).length;
  return (
    <div className="space-y-1.5">
      <SpatialMapCanvas
        ariaLabel="Changed memory notes and their prose links"
        bounds={{ minX: 0, minY: 0, maxX: layout.width, maxY: layout.height }}
        className="h-72 min-h-64 max-h-[50vh]"
        edges={edges}
        fit={MEMORY_GRAPH_FIT}
        focus={focus}
        minOpeningZoom={MEMORY_GRAPH_MIN_OPENING_ZOOM}
        nodes={nodes}
        showMinimap={false}
      />
      <p className="text-[11px] text-muted-foreground">
        {layout.nodes.length} changed {layout.nodes.length === 1 ? "note" : "notes"} ·{" "}
        {components.length} {components.length === 1 ? "group" : "groups"}
        {isolates > 0 ? ` · ${isolates} unlinked` : ""} · solid: unchanged link · thick: added link
        · dashed: removed link. Maps are listed under Changes, not drawn here.
      </p>
    </div>
  );
}
