import "./canvasBoard.css";

import {
  canvasBounds,
  type CanvasCodeReference,
  type CanvasData,
  type CanvasNode,
} from "@mercurian/wiki/canvas";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { canvasColor, canvasEdgeShapes, isOpenableUrl } from "./canvasGeometry";
import { CanvasMarkdown } from "./CanvasMarkdown";
import { CanvasView } from "./canvasView";

/** What a board can do outside itself. A missing callback leaves that card inert. */
export interface CanvasBoardHost {
  readonly onOpenUrl?: (href: string) => void;
  readonly onOpenCode?: (code: CanvasCodeReference) => void;
}

const FIT_PADDING = { fit: 8, free: 32 };
const PAN_STEP = 60;
const ZOOM_STEP = 1.25;
/** A left-edge touch belongs to the phone's back swipe, not the board. */
const BACK_SWIPE_EDGE = 24;

function colorProps(color: string | undefined) {
  const { preset, hex } = canvasColor(color);
  return {
    ...(preset === undefined ? {} : { "data-color": preset }),
    ...(hex === undefined ? {} : { style: { "--cv-tint": hex } as Record<string, string> }),
  };
}

const position = ({ x, y, width, height }: CanvasNode) => ({
  left: x,
  top: y,
  width,
  height,
});

function CodeCard({
  code,
  caption,
  host,
}: {
  readonly code: CanvasCodeReference;
  readonly caption: string | undefined;
  readonly host: CanvasBoardHost;
}) {
  const slash = code.path.lastIndexOf("/");
  const lines = code.lines
    ? code.lines[0] === code.lines[1]
      ? `:${code.lines[0]}`
      : `:${code.lines[0]}–${code.lines[1]}`
    : "";
  const body = (
    <>
      <span className="cv-code-path">
        {slash >= 0 ? (
          <span className="cv-code-folder">{code.path.slice(0, slash + 1)}</span>
        ) : null}
        <span className="cv-code-file">
          {code.path.slice(slash + 1)}
          {lines}
        </span>
      </span>
      {caption === undefined ? null : <CanvasMarkdown text={caption} onOpenUrl={host.onOpenUrl} />}
    </>
  );
  const { onOpenCode } = host;
  if (onOpenCode === undefined) return <div className="cv-card-body">{body}</div>;
  return (
    <button type="button" className="cv-card-body cv-card-open" onClick={() => onOpenCode(code)}>
      {body}
    </button>
  );
}

function LinkCard({
  url,
  caption,
  host,
}: {
  readonly url: string;
  readonly caption: string | undefined;
  readonly host: CanvasBoardHost;
}) {
  const body = (
    <>
      <span className="cv-link-url">{url}</span>
      {caption === undefined ? null : <CanvasMarkdown text={caption} onOpenUrl={host.onOpenUrl} />}
    </>
  );
  const { onOpenUrl } = host;
  if (onOpenUrl === undefined || !isOpenableUrl(url)) {
    return <div className="cv-card-body">{body}</div>;
  }
  return (
    <button type="button" className="cv-card-body cv-card-open" onClick={() => onOpenUrl(url)}>
      {body}
    </button>
  );
}

function Node({ node, host }: { readonly node: CanvasNode; readonly host: CanvasBoardHost }) {
  const { style, ...color } = colorProps(node.color);
  const placed = { ...position(node), ...style };
  if (node.type === "group") {
    return (
      <div className="cv-group" style={placed} {...color}>
        {node.label === undefined ? null : <span className="cv-group-label">{node.label}</span>}
      </div>
    );
  }
  return (
    <article className="cv-card" data-kind={node.type} style={placed} {...color}>
      {node.type === "text" ? (
        <div className="cv-card-body">
          <CanvasMarkdown text={node.text} onOpenUrl={host.onOpenUrl} />
        </div>
      ) : node.astrolabe?.code !== undefined ? (
        <CodeCard code={node.astrolabe.code} caption={node.astrolabe.caption} host={host} />
      ) : (
        <LinkCard url={node.url} caption={node.astrolabe?.caption} host={host} />
      )}
    </article>
  );
}

function Edges({ data }: { readonly data: CanvasData }) {
  const shapes = useMemo(() => canvasEdgeShapes(data), [data]);
  return (
    <>
      <svg className="cv-edges" aria-hidden="true" width="1" height="1">
        {shapes.map(({ edge, path, heads }) => {
          const { style, ...color } = colorProps(edge.color);
          return (
            <g key={edge.id} className="cv-edge" style={style} {...color}>
              <path className="cv-edge-line" d={path} />
              {heads.map((head) => (
                <path key={head} className="cv-edge-head" d={head} />
              ))}
            </g>
          );
        })}
      </svg>
      {shapes.flatMap(({ edge, labelAt }) =>
        edge.label === undefined
          ? []
          : [
              <span
                key={edge.id}
                className="cv-edge-label"
                style={{ left: labelAt.x, top: labelAt.y }}
              >
                {edge.label}
              </span>,
            ],
      )}
    </>
  );
}

/**
 * A JSON Canvas as DOM cards and SVG arrows inside one transformed element. `fit` shows the whole
 * board and leaves scrolling to the page around it, for a board inside a chat. `free` pans and
 * zooms, through `CanvasView`, so a gesture never re-renders the cards.
 */
export function CanvasBoard({
  data,
  mode,
  host = {},
  label,
}: {
  readonly data: CanvasData;
  readonly mode: "fit" | "free";
  readonly host?: CanvasBoardHost;
  readonly label: string;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view] = useState(() => new CanvasView());
  const bounds = useMemo(() => canvasBounds(data), [data]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame the browser laid out and follows its resizes, so the board always fits
  useLayoutEffect(() => {
    const board = boardRef.current;
    const world = worldRef.current;
    if (board === null || world === null) return;
    return view.attach(board, world, bounds, FIT_PADDING[mode]);
  }, [view, bounds, mode]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wheel listener must be non-passive to keep the page from scrolling, and React's is passive
  useEffect(() => {
    const board = boardRef.current;
    if (board === null || mode !== "free") return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      view.wheel(event);
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [view, mode]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button, a") !== null) return;
    const board = event.currentTarget;
    if (
      event.pointerType === "touch" &&
      event.clientX - board.getBoundingClientRect().left < BACK_SWIPE_EDGE
    ) {
      return;
    }
    board.setPointerCapture(event.pointerId);
    view.press(event.pointerId, event.clientX, event.clientY);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pan = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const step = pan[event.key as keyof typeof pan];
    if (step !== undefined) {
      view.pan(step[0]! * PAN_STEP, step[1]! * PAN_STEP);
    } else if (event.key === "+" || event.key === "=") {
      view.zoomBy(ZOOM_STEP);
    } else if (event.key === "-") {
      view.zoomBy(1 / ZOOM_STEP);
    } else if (event.code === "Digit1" && event.shiftKey) {
      view.fit();
    } else {
      return;
    }
    event.preventDefault();
  };

  const interactive =
    mode === "free"
      ? {
          tabIndex: 0,
          onPointerDown,
          onPointerMove: (event: PointerEvent<HTMLDivElement>) =>
            view.drag(event.pointerId, event.clientX, event.clientY),
          onPointerUp: (event: PointerEvent<HTMLDivElement>) => view.release(event.pointerId),
          onPointerCancel: (event: PointerEvent<HTMLDivElement>) => view.release(event.pointerId),
          onKeyDown,
        }
      : {};

  return (
    <div
      ref={boardRef}
      className="cv-board"
      data-mode={mode}
      role="group"
      aria-label={label}
      {...interactive}
    >
      <div ref={worldRef} className="cv-world">
        <Edges data={data} />
        {data.nodes.map((node) => (
          <Node key={node.id} node={node} host={host} />
        ))}
      </div>
      {mode === "free" ? (
        <div className="cv-controls">
          <button type="button" aria-label="Zoom in" onClick={() => view.zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <button type="button" aria-label="Fit the board in view" onClick={() => view.fit()}>
            Fit
          </button>
        </div>
      ) : null}
    </div>
  );
}
