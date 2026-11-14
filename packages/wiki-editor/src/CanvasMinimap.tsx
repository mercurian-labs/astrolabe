import "./canvasBoard.css";

import {
  canvasBounds,
  canvasStack,
  type CanvasData,
  type CanvasNode,
} from "@mercurian/wiki/canvas";
import { useMemo } from "react";

import { canvasEdgeShapes } from "./canvasGeometry";

const PADDING = 24;

/**
 * A canvas as a picture: a shape per card and a line per arrow, in the order the board stacks
 * them, with its groups named. Static and cheap, for a note's embed and a nested canvas's card.
 */
export function CanvasMinimap({
  data,
  label,
}: {
  readonly data: CanvasData;
  readonly label: string;
}) {
  const { box, stack, shapes } = useMemo(
    () => ({
      box: canvasBounds(data),
      stack: canvasStack(data),
      shapes: new Map(canvasEdgeShapes(data).map((shape) => [shape.edge.id, shape])),
    }),
    [data],
  );
  const size = Math.max(box.width, box.height, 1);
  const card = (node: CanvasNode) => (
    <rect
      key={`card:${node.id}`}
      className="cv-minimap-card"
      data-group={node.type === "group" || undefined}
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      rx={size / 200}
    />
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
        return shape === undefined ? null : (
          <path key={`arrow:${shape.edge.id}`} className="cv-minimap-edge" d={shape.path} />
        );
      })}
      {data.nodes.flatMap((node) =>
        node.type === "group" && node.label !== undefined
          ? [
              <text
                key={node.id}
                className="cv-minimap-label"
                x={node.x}
                y={node.y - size / 120}
                fontSize={size / 36}
              >
                {node.label}
              </text>,
            ]
          : [],
      )}
    </svg>
  );
}
