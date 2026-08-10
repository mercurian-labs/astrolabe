import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";
import {
  CircleDotIcon,
  FileTextIcon,
  GitForkIcon,
  LocateFixedIcon,
  Maximize2Icon,
  MessageSquareIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  cameraTween,
  centerOn,
  detailFor,
  edgeRibbon,
  fitTransform,
  labelVisible,
  radiusFor,
  wheelIntent,
  zoomAtPoint,
  type MapTransform,
  type MapViewBox,
} from "./DagExplorer.logic";
import {
  ancestorClosure,
  descendantClosure,
  navigatorLayout,
  planCommitSummary,
  spatialLayout,
  type NavigatorLayout,
  type PlanGraph,
  type SpatialLayout,
  type SpatialNode,
  type SpatialPoint,
} from "./PlanGraph.logic";

const EXPLORER_VIEW_STORAGE_KEY = "mercurian:dag-explorer-view:v1";
const ExplorerView = Schema.Literals(["navigator", "graph"]);
type ExplorerView = typeof ExplorerView.Type;
const DEFAULT_EXPLORER_VIEW: ExplorerView = "navigator";

/** One navigator row, so the rail's geometry and the list's agree. */
const ROW_HEIGHT = 34;
const LANE_WIDTH = 16;
const RAIL_INSET = 12;

const MAP_PADDING = 64;
const MAP_TWEEN_DURATION = 250;
/** How far the pointer has to travel before a press counts as a pan. */
const DRAG_THRESHOLD = 4;

/**
 * The DAG explorer: the plan's whole history, in the two readings the design
 * settled on.
 *
 * The **Navigator** is the git-graph — commit rows in append order with a rail
 * drawing lanes and edges. Rows in time order are the easier reading to move
 * through, and rows are the thing you pick. The **Graph** is the spatial map:
 * every commit a node, every parent edge drawn, the whole shape visible at
 * once — for seeing structure, not for walking it.
 *
 * Neither view renders a commit twice. A merge is drawn once in both: in the
 * navigator where its lanes reunite, in the map as one node with an edge from
 * each parent.
 *
 * The explorer carries no subscription of its own. Every commit it draws comes
 * from the timeline the planning space already holds, which is why a commit
 * landing in another window shows up here, in the conversation, and in the
 * artifact at the same moment.
 */
export function DagExplorer({
  graph,
  anchoredCommitId,
  onSelect,
}: {
  readonly graph: PlanGraph;
  /** Where the surface is looking, or `null` when it is looking at now. */
  readonly anchoredCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const [view, setView] = useLocalStorage(
    EXPLORER_VIEW_STORAGE_KEY,
    DEFAULT_EXPLORER_VIEW,
    ExplorerView,
  );
  // Standing at the tip is standing at the latest commit; an anchor is what
  // moves the highlight anywhere else.
  const currentCommitId = anchoredCommitId ?? graph.latest;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <h2 className="text-sm font-medium text-foreground">History</h2>
        <span className="min-w-0 flex-1" />
        <ToggleGroup
          className="shrink-0"
          size="xs"
          value={[view]}
          variant="outline"
          onValueChange={(next) => {
            const chosen = next[0];
            // The switch is a choice between two views, never a way to have
            // neither: re-pressing the active one leaves it pressed.
            if (chosen === "navigator" || chosen === "graph") {
              setView(chosen);
            }
          }}
        >
          <Toggle aria-label="Navigator view" value="navigator">
            Navigator
          </Toggle>
          <Toggle aria-label="Graph view" value="graph">
            Graph
          </Toggle>
        </ToggleGroup>
      </div>
      {graph.nodes.length === 0 ? (
        <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
          <p className="text-sm text-muted-foreground/70">Nothing has happened here yet.</p>
        </div>
      ) : view === "navigator" ? (
        <NavigatorView
          currentCommitId={currentCommitId}
          layout={navigatorLayout(graph)}
          onSelect={onSelect}
        />
      ) : (
        <GraphView currentCommitId={currentCommitId} graph={graph} onSelect={onSelect} />
      )}
    </section>
  );
}

/**
 * The navigator: the git-graph, as rows plus an inline SVG rail behind them.
 * Lanes and edges are drawn once from `navigatorLayout` — no canvas, no
 * animation loop, and no graph dependency for a history a person can read.
 */
function NavigatorView({
  layout,
  currentCommitId,
  onSelect,
}: {
  readonly layout: NavigatorLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const scrollRef = useCurrentRowScroll(currentCommitId);
  const railWidth = RAIL_INSET * 2 + Math.max(0, layout.laneCount - 1) * LANE_WIDTH;
  const laneX = (lane: number) => RAIL_INSET + lane * LANE_WIDTH;
  const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      <div className="relative">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
          height={layout.rows.length * ROW_HEIGHT}
          width={railWidth}
        >
          {layout.edges.map((edge) => (
            <path
              className="fill-none stroke-border"
              d={railPath(
                laneX(edge.fromLane),
                rowY(edge.fromRow),
                laneX(edge.toLane),
                rowY(edge.toRow),
              )}
              key={`${edge.fromCommitId}->${edge.toCommitId}`}
              strokeWidth={1.5}
            />
          ))}
          {layout.rows.map((row) => (
            <circle
              // Solid is shared history, hollow is private work still your own.
              className={cn(
                "stroke-muted-foreground",
                row.item.published ? "fill-muted-foreground" : "fill-background",
              )}
              cx={laneX(row.lane)}
              cy={rowY(row.row)}
              key={row.commitId}
              r={4}
              strokeWidth={1.5}
            />
          ))}
        </svg>
        <ol className="flex flex-col">
          {layout.rows.map((row) => (
            <li key={row.commitId} style={{ paddingLeft: `${railWidth}px` }}>
              <CommitRow
                isCurrent={row.commitId === currentCommitId}
                item={row.item}
                ref={row.commitId === currentCommitId ? scrollRef : undefined}
                trailing={
                  row.isBranchPoint ? (
                    <GitForkIcon className="size-3 shrink-0 text-muted-foreground/70" />
                  ) : null
                }
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * The spatial map: the whole DAG at once, laid out by `spatialLayout` and drawn
 * as one static SVG.
 *
 * The layout is solved synchronously to a fixed budget and rendered once —
 * nothing repaints at rest, and there is no simulation ticking in the
 * background. Pan and zoom are a single transform on one `<g>`, so a gesture
 * moves the map without re-solving it.
 *
 * `prior` positions live here, in per-window state like the position anchor
 * itself: when a commit lands the map drifts locally instead of rearranging
 * itself under someone who was reading it.
 */
function GraphView({
  graph,
  currentCommitId,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const priorRef = useRef<ReadonlyMap<string, SpatialPoint> | undefined>(undefined);
  const layout = useMemo(() => spatialLayout(graph, priorRef.current), [graph]);
  useEffect(() => {
    priorRef.current = layout.positions;
  }, [layout]);

  // Deliberately not keyed on the layout: a commit landing must not throw away
  // the pan and zoom of whoever is reading the map.
  return (
    <SpatialMap
      currentCommitId={currentCommitId}
      graph={graph}
      layout={layout}
      onSelect={onSelect}
    />
  );
}

function SpatialMap({
  graph,
  layout,
  currentCommitId,
  onSelect,
}: {
  readonly graph: PlanGraph;
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly onSelect: (commitId: MercurianCommitId) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  const [hovered, setHovered] = useState<MercurianCommitId | null>(null);
  const [focused, setFocused] = useState<MercurianCommitId | null>(null);
  const [transform, setTransform] = useState<MapTransform>({ x: 0, y: 0, zoom: 1 });
  const transformRef = useRef(transform);
  const [renderLayout, setRenderLayout] = useState(() => settledSpatialLayout(layout));
  const renderLayoutRef = useRef(renderLayout);
  const solvedLayoutRef = useRef(layout);
  const [startTween, cancelTween] = useTween();

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const applyTransform = useCallback((next: MapTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const applyRenderLayout = useCallback((next: AnimatedSpatialLayout) => {
    renderLayoutRef.current = next;
    setRenderLayout(next);
  }, []);

  useEffect(() => {
    if (solvedLayoutRef.current === layout) return;
    const from = renderLayoutRef.current;
    solvedLayoutRef.current = layout;
    startTween("layout", (progress) => {
      applyRenderLayout(interpolateSpatialLayout(from, layout, progress));
    });
  }, [applyRenderLayout, layout, startTween]);

  const viewBox = useMemo<MapViewBox>(
    () => ({
      x: layout.bounds.minX - MAP_PADDING,
      y: layout.bounds.minY - MAP_PADDING,
      width: layout.bounds.maxX - layout.bounds.minX + MAP_PADDING * 2,
      height: layout.bounds.maxY - layout.bounds.minY + MAP_PADDING * 2,
    }),
    [layout.bounds],
  );

  // Where you stand comes to the middle when the position moves — the map is
  // for orientation, and orientation starts with finding yourself on it.
  const here = currentCommitId === null ? undefined : layout.positions.get(currentCommitId);
  const hereX = here?.x;
  const hereY = here?.y;
  useEffect(() => {
    if (hereX === undefined || hereY === undefined) return;
    const from = transformRef.current;
    const tween = cameraTween(from, centerOn({ x: hereX, y: hereY }, from, viewBox));
    startTween("camera", (progress) => applyTransform(tween(progress)));
  }, [applyTransform, hereX, hereY, startTween, viewBox]);

  const unitsPerPixel = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return 1;
    // `preserveAspectRatio` letterboxes, so the tighter axis sets the scale.
    return Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  }, [viewBox.height, viewBox.width]);

  const clientToViewBox = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect === undefined || rect.width === 0 || rect.height === 0) {
        return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
      }
      const scale = Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
      const renderedWidth = viewBox.width / scale;
      const renderedHeight = viewBox.height / scale;
      const insetX = (rect.width - renderedWidth) / 2;
      const insetY = (rect.height - renderedHeight) / 2;
      return {
        x: viewBox.x + (clientX - rect.left - insetX) * scale,
        y: viewBox.y + (clientY - rect.top - insetY) * scale,
      };
    },
    [viewBox],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    // Deliberately not capturing yet. Capturing on press retargets the click
    // to this element, and picking a commit would stop working — the map has
    // to stay clickable, not just draggable.
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panning: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (!drag.panning) {
      // A press that never moves is a pick, not a pan.
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No active pointer to capture; panning still works without it.
      }
      drag.panning = true;
    }
    const scale = unitsPerPixel();
    const dx = (event.clientX - drag.x) * scale;
    const dy = (event.clientY - drag.y) * scale;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    try {
      if (drag.panning && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released; harmless.
    }
    dragRef.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelTween("camera");
      const intent = wheelIntent({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      if (intent.kind === "pan") {
        const scale = unitsPerPixel();
        setTransform((current) => ({
          ...current,
          x: current.x - intent.dx * scale,
          y: current.y - intent.dy * scale,
        }));
        return;
      }

      const point = clientToViewBox(event.clientX, event.clientY);
      setTransform((current) => {
        const next = zoomAtPoint(current, intent.factor, point, viewBox);
        transformRef.current = next;
        return next;
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [cancelTween, clientToViewBox, unitsPerPixel, viewBox]);

  const emphasisId = hovered ?? focused;
  const lineage = useMemo(() => {
    if (emphasisId === null || !graph.byId.has(emphasisId)) return null;
    return new Set([
      ...ancestorClosure(graph, emphasisId),
      ...descendantClosure(graph, emphasisId),
    ]);
  }, [emphasisId, graph]);
  const currentPath = useMemo(
    () => (currentCommitId === null ? new Set<string>() : ancestorClosure(graph, currentCommitId)),
    [currentCommitId, graph],
  );
  const detail = detailFor(transform.zoom);

  const fitToView = () => {
    const from = transformRef.current;
    const tween = cameraTween(from, fitTransform(layout.bounds, viewBox));
    startTween("camera", (progress) => applyTransform(tween(progress)));
  };

  const jumpToCurrent = () => {
    if (hereX === undefined || hereY === undefined) return;
    const from = transformRef.current;
    const tween = cameraTween(from, centerOn({ x: hereX, y: hereY }, from, viewBox));
    startTween("camera", (progress) => applyTransform(tween(progress)));
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <svg
        className="size-full cursor-grab touch-none active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
          {renderLayout.edges.map((edge) => {
            const isCurrentPath =
              currentPath.has(edge.fromCommitId) && currentPath.has(edge.toCommitId);
            const isDimmed =
              lineage !== null &&
              (!lineage.has(edge.fromCommitId) || !lineage.has(edge.toCommitId));
            return (
              <path
                className={cn(
                  "transition-opacity duration-150",
                  isCurrentPath ? "fill-foreground" : "fill-border",
                  isDimmed && "opacity-[0.18]",
                )}
                d={edgeRibbon(
                  edge.fromX,
                  edge.fromY,
                  edge.toX,
                  edge.toY,
                  isCurrentPath ? 3.5 : 2.5,
                  isCurrentPath ? 1.5 : 1,
                )}
                key={`${edge.fromCommitId}->${edge.toCommitId}`}
              />
            );
          })}
          {renderLayout.nodes.map((node) => {
            const isCurrent = node.commitId === currentCommitId;
            const radius = radiusFor(node);
            const showLabel = labelVisible(transform.zoom, node, isCurrent);
            const isDimmed = lineage !== null && !lineage.has(node.commitId);
            const Glyph = commitGlyph(node.item);
            return (
              <g
                // A node is a control, and a circle has no accessible name of
                // its own: without this the map is unreadable to a screen
                // reader and unreachable by keyboard.
                aria-label={planCommitSummary(node.item)}
                aria-current={isCurrent ? "true" : undefined}
                className="cursor-pointer transition-opacity duration-150"
                key={node.commitId}
                onClick={() => onSelect(node.commitId)}
                onBlur={() => setFocused((at) => (at === node.commitId ? null : at))}
                onFocus={() => setFocused(node.commitId)}
                onPointerEnter={() => setHovered(node.commitId)}
                onPointerLeave={() => setHovered((at) => (at === node.commitId ? null : at))}
                role="button"
                style={{ opacity: node.opacity * (isDimmed ? 0.18 : 1) }}
                tabIndex={0}
                transform={`translate(${node.x} ${node.y}) scale(${node.scale}) translate(${-node.x} ${-node.y})`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.commitId);
                  }
                }}
              >
                {isCurrent ? (
                  <circle
                    className="fill-none stroke-primary"
                    cx={node.x}
                    cy={node.y}
                    r={radius + 4}
                    strokeWidth={2}
                  />
                ) : null}
                <circle
                  className={cn(
                    // Same distinction the navigator's dots draw: solid is
                    // shared history, hollow is private work still your own.
                    node.item.published
                      ? "fill-muted-foreground stroke-none"
                      : "fill-background stroke-muted-foreground",
                  )}
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  strokeWidth={1.5}
                />
                {detail === "dot" ? null : (
                  <Glyph
                    className={cn(
                      "pointer-events-none",
                      node.item.published ? "text-background" : "text-muted-foreground",
                    )}
                    height={radius}
                    strokeWidth={3}
                    width={radius}
                    x={node.x - radius / 2}
                    y={node.y - radius / 2}
                  />
                )}
                {showLabel ? (
                  <text
                    className={cn(
                      "pointer-events-none text-[11px]",
                      detail === "labeled" ? "fill-foreground" : "fill-foreground/70",
                    )}
                    x={node.x + radius + 8}
                    y={node.y + 4}
                  >
                    {planCommitSummary(node.item)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-2 bottom-2 flex items-center rounded-md border border-border bg-background/90 p-0.5 shadow-sm">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Fit graph to view"
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={fitToView}
              />
            }
          >
            <Maximize2Icon />
          </TooltipTrigger>
          <TooltipPopup>Fit graph to view</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Jump to current commit"
                disabled={hereX === undefined || hereY === undefined}
                size="icon-xs"
                type="button"
                variant="ghost"
                onClick={jumpToCurrent}
              />
            }
          >
            <LocateFixedIcon />
          </TooltipTrigger>
          <TooltipPopup>Jump to current commit</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

interface ActiveTween {
  readonly startedAt: number;
  readonly duration: number;
  readonly render: (progress: number) => void;
}

/** One finite frame loop shared by every map transition. */
function useTween() {
  const activeRef = useRef(new Map<string, ActiveTween>());
  const frameRef = useRef<number | null>(null);

  const tick = useCallback(function tick(now: number) {
    for (const [key, tween] of activeRef.current) {
      const progress = Math.min((now - tween.startedAt) / tween.duration, 1);
      tween.render(progress);
      if (progress >= 1) activeRef.current.delete(key);
    }

    if (activeRef.current.size === 0) {
      frameRef.current = null;
      return;
    }
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(
    (key: string, render: (progress: number) => void) => {
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : MAP_TWEEN_DURATION;
      activeRef.current.delete(key);
      if (duration === 0) {
        render(1);
        return;
      }

      activeRef.current.set(key, { duration, render, startedAt: performance.now() });
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  const cancel = useCallback((key: string) => {
    activeRef.current.delete(key);
    if (activeRef.current.size > 0 || frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      activeRef.current.clear();
    },
    [],
  );

  return [start, cancel] as const;
}

type AnimatedSpatialNode = SpatialNode & {
  readonly opacity: number;
  readonly scale: number;
};

type AnimatedSpatialLayout = Omit<SpatialLayout, "nodes"> & {
  readonly nodes: ReadonlyArray<AnimatedSpatialNode>;
};

function settledSpatialLayout(layout: SpatialLayout): AnimatedSpatialLayout {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => ({ ...node, opacity: 1, scale: 1 })),
  };
}

function interpolateSpatialLayout(
  from: AnimatedSpatialLayout,
  to: SpatialLayout,
  progress: number,
): AnimatedSpatialLayout {
  if (progress >= 1) return settledSpatialLayout(to);
  const eased = 1 - (1 - progress) ** 3;
  const fromById = new Map(from.nodes.map((node) => [node.commitId as string, node]));
  const positions = new Map<string, SpatialPoint>();
  const nodes = to.nodes.map((node): AnimatedSpatialNode => {
    const previous = fromById.get(node.commitId);
    const x = previous === undefined ? node.x : previous.x + (node.x - previous.x) * eased;
    const y = previous === undefined ? node.y : previous.y + (node.y - previous.y) * eased;
    positions.set(node.commitId, { x, y });
    return {
      ...node,
      x,
      y,
      opacity: previous === undefined ? eased : previous.opacity + (1 - previous.opacity) * eased,
      scale: previous === undefined ? eased : previous.scale + (1 - previous.scale) * eased,
    };
  });
  const edges = to.edges.map((edge) => {
    const fromPoint = positions.get(edge.fromCommitId)!;
    const toPoint = positions.get(edge.toCommitId)!;
    return {
      ...edge,
      fromX: fromPoint.x,
      fromY: fromPoint.y,
      toX: toPoint.x,
      toY: toPoint.y,
    };
  });
  return { ...to, edges, nodes, positions };
}

/**
 * What a commit looks like at a glance. One glyph per kind, shared by the map
 * and the list so a commit reads the same in both.
 */
function commitGlyph(item: PlanTimelineItem) {
  if (item._tag === "plan-revision") return FileTextIcon;
  if (item._tag === "issue-revision") return CircleDotIcon;
  return MessageSquareIcon;
}

/**
 * One commit, as the navigator shows it: what it was, what it said, and when.
 *
 * Published work reads solid and private work muted — the same distinction the
 * dots draw, carried into the row so the text makes it too.
 */
function CommitRow({
  item,
  isCurrent,
  trailing,
  onSelect,
  ref,
}: {
  readonly item: PlanTimelineItem;
  readonly isCurrent: boolean;
  readonly trailing: ReactNode;
  readonly onSelect: (commitId: MercurianCommitId) => void;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}) {
  const Glyph = commitGlyph(item);

  return (
    <button
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 text-left ring-ring outline-hidden focus-visible:ring-2",
        "hover:bg-accent/50",
        isCurrent && "bg-accent",
      )}
      ref={ref}
      style={{ height: `${ROW_HEIGHT}px` }}
      type="button"
      onClick={() => onSelect(item.commitId)}
    >
      <Glyph
        className={cn(
          "size-3.5 shrink-0",
          item.published ? "text-foreground" : "text-muted-foreground/70",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          item.published ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {planCommitSummary(item)}
      </span>
      {trailing}
      <span className="shrink-0 text-[11px] text-muted-foreground/70">
        {formatRelativeTimeLabel(item.createdAt)}
      </span>
    </button>
  );
}

/**
 * Bring where you stand into view when the navigator opens and whenever the
 * position moves. One scroll, not a smooth-scrolling loop.
 */
function useCurrentRowScroll(currentCommitId: MercurianCommitId | null) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [currentCommitId]);

  return ref;
}

/**
 * Parent to child on the rail: straight down its own lane, and a curve across
 * when the child sits on another one.
 */
function railPath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}
