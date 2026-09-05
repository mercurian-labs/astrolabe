import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2Icon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  cameraTween,
  centerOn,
  minimapPointToWorld,
  minimapProjection,
  minimapSize,
  visibleWorldRect,
  type MapBounds,
  type MapFitOptions,
  type MapFrameSize,
  type MapPoint,
  type MapTransform,
  type MapViewBox,
  type MinimapSize,
} from "./DagExplorer.logic";
import {
  fitSpatialMap,
  openingSpatialMapTransform,
  pointWithinBounds,
  spatialMapChromeVisibility,
  spatialMapViewBox,
  spatialMapWheelTransform,
} from "./SpatialMapCanvas.logic";

const CAMERA_TWEEN_DURATION = 250;
const DRAG_THRESHOLD = 4;

export interface SpatialMapRenderContext {
  readonly markerId: string;
}

export interface SpatialMapCanvasNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly render: (context: SpatialMapRenderContext) => ReactNode;
}

export interface SpatialMapCanvasEdge {
  readonly id: string;
  readonly from: MapPoint;
  readonly to: MapPoint;
  readonly label?: string;
  readonly render: (context: SpatialMapRenderContext) => ReactNode;
}

export function SpatialMapCanvas({
  ariaLabel,
  bounds,
  className,
  edges,
  nodes,
  fit,
  minOpeningZoom,
  showMinimap = true,
  focus = null,
}: {
  readonly ariaLabel: string;
  readonly bounds: MapBounds;
  readonly className?: string;
  readonly edges: ReadonlyArray<SpatialMapCanvasEdge>;
  readonly nodes: ReadonlyArray<SpatialMapCanvasNode>;
  /** Opt-in fit padding and zoom ceiling for small, label-heavy graphs. */
  readonly fit?: MapFitOptions;
  /**
   * The graph never opens below this zoom: a narrow frame shows part of the
   * graph at reading size, panned to its center, and Fit still gives the overview.
   */
  readonly minOpeningZoom?: number;
  /** A tiny graph gains nothing from an overview that covers its nodes. */
  readonly showMinimap?: boolean;
  /** When the id changes and the point is out of view, the camera pans to it without rezooming. */
  readonly focus?: { readonly id: string; readonly point: MapPoint } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panning: boolean;
  } | null>(null);
  const [frame, setFrame] = useState<MapFrameSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<MapTransform>({ x: 0, y: 0, zoom: 1 });
  const transformRef = useRef(transform);
  const [startTween, cancelTween] = useFiniteCameraTween();
  const markerId = `spatial-map-arrow-${useId().replaceAll(":", "")}`;
  const viewBox = useMemo(() => spatialMapViewBox(frame), [frame]);

  const applyTransform = useCallback((next: MapTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setFrame((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const fitPadding = fit?.padding;
  const fitMaxZoom = fit?.maxZoom;
  const fitOptions = useMemo<MapFitOptions>(
    () => ({
      ...(fitPadding === undefined ? {} : { padding: fitPadding }),
      ...(fitMaxZoom === undefined ? {} : { maxZoom: fitMaxZoom }),
    }),
    [fitMaxZoom, fitPadding],
  );

  useEffect(() => {
    if (frame.width <= 0 || frame.height <= 0) return;
    cancelTween();
    applyTransform(openingSpatialMapTransform(bounds, frame, fitOptions, minOpeningZoom));
  }, [
    applyTransform,
    bounds.maxX,
    bounds.maxY,
    bounds.minX,
    bounds.minY,
    cancelTween,
    fitOptions,
    frame,
    minOpeningZoom,
  ]);

  // Pans to a world point only when it is out of view, keeping the zoom, so the
  // picture stays put while the point is already on screen.
  const reveal = useCallback(
    (point: MapPoint) => {
      if (frame.width <= 0 || frame.height <= 0) return;
      const from = transformRef.current;
      if (pointWithinBounds(point, visibleWorldRect(from, viewBox, frame))) return;
      const tween = cameraTween(from, centerOn(point, from, viewBox), viewBox);
      startTween((progress) => applyTransform(tween(progress)));
    },
    [applyTransform, frame, startTween, viewBox],
  );

  const focusId = focus?.id ?? null;
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  useEffect(() => {
    const target = focusRef.current;
    if (focusId === null || target === null) return;
    reveal(target.point);
  }, [focusId, reveal]);

  const unitsPerPixel = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return 1;
    return Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  }, [viewBox.height, viewBox.width]);

  const clientToViewBox = useCallback(
    (clientX: number, clientY: number): MapPoint => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect === undefined || rect.width === 0 || rect.height === 0) {
        return { x: viewBox.width / 2, y: viewBox.height / 2 };
      }
      return {
        x: ((clientX - rect.left) / rect.width) * viewBox.width,
        y: ((clientY - rect.top) / rect.height) * viewBox.height,
      };
    },
    [viewBox.height, viewBox.width],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
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
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
      cancelTween();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already have ended; panning can continue without capture.
      }
      drag.panning = true;
    }
    const scale = unitsPerPixel();
    const next = {
      ...transformRef.current,
      x: transformRef.current.x + (event.clientX - drag.x) * scale,
      y: transformRef.current.y + (event.clientY - drag.y) * scale,
    };
    drag.x = event.clientX;
    drag.y = event.clientY;
    applyTransform(next);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    try {
      if (drag.panning && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released capture.
    }
    dragRef.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelTween();
      applyTransform(
        spatialMapWheelTransform({
          event,
          pointer: clientToViewBox(event.clientX, event.clientY),
          transform: transformRef.current,
          unitsPerPixel: unitsPerPixel(),
          viewBox,
        }),
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [applyTransform, cancelTween, clientToViewBox, unitsPerPixel, viewBox]);

  const recenterFromMinimap = (point: MapPoint, animate: boolean) => {
    const from = transformRef.current;
    const target = centerOn(point, from, viewBox);
    if (!animate) {
      cancelTween();
      applyTransform(target);
      return;
    }
    const tween = cameraTween(from, target, viewBox);
    startTween((progress) => applyTransform(tween(progress)));
  };

  const fitToView = () => {
    const from = transformRef.current;
    const tween = cameraTween(from, fitSpatialMap(bounds, frame, fitOptions), viewBox);
    startTween((progress) => applyTransform(tween(progress)));
  };

  const overviewSize = useMemo(() => minimapSize(frame.width, frame.height), [frame]);
  const renderContext = useMemo<SpatialMapRenderContext>(() => ({ markerId }), [markerId]);
  const chrome = spatialMapChromeVisibility(transform, bounds, frame, undefined, {
    ...fitOptions,
    minimap: showMinimap,
  });

  return (
    <div
      className={cn(
        "relative h-96 min-h-72 overflow-hidden rounded-md border border-border bg-muted/10",
        className,
      )}
      ref={containerRef}
    >
      <svg
        aria-label={ariaLabel}
        className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      >
        <title>{ariaLabel}</title>
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
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
          {edges.map((edge) => (
            <g key={edge.id}>{edge.render(renderContext)}</g>
          ))}
          {/* Keyboard focus can land on a node the opening view left off screen; reveal it. */}
          {nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x - node.width / 2} ${node.y - node.height / 2})`}
              onFocus={() => reveal({ x: node.x, y: node.y })}
            >
              {node.render(renderContext)}
            </g>
          ))}
        </g>
      </svg>
      {chrome.fitButton || chrome.minimap ? (
        <div className="absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1">
          {chrome.fitButton ? (
            <div className="flex items-center rounded-md border border-border bg-background/90 p-0.5 shadow-sm">
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
            </div>
          ) : null}
          {chrome.minimap ? (
            <SpatialMapMinimap
              ariaLabel={`${ariaLabel} minimap`}
              bounds={bounds}
              edges={edges}
              frame={frame}
              nodes={nodes}
              size={overviewSize}
              transform={transform}
              viewBox={viewBox}
              onCenter={recenterFromMinimap}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SpatialMapMinimap({
  ariaLabel,
  bounds,
  edges,
  frame,
  nodes,
  onCenter,
  size,
  transform,
  viewBox,
}: {
  readonly ariaLabel: string;
  readonly bounds: MapBounds;
  readonly edges: ReadonlyArray<SpatialMapCanvasEdge>;
  readonly frame: MapFrameSize;
  readonly nodes: ReadonlyArray<SpatialMapCanvasNode>;
  readonly onCenter: (point: MapPoint, animate: boolean) => void;
  readonly size: MinimapSize;
  readonly transform: MapTransform;
  readonly viewBox: MapViewBox;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    moved: boolean;
  } | null>(null);
  const projection = useMemo(() => minimapProjection(bounds, size), [bounds, size]);
  const visible = visibleWorldRect(transform, viewBox, frame);
  const visibleTopLeft = projection.project({ x: visible.minX, y: visible.minY });
  const visibleBottomRight = projection.project({ x: visible.maxX, y: visible.maxY });

  const clientToMinimap = (clientX: number, clientY: number): MapPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return { x: size.width / 2, y: size.height / 2 };
    }
    return {
      x: ((clientX - rect.left) / rect.width) * size.width,
      y: ((clientY - rect.top) / rect.height) * size.height,
    };
  };

  const centerAtPointer = (event: ReactPointerEvent<SVGSVGElement>, animate: boolean) => {
    onCenter(
      minimapPointToWorld(clientToMinimap(event.clientX, event.clientY), projection),
      animate,
    );
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A clean click still works if capture is unavailable.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      drag.moved =
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD;
    }
    if (drag.moved) centerAtPointer(event, false);
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>, flyOnClick: boolean) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (drag.moved) centerAtPointer(event, false);
    else if (flyOnClick) centerAtPointer(event, true);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released capture.
    }
    dragRef.current = null;
  };

  return (
    <svg
      aria-label={ariaLabel}
      className="pointer-events-auto cursor-crosshair rounded-md border border-border bg-background/90 shadow-sm"
      height={size.height}
      onPointerCancel={(event) => finishDrag(event, false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, true)}
      ref={svgRef}
      viewBox={`0 0 ${size.width} ${size.height}`}
      width={size.width}
    >
      <title>{ariaLabel}</title>
      {edges.map((edge) => {
        const from = projection.project(edge.from);
        const to = projection.project(edge.to);
        return (
          <line
            className="stroke-border"
            key={edge.id}
            strokeWidth={0.75}
            x1={from.x}
            x2={to.x}
            y1={from.y}
            y2={to.y}
          />
        );
      })}
      {nodes.map((node) => {
        const point = projection.project(node);
        return (
          <circle className="fill-muted-foreground" cx={point.x} cy={point.y} key={node.id} r={2} />
        );
      })}
      <rect
        className="fill-primary/10 stroke-primary"
        height={Math.max(visibleBottomRight.y - visibleTopLeft.y, 0)}
        strokeWidth={1}
        width={Math.max(visibleBottomRight.x - visibleTopLeft.x, 0)}
        x={visibleTopLeft.x}
        y={visibleTopLeft.y}
      />
    </svg>
  );
}

function useFiniteCameraTween() {
  const frameRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const start = useCallback(
    (render: (progress: number) => void) => {
      cancel();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        render(1);
        return;
      }
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / CAMERA_TWEEN_DURATION, 1);
        render(progress);
        if (progress >= 1) {
          frameRef.current = null;
          return;
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);
  return [start, cancel] as const;
}
