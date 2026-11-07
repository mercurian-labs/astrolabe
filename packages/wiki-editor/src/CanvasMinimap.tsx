import "./canvasBoard.css";

import { canvasBounds, type CanvasData } from "@mercurian/wiki/canvas";
import { useMemo } from "react";

import { canvasEdgeShapes } from "./canvasGeometry";

const PADDING = 24;

/**
 * A canvas as a picture: a shape per card and a line per arrow, with its groups named. Static and
 * cheap, for a note's embed and a nested canvas's card.
 */
export function CanvasMinimap({
  data,
  label,
}: {
  readonly data: CanvasData;
  readonly label: string;
}) {
  const { box, shapes } = useMemo(
    () => ({ box: canvasBounds(data), shapes: canvasEdgeShapes(data) }),
    [data],
  );
  const size = Math.max(box.width, box.height, 1);
  return (
    <svg
      className="cv-minimap"
      role="img"
      aria-label={label}
      viewBox={`${box.x - PADDING} ${box.y - PADDING} ${box.width + PADDING * 2} ${box.height + PADDING * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {data.nodes.map((node) => (
        <rect
          key={node.id}
          className="cv-minimap-card"
          data-group={node.type === "group" || undefined}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={size / 200}
        />
      ))}
      {shapes.map(({ edge, path }) => (
        <path key={edge.id} className="cv-minimap-edge" d={path} />
      ))}
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
