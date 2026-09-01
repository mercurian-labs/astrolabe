import type { CatalogEntry } from "../../design-system/catalog";
import {
  SpatialMapCanvas,
  type SpatialMapCanvasEdge,
  type SpatialMapCanvasNode,
} from "./SpatialMapCanvas";

const nodeWidth = 120;
const nodeHeight = 40;
const fixturePoints = [
  { id: "observe", label: "Observe", x: 100, y: 100 },
  { id: "orient", label: "Orient", x: 320, y: 180 },
  { id: "act", label: "Act", x: 540, y: 100 },
] as const;

const fixtureNodes: ReadonlyArray<SpatialMapCanvasNode> = fixturePoints.map((node) => ({
  ...node,
  width: nodeWidth,
  height: nodeHeight,
  render: () => (
    <g
      aria-label={node.label}
      className="outline-none focus-visible:[&_rect]:stroke-primary"
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.preventDefault();
      }}
    >
      <rect
        className="fill-background stroke-border"
        height={nodeHeight}
        rx="6"
        width={nodeWidth}
      />
      <text
        className="fill-primary text-xs font-medium"
        dominantBaseline="middle"
        textAnchor="middle"
        x={nodeWidth / 2}
        y={nodeHeight / 2}
      >
        {node.label}
      </text>
    </g>
  ),
}));

const fixtureEdges: ReadonlyArray<SpatialMapCanvasEdge> = [
  { id: "observe-orient", from: fixturePoints[0], to: fixturePoints[1], label: "frames" },
  { id: "orient-act", from: fixturePoints[1], to: fixturePoints[2], label: "guides" },
].map((edge) => ({
  ...edge,
  render: ({ markerId }) => (
    <>
      <line
        className="stroke-muted-foreground"
        markerEnd={`url(#${markerId})`}
        strokeWidth="1.25"
        x1={edge.from.x}
        x2={edge.to.x}
        y1={edge.from.y}
        y2={edge.to.y}
      />
      <text
        className="fill-muted-foreground text-[10px]"
        textAnchor="middle"
        x={(edge.from.x + edge.to.x) / 2}
        y={(edge.from.y + edge.to.y) / 2 - 8}
      >
        {edge.label}
      </text>
    </>
  ),
}));

export const SPATIAL_MAP_CANVAS_CATALOG_ENTRIES = [
  {
    id: "spatial-map-canvas",
    section: "checkpoint-graph",
    group: "SpatialMapCanvas",
    title: "Spatial map canvas",
    description: "A measured graph camera with fit, pan, zoom, and minimap navigation.",
    sourcePath: "src/components/mercurian/SpatialMapCanvas.tsx",
    render: () => (
      <SpatialMapCanvas
        ariaLabel="Spatial map fixture"
        bounds={{ minX: 0, minY: 0, maxX: 640, maxY: 300 }}
        className="h-[360px]"
        edges={fixtureEdges}
        nodes={fixtureNodes}
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
  },
] satisfies ReadonlyArray<CatalogEntry>;
