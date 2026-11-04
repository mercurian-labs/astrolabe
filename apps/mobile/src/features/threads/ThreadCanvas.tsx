import { canvasBounds } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { canvasEdgeShapes } from "@mercurian/wiki-editor/canvas-geometry";
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

// The presets of `canvasBoard.css`.
const PRESET_COLORS: Readonly<Record<string, string>> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#d6a100",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

const tint = (color: string | undefined) =>
  color === undefined ? undefined : (PRESET_COLORS[color] ?? color);

function frameHeight(view: CanvasView, width: number) {
  const { width: boardWidth, height: boardHeight } = canvasBounds(view.data);
  const natural = (width * boardHeight) / Math.max(1, boardWidth);
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, natural));
}

/** The feed row's height: known up front, so a list of rows never jumps as it scrolls. */
export const canvasRowHeight = (view: CanvasView, width: number) =>
  CAPTION_HEIGHT + frameHeight(view, width) + ROW_BOTTOM_MARGIN;

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
  const zoom = Math.min(props.frameWidth / bounds.width, height / bounds.height);
  const border = String(theme["--color-border"]);
  const subtle = String(theme["--color-icon-subtle"]);
  const foreground = String(theme["--color-foreground-secondary"]);
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
          const color = tint(node.color);
          const isGroup = node.type === "group";
          const label =
            node.type === "group"
              ? (node.label ?? "")
              : node.type === "text"
                ? node.text
                : (node.astrolabe?.code?.path.split("/").at(-1) ?? node.url);
          return (
            <G key={node.id}>
              <Rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={8}
                fill={color ?? "transparent"}
                fillOpacity={color === undefined ? 0 : isGroup ? 0.06 : 0.14}
                stroke={color ?? border}
                strokeWidth={1 / zoom}
              />
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
          const color = tint(edge.color) ?? subtle;
          return (
            <G key={edge.id}>
              <Path d={path} fill="none" stroke={color} strokeWidth={1.5 / zoom} />
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
