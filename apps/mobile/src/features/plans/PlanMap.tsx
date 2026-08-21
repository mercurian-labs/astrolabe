import {
  ancestorClosure,
  descendantClosure,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
  type SpatialLayout,
} from "@t3tools/client-runtime/state/plan-graph";
import {
  cameraTween,
  centerOn,
  detailFor,
  edgeWidthFor,
  fitTransform,
  interpolateSpatialLayout,
  minimapProjection,
  minimapSize,
  planNodeStatusDots,
  radiusFor,
  settledSpatialLayout,
  type AnimatedSpatialLayout,
  type MapDetail,
  type MapTransform,
} from "@t3tools/client-runtime/state/plan-map";
import type { MercurianCommitId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  View,
  type ColorValue,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, G, Path, Polyline, Rect } from "react-native-svg";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { hitTestNode } from "./planMap.logic";
import { panBy, pinchAround } from "./planMap.gestures";
import { mirrorPlanMapGlyph, PLAN_MAP_GLYPH_PATHS, planMapGlyphFor } from "./planMapGlyphs";

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const TWEEN_DURATION = 250;
const STATUS_COLORS: Readonly<Record<string, string>> = {
  ready: "#10b981",
  "stale-spec": "#f59e0b",
  "stale-plan": "#f97316",
};

export function PlanMap(props: {
  readonly graph: PlanGraph;
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly selectedCommitId: MercurianCommitId | null;
  readonly readyNodeIds: ReadonlySet<string>;
  readonly staleSpecNodeIds: ReadonlySet<string>;
  readonly stalePlanNodeIds: ReadonlySet<string>;
  readonly onOpenNode: (commitId: MercurianCommitId) => void;
}) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [detail, setDetail] = useState<MapDetail>("glyph");
  const [showMinimap, setShowMinimap] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [renderLayout, setRenderLayout] = useState<AnimatedSpatialLayout>(() =>
    settledSpatialLayout(props.layout),
  );
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const zoom = useSharedValue(1);
  const panStart = useSharedValue<MapTransform>({ x: 0, y: 0, zoom: 1 });
  const pinchStart = useSharedValue<MapTransform>({ x: 0, y: 0, zoom: 1 });
  const cameraFrameRef = useRef<number | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
    const from = renderLayout;
    if (reduceMotion) {
      setRenderLayout(settledSpatialLayout(props.layout));
      return;
    }
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / TWEEN_DURATION, 1);
      setRenderLayout(interpolateSpatialLayout(from, props.layout, progress));
      if (progress < 1) layoutFrameRef.current = requestAnimationFrame(tick);
      else layoutFrameRef.current = null;
    };
    layoutFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
    };
  }, [props.layout, reduceMotion]);

  const applyTransform = useCallback(
    (next: MapTransform) => {
      tx.value = next.x;
      ty.value = next.y;
      zoom.value = next.zoom;
    },
    [tx, ty, zoom],
  );

  const flyTo = useCallback(
    (target: MapTransform) => {
      if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
      const viewBox = { x: 0, y: 0, ...frame };
      const from = { x: tx.value, y: ty.value, zoom: zoom.value };
      if (reduceMotion || frame.width <= 0 || frame.height <= 0) {
        applyTransform(target);
        return;
      }
      const tween = cameraTween(from, target, viewBox);
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / TWEEN_DURATION, 1);
        applyTransform(tween(progress));
        if (progress < 1) cameraFrameRef.current = requestAnimationFrame(tick);
        else cameraFrameRef.current = null;
      };
      cameraFrameRef.current = requestAnimationFrame(tick);
    },
    [applyTransform, frame, reduceMotion, tx, ty, zoom],
  );

  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (frame.width <= 0 || frame.height <= 0 || initializedRef.current) return;
    applyTransform(fitTransform(props.layout.bounds, { x: 0, y: 0, ...frame }));
    initializedRef.current = true;
  }, [applyTransform, frame, props.layout.bounds]);

  useAnimatedReaction(
    () => detailFor(zoom.value),
    (next, previous) => {
      if (next !== previous) runOnJS(setDetail)(next);
    },
  );
  useAnimatedReaction(
    () => {
      if (frame.width <= 0 || frame.height <= 0) return false;
      return (
        props.layout.bounds.minX * zoom.value + tx.value < 0 ||
        props.layout.bounds.minY * zoom.value + ty.value < 0 ||
        props.layout.bounds.maxX * zoom.value + tx.value > frame.width ||
        props.layout.bounds.maxY * zoom.value + ty.value > frame.height
      );
    },
    (next, previous) => {
      if (next !== previous) runOnJS(setShowMinimap)(next);
    },
    [frame, props.layout.bounds],
  );

  const worldAnimatedProps = useAnimatedProps(() => ({
    transform: `translate(${tx.value} ${ty.value}) scale(${zoom.value})`,
  }));

  const handleTap = useCallback(
    (x: number, y: number, transformX: number, transformY: number, transformZoom: number) => {
      const hit = hitTestNode(
        props.graph,
        props.layout,
        { x: transformX, y: transformY, zoom: transformZoom },
        { x, y },
      );
      if (hit !== null) props.onOpenNode(hit);
    },
    [props],
  );

  const mapGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(2)
      .minDistance(4)
      .onBegin(() => {
        panStart.value = { x: tx.value, y: ty.value, zoom: zoom.value };
      })
      .onUpdate((event) => {
        const next = panBy(panStart.value, { x: event.translationX, y: event.translationY });
        tx.value = next.x;
        ty.value = next.y;
      });
    const pinch = Gesture.Pinch()
      .onBegin(() => {
        pinchStart.value = { x: tx.value, y: ty.value, zoom: zoom.value };
      })
      .onUpdate((event) => {
        const next = pinchAround(pinchStart.value, event.scale, {
          x: event.focalX,
          y: event.focalY,
        });
        tx.value = next.x;
        ty.value = next.y;
        zoom.value = next.zoom;
      });
    const tap = Gesture.Tap()
      .maxDistance(8)
      .onEnd((event, success) => {
        if (success) runOnJS(handleTap)(event.x, event.y, tx.value, ty.value, zoom.value);
      });
    return Gesture.Exclusive(Gesture.Simultaneous(pan, pinch), tap);
  }, [handleTap, panStart, pinchStart, tx, ty, zoom]);

  const currentPath = useMemo(
    () =>
      props.currentCommitId === null
        ? new Set<string>()
        : ancestorClosure(props.graph, props.currentCommitId),
    [props.currentCommitId, props.graph],
  );
  const selectedLineage = useMemo(() => {
    if (props.selectedCommitId === null) return null;
    return new Set([
      ...ancestorClosure(props.graph, props.selectedCommitId),
      ...descendantClosure(props.graph, props.selectedCommitId),
    ]);
  }, [props.graph, props.selectedCommitId]);
  const screen = useThemeColor("--color-screen");
  const muted = useThemeColor("--color-foreground-muted");
  const foreground = useThemeColor("--color-foreground");
  const border = useThemeColor("--color-border");
  const primary = useThemeColor("--color-primary");

  const onLayout = (event: LayoutChangeEvent) => setFrame(event.nativeEvent.layout);
  const fit = () => flyTo(fitTransform(props.layout.bounds, { x: 0, y: 0, ...frame }));
  const jumpToCurrent = () => {
    if (props.currentCommitId === null) return;
    const point = props.layout.positions.get(props.currentCommitId);
    if (point !== undefined)
      flyTo(
        centerOn(point, { x: tx.value, y: ty.value, zoom: zoom.value }, { x: 0, y: 0, ...frame }),
      );
  };

  return (
    <View className="flex-1 bg-screen" onLayout={onLayout}>
      <GestureDetector gesture={mapGesture}>
        <Svg height="100%" width="100%">
          <AnimatedG animatedProps={worldAnimatedProps}>
            {renderLayout.edges.map((edge) => {
              const emphasized =
                currentPath.has(edge.fromCommitId) && currentPath.has(edge.toCommitId);
              const selected =
                selectedLineage === null ||
                (selectedLineage.has(edge.fromCommitId) && selectedLineage.has(edge.toCommitId));
              return (
                <Polyline
                  key={`${edge.fromCommitId}:${edge.toCommitId}`}
                  fill="none"
                  opacity={selected ? 1 : 0.18}
                  points={edge.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  stroke={emphasized ? foreground : border}
                  strokeWidth={edgeWidthFor(emphasized, { lineThickness: 1 })}
                />
              );
            })}
            {renderLayout.nodes.map((spatialNode) => {
              const node = props.graph.byId.get(spatialNode.commitId);
              if (node === undefined) return null;
              const radius = radiusFor(node, { nodeSize: 1 });
              const published = node.item.published;
              const selected = selectedLineage === null || selectedLineage.has(node.commitId);
              const dots = planNodeStatusDots({
                ready: props.readyNodeIds.has(node.commitId),
                staleSpec: props.staleSpecNodeIds.has(node.commitId),
                stalePlan: props.stalePlanNodeIds.has(node.commitId),
              });
              const glyph = planMapGlyphFor(node);
              return (
                <G
                  accessible
                  accessibilityLabel={nodeAccessibilityLabel(
                    node,
                    dots.map((dot) => dot.key),
                  )}
                  accessibilityRole="button"
                  key={node.commitId}
                  opacity={selected ? spatialNode.opacity : spatialNode.opacity * 0.18}
                  transform={`translate(${spatialNode.x} ${spatialNode.y}) scale(${spatialNode.scale})`}
                >
                  {node.commitId === props.currentCommitId ? (
                    <Circle
                      cx={0}
                      cy={0}
                      fill="none"
                      r={radius + 4}
                      stroke={primary}
                      strokeWidth={2}
                    />
                  ) : null}
                  <Circle
                    cx={0}
                    cy={0}
                    fill={published ? muted : screen}
                    r={radius}
                    stroke={muted}
                    strokeWidth={published ? 0 : 1.5}
                  />
                  {node.checkpoint !== undefined ? (
                    <Circle
                      cx={0}
                      cy={0}
                      fill="none"
                      r={Math.max(radius - 3, 1)}
                      stroke={published ? screen : muted}
                      strokeWidth={1}
                    />
                  ) : null}
                  {detail === "glyph" ? (
                    <G
                      transform={`${mirrorPlanMapGlyph(node) ? "scale(-1 1) " : ""}translate(-6 -6) scale(.5)`}
                    >
                      {PLAN_MAP_GLYPH_PATHS[glyph].map((path, index) => (
                        <Path
                          key={index}
                          d={path}
                          fill="none"
                          stroke={published ? screen : muted}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      ))}
                    </G>
                  ) : null}
                  {dots.map((dot, index) => (
                    <Circle
                      key={dot.key}
                      cx={radius / Math.SQRT2 + index * 5}
                      cy={-radius / Math.SQRT2}
                      fill={STATUS_COLORS[dot.key]}
                      r={3}
                      stroke={screen}
                      strokeWidth={1}
                    />
                  ))}
                </G>
              );
            })}
          </AnimatedG>
        </Svg>
      </GestureDetector>
      <View className="absolute bottom-5 right-4 items-end gap-2">
        {showMinimap ? (
          <PlanMinimap
            frame={frame}
            layout={props.layout}
            currentCommitId={props.currentCommitId}
            tx={tx}
            ty={ty}
            zoom={zoom}
            border={border}
            primary={primary}
            muted={muted}
          />
        ) : null}
        <View className="flex-row gap-2">
          <MapControl
            accessibilityLabel="Fit graph to view"
            icon="arrow.up.left.and.arrow.down.right"
            onPress={fit}
          />
          <MapControl
            accessibilityLabel="Jump to current checkpoint"
            disabled={props.currentCommitId === null}
            icon="pin"
            onPress={jumpToCurrent}
          />
        </View>
      </View>
    </View>
  );
}

function nodeAccessibilityLabel(node: PlanGraphNode, statuses: ReadonlyArray<string>): string {
  const checkpoint = node.checkpoint;
  const identity =
    checkpoint === undefined
      ? planCommitSummary(node.item)
      : `You: ${planCommitSummary(checkpoint.query)}${checkpoint.response === undefined ? "" : `; Assistant: ${planCommitSummary(checkpoint.response)}`}`;
  const statusLabel = statuses
    .map((status) =>
      status === "ready" ? "ready" : status === "stale-spec" ? "spec stale" : "plan may be stale",
    )
    .join(", ");
  return statusLabel.length === 0 ? identity : `${identity}, ${statusLabel}`;
}

function MapControl(props: {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const color = useThemeColor("--color-icon");
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-11 items-center justify-center rounded-full border border-border bg-sheet active:opacity-70 disabled:opacity-40"
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <SymbolView name={props.icon} size={19} tintColor={color} />
    </Pressable>
  );
}

function PlanMinimap(props: {
  readonly frame: { readonly width: number; readonly height: number };
  readonly layout: SpatialLayout;
  readonly currentCommitId: MercurianCommitId | null;
  readonly tx: SharedValue<number>;
  readonly ty: SharedValue<number>;
  readonly zoom: SharedValue<number>;
  readonly border: ColorValue;
  readonly primary: ColorValue;
  readonly muted: ColorValue;
}) {
  const size = minimapSize(props.frame.width, props.frame.height);
  const projection = minimapProjection(props.layout.bounds, size);
  const viewportProps = useAnimatedProps(() => {
    const minX = -props.tx.value / props.zoom.value;
    const minY = -props.ty.value / props.zoom.value;
    return {
      x: minX * projection.scale + projection.offsetX,
      y: minY * projection.scale + projection.offsetY,
      width: (props.frame.width / props.zoom.value) * projection.scale,
      height: (props.frame.height / props.zoom.value) * projection.scale,
    };
  });
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Pan()
          .minDistance(2)
          .onUpdate((event) => {
            const worldX = (event.x - projection.offsetX) / projection.scale;
            const worldY = (event.y - projection.offsetY) / projection.scale;
            props.tx.value = props.frame.width / 2 - worldX * props.zoom.value;
            props.ty.value = props.frame.height / 2 - worldY * props.zoom.value;
          }),
        Gesture.Tap().onEnd((event, success) => {
          if (!success) return;
          const worldX = (event.x - projection.offsetX) / projection.scale;
          const worldY = (event.y - projection.offsetY) / projection.scale;
          props.tx.value = props.frame.width / 2 - worldX * props.zoom.value;
          props.ty.value = props.frame.height / 2 - worldY * props.zoom.value;
        }),
      ),
    [projection, props.frame.height, props.frame.width, props.tx, props.ty, props.zoom],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        className="overflow-hidden rounded-xl border border-border bg-sheet"
        style={{ width: size.width, height: size.height }}
      >
        <Svg width={size.width} height={size.height}>
          {props.layout.nodes.map((node) => {
            const point = projection.project(node);
            return (
              <Circle
                key={node.commitId}
                cx={point.x}
                cy={point.y}
                r={2}
                fill={node.commitId === props.currentCommitId ? props.primary : props.muted}
              />
            );
          })}
          <AnimatedRect
            animatedProps={viewportProps}
            fill={props.primary}
            fillOpacity={0.1}
            stroke={props.primary}
            strokeWidth={1}
          />
        </Svg>
      </View>
    </GestureDetector>
  );
}
