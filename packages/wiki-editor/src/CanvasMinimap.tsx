import "./canvasBoard.css";

import {
  canvasBounds,
  canvasCardName,
  canvasFrame,
  canvasFrameCards,
  canvasStack,
  type CanvasBounds,
  type CanvasData,
  type CanvasNode,
} from "@mercurian/wiki/canvas";
import { useMemo } from "react";

import { canvasEdgeShapes } from "./canvasGeometry";

const PADDING = 24;
/** A card's words as the board sizes them, in board units. */
const TEXT_SIZE = 16;
const TEXT_LIMIT = 160;

/** What a frame-aware picture shows: the box it frames, and what's inside the frame. */
export interface CanvasFigureView {
  readonly box: CanvasBounds;
  /** The frame's group and what it holds; undefined when the whole board is shown. */
  readonly inside: ReadonlySet<string> | undefined;
  /** A frame was asked for that the board doesn't have, so it shows whole. */
  readonly missing: boolean;
}

/** The box a picture of `data` frames: `frame`'s group, else the whole board. */
export function canvasFigureView(data: CanvasData, frame: string | undefined): CanvasFigureView {
  const group = frame === undefined ? undefined : canvasFrame(data, frame);
  if (group === undefined) {
    return { box: canvasBounds(data), inside: undefined, missing: frame !== undefined };
  }
  const inside = new Set(canvasFrameCards(data, group));
  inside.add(group.id);
  return {
    box: { x: group.x, y: group.y, width: group.width, height: group.height },
    inside,
    missing: false,
  };
}

/** A card's words with Markdown's marks taken out, short enough for a picture. */
const plainWords = (node: CanvasNode) => {
  const words =
    node.type === "text"
      ? node.text
          .replace(/!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, target: string, shown: string) =>
            shown === "" ? target : shown,
          )
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?)/gm, "")
          .replace(/[*_`~]/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : node.type === "link" && node.astrolabe?.caption !== undefined
        ? node.astrolabe.caption
        : canvasCardName({ ...node });
  return words.length > TEXT_LIMIT ? `${words.slice(0, TEXT_LIMIT - 1)}…` : words;
};

/**
 * A canvas as a picture: a shape per card and a line per arrow, in the order the board stacks
 * them, with its groups named. Static and cheap, for a note's embed, a nested canvas's card and a
 * figure in a reply. With `frame` it shows that named group, the rest of the board dimmed round
 * it; `words` writes each card's text on it.
 */
export function CanvasMinimap({
  data,
  label,
  frame,
  words = false,
}: {
  readonly data: CanvasData;
  readonly label: string;
  readonly frame?: string | undefined;
  readonly words?: boolean;
}) {
  const { view, stack, shapes } = useMemo(
    () => ({
      view: canvasFigureView(data, frame),
      stack: canvasStack(data),
      shapes: new Map(canvasEdgeShapes(data).map((shape) => [shape.edge.id, shape])),
    }),
    [data, frame],
  );
  const { box, inside } = view;
  const size = Math.max(box.width, box.height, 1);
  const dim = (id: string) => (inside === undefined || inside.has(id) ? undefined : "");
  const card = (node: CanvasNode) => (
    <rect
      key={`card:${node.id}`}
      className="cv-minimap-card"
      data-group={node.type === "group" || undefined}
      data-dim={dim(node.id)}
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      rx={size / 200}
    />
  );
  const cardWords = (node: CanvasNode) =>
    node.type === "group" ? null : (
      <foreignObject
        key={`words:${node.id}`}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        data-dim={dim(node.id)}
      >
        <div className="cv-minimap-words" style={{ fontSize: TEXT_SIZE }}>
          {plainWords(node)}
        </div>
      </foreignObject>
    );
  return (
    <svg
      className="cv-minimap"
      role="img"
      aria-label={label}
      viewBox={`${box.x - PADDING} ${box.y - PADDING} ${box.width + PADDING * 2} ${box.height + PADDING * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {stack.sections.map(card)}
      {stack.content.map((layer) => {
        if (layer.kind === "card") return card(layer.node);
        const shape = layer.kind === "arrow" ? shapes.get(layer.edge.id) : undefined;
        if (shape === undefined) return null;
        const { edge } = shape;
        const dimmed =
          inside === undefined || (inside.has(edge.fromNode) && inside.has(edge.toNode))
            ? undefined
            : "";
        return (
          <g key={`arrow:${edge.id}`} data-dim={dimmed}>
            <path className="cv-minimap-edge" d={shape.path} />
            {words
              ? shape.heads.map((head) => <path key={head} className="cv-minimap-head" d={head} />)
              : null}
            {words && edge.label !== undefined ? (
              <text
                className="cv-minimap-edge-label"
                x={shape.labelAt.x}
                y={shape.labelAt.y}
                fontSize={TEXT_SIZE * 0.85}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {words
        ? stack.content.map((layer) => (layer.kind === "card" ? cardWords(layer.node) : null))
        : null}
      {data.nodes.flatMap((node) =>
        node.type === "group" && node.label !== undefined
          ? [
              <text
                key={node.id}
                className="cv-minimap-label"
                data-dim={dim(node.id)}
                x={node.x}
                y={node.y - size / 120}
                fontSize={words ? TEXT_SIZE : size / 36}
              >
                {node.label}
              </text>,
            ]
          : [],
      )}
    </svg>
  );
}
