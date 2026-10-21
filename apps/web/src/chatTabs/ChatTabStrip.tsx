import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { environmentShell } from "~/state/shell";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
} from "~/threadRoutes";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { insertIndex } from "../panes/drag";
import { chatTabsSlot } from "../whichKey/handles";
import { neighbourOf, useChatTabsStore } from "./chatTabsStore";

/** Where a chat's tab leads: its server thread, or its draft while it is one. */
type ChatRoute =
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "draft"; readonly draftId: DraftId };

const DRAG_TYPE = "application/x-astrolabe-chat-tab";

/**
 * Draws the chat tabs where ChatView puts them: across the top of its chat column, above its
 * header. `atWindowEdge` is whether the strip reaches the window's right edge, as it does while
 * the right panel is closed. `trailing` ends the strip: the chat's own controls.
 */
export type ChatTabStripSlot = (options: {
  readonly atWindowEdge: boolean;
  readonly trailing: ReactNode;
}) => ReactNode;

export const ChatTabStripContext = createContext<ChatTabStripSlot | null>(null);

/** The chat tabs for ChatView to draw; null outside the chat tabs. */
export function useChatTabStrip(): ChatTabStripSlot | null {
  return useContext(ChatTabStripContext);
}

/**
 * The open chats, as tabs; the route's thread is the one in front. It is the chat column's part
 * of the window's title bar: it drags the window on desktop, clears a collapsed sidebar's
 * controls on the left, and while it reaches the window's right edge leaves room for the
 * window's own controls.
 */
export function ChatTabStrip({
  activeKey,
  atWindowEdge,
  trailing,
}: {
  activeKey: string | null;
  atWindowEdge: boolean;
  trailing: ReactNode;
}) {
  const keys = useChatTabsStore((store) => store.keys);
  const navigate = useNavigate();
  // Each tab reports where it leads, so closing the tab in front can go to its neighbour.
  const routes = useRef(new Map<string, ChatRoute>());
  const list = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const go = (route: ChatRoute | undefined) => {
    if (!route) return void navigate({ to: "/" });
    if (route.kind === "draft") {
      return void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(route.draftId),
      });
    }
    const ref = parseScopedThreadKey(route.key);
    if (ref)
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const close = (key: string) => {
    const store = useChatTabsStore.getState();
    if (key === activeKey) {
      const next = neighbourOf(store.keys, key);
      go(next === null ? undefined : routes.current.get(next));
    }
    store.close(key);
  };

  // Astrolabe: the keyboard menu and the Command Palette select and close tabs as the strip does.
  const select = (key: string) => {
    const route = routes.current.get(key);
    if (route && key !== activeKey) go(route);
  };
  const handle = useRef({ select, close });
  useLayoutEffect(() => {
    handle.current = { select, close };
  });
  useEffect(
    () =>
      chatTabsSlot.register({
        keys,
        activeKey,
        select: (key) => handle.current.select(key),
        close: (key) => handle.current.close(key),
      }),
    [activeKey, keys],
  );

  // The tab in front scrolls into view.
  useEffect(() => {
    const element = list.current;
    if (!element || activeKey === null) return;
    const pill = [...element.querySelectorAll<HTMLElement>("[data-chat-tab]")].find(
      (tab) => tab.dataset.key === activeKey,
    );
    pill?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, keys]);

  const dropIndex = (event: DragEvent) => {
    const tabs = [...(list.current?.querySelectorAll("[data-chat-tab]") ?? [])].map((tab) =>
      tab.getBoundingClientRect(),
    );
    return insertIndex(
      tabs.map((box) => box.left + box.width / 2),
      event.clientX,
    );
  };

  return (
    <div
      data-chat-tab-strip
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center border-b border-border bg-muted ps-3.5 pe-2",
        isElectron && "drag-region",
        isElectron && atWindowEdge && "wco:pe-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      // The whole strip takes a dragged tab, so dropping short of the first tab, in the strip's
      // padding, puts it at the start. The first tab starts in line with the header's breadcrumb,
      // which also keeps that padding clear of the sidebar's resize rail.
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setInsertAt(dropIndex(event));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertAt(null);
      }}
      onDrop={(event) => {
        const key = event.dataTransfer.getData(DRAG_TYPE);
        setInsertAt(null);
        if (!key) return;
        event.preventDefault();
        useChatTabsStore.getState().move(key, dropIndex(event));
      }}
    >
      <div
        ref={list}
        role="tablist"
        aria-label="Open chats"
        aria-orientation="horizontal"
        // Room on each side for a pill's shadow and focus ring, and for the insertion line before
        // the first tab or after the last, which the scrolling list would otherwise clip.
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs sideways.
          if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        {keys.map((key, index) => (
          <ChatTab
            key={key}
            tabKey={key}
            active={key === activeKey}
            insertBefore={insertAt === index}
            insertAfter={insertAt === keys.length && index === keys.length - 1}
            onRoute={(route) => {
              if (route) routes.current.set(key, route);
              else routes.current.delete(key);
            }}
            onOpen={(route) => {
              if (route) go(route);
              // A chat that is neither a thread nor a draft any more has nothing to show.
              else useChatTabsStore.getState().close(key);
            }}
            onClose={() => close(key)}
            onDragEnd={() => setInsertAt(null)}
          />
        ))}
      </div>
      <div className="ms-auto flex shrink-0 items-center ps-1.5">{trailing}</div>
    </div>
  );
}

function ChatTab({
  tabKey,
  active,
  insertBefore,
  insertAfter,
  onRoute,
  onOpen,
  onClose,
  onDragEnd,
}: {
  tabKey: string;
  active: boolean;
  insertBefore: boolean;
  insertAfter: boolean;
  onRoute: (route: ChatRoute | null) => void;
  onOpen: (route: ChatRoute | null) => void;
  onClose: () => void;
  onDragEnd: () => void;
}) {
  const ref = useMemo(() => parseScopedThreadKey(tabKey), [tabKey]);
  const shell = useThreadShell(ref);
  const draftId = useComposerDraftStore((store) =>
    shell || !ref ? null : store.getDraftIdByRef(ref),
  );
  const live = isThreadRouteSnapshotAuthoritative(
    useEnvironmentQuery(ref ? environmentShell.stateAtom(ref.environmentId) : null).data?.status,
  );
  const exists = shell !== null && shell.deletedAt == null;
  const route = useMemo<ChatRoute | null>(
    () => (exists ? { kind: "thread", key: tabKey } : draftId ? { kind: "draft", draftId } : null),
    [draftId, exists, tabKey],
  );
  useEffect(() => onRoute(route), [onRoute, route]);
  // A chat deleted, or a draft discarded, closes its tab once its environment's threads are known.
  // The chat in front leaves through ThreadRouteView's own redirect first.
  const gone = live && route === null;
  useEffect(() => {
    if (gone && !active) useChatTabsStore.getState().close(tabKey);
  }, [active, gone, tabKey]);
  // A thread not yet sent has no title of its own.
  const title = shell?.title ?? "New thread";

  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={title}
      draggable
      data-chat-tab
      data-key={tabKey}
      className={cn(
        // A pill as wide as its title up to 220px; short of room the pills shrink together to
        // 96px, then the strip scrolls. `--pill` is its fill, which the close control fades to.
        "group/tab relative flex h-7 max-w-[220px] min-w-24 shrink cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-(--pill) px-2.25 text-xs font-medium transition-colors duration-75 outline-none select-none focus-visible:inset-ring focus-visible:inset-ring-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24",
        isElectron && "[-webkit-app-region:no-drag]",
        active
          ? "border-border text-foreground shadow-xs/5 [--pill:var(--card)]"
          : "text-muted-foreground [--pill:color-mix(in_oklch,var(--muted),black_4%)] hover:text-foreground hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)] dark:[--pill:color-mix(in_oklch,var(--muted),black_22%)] dark:hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)]",
      )}
      onClick={() => {
        if (!active) onOpen(route);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!active) onOpen(route);
        }
      }}
      onMouseDown={(event) => {
        // Middle-click closes; keep the browser from starting its autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, tabKey);
      }}
      onDragEnd={onDragEnd}
    >
      {insertBefore ? <InsertionLine side="start" /> : null}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <MessagesSquare className="size-3 shrink-0" />
      </span>
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate">{title}</span>} />
        <TooltipPopup>{title}</TooltipPopup>
      </Tooltip>
      {/* Over the pill's end while it is hovered or focus is inside it, on a backdrop that fades
          the title out before it, so the pill keeps its width. Only the 16px ✕ takes clicks. */}
      <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100">
        <span className="h-full w-6 bg-linear-to-r from-transparent to-(--pill)" />
        <span className="flex h-full items-center rounded-e-md bg-(--pill) pe-1.5">
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="pointer-events-auto flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      </span>
      {insertAfter ? <InsertionLine side="end" /> : null}
    </div>
  );
}

function InsertionLine({ side }: { side: "start" | "end" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0.5 w-0.5 rounded-xs bg-primary",
        side === "start" ? "-start-[5px]" : "-end-[5px]",
      )}
    />
  );
}
