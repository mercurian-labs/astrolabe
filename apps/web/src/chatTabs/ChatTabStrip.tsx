import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { resolveComposerProviderSelection } from "~/components/ChatView.logic";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { allTabs, showTabBefore } from "~/panes/arrangement";
import { RightPanelHostContext } from "~/panes/PaneSurfaceHost";
import { noteTabGroupRuns, useTabGroupRelease } from "~/panes/tabGroupNumbers";
import { tabGroupRuns } from "~/panes/tabGroupRuns";
import {
  TabGroupRun,
  tabGroupId,
  useTabGroupCollapsed,
  useTabGroupLookup,
  type TabGroupLookup,
  type TabGroupRunActions,
} from "~/panes/tabGroups";
import { sortProviderInstanceEntries, type ProviderInstanceEntry } from "~/providerInstances";
import { useRightPanelStore } from "~/rightPanelStore";
import { chatTabKey } from "~/sectionTabs/sectionTabs";
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
import { preventTabMiddleButtonDefault, TabCloseButton, TabTitle } from "../panes/TabParts";
import { historyTarget } from "~/tabNavigation.logic";
import { chatTabsSlot, tabHistorySlot } from "../whichKey/handles";
import { neighbourOf, useChatTabsStore } from "./chatTabsStore";
import { registerThreadTabDrop } from "./threadTabDrop";

/** Where a chat's tab leads: its server thread, or its draft while it is one. */
type ChatRoute =
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "draft"; readonly draftId: DraftId };

const DRAG_TYPE = "application/x-astrolabe-chat-tab";
/** Astrolabe: a tab group dragged by its marker, by its id (`tabGroupId`). */
const RUN_DRAG_TYPE = "application/x-astrolabe-chat-tab-group";

const NO_GROUPS: readonly EnvironmentChangeGroup[] = [];
/** How long a marker waits for the right panel to show the chat it brought to the front. */
const SHOW_GROUP_TIMEOUT_MS = 5_000;

/** The change groups a chat's tab is in, as its chat's tab in a pane is (`useTabGroupLookup`). */
function chatGroupsOf(groupsOf: TabGroupLookup, key: string): readonly EnvironmentChangeGroup[] {
  const ref = parseScopedThreadKey(key);
  return ref ? groupsOf(chatTabKey(ref)) : NO_GROUPS;
}

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
  // Astrolabe: the chat in front's right panel, where a tab group's marker shows the group's tab.
  const panes = useContext(RightPanelHostContext)?.controller ?? null;
  // Astrolabe: the strip in runs, a change group's threads together behind its marker, as a
  // pane's strip shows them (`tabGroups`).
  const groupsOf = useTabGroupLookup();
  const runs = useMemo(
    () => tabGroupRuns(keys, (key) => chatGroupsOf(groupsOf, key), tabGroupId),
    [groupsOf, keys],
  );
  // The groups shown here take their numbers before the strip paints (`tabGroupNumbers`).
  useLayoutEffect(() => {
    noteTabGroupRuns(
      runs.flatMap(({ group, keys: run }) => (group ? [{ id: tabGroupId(group), keys: run }] : [])),
    );
  }, [runs]);
  // A tab leaving the strip may have been its group's last anywhere.
  useTabGroupRelease(null, keys);
  const isCollapsed = useTabGroupCollapsed();
  // The run dragged by its marker, which shows the marker alone until the drag ends.
  const [draggedRun, setDraggedRun] = useState<string | null>(null);
  const dragged = useRef<{ readonly id: string; readonly keys: readonly string[] } | null>(null);

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
  const open = (key: string, route: ChatRoute | null) => {
    if (route) go(route);
    // A chat that is neither a thread nor a draft any more has nothing to show.
    else useChatTabsStore.getState().close(key);
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
  /**
   * Where a tab dragged to `clientX` lands: its index among the open chats, and the insertion
   * line's place. The line goes between the tabs shown, or for a tab group dragged by its marker
   * (`wholeRuns`) between whole runs; the index counts a collapsed group's hidden tabs too.
   */
  const dropTarget = (clientX: number, wholeRuns = false) => {
    const element = list.current;
    const places = [
      ...(element?.querySelectorAll<HTMLElement>(
        wholeRuns ? ":scope > [data-chat-tab], :scope > [data-tab-group-run]" : "[data-chat-tab]",
      ) ?? []),
    ];
    const tabs = places.map((place) => place.getBoundingClientRect());
    const at = insertIndex(
      tabs.map((box) => box.left + box.width / 2),
      clientX,
    );
    const openKeys = useChatTabsStore.getState().keys;
    const before = places[at];
    const found = before
      ? openKeys.indexOf(before.dataset.key ?? before.dataset.firstKey ?? "")
      : -1;
    const index = found === -1 ? openKeys.length : found;
    if (!element) return { index, x: 0 };
    const box = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).gap) || 0;
    const x = insertionLineX(tabs, at, gap, box.left + gap);
    return { index, x: Math.round(x - box.left + element.scrollLeft) };
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
  const handle = useRef({ select, close, open, goInHistory, showDragOver, openDropped });
  useLayoutEffect(() => {
    handle.current = { select, close, open, goInHistory, showDragOver, openDropped };
  });
  // What each tab asks of the strip, the same across renders so the tabs render only for their own
  // changes.
  const tabActions = useMemo<ChatTabActions>(
    () => ({
      route: (key, route) => {
        if (route) routes.current.set(key, route);
        else routes.current.delete(key);
      },
      open: (key, route) => handle.current.open(key, route),
      close: (key) => handle.current.close(key),
      dragEnd: () => setInsertAt(null),
    }),
    [],
  );
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

  /**
   * Astrolabe: a tab group's marker here, for its run of chats (`run`). It shows the group's tab
   * beside a chat of the group, opening its right panel, and in front there: beside the chat in
   * front when that chat is in the group, else beside the run's first chat, which comes to the
   * front first. The group's tab is its shared run's (`groupPanelRuns.ts`), so it opens beside
   * every thread in the group, and never beside a thread outside it. It closes the run's chats,
   * leaving the panels' runs as they are, and drags the run along the strip only.
   */
  const runActions = (
    group: EnvironmentChangeGroup,
    run: readonly string[],
  ): TabGroupRunActions => ({
    show: () => {
      if (!panes) return;
      const id = tabGroupId(group);
      const inGroup = (key: string) =>
        chatGroupsOf(groupsOf, key).some((each) => tabGroupId(each) === id);
      const beside = activeKey !== null && inGroup(activeKey) ? activeKey : run[0];
      if (beside === undefined) return;
      // Once the panel shows `beside`'s thread: the route may still be on its way there.
      const showHere = () => {
        const ref = panes.threadRef();
        if (!ref || scopedThreadKey(ref) !== beside || panes.getSnapshot() === null) return false;
        useRightPanelStore.getState().show(ref);
        panes.update((arrangement) =>
          showTabBefore(
            arrangement,
            changeGroupTabKey(group),
            allTabs(arrangement).find((tab) =>
              groupsOf(tab).some((each) => tabGroupId(each) === id),
            ) ?? "",
          ),
        );
        return true;
      };
      if (showHere()) return;
      go(routes.current.get(beside) ?? chatRouteOf(beside) ?? undefined);
      const stop = panes.subscribe(() => {
        if (showHere()) stop();
      });
      // A route that never arrives there leaves nothing waiting.
      setTimeout(stop, SHOW_GROUP_TIMEOUT_MS);
    },
    close: () => {
      const store = useChatTabsStore.getState();
      if (activeKey !== null && run.includes(activeKey)) {
        const rest = store.keys.filter((key) => key === activeKey || !run.includes(key));
        const next = neighbourOf(rest, activeKey);
        go(next === null ? undefined : routes.current.get(next));
      }
      for (const key of run) store.close(key);
    },
    dragStart: (event: DragEvent<HTMLElement>) => {
      const id = tabGroupId(group);
      dragged.current = { id, keys: run };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(RUN_DRAG_TYPE, id);
      startTabDragPreview(event);
      // After the drag has started, so the run collapses without disturbing it.
      setTimeout(() => setDraggedRun(dragged.current?.id ?? null));
    },
    dragEnd: () => {
      dragged.current = null;
      setDraggedRun(null);
      setInsertAt(null);
    },
  });

  const renderTab = (key: string) => (
    <ChatTab
      key={key}
      tabKey={key}
      active={key === activeKey}
      providerEntriesByEnvironment={providerEntriesByEnvironment}
      actions={tabActions}
    />
  );

  return (
    <div
      ref={strip}
      data-chat-tab-strip
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center border-b border-border bg-(--astrolabe-rail) pe-2 [--tab-join:var(--toolbar-background)]",
        isElectron && "drag-region",
        isElectron && atWindowEdge && "wco:pe-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      // The whole strip takes a dragged tab, so dropping short of the first tab, in the strip's
      // padding, puts it at the start. Astrolabe: the first tab sits as far from the sidebar's
      // edge as a pane strip's first tab does.
      onDragOver={(event) => {
        const wholeRuns = event.dataTransfer.types.includes(RUN_DRAG_TYPE);
        if (!wholeRuns && !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const next = dropTarget(event.clientX, wholeRuns);
        if (next.index !== insertAt?.index || next.x !== insertAt.x) setInsertAt(next);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertAt(null);
      }}
      onDrop={(event) => {
        setInsertAt(null);
        // Astrolabe: a tab group dragged by its marker lands whole, between runs.
        const run = event.dataTransfer.types.includes(RUN_DRAG_TYPE) ? dragged.current : null;
        if (run) {
          event.preventDefault();
          useChatTabsStore.getState().openAt(run.keys, dropTarget(event.clientX, true).index);
          return;
        }
        const key = event.dataTransfer.getData(DRAG_TYPE);
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
        {runs.map(({ group, keys: run }) => {
          if (group === null) return run.map(renderTab);
          const id = tabGroupId(group);
          const collapsedNow = isCollapsed(id) || draggedRun === id;
          return (
            <TabGroupRun
              key={`${id}:${run[0]}`}
              group={group}
              firstKey={run[0]}
              shownKeys={
                draggedRun === id ? [] : run.filter((key) => !collapsedNow || key === activeKey)
              }
              collapsedNow={collapsedNow}
              dragging={draggedRun === id}
              actions={runActions(group, run)}
              renderTab={renderTab}
            />
          );
        })}
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

/** What a tab asks of its strip, by its key. */
interface ChatTabActions {
  /** Where the tab leads now, or null for a chat gone. */
  readonly route: (key: string, route: ChatRoute | null) => void;
  readonly open: (key: string, route: ChatRoute | null) => void;
  readonly close: (key: string) => void;
  readonly dragEnd: () => void;
}

const ChatTab = memo(function ChatTab({
  tabKey,
  active,
  providerEntriesByEnvironment,
  actions,
}: {
  tabKey: string;
  active: boolean;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>>;
  actions: ChatTabActions;
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
  useEffect(() => actions.route(tabKey, route), [actions, route, tabKey]);
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
        if (!active) actions.open(tabKey, route);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!active) actions.open(tabKey, route);
        }
      }}
      // Middle-click closes.
      onMouseDown={preventTabMiddleButtonDefault}
      onMouseUp={preventTabMiddleButtonDefault}
      onAuxClick={(event) => {
        if (event.button === 1) actions.close(tabKey);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, tabKey);
        startTabDragPreview(event);
      }}
      onDragEnd={actions.dragEnd}
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
          actions.close(tabKey);
        }}
      />
    </div>
  );
});
