/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { canvasBounds, type CanvasCodeReference, type CanvasData } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef, ThreadId, TurnItemId } from "@t3tools/contracts";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { useGT } from "gt-react";

import { readLocalApi } from "~/localApi";
import { workspace } from "~/panes/workspace";
import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShell } from "~/state/entities";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { repositoryFileReveal } from "../repositories/repositoryFileReveal";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { toastManager } from "../ui/toast";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useCanvasMenuItems } from "./canvasMenuItems";
import { codeCardTarget } from "./codeCardTarget";
import { useKeepCanvas } from "./KeepCanvas";
import { showThreadCanvas } from "./threadCanvasStore";
import { useThreadCanvasDocument } from "./useThreadCanvasDocument";

// The board brings the Markdown parser; a thread with no canvas shouldn't load it.
export const LazyCanvasBoard = lazy(() =>
  import("@mercurian/wiki-editor/canvas-board").then((module) => ({
    default: module.CanvasBoard,
  })),
);

const openUrl = (href: string) => {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(href);
  else window.open(href, "_blank", "noopener,noreferrer");
};

const namesFolder = (data: CanvasData) =>
  data.nodes.some((node) => node.type === "link" && node.astrolabe?.code?.root !== undefined);

/**
 * What a canvas's cards can reach from a thread; a guest page has no thread to open files in. A
 * card naming another of the project's folders opens that folder's file, as the thread has it.
 */
export function useCanvasHost(threadRef: ScopedThreadRef | null, data: CanvasData) {
  const gt = useGT();
  const shell = useThreadShell(threadRef);
  const listed = useEnvironmentQuery(
    threadRef === null || shell === null || !namesFolder(data)
      ? null
      : projectRootsEnvironment.list({
          environmentId: threadRef.environmentId,
          input: { projectId: shell.projectId, worktreePath: shell.worktreePath },
        }),
  );
  const roots = listed.data?.roots ?? null;
  if (threadRef === null) return { onOpenUrl: openUrl };
  const onOpenCode = (code: CanvasCodeReference) => {
    const line = code.lines?.[0];
    // The thread's own folder needs nothing read: its cards open in the thread's file panel.
    const target =
      code.root === undefined
        ? ({ kind: "panel", path: code.path } as const)
        : shell === null
          ? null
          : codeCardTarget({
              environmentId: threadRef.environmentId,
              projectId: shell.projectId,
              roots,
              code,
            });
    if (target === null) {
      toastManager.add({
        type: "warning",
        title: gt("Couldn't find {place} in this project", {
          place: `${code.root ?? ""}:${code.path}`,
        }),
      });
      return;
    }
    if (target.kind === "panel") {
      useRightPanelStore.getState().openFile(threadRef, target.path, line);
      return;
    }
    const key = repositoryTabKey(target.tab);
    workspace.show(key);
    if (line !== undefined) repositoryFileReveal.request(key, line);
  };
  return { onOpenUrl: openUrl, onOpenCode };
}

/**
 * A canvas in a thread, live: the whole board, sized by its own shape so the row never shifts when
 * the board loads. It pans and zooms in place; the wheel scrolls the thread until it's clicked.
 */
export function CanvasFrame({
  id,
  view,
  threadRef,
  source,
}: {
  readonly id: string;
  readonly view: CanvasView;
  readonly threadRef: ScopedThreadRef | null;
  /** The tool call that drew it, which a thread can hold from another thread. */
  readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId };
}) {
  const { width, height } = canvasBounds(view.data);
  const host = useCanvasHost(threadRef, view.data);
  const canvas = useThreadCanvasDocument(
    view,
    threadRef === null ? null : { environmentId: threadRef.environmentId, ...source },
  );
  const keep = useKeepCanvas(
    threadRef === null
      ? null
      : { environmentId: threadRef.environmentId, ...source, title: view.title },
  );
  const menuItems = useCanvasMenuItems(
    threadRef === null ? null : { ...source, title: view.title },
    keep.item,
  );
  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-border">
      <figcaption className="flex h-8 items-center gap-2 border-b border-border pr-1 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{view.title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {threadRef === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Open ${view.title} in a linked tab`}
                    onClick={() => showThreadCanvas(threadRef, id)}
                  />
                }
              >
                <SquareArrowOutUpRightIcon />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Open in a linked tab</TooltipPopup>
            </Tooltip>
          )}
        </div>
      </figcaption>
      <div
        className="max-h-[520px] min-h-40 w-full"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <Suspense fallback={null}>
          <LazyCanvasBoard
            data={view.data}
            mode="free"
            wheelOnceFocused
            host={host}
            label={view.title}
            menuItems={menuItems}
            {...(canvas === null || threadRef === null
              ? {}
              : {
                  document: canvas,
                  // The chat column is too narrow to edit in: Edit opens the board in its tab.
                  readOnly: true,
                  onReadOnly: (readOnly: boolean) => {
                    if (!readOnly) showThreadCanvas(threadRef, id, { edit: true });
                  },
                })}
          />
        </Suspense>
      </div>
      {keep.dialog}
    </figure>
  );
}
