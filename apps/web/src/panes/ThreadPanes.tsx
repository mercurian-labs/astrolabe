import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { useAtomValue } from "@effect/atom-react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { ThreadRouteView } from "../components/ThreadRouteView";
import { SidebarInset } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { primaryServerKeybindingsAtom } from "../state/server";
import type { ThreadRouteTarget } from "../threadRoutes";
import { CONVERSATION, resizePanes } from "./arrangement";
import {
  PaneSurfaceHostProvider,
  PanesHostContext,
  PanesThreadContext,
  createPanesHost,
  usePanesHost,
  type PanesHost,
} from "./PaneSurfaceHost";
import { createPanesController, type PanesSnapshot } from "./panesController";
import type { StorageLike } from "./persistence";
import { PaneView } from "./PaneView";
import {
  MIN_SPLIT_PX,
  minWidthPx,
  resizeTiled,
  type Direction,
  type Leaf,
  type SplitNode,
} from "./tree";

/**
 * The panes' handler for the terminal shortcut, while panes show a thread. Its window listener
 * is added when this module loads, before ChatView mounts and adds its own capture handler, so
 * it runs first and can keep ChatView from toggling the drawer the panes replace.
 */
let terminalShortcut: ((event: KeyboardEvent) => void) | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => terminalShortcut?.(event), true);
}

/** The narrowest the conversation's pane goes: room for the composer and its controls. */
const CONVERSATION_MIN_PX = 320;

function paneMinimum(leaf: Leaf) {
  return leaf.tabs.includes(CONVERSATION) ? CONVERSATION_MIN_PX : MIN_SPLIT_PX;
}

/** The thread a route shows: a server thread's own ref, or the thread a draft reserved. */
function useRouteThreadRef(target: ThreadRouteTarget): ScopedThreadRef | null {
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draft = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const environmentId =
    target.kind === "server" ? target.threadRef.environmentId : draft?.environmentId;
  const threadId = target.kind === "server" ? target.threadRef.threadId : draft?.threadId;
  return useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
}

/**
 * The main area beside T3 Code's sidebar for a thread: its tabs and panes. Below the width
 * where T3 Code's right panel becomes a sheet, and for a draft not yet known, the thread view
 * shows as T3 Code draws it, without panes.
 */
export function ThreadPanes({ target }: { target: ThreadRouteTarget }) {
  const compact = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const threadRef = useRouteThreadRef(target);
  if (compact || threadRef === null) return <ThreadRouteView target={target} />;
  return <PanesRoot target={target} threadRef={threadRef} />;
}

/** The device's storage; null where reading it throws, as with blocked site data. */
function deviceStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function PanesRoot({
  target,
  threadRef,
}: {
  target: ThreadRouteTarget;
  threadRef: ScopedThreadRef;
}) {
  const threadKey = scopedThreadKey(threadRef);
  const [host] = useState<PanesHost>(() => createPanesHost(createPanesController(deviceStorage())));
  const { controller } = host;

  useLayoutEffect(() => {
    controller.load(threadRef, threadKey);
  }, [controller, threadKey, threadRef]);

  // Declared after the load so it subscribes once the thread is loaded, and pairs its own
  // cleanup, as StrictMode's remount checks.
  useLayoutEffect(() => controller.follow(), [controller]);

  // The terminal shortcut opens or goes to a panel terminal: the panes have no drawer.
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
          previewFocus: isPreviewFocused(),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "terminal.toggle") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (controller.toggleTerminal() !== "conversation") return;
      // The conversation shows once the panes re-render; its composer takes focus then.
      requestAnimationFrame(() => {
        host.conversation.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
      });
    };
    terminalShortcut = handle;
    return () => {
      if (terminalShortcut === handle) terminalShortcut = null;
    };
  }, [controller, host, keybindings]);

  useEffect(() => {
    const save = () => controller.flush();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [controller]);

  // While another thread loads, the last one's panes stay up for that one render, so ChatView
  // stays mounted across the switch as T3 Code keeps it.
  const current = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  // The active surface's content shows only in the pane showing its tab.
  useLayoutEffect(() => {
    if (!current?.hostPaneId) host.hide("surface");
  }, [current?.hostPaneId, host]);

  return (
    <PanesHostContext.Provider value={host}>
      <PanesThreadContext.Provider value={threadRef}>
        <PaneSurfaceHostProvider>
          <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
            {current ? <PaneRoot snapshot={current} /> : null}
          </SidebarInset>
          {current ? createPortal(<ThreadRouteView target={target} />, host.conversation) : null}
        </PaneSurfaceHostProvider>
      </PanesThreadContext.Provider>
    </PanesHostContext.Provider>
  );
}

/**
 * The thread's panes, fitted to the main area. Panes never go below their minimum width; when
 * those add up past the main area, it scrolls sideways rather than squeezing them.
 */
function PaneRoot({ snapshot }: { snapshot: PanesSnapshot }) {
  const { arrangement, hostPaneId } = snapshot;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden" data-panes-root>
      <PaneNode
        node={arrangement.root}
        focused={arrangement.focused}
        hostPaneId={hostPaneId}
        atTop
        atLeft
        atRight
      />
    </div>
  );
}

function PaneNode({
  node,
  focused,
  hostPaneId,
  atTop,
  atLeft,
  atRight,
}: {
  node: SplitNode;
  focused: string;
  hostPaneId: string | null;
  /** Whether the node's top edge, left edge or right edge is the main area's. */
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
}) {
  if (node.type === "leaf") {
    return (
      <PaneView
        leaf={node}
        focused={node.id === focused}
        hosting={node.id === hostPaneId}
        atTop={atTop}
        atLeft={atLeft}
        atRight={atRight}
        minWidth={paneMinimum(node)}
      />
    );
  }
  return (
    <div
      className={
        node.direction === "column" ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1"
      }
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${node.weights[index] ?? 1} 1 0px` }}
          >
            <PaneNode
              node={child}
              focused={focused}
              hostPaneId={hostPaneId}
              atTop={atTop && (node.direction === "row" || index === 0)}
              atLeft={atLeft && (node.direction === "column" || index === 0)}
              atRight={
                atRight && (node.direction === "column" || index === node.children.length - 1)
              }
            />
          </div>
          {index < node.children.length - 1 ? (
            <Divider
              branchId={node.id}
              direction={node.direction}
              weights={node.weights}
              resize={(start, delta, extent) =>
                node.direction === "row"
                  ? resizeTiled(
                      start,
                      index,
                      delta,
                      extent,
                      minWidthPx(node.children[index] ?? node, paneMinimum),
                      minWidthPx(node.children[index + 1] ?? node, paneMinimum),
                    )
                  : resizeTiled(start, index, delta, extent)
              }
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The line between two panes, after Obsidian's: 1px, with a 3px handle that takes the accent
 * colour while hovered or dragged. Dragging captures the pointer and turns the drag into the
 * branch's new weights.
 */
function Divider({
  branchId,
  direction,
  weights,
  resize,
}: {
  branchId: string;
  direction: Direction;
  weights: readonly number[];
  resize: (start: readonly number[], deltaPx: number, extentPx: number) => readonly number[];
}) {
  const { controller } = usePanesHost();
  const drag = useRef<{ start: readonly number[]; origin: number; extent: number } | null>(null);
  const [active, setActive] = useState(false);
  const along = (event: PointerEvent) => (direction === "row" ? event.clientX : event.clientY);
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  const row = direction === "row";
  return (
    <div className={row ? "relative w-px shrink-0 bg-border" : "relative h-px shrink-0 bg-border"}>
      <div
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        data-active={active || undefined}
        className={
          row
            ? "absolute inset-y-0 -left-px z-10 w-[3px] cursor-col-resize touch-none transition-colors hover:bg-primary data-active:bg-primary"
            : "absolute inset-x-0 -top-px z-10 h-[3px] cursor-row-resize touch-none transition-colors hover:bg-primary data-active:bg-primary"
        }
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const branch = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            start: weights,
            origin: along(event),
            extent: branch ? (row ? branch.width : branch.height) : 0,
          };
          setActive(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const next = resize(start.start, along(event) - start.origin, start.extent);
          controller.update((arrangement) => resizePanes(arrangement, branchId, next));
        }}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}
