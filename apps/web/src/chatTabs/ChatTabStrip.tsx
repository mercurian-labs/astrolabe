import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { resolveComposerProviderSelection } from "~/components/ChatView.logic";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { sortProviderInstanceEntries, type ProviderInstanceEntry } from "~/providerInstances";
import { readThreadShell, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { providerEntriesByEnvironmentAtom } from "~/state/server";
import { environmentShell } from "~/state/shell";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
} from "~/threadRoutes";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { insertIndex, insertionLineX, startTabDragPreview } from "../panes/drag";
import { TabCloseButton, TabTitle } from "../panes/TabParts";
import { historyTarget } from "~/tabNavigation.logic";
import { chatTabsSlot, tabHistorySlot } from "../whichKey/handles";
import { neighbourOf, useChatTabsStore } from "./chatTabsStore";
import { registerThreadTabDrop } from "./threadTabDrop";

/** Where a chat's tab leads: its server thread, or its draft while it is one. */
type ChatRoute =
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "draft"; readonly draftId: DraftId };

const DRAG_TYPE = "application/x-astrolabe-chat-tab";

/**
 * Where a chat leads, read now: its server thread while it exists, else its draft; null for a
 * chat gone (deleted, or a draft discarded). For a chat a tab's history names, which no tab draws.
 */
function chatRouteOf(key: string): ChatRoute | null {
  const ref = parseScopedThreadKey(key);
  if (!ref) return null;
  const shell = readThreadShell(ref);
  if (shell && shell.deletedAt == null) return { kind: "thread", key };
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(ref);
  return draftId ? { kind: "draft", draftId } : null;
}

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
  const histories = useChatTabsStore((store) => store.histories);
  const providerEntriesByEnvironment = useAtomValue(providerEntriesByEnvironmentAtom);
  const navigate = useNavigate();
  // Each tab reports where it leads, so closing the tab in front can go to its neighbour.
  const routes = useRef(new Map<string, ChatRoute>());
  const list = useRef<HTMLDivElement>(null);
  // Where a dragged tab would land: its index, and the insertion line's place along the list.
  const [insertAt, setInsertAt] = useState<{ index: number; x: number } | null>(null);

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
  // Astrolabe: the sidebar header's arrows and `navigation.back`/`forward` walk the tab in front.
  const goInHistory = (direction: "back" | "forward") => {
    const target = useChatTabsStore
      .getState()
      .step(direction, (key) => routes.current.has(key) || chatRouteOf(key) !== null);
    if (target !== null) go(routes.current.get(target) ?? chatRouteOf(target) ?? undefined);
  };
  const dropTarget = (clientX: number) => {
    const element = list.current;
    const tabs = [...(element?.querySelectorAll("[data-chat-tab]") ?? [])].map((tab) =>
      tab.getBoundingClientRect(),
    );
    const index = insertIndex(
      tabs.map((box) => box.left + box.width / 2),
      clientX,
    );
    if (!element) return { index, x: 0 };
    const box = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).gap) || 0;
    const at = insertionLineX(tabs, index, gap, box.left + gap);
    return { index, x: Math.round(at - box.left + element.scrollLeft) };
  };

  // Astrolabe: threads dragged from the sidebar open at the insertion line, the one it was
  // picked up by in front (see `threadTabDrop.ts`).
  const showDragOver = (x: number | null) =>
    setInsertAt((current) => {
      if (x === null) return null;
      const next = dropTarget(x);
      return current?.index === next.index && current.x === next.x ? current : next;
    });
  const openDropped = (dropped: readonly string[], x: number, front: string) => {
    useChatTabsStore.getState().openAt(dropped, dropTarget(x).index);
    go(routes.current.get(front) ?? chatRouteOf(front) ?? undefined);
  };
  const handle = useRef({ select, close, goInHistory, showDragOver, openDropped });
  useLayoutEffect(() => {
    handle.current = { select, close, goInHistory, showDragOver, openDropped };
  });
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    return registerThreadTabDrop(element, {
      over: (x) => handle.current.showDragOver(x),
      drop: (dropped, x, front) => handle.current.openDropped(dropped, x, front),
    });
  }, []);
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
  const canGoBack = activeKey !== null && historyTarget(histories, activeKey, "back") !== null;
  const canGoForward =
    activeKey !== null && historyTarget(histories, activeKey, "forward") !== null;
  useEffect(
    () =>
      tabHistorySlot.register({
        canGoBack,
        canGoForward,
        go: (direction) => handle.current.goInHistory(direction),
      }),
    [canGoBack, canGoForward],
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

  return (
    <div
      ref={strip}
      data-chat-tab-strip
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center border-b border-border bg-muted pe-2 [--tab-join:var(--toolbar-background)]",
        isElectron && "drag-region",
        isElectron && atWindowEdge && "wco:pe-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      // The whole strip takes a dragged tab, so dropping short of the first tab, in the strip's
      // padding, puts it at the start. Astrolabe: the first tab sits as far from the sidebar's
      // edge as a pane strip's first tab does.
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const next = dropTarget(event.clientX);
        if (next.index !== insertAt?.index || next.x !== insertAt.x) setInsertAt(next);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertAt(null);
      }}
      onDrop={(event) => {
        const key = event.dataTransfer.getData(DRAG_TYPE);
        setInsertAt(null);
        if (!key) return;
        event.preventDefault();
        useChatTabsStore.getState().move(key, dropTarget(event.clientX).index);
      }}
    >
      <div
        ref={list}
        role="tablist"
        aria-label="Open chats"
        aria-orientation="horizontal"
        // Room on each side for the joined tab's curved feet and a tab's focus ring, and for the
        // insertion line before the first tab or after the last, which the scrolling list would
        // otherwise clip; down over the strip's bottom border, which the joined tab covers.
        className="relative -mb-px flex min-w-0 items-center gap-1 self-stretch overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs sideways.
          if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        {keys.map((key) => (
          <ChatTab
            key={key}
            tabKey={key}
            active={key === activeKey}
            providerEntriesByEnvironment={providerEntriesByEnvironment}
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
        {insertAt ? (
          // As tall as a rule between tabs and centred on the strip (`index.css`).
          <span
            className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-xs bg-primary"
            style={{ left: insertAt.x }}
          />
        ) : null}
      </div>
      <div className="ms-auto flex shrink-0 items-center ps-1.5">{trailing}</div>
    </div>
  );
}

function ChatTab({
  tabKey,
  active,
  providerEntriesByEnvironment,
  onRoute,
  onOpen,
  onClose,
  onDragEnd,
}: {
  tabKey: string;
  active: boolean;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>>;
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
  // Its harness, as its sidebar row draws it: a thread's running or selected instance; a draft's
  // composer pick, else the instance the composer would fall back to.
  const draftProvider = useComposerDraftStore((store) =>
    draftId ? (store.getComposerDraft(draftId)?.activeProvider ?? null) : null,
  );
  const threadProvider = shell
    ? (shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId)
    : null;
  const providerEntries = ref ? providerEntriesByEnvironment.get(ref.environmentId) : undefined;
  const providerEntry = useMemo(() => {
    if (!providerEntries) return null;
    if (threadProvider !== null) return providerEntries.get(threadProvider) ?? null;
    if (!draftId) return null;
    return (
      resolveComposerProviderSelection({
        entries: sortProviderInstanceEntries([...providerEntries.values()]),
        candidateInstanceIds: [draftProvider],
        lockedProvider: null,
        lockedInstanceId: null,
      }).selectedProviderEntry ?? null
    );
  }, [draftId, draftProvider, providerEntries, threadProvider]);

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
        // Astrolabe: drawn as a pane's tabs are, as Chrome's tabs (see `PaneView`'s `TabPill`).
        "group/tab relative flex w-60 min-w-24 shrink cursor-pointer items-center gap-1.5 border border-transparent ps-2.25 pe-1.5 text-xs font-medium transition-colors duration-75 outline-none select-none focus-visible:inset-ring focus-visible:inset-ring-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24",
        isElectron && "[-webkit-app-region:no-drag]",
        active
          ? "z-10 mt-1.5 self-stretch rounded-t-md border-border border-b-0 bg-(--tab-join) text-foreground"
          : "h-7 rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
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
        startTabDragPreview(event);
      }}
      onDragEnd={onDragEnd}
    >
      <span data-tab-icon className="flex size-4 shrink-0 items-center justify-center">
        {providerEntry ? (
          // No instance badge: at this size it would cover the glyph.
          <ProviderInstanceIcon
            driverKind={providerEntry.driverKind}
            displayName={providerEntry.displayName}
            accentColor={providerEntry.accentColor}
            acpRegistryAgentId={providerEntry.acpRegistryAgentId}
            acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
            iconClassName={cn("size-3", !active && "opacity-60 group-hover/tab:opacity-100")}
          />
        ) : (
          <MessagesSquare className="size-3 shrink-0" />
        )}
      </span>
      <TabTitle title={title} />
      <TabCloseButton
        label={`Close ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}
