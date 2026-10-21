import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
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
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { cn } from "../lib/utils";
import { useThreadShell } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  CONVERSATION,
  activateTab,
  addGuests,
  focusedPane,
  guestThreadOf,
  resizePanes,
} from "./arrangement";
import { GuestWorkspaceDialog } from "./GuestWorkspaceDialog";
import {
  OpenGuestProvider,
  PaneMemberProvider,
  PaneSurfaceHostProvider,
  PanesHostContext,
  PanesThreadContext,
  createPanesHost,
  usePanesHost,
  type PaneMember,
  type PanesHost,
} from "./PaneSurfaceHost";
import { createPanesController, type PanesSnapshot } from "./panesController";
import type { StorageLike } from "./persistence";
import { PaneView, closeTabOf } from "./PaneView";
import { useMaximizedPaneId, useMaximizedPaneStore } from "./maximize";
import { panesShortcut } from "./shortcuts";
import { NO_TAB_SELECTION, tabsActedOn, useTabSelectionStore } from "./tabSelection";
import { selectThreadPanelOpen, useRightPanelStore } from "../rightPanelStore";
import {
  findLeaf,
  leafWithTab,
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
 * The main area beside T3 Code's sidebar for a thread: its tabs and panes, at every width; past
 * the panes' minimum widths the main area scrolls sideways. For a draft not yet known, the
 * thread view shows as T3 Code draws it, without panes.
 */
export function ThreadPanes({ target }: { target: ThreadRouteTarget }) {
  const threadRef = useRouteThreadRef(target);
  if (threadRef === null) return <ThreadRouteView target={target} />;
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
  const [storage] = useState(deviceStorage);
  const [host] = useState<PanesHost>(() => createPanesHost(createPanesController(storage)));
  const { controller } = host;

  useLayoutEffect(() => {
    // A selection of tabs is one thread's: another thread starts with none.
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    controller.load(threadRef, threadKey);
  }, [controller, threadKey, threadRef]);

  // Declared after the load so it subscribes once the thread is loaded, and pairs its own
  // cleanup, as StrictMode's remount checks.
  useLayoutEffect(() => controller.follow(), [controller]);

  // The shortcuts T3 Code's drawer and right panel answered (see `panesShortcut`).
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
      const snapshot = controller.getSnapshot();
      const focusedTab = snapshot ? focusedPane(snapshot.arrangement).active : null;
      const action = panesShortcut(command, focusedTab);
      if (action === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || action === "ignore") return;
      if (action === "toggle-maximized") {
        // A lone pane has nothing to fill the main area over.
        if (snapshot && leavesOf(snapshot.arrangement.root).length > 1) {
          useMaximizedPaneStore.getState().toggle(threadKey, snapshot.arrangement.focused);
        }
        return;
      }
      if (action === "close-tab") {
        const pane = snapshot ? focusedPane(snapshot.arrangement) : null;
        if (!pane || focusedTab === null) return;
        // The selection the focused tab belongs to closes with it.
        const selection = useTabSelectionStore.getState().selection;
        for (const key of tabsActedOn(selection, pane, focusedTab)) {
          if (key !== CONVERSATION) closeTabOf(controller, key);
        }
        useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
        return;
      }
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
  }, [controller, host, keybindings, threadKey]);

  // Escape clears a selection of tabs.
  useEffect(() => {
    const { change } = useTabSelectionStore.getState();
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useTabSelectionStore.getState().selection.keys.length === 0) return;
      change(() => NO_TAB_SELECTION);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

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

  // The thread details belong to the conversation: its popover, which floats over everything,
  // closes when another tab takes the conversation's place. The inline card hides with it.
  const conversationShown =
    current !== null &&
    leafWithTab(current.arrangement.root, CONVERSATION)?.active === CONVERSATION;
  useEffect(() => {
    if (conversationShown) return;
    const panels = useRightPanelStore.getState();
    if (selectThreadPanelOpen(panels.threadPanelVisibilityByThreadKey, threadRef, "popover")) {
      panels.setThreadPanelOpen(threadRef, "popover", false);
    }
  }, [conversationShown, threadRef]);

  // The active surface's content shows only in the pane showing its tab.
  useLayoutEffect(() => {
    if (!current?.hostPaneId) host.hide("surface");
  }, [current?.hostPaneId, host]);

  // A thread made or picked from here (a fork, a thread in Lineage) opens beside the
  // conversation as a guest, and comes forward.
  const openGuest = useMemo(
    () => (thread: ScopedThreadRef) => {
      const key = scopedThreadKey(thread);
      controller.update((arrangement) =>
        key === threadKey
          ? activateTab(arrangement, CONVERSATION)
          : addGuests(arrangement, [key], { show: true }),
      );
    },
    [controller, threadKey],
  );

  // The thread the focused pane shows answers the page's keys: a guest, or else the host.
  const focusedGuest = current ? guestThreadOf(focusedPane(current.arrangement).active) : null;
  // A guest's view is live while its tab shows.
  const shownGuests = current
    ? [
        ...new Set(
          leavesOf(current.arrangement.root).flatMap((leaf) => guestThreadOf(leaf.active) ?? []),
        ),
      ]
    : [];
  const shownSignature = shownGuests.join("\n");
  useLayoutEffect(() => {
    host.hideGuestsExcept(new Set(shownSignature === "" ? [] : shownSignature.split("\n")));
  }, [host, shownSignature]);
  const hostMember = useMemo<PaneMember>(
    () => ({ role: "host", active: focusedGuest === null }),
    [focusedGuest],
  );

  return (
    <PanesHostContext.Provider value={host}>
      <PanesThreadContext.Provider value={threadRef}>
        <PaneSurfaceHostProvider>
          <OpenGuestProvider value={openGuest}>
            <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
              {current ? <PaneRoot snapshot={current} /> : null}
            </SidebarInset>
            {current ? (
              <PaneMemberProvider value={hostMember}>
                {createPortal(<ThreadRouteView target={target} />, host.conversation)}
              </PaneMemberProvider>
            ) : null}
            {shownGuests.map((guest) => (
              <GuestView
                key={guest}
                threadKey={guest}
                active={focusedGuest === guest}
                container={host.guest(guest)}
              />
            ))}
            {current ? (
              <GuestWorkspaceDialog
                hostKey={threadKey}
                arrangement={current.arrangement}
                storage={storage}
              />
            ) : null}
          </OpenGuestProvider>
        </PaneSurfaceHostProvider>
      </PanesThreadContext.Provider>
    </PanesHostContext.Provider>
  );
}

/**
 * A guest's thread view: its thread, or its draft while it is one, rendered into its own
 * container, which moves into the pane showing its tab. It answers the page only while its pane
 * has focus, and never moves the route.
 */
function GuestView({
  threadKey,
  active,
  container,
}: {
  threadKey: string;
  active: boolean;
  container: HTMLDivElement;
}) {
  const threadRef = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const shell = useThreadShell(threadRef);
  const draftId = useComposerDraftStore((store) =>
    shell || !threadRef ? null : store.getDraftIdByRef(threadRef),
  );
  const target = useMemo<ThreadRouteTarget | null>(
    () =>
      threadRef === null
        ? null
        : draftId
          ? { kind: "draft", draftId }
          : { kind: "server", threadRef },
    [draftId, threadRef],
  );
  const member = useMemo<PaneMember>(
    () => ({ role: "guest", threadKey, active }),
    [active, threadKey],
  );
  if (!target) return null;
  return (
    <PaneMemberProvider value={member}>
      {createPortal(<ThreadRouteView target={target} />, container)}
    </PaneMemberProvider>
  );
}

function leavesOf(node: SplitNode): Leaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(leavesOf);
}

/**
 * The thread's panes, fitted to the main area. Panes never go below their minimum width; when
 * those add up past the main area, it scrolls sideways rather than squeezing them.
 */
function PaneRoot({ snapshot }: { snapshot: PanesSnapshot }) {
  const { arrangement, hostPaneId } = snapshot;
  const maximizedId = useMaximizedPaneId();
  // Maximizing ends once the pane is gone or the last one left, so a later split shows every
  // pane rather than maximizing again.
  const maximized =
    maximizedId !== null &&
    findLeaf(arrangement.root, maximizedId) &&
    leavesOf(arrangement.root).length > 1
      ? maximizedId
      : null;
  useEffect(() => {
    if (maximizedId !== null && maximized === null) useMaximizedPaneStore.getState().restore();
  }, [maximized, maximizedId]);
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-y-hidden",
        maximized === null ? "overflow-x-auto" : "overflow-x-hidden",
      )}
      data-panes-root
    >
      <PaneNode
        node={arrangement.root}
        focused={arrangement.focused}
        hostPaneId={hostPaneId}
        maximized={maximized}
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
  maximized,
  atTop,
  atLeft,
  atRight,
}: {
  node: SplitNode;
  focused: string;
  hostPaneId: string | null;
  /** The pane filling the main area, if one does; the others stay mounted beneath it. */
  maximized: string | null;
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
        maximized={maximized === null ? null : maximized === node.id}
        atTop={maximized === node.id || atTop}
        atLeft={maximized === node.id || atLeft}
        atRight={maximized === node.id || atRight}
        minWidth={paneMinimum(node)}
      />
    );
  }
  return (
    // Each pane and split holds its minimum width and no more: left to their content, a strip
    // of tabs (which scrolls) would count at its full width and push the panes past the main
    // area.
    <div
      className={
        node.direction === "column"
          ? "flex min-h-0 min-w-0 flex-1 flex-col"
          : "flex min-h-0 min-w-0 flex-1"
      }
      style={{ minWidth: minWidthPx(node, paneMinimum) }}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            className="flex min-h-0"
            style={{
              flex: `${node.weights[index] ?? 1} 1 0px`,
              minWidth: minWidthPx(child, paneMinimum),
            }}
          >
            <PaneNode
              node={child}
              focused={focused}
              hostPaneId={hostPaneId}
              maximized={maximized}
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
