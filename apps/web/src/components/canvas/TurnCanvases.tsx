/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { canvasViewFile, type CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef, ThreadId, TurnItemId } from "@t3tools/contracts";
import {
  BookmarkPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SquareArrowOutUpRightIcon,
  WaypointsIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasFrame } from "./CanvasFrame";
import { useKeepCanvas } from "./KeepCanvas";
import { showThreadCanvas } from "./threadCanvasStore";

const LazyCanvasMinimap = lazy(() =>
  import("@mercurian/wiki-editor/canvas-minimap").then((module) => ({
    default: module.CanvasMinimap,
  })),
);

export interface TurnCanvasEntry {
  readonly id: string;
  readonly canvas: CanvasView;
  readonly sourceThreadId: ThreadId;
  readonly itemId: TurnItemId;
  /** The turn's prose shows it with `![[…]]`. One it never showed is drawn here. */
  readonly embedded: boolean;
}

/**
 * Astrolabe: the canvases a turn drew, at its foot beside its changed files, whether or not the
 * reply embedded them. Each opens live in place or in a linked tab, and can be kept in the project. One
 * the reply never showed draws as a picture here, so it is never lost.
 */
export function TurnCanvases({
  canvases,
  threadRef,
}: {
  readonly canvases: ReadonlyArray<TurnCanvasEntry>;
  readonly threadRef: ScopedThreadRef | null;
}) {
  if (canvases.length === 0) return null;
  return (
    <section
      aria-label="Canvases"
      className="mt-4 rounded-lg bg-secondary dark:bg-input/20"
      data-turn-canvases=""
    >
      <h3 className="m-0 px-3 pt-2 pb-1 text-xs font-medium text-foreground">
        {canvases.length === 1 ? "1 canvas" : `${canvases.length} canvases`}
      </h3>
      <ul className="m-0 flex list-none flex-col p-0 pb-1">
        {canvases.map((entry) => (
          <TurnCanvasRow key={entry.id} entry={entry} threadRef={threadRef} />
        ))}
      </ul>
    </section>
  );
}

function TurnCanvasRow({
  entry,
  threadRef,
}: {
  readonly entry: TurnCanvasEntry;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { canvas: view } = entry;
  const [open, setOpen] = useState(false);
  const source = { threadId: entry.sourceThreadId, itemId: entry.itemId };
  const keep = useKeepCanvas(
    threadRef === null
      ? null
      : { environmentId: threadRef.environmentId, ...source, title: view.title },
  );
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li className="flex flex-col px-1">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          className="min-w-0 flex-1 justify-start"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} ${view.title}`}
          onClick={() => setOpen(!open)}
        >
          <Chevron className="size-3 shrink-0" />
          <WaypointsIcon className="size-3 shrink-0" />
          <span className="min-w-0 truncate text-foreground">{view.title}</span>
          <span className="hidden min-w-0 truncate sm:inline">{canvasViewFile(view)}</span>
        </Button>
        {threadRef === null ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Open ${view.title} in a linked tab`}
                  onClick={() => showThreadCanvas(threadRef, entry.id)}
                />
              }
            >
              <SquareArrowOutUpRightIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">Open in a linked tab</TooltipPopup>
          </Tooltip>
        )}
        {keep.item === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Keep ${view.title} in the project`}
                  onClick={keep.item.run}
                />
              }
            >
              <BookmarkPlusIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">Keep in the project</TooltipPopup>
          </Tooltip>
        )}
      </div>
      {open ? (
        <div className="px-2 pt-1 pb-2">
          <CanvasFrame id={entry.id} view={view} threadRef={threadRef} source={source} />
        </div>
      ) : entry.embedded ? null : (
        <button
          type="button"
          className="mx-2 mt-1 mb-2 block h-40 cursor-pointer rounded-md border border-border bg-background p-2 disabled:cursor-default"
          aria-label={`Open ${view.title}`}
          disabled={threadRef === null}
          onClick={() => {
            if (threadRef !== null) showThreadCanvas(threadRef, entry.id);
          }}
        >
          <Suspense fallback={null}>
            <LazyCanvasMinimap data={view.data} label={`The canvas ${view.title}`} words />
          </Suspense>
        </button>
      )}
      {keep.dialog}
    </li>
  );
}
