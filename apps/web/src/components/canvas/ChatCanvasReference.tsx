/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { useAtomValue } from "@effect/atom-react";
import { canvasBounds, canvasFrame, type CanvasBounds } from "@mercurian/wiki/canvas";
import { canvasViewNamed } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { CanvasLinkTarget } from "@t3tools/shared/canvasLinks";
import { WaypointsIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { canvasViewsAtom, canvasViewsKey, noCanvasViewsAtom } from "~/state/canvasViews";

import { showThreadCanvas } from "./threadCanvasStore";

const LazyCanvasMinimap = lazy(() =>
  import("@mercurian/wiki-editor/canvas-minimap").then((module) => ({
    default: module.CanvasMinimap,
  })),
);

/** As `CanvasMinimap` pads what it frames. */
const FIGURE_PADDING = 24;
/** A figure is never so thin or so tall that it stops reading as a picture. */
const MIN_ASPECT = 0.75;
const MAX_ASPECT = 3.5;

const aspectOf = (box: CanvasBounds) => {
  const width = box.width + FIGURE_PADDING * 2;
  const height = box.height + FIGURE_PADDING * 2;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, width / Math.max(1, height)));
};

/**
 * Astrolabe: `![[Name.canvas#Group]]` or `[[Name.canvas#Group]]` in a reply, resolved against the
 * thread's canvases. An embed is a static picture of the board, or of the named group with the rest
 * dimmed; a link is a chip. Either opens the live board in a linked tab, on that group. One that
 * names no canvas of the thread reads as the text it was written as.
 */
export function ChatCanvasReference({
  threadRef,
  target,
  written,
}: {
  readonly threadRef: ScopedThreadRef | undefined;
  readonly target: Omit<CanvasLinkTarget, "text">;
  /** The link as the reply wrote it, and its text. */
  readonly written: { readonly source: string; readonly text: string };
}) {
  const views = useAtomValue(
    threadRef === undefined ? noCanvasViewsAtom : canvasViewsAtom(canvasViewsKey(threadRef)),
  );
  const view = canvasViewNamed(views, target.name);
  if (view === undefined) {
    return target.name.toLowerCase().endsWith(".canvas") ? (
      <span className="text-muted-foreground">{written.source}</span>
    ) : (
      written.source
    );
  }
  const group = target.frame === undefined ? undefined : canvasFrame(view.data, target.frame);
  const missing = target.frame !== undefined && group === undefined;
  const name = group === undefined ? view.title : `${view.title} › ${group.label ?? target.frame}`;
  const open =
    threadRef === undefined
      ? undefined
      : () => showThreadCanvas(threadRef, view.id, group === undefined ? {} : { frame: group.id });
  if (!target.embed) {
    return (
      <button
        type="button"
        className="inline-flex cursor-pointer items-baseline gap-1 rounded-sm text-primary underline-offset-2 hover:underline disabled:cursor-default disabled:no-underline"
        disabled={open === undefined}
        aria-label={`Open ${name}`}
        data-markdown-copy={written.source}
        onClick={open}
      >
        <WaypointsIcon aria-hidden className="size-3.5 shrink-0 self-center" />
        {written.text}
        {missing ? <span className="text-muted-foreground">(whole board)</span> : null}
      </button>
    );
  }
  const box = group ?? canvasBounds(view.data);
  return (
    <button
      type="button"
      className="my-2 block w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-transparent p-0 text-left disabled:cursor-default"
      disabled={open === undefined}
      aria-label={`Open ${name}`}
      data-canvas-embed=""
      data-markdown-copy={`${written.source}\n`}
      onClick={open}
    >
      <span className="flex h-7 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <WaypointsIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{name}</span>
        {missing ? (
          <span className="ml-auto shrink-0">{`No group named "${target.frame}": whole board`}</span>
        ) : null}
      </span>
      {/* Sized by the frame before the picture loads, so a streaming reply never jumps. */}
      <span className="block max-h-96 w-full p-2" style={{ aspectRatio: String(aspectOf(box)) }}>
        <Suspense fallback={null}>
          <LazyCanvasMinimap
            data={view.data}
            label={`The canvas ${name}`}
            frame={group?.id}
            words
          />
        </Suspense>
      </span>
    </button>
  );
}
