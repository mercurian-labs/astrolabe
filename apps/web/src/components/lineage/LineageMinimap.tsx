import { useEffect, useRef, type PointerEvent, type RefObject } from "react";

import { observeResize } from "~/lib/observeResize";

/** One stroke of the overview, in the drawing's coordinates. */
export interface MinimapPath {
  readonly key: string;
  readonly d: string;
  /** The viewed thread's, drawn at full ink; the others are lighter. */
  readonly viewed: boolean;
  readonly dashed: boolean;
}

/** One point of the overview, in the drawing's coordinates. */
export interface MinimapDot {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly kind: "turn" | "viewed" | "here" | "reading";
}

/**
 * Where a box for what a scroll area shows sits along one axis of a strip `strip` long: its start
 * and length, for content `content` long seen through `view` at `scroll`. All of it when the
 * content fits.
 */
export function minimapBox(scroll: number, content: number, view: number, strip: number) {
  if (content <= view) return { start: 0, size: strip };
  return { start: (scroll / content) * strip, size: (view / content) * strip };
}

/** The scroll that centres the view on a point `fraction` of the way along the content. */
export function minimapScroll(fraction: number, content: number, view: number) {
  const target = Math.min(1, Math.max(0, fraction)) * content - view / 2;
  return Math.min(Math.max(0, content - view), Math.max(0, target));
}

/**
 * The Lineage tab's overview: the whole drawing squeezed into a strip, with a box around the part
 * the panel shows. Pressing on it, or dragging, scrolls the drawing there. The box follows the
 * scroll directly, without rendering.
 */
export function LineageMinimap({
  width,
  height,
  paths,
  dots,
  scroller,
  onNavigate,
}: {
  /** The drawing's size, which the strip squeezes to its own. */
  readonly width: number;
  readonly height: number;
  readonly paths: ReadonlyArray<MinimapPath>;
  readonly dots: ReadonlyArray<MinimapDot>;
  readonly scroller: RefObject<HTMLElement | null>;
  /** Scrolls the drawing to centre on a point, given as fractions of its width and height. */
  readonly onNavigate: (across: number, down: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = scroller.current;
    const element = strip.current;
    if (!area || !element) return;
    const place = () => {
      const target = box.current;
      if (!target) return;
      const across = minimapBox(
        area.scrollLeft,
        area.scrollWidth,
        area.clientWidth,
        element.clientWidth,
      );
      const down = minimapBox(
        area.scrollTop,
        area.scrollHeight,
        area.clientHeight,
        element.clientHeight,
      );
      target.style.left = `${across.start}px`;
      target.style.width = `${across.size}px`;
      target.style.top = `${down.start}px`;
      target.style.height = `${down.size}px`;
    };
    place();
    area.addEventListener("scroll", place, { passive: true });
    // The panel, the strip, and the drawing as it unfolds or grows.
    const stops = [area, element, area.firstElementChild].flatMap((each) =>
      each === null ? [] : [observeResize(each, place)],
    );
    return () => {
      area.removeEventListener("scroll", place);
      for (const stop of stops) stop();
    };
  }, [scroller]);

  const navigate = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onNavigate((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  return (
    <div
      ref={strip}
      aria-hidden
      className="relative h-9 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-sm bg-muted/40"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event);
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0"
      >
        {paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill="none"
            className={path.viewed ? "stroke-foreground" : "stroke-foreground/45"}
            strokeWidth={path.viewed ? 1.5 : 1}
            strokeDasharray={path.dashed ? "1 3" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {dots.map((dot) => (
          // A round cap on a stroke this short is a dot of the stroke's width at any squeeze.
          <path
            key={dot.key}
            d={`M ${dot.x} ${dot.y} h 0.001`}
            fill="none"
            strokeLinecap="round"
            className={
              dot.kind === "turn"
                ? "stroke-foreground/45"
                : dot.kind === "reading"
                  ? "stroke-foreground/30"
                  : "stroke-foreground"
            }
            strokeWidth={dot.kind === "here" ? 6 : dot.kind === "reading" ? 10 : 3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        ref={box}
        className="pointer-events-none absolute rounded-sm border border-foreground/50 bg-foreground/6"
      />
    </div>
  );
}
