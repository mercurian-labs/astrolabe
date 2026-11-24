/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import {
  canvasBounds,
  canvasFrame,
  canvasFrameCards,
  canvasLayerOf,
  canvasStack,
  type CanvasNode,
} from "@mercurian/wiki/canvas";
import { documentTitle } from "@t3tools/client-runtime/wikiLogic";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { canvasEdgeShapes } from "@mercurian/wiki-editor/canvas-geometry";
import { canvasInkShapes } from "@mercurian/wiki-editor/canvas-ink";
import {
  canvasLineScale,
  canvasOutline,
  canvasPaint,
  canvasSketchBox,
  canvasSketchLine,
  type CanvasPaint,
} from "@mercurian/wiki-editor/canvas-paint";
import type { WikiCanvasReference } from "@t3tools/shared/toolOutput";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { MobileTurnCanvas } from "../../lib/threadActivity";
// oxlint-disable-next-line t3code/no-mobile-uniwind-theme-escape-hatches -- react-native-svg takes colours as props, so no className reaches its shapes
import { useUniwindTheme } from "../../lib/useUniwindTheme";

const CAPTION_HEIGHT = 32;
const ROW_BOTTOM_MARGIN = 8;
const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 320;
const MIN_READABLE_ZOOM = 0.3;
const FRAME_PADDING = 24;
const DIM_OPACITY = 0.25;

/** A line's props as its paint has it, `lines` its width's share at this zoom. */
const lineProps = (paint: CanvasPaint, color: string, lines: number) => ({
  stroke: color,
  strokeWidth: paint.width * lines,
  strokeLinecap: paint.cap,
  strokeLinejoin: "round" as const,
  ...(paint.dashArray === null
    ? {}
    : { strokeDasharray: paint.dashArray.map((length) => length * lines) }),
});

/** A fill as react-native-svg takes it: a box's surface is the frame's own background. */
function fillProps(paint: CanvasPaint, background: string, muted: string) {
  const { fill } = paint;
  if (fill.kind === "none") return { fill: "none" };
  if (fill.kind === "surface") return { fill: background };
  return { fill: fill.color ?? muted, fillOpacity: fill.amount };
}

function frameBounds(view: CanvasView, frame?: string | undefined) {
  const group = frame === undefined ? undefined : canvasFrame(view.data, frame);
  if (group === undefined) {
    return { bounds: canvasBounds(view.data), group: undefined, inside: undefined };
  }
  const inside = new Set(canvasFrameCards(view.data, group));
  inside.add(group.id);
  return {
    bounds: {
      x: group.x - FRAME_PADDING,
      y: group.y - FRAME_PADDING,
      width: group.width + FRAME_PADDING * 2,
      height: group.height + FRAME_PADDING * 2,
    },
    group,
    inside,
  };
}

function frameHeight(view: CanvasView, width: number, frame?: string | undefined) {
  const { width: boardWidth, height: boardHeight } = frameBounds(view, frame).bounds;
  const natural = (width * boardHeight) / Math.max(1, boardWidth);
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, natural));
}

/** The feed row's height: known up front, so a list of rows never jumps as it scrolls. */
export const canvasRowHeight = (view: CanvasView, width: number, frame?: string | undefined) =>
  CAPTION_HEIGHT + frameHeight(view, width, frame) + ROW_BOTTOM_MARGIN;

export const WIKI_CANVAS_ROW_HEIGHT = 36;

/** A canvas an agent changed in a wiki: where it landed, and the way to it. */
export function ThreadWikiCanvas(props: {
  readonly environmentId: EnvironmentId;
  readonly canvas: WikiCanvasReference;
}) {
  const navigation = useNavigation();
  const { wikiId, changeRequestId, file } = props.canvas;
  const title = documentTitle(file);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${title}`}
      className="flex-row items-center gap-2 active:opacity-70"
      style={{ height: WIKI_CANVAS_ROW_HEIGHT }}
      onPress={() =>
        navigation.navigate("WikiDocument", {
          environmentId: String(props.environmentId),
          wikiId,
          name: file,
          changeRequestId,
        })
      }
    >
      <Text className="flex-1 text-sm text-foreground-secondary" numberOfLines={1}>
        {`Changed the canvas ${title}`}
      </Text>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-subtle" />
    </Pressable>
  );
}

/** A card's first line, cut to what fits its width at the size this draws. */
function firstLine(text: string, width: number) {
  const line = text.split("\n")[0]?.replace(/^#+\s*|[*_`]/g, "") ?? "";
  const fits = Math.floor(width / 9);
  return line.length > fits ? `${line.slice(0, Math.max(1, fits - 1))}…` : line;
}

/** A card or section as native shapes: its outline as its paint has it, and its first line. */
function CardShape({
  node,
  zoom,
  lines,
  border,
  subtle,
  foreground,
  background,
  dimmed,
}: {
  readonly node: CanvasNode;
  readonly zoom: number;
  readonly lines: number;
  readonly border: string;
  readonly subtle: string;
  readonly foreground: string;
  readonly background: string;
  readonly dimmed: boolean;
}) {
  const paint = canvasPaint(node);
  const isGroup = node.type === "group";
  const label =
    node.type === "group"
      ? (node.label ?? "")
      : node.type === "text"
        ? node.text
        : node.type === "file"
          ? node.file
          : (node.astrolabe?.code?.path.split("/").at(-1) ?? node.url);
  const shape = canvasOutline(node, paint);
  const sketch = canvasSketchBox(node, paint);
  const outline = {
    ...fillProps(paint, background, subtle),
    ...lineProps(paint, paint.stroke ?? border, lines),
  };
  return (
    <G opacity={dimmed ? paint.opacity * DIM_OPACITY : paint.opacity}>
      {sketch !== undefined ? (
        <G transform={`translate(${node.x} ${node.y})`}>
          {sketch.fill === undefined ? null : (
            <Path d={sketch.fill} {...fillProps(paint, background, subtle)} />
          )}
          <Path d={sketch.line} fill="none" {...lineProps(paint, paint.stroke ?? border, lines)} />
        </G>
      ) : shape.kind === "path" ? (
        <Path d={shape.d} {...outline} />
      ) : (
        <Rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.radius}
          {...outline}
        />
      )}
      {zoom < MIN_READABLE_ZOOM ? null : (
        <SvgText
          x={node.x + 12}
          y={node.y + 24}
          fontSize={14}
          fontWeight={isGroup ? "600" : "400"}
          fill={foreground}
        >
          {firstLine(label, node.width - 24)}
        </SvgText>
      )}
    </G>
  );
}

/**
 * A canvas in the feed: its layout as native shapes, since a feed can hold many and each page in
 * a web view is heavy. Tapping opens the board, to read and pan. With `frame`, shows that named
 * group with the rest of the board dimmed around it.
 */
export function ThreadCanvas(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly view: CanvasView;
  readonly frameWidth: number;
  readonly frame?: string | undefined;
}) {
  const navigation = useNavigation();
  const theme = useUniwindTheme();
  const { view, frame } = props;
  const { bounds, group, inside } = useMemo(() => frameBounds(view, frame), [view, frame]);
  const missingFrame = frame !== undefined && group === undefined;
  const caption = group === undefined ? view.title : `${view.title} › ${group.label ?? frame}`;
  const height = useMemo(() => {
    const natural = (props.frameWidth * bounds.height) / Math.max(1, bounds.width);
    return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, natural));
  }, [bounds.height, bounds.width, props.frameWidth]);
  const stack = useMemo(() => canvasStack(view.data), [view.data]);
  // Kinds may share an id, so each is found among its own.
  const edges = useMemo(
    () => new Map(canvasEdgeShapes(view.data).map((shape) => [shape.edge.id, shape])),
    [view.data],
  );
  const inks = useMemo(
    () => new Map(canvasInkShapes(view.data).map((shape) => [shape.ink.id, shape])),
    [view.data],
  );
  const zoom = Math.min(props.frameWidth / bounds.width, height / bounds.height);
  const border = String(theme["--color-border"]);
  const subtle = String(theme["--color-icon-subtle"]);
  const foreground = String(theme["--color-foreground-secondary"]);
  const background = String(theme["--color-screen"]);
  const lines = canvasLineScale(zoom);
  const cardStyle = { zoom, lines, border, subtle, foreground, background };
  const isDimmed = (id: string) => inside !== undefined && !inside.has(id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${caption}`}
      style={{ marginBottom: ROW_BOTTOM_MARGIN }}
      onPress={() =>
        navigation.navigate("ThreadCanvas", {
          environmentId: String(props.environmentId),
          threadId: String(props.threadId),
          itemId: String(props.itemId),
          ...(group === undefined ? {} : { frame: group.id }),
        })
      }
    >
      <View
        className="flex-row items-center justify-between gap-2"
        style={{ height: CAPTION_HEIGHT }}
      >
        <Text className="flex-1 text-sm text-foreground-secondary" numberOfLines={1}>
          {caption}
        </Text>
        {missingFrame ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            whole board
          </Text>
        ) : null}
        <SymbolView name="arrow.up.left.and.arrow.down.right" size={14} tintColor={subtle} />
      </View>
      <Svg
        width={props.frameWidth}
        height={height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      >
        {/* Sections beneath, then the rest in the one order the board draws it in. */}
        {stack.sections.map((node) => (
          <CardShape
            key={`card:${node.id}`}
            node={node}
            dimmed={isDimmed(node.id)}
            {...cardStyle}
          />
        ))}
        {stack.content.map((layer) => {
          const { id } = canvasLayerOf(layer);
          if (layer.kind === "card") {
            return (
              <CardShape
                key={`card:${id}`}
                node={layer.node}
                dimmed={isDimmed(id)}
                {...cardStyle}
              />
            );
          }
          if (layer.kind === "arrow") {
            const shape = edges.get(id);
            if (shape === undefined) return null;
            const paint = canvasPaint(shape.edge);
            const color = paint.stroke ?? subtle;
            const arrowDimmed =
              inside !== undefined &&
              !inside.has(shape.edge.fromNode) &&
              !inside.has(shape.edge.toNode);
            return (
              <G
                key={`arrow:${id}`}
                opacity={arrowDimmed ? paint.opacity * DIM_OPACITY : paint.opacity}
              >
                <Path
                  d={canvasSketchLine(shape.edge, shape.path) ?? shape.path}
                  fill="none"
                  {...lineProps(paint, color, lines)}
                />
                {shape.heads.map((head) => (
                  <Path key={head} d={head} fill={color} />
                ))}
              </G>
            );
          }
          const shape = inks.get(id);
          if (shape === undefined) return null;
          const { ink, path, fill, heads } = shape;
          const paint = canvasPaint(ink);
          const color = paint.stroke ?? (ink.type === "stroke" ? foreground : subtle);
          return (
            <G
              key={`drawing:${id}`}
              opacity={inside !== undefined ? paint.opacity * DIM_OPACITY : paint.opacity}
            >
              {fill === undefined ? (
                <Path
                  d={canvasSketchLine(ink, path) ?? path}
                  fill="none"
                  {...lineProps(paint, color, lines)}
                />
              ) : (
                <Path d={fill} fill={color} />
              )}
              {heads.map((head) => (
                <Path key={head} d={head} fill={color} />
              ))}
            </G>
          );
        })}
      </Svg>
    </Pressable>
  );
}

function TurnCanvasLinkRow(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: MobileTurnCanvas;
}) {
  const navigation = useNavigation();
  const { entry } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.canvas.title}`}
      className="min-h-11 flex-row items-center gap-2 rounded-lg px-2 active:bg-subtle"
      onPress={() =>
        navigation.navigate("ThreadCanvas", {
          environmentId: String(props.environmentId),
          threadId: String(entry.sourceThreadId),
          itemId: String(entry.itemId),
        })
      }
    >
      <SymbolView name="rectangle.3.group" size={14} tintColorClassName="accent-icon-subtle" />
      <Text className="flex-1 text-sm text-foreground-secondary" numberOfLines={1}>
        {entry.canvas.title}
      </Text>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}

/**
 * A turn's canvases at the foot of its last reply: an unembedded canvas shows its preview inline;
 * an embedded canvas stays a compact link row; two or more fold behind a count toggle.
 */
export function TurnCanvasesFooter(props: {
  readonly environmentId: EnvironmentId;
  readonly canvases: ReadonlyArray<MobileTurnCanvas>;
  readonly frameWidth: number;
}) {
  const { canvases } = props;
  const allEmbedded = canvases.every((entry) => entry.embedded);
  const [expanded, setExpanded] = useState(!allEmbedded);

  if (canvases.length === 0) return null;
  if (canvases.length === 1) {
    const entry = canvases[0]!;
    return entry.embedded ? (
      <TurnCanvasLinkRow environmentId={props.environmentId} entry={entry} />
    ) : (
      <ThreadCanvas
        environmentId={props.environmentId}
        threadId={entry.sourceThreadId}
        itemId={entry.itemId}
        view={entry.canvas}
        frameWidth={props.frameWidth}
      />
    );
  }

  return (
    <View className="mt-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${canvases.length} canvases`}
        className="min-h-11 flex-row items-center gap-2 rounded-lg px-2 active:bg-subtle"
        onPress={() => setExpanded((current) => !current)}
      >
        <SymbolView name="rectangle.3.group" size={14} tintColorClassName="accent-icon-subtle" />
        <Text className="flex-1 text-sm text-foreground-secondary">
          {`${canvases.length} canvases`}
        </Text>
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      {expanded ? (
        <View className="mt-1">
          {canvases.map((entry) =>
            entry.embedded ? (
              <TurnCanvasLinkRow key={entry.id} environmentId={props.environmentId} entry={entry} />
            ) : (
              <ThreadCanvas
                key={entry.id}
                environmentId={props.environmentId}
                threadId={entry.sourceThreadId}
                itemId={entry.itemId}
                view={entry.canvas}
                frameWidth={props.frameWidth}
              />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}
