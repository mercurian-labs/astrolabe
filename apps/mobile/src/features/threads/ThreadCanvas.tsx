import { canvasBounds } from "@mercurian/wiki/canvas";
import { documentTitle } from "@t3tools/client-runtime/wikiLogic";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { canvasEdgeShapes } from "@mercurian/wiki-editor/canvas-geometry";
import { canvasInkShapes } from "@mercurian/wiki-editor/canvas-ink";
import {
  canvasLineScale,
  canvasOutline,
  canvasPaint,
  type CanvasPaint,
} from "@mercurian/wiki-editor/canvas-paint";
import type { WikiCanvasReference } from "@t3tools/shared/toolOutput";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
// oxlint-disable-next-line t3code/no-mobile-uniwind-theme-escape-hatches -- react-native-svg takes colours as props, so no className reaches its shapes
import { useUniwindTheme } from "../../lib/useUniwindTheme";

const CAPTION_HEIGHT = 32;
const ROW_BOTTOM_MARGIN = 8;
const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 320;
const MIN_READABLE_ZOOM = 0.3;

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

function frameHeight(view: CanvasView, width: number) {
  const { width: boardWidth, height: boardHeight } = canvasBounds(view.data);
  const natural = (width * boardHeight) / Math.max(1, boardWidth);
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, natural));
}

/** The feed row's height: known up front, so a list of rows never jumps as it scrolls. */
export const canvasRowHeight = (view: CanvasView, width: number) =>
  CAPTION_HEIGHT + frameHeight(view, width) + ROW_BOTTOM_MARGIN;

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

/**
 * A canvas in the feed: its layout as native shapes, since a feed can hold many and each page in
 * a web view is heavy. Tapping opens the board, to read and pan.
 */
export function ThreadCanvas(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly view: CanvasView;
  readonly frameWidth: number;
}) {
  const navigation = useNavigation();
  const theme = useUniwindTheme();
  const { view } = props;
  const height = frameHeight(view, props.frameWidth);
  const bounds = useMemo(() => canvasBounds(view.data), [view.data]);
  const edges = useMemo(() => canvasEdgeShapes(view.data), [view.data]);
  const inks = useMemo(() => canvasInkShapes(view.data), [view.data]);
  const zoom = Math.min(props.frameWidth / bounds.width, height / bounds.height);
  const border = String(theme["--color-border"]);
  const subtle = String(theme["--color-icon-subtle"]);
  const foreground = String(theme["--color-foreground-secondary"]);
  const background = String(theme["--color-screen"]);
  const lines = canvasLineScale(zoom);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${view.title}`}
      style={{ marginBottom: ROW_BOTTOM_MARGIN }}
      onPress={() =>
        navigation.navigate("ThreadCanvas", {
          environmentId: String(props.environmentId),
          threadId: String(props.threadId),
          itemId: String(props.itemId),
        })
      }
    >
      <View className="flex-row items-center justify-between" style={{ height: CAPTION_HEIGHT }}>
        <Text className="flex-1 text-sm text-foreground-secondary" numberOfLines={1}>
          {view.title}
        </Text>
        <SymbolView name="arrow.up.left.and.arrow.down.right" size={14} tintColor={subtle} />
      </View>
      <Svg
        width={props.frameWidth}
        height={height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      >
        {view.data.nodes.map((node) => {
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
          const outline = {
            ...fillProps(paint, background, subtle),
            ...lineProps(paint, paint.stroke ?? border, lines),
          };
          return (
            <G key={node.id} opacity={paint.opacity}>
              {shape.kind === "path" ? (
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
        })}
        {edges.map(({ edge, path, heads }) => {
          const paint = canvasPaint(edge);
          const color = paint.stroke ?? subtle;
          return (
            <G key={edge.id} opacity={paint.opacity}>
              <Path d={path} fill="none" {...lineProps(paint, color, lines)} />
              {heads.map((head) => (
                <Path key={head} d={head} fill={color} />
              ))}
            </G>
          );
        })}
        {inks.map(({ ink, path, head }) => {
          const paint = canvasPaint(ink);
          const color = paint.stroke ?? (ink.type === "stroke" ? foreground : subtle);
          return (
            <G key={ink.id} opacity={paint.opacity}>
              <Path d={path} fill="none" {...lineProps(paint, color, lines)} />
              {head === undefined ? null : <Path d={head} fill={color} />}
            </G>
          );
        })}
      </Svg>
    </Pressable>
  );
}
