import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { ThemeEditorSurfaceRenderState } from "./ThemeEditorSurface";

export function ThemeEditorPanel({
  onOpenChange,
  surface,
}: {
  onOpenChange: (open: boolean) => void;
  surface: ThemeEditorSurfaceRenderState;
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  // Null parks the panel at its default corner; a value is a dragged spot,
  // kept clamped so the header can always be grabbed again.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  // Null keeps the responsive default size; a value is a corner-grip resize.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    // Where the panel's top-left sits: the grip only moves the opposite
    // corner, so the room to grow is measured from here.
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const clampPosition = (x: number, y: number, widthOverride?: number) => {
    const panel = panelRef.current;
    const margin = 8;
    // The caller passes a width when it has just shrunk the panel: the DOM
    // still reports the old one until React commits.
    const width = widthOverride ?? panel?.offsetWidth ?? 0;
    return {
      x: Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - width - margin)),
      // Keep at least the header on screen even when dragged far down.
      y: Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - 48)),
    };
  };

  useEffect(() => {
    // A panel sized wider than the window can no longer be clamped back into
    // view by position alone -- its right edge (close, minimize, the grip)
    // stays off screen. So the size shrinks to fit first, then the position
    // is re-clamped against the new size.
    const clamp = () => {
      const margin = 8;
      let clampedWidth: number | undefined;
      let clampedHeight: number | undefined;
      setSize((current) => {
        if (!current) return current;
        clampedWidth = Math.max(280, Math.min(current.width, window.innerWidth - margin * 2));
        clampedHeight = Math.max(220, Math.min(current.height, window.innerHeight - margin * 2));
        return { width: clampedWidth, height: clampedHeight };
      });
      setPosition((current) => {
        if (!current) return current;
        const clamped = clampPosition(current.x, current.y, clampedWidth);
        // Dragging may park the panel with only its header showing, but a
        // window resize should pull the whole thing back into view when it
        // fits -- otherwise the grip ends up below the fold. Minimized, the
        // stored height is not applied (the panel hugs its header), so the
        // rendered height is what has to fit.
        const height = isMinimized
          ? (panelRef.current?.offsetHeight ?? 0)
          : (clampedHeight ?? panelRef.current?.offsetHeight ?? 0);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        return { x: clamped.x, y: Math.min(clamped.y, maxY) };
      });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [isMinimized]);

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Buttons in the header keep their own behavior.
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { dx: event.clientX - rect.x, dy: event.clientY - rect.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffsetRef.current;
    if (!offset) return;
    setPosition(clampPosition(event.clientX - offset.dx, event.clientY - offset.dy));
  };

  const endDrag = () => {
    dragOffsetRef.current = null;
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    // The grip drags the bottom-right corner, so the top-left must hold
    // still; the default parking spot is anchored bottom-right and would
    // slide, so it converts to an explicit position first.
    if (position === null) setPosition(clampPosition(rect.x, rect.y));
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const margin = 8;
    const MIN_WIDTH = 280;
    const MIN_HEIGHT = 220;
    // Grow only into the space right of and below the panel's own corner,
    // otherwise a panel parked away from the top-left pushes its far edges
    // (and this grip) off screen.
    const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - margin - start.left);
    const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - margin - start.top);
    setSize({
      width: Math.min(Math.max(start.width + event.clientX - start.pointerX, MIN_WIDTH), maxWidth),
      height: Math.min(
        Math.max(start.height + event.clientY - start.pointerY, MIN_HEIGHT),
        maxHeight,
      ),
    });
  };

  const endResize = () => {
    resizeStartRef.current = null;
  };

  return (
    <div
      aria-label={surface.ariaLabel}
      className={cn(
        "dialog-glass fixed z-[110] flex max-h-[min(42rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border text-popover-foreground",
        position === null && "bottom-4 right-4",
        isMinimized && "max-h-none",
      )}
      data-theme-editor-panel
      ref={(node) => {
        panelRef.current = node;
        surface.panelRef.current = node;
      }}
      role="dialog"
      style={{
        ...(position ? { left: position.x, top: position.y } : {}),
        ...(size ? { width: size.width } : {}),
        // A chosen height only applies expanded; minimized keeps hugging the
        // header. The viewport stays the ceiling either way.
        ...(size && !isMinimized ? { height: size.height, maxHeight: "calc(100dvh - 1rem)" } : {}),
      }}
    >
      <div
        className="flex cursor-grab touch-none select-none items-center gap-1 border-b border-border/70 px-3 py-2 active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={endDrag}
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 truncate text-sm font-medium">{surface.title}</h2>
          {isMinimized ? null : (
            <p className="truncate text-xs text-muted-foreground">{surface.subtitle}</p>
          )}
        </div>
        {surface.inspectorControl}
        <Button
          aria-label={isMinimized ? "Expand the theme editor" : "Minimize the theme editor"}
          size="icon-xs"
          variant="ghost"
          onClick={() => setIsMinimized(!isMinimized)}
        >
          {isMinimized ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
        <Button
          aria-label="Close the theme editor"
          size="icon-xs"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
        </Button>
      </div>

      {isMinimized ? null : (
        <>
          {surface.content}
          <div
            aria-hidden
            className="absolute bottom-0 right-0 z-10 flex size-5 cursor-se-resize touch-none select-none items-end justify-end p-1 text-muted-foreground/70"
            onPointerCancel={endResize}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
          >
            <svg
              className="size-2.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
              viewBox="0 0 8 8"
            >
              <path d="M7 1 1 7M7 4.5 4.5 7" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
