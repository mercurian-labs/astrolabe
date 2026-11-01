import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { pullRequestTargetOfKey } from "~/components/pullRequest/pullRequestTabs";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import {
  chatSurfaceKey,
  chatTabKey,
  isSectionTabKey,
  parseChatSurfaceKey,
  parseChatTabKey,
} from "~/sectionTabs/sectionTabs";
import {
  dropHistoryTarget,
  historyTarget,
  keepHistories,
  parseHistories,
  replaceInHistory,
  stepHistory,
  type HistoryDirection,
  type TabHistories,
} from "~/tabNavigation.logic";
import {
  activateTab,
  allTabs,
  closeTab,
  focusedPane,
  focusPane,
  isEmptyTab,
  openBeside,
  openTab,
  placeTabs,
  replaceTab,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import {
  linkedArrangement,
  linkTab,
  openLinked,
  settleLinks,
  unlinkTab,
  type LinkContext,
  type LinkedArrangement,
} from "./linkedTabs";
import type { PanelProps } from "./panesController";
import type { PaneArrangementSnapshot, PaneArrangementStore } from "./panesHost";
import {
  isStarting,
  joinLayouts,
  parseArrangement,
  parseLinkedArrangement,
  type StorageLike,
} from "./persistence";
import {
  activeSurfaceFor,
  followRecord,
  hostPaneId,
  type PanelRecord,
  type SurfaceKeys,
} from "./surfaceMirror";
import { findLeaf, leafWithTab, leaves, type Side } from "./tree";
import { hasUnsavedEdits } from "./unsavedEdits";

/**
 * Astrolabe: the one set of panes every section shares (chats, files, documents, a thread's
 * surfaces), kept on the device outside React so sidebars, links and routes can open tabs into
 * it. Tabs link to owners (`linkedTabs.ts`); the chat in front's surfaces mirror T3 Code's
 * right-panel record for its thread, as one thread's right panel once did (`surfaceMirror.ts`).
 */
export const WORKSPACE_LAYOUT_KEY = "workspace";
export const WORKSPACE_STORAGE_KEY = "astrolabe:workspace:v1";
const HISTORY_STORAGE_KEY = "astrolabe:workspace-tab-history:v1";
const PERSIST_DELAY_MS = 150;
/** How long a pane's New tab menu waits for the surface it asked for to arrive. */
const TARGET_WINDOW_MS = 10_000;

/** What the sections kept before they shared one set of panes, brought in once and dropped. */
const OLD_CHAT_TABS_KEY = "t3code:chat-tabs:v1";
const OLD_SECTIONS = [
  { panes: "astrolabe:repository-panes:v1", history: "astrolabe:repository-tab-history:v1" },
  { panes: "astrolabe:wiki-panes:v1", history: "astrolabe:wiki-tab-history:v1" },
] as const;
const OLD_PREFIXES = ["t3code:right-panel-panes:v1:"];
const OLD_KEYS = ["astrolabe:group-panel-runs:v1"];

export interface WorkspaceSnapshot extends PaneArrangementSnapshot {
  readonly linked: LinkedArrangement;
}

/** The tabs the shared panes keep across a reload. */
const isWorkspaceKey = (key: string) =>
  isEmptyTab(key) ||
  isSectionTabKey(key) ||
  pullRequestTargetOfKey(key) !== null ||
  parseChatSurfaceKey(key) !== null;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(storage: StorageLike | null, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The shared panes as the device last left them; on first opening, the chat tabs and each
 * section's panes as they were left, joined (`joinLayouts`). Thread right panels start fresh.
 */
function loadWorkspace(storage: StorageLike | null): {
  readonly linked: LinkedArrangement;
  readonly histories: TabHistories;
} {
  const stored = readJson(storage, WORKSPACE_STORAGE_KEY);
  if (stored !== null) {
    const linked = parseLinkedArrangement(stored, isWorkspaceKey);
    const histories = parseHistories(readJson(storage, HISTORY_STORAGE_KEY));
    if (linked) return { linked, histories: keepHistories(histories, allTabs(linked.arrangement)) };
  }
  const chatState = readJson(storage, OLD_CHAT_TABS_KEY);
  const chat = isRecordObject(chatState) && isRecordObject(chatState.state) ? chatState.state : {};
  const toChatKey = (key: unknown) => {
    const ref = typeof key === "string" ? parseScopedThreadKey(key) : null;
    return ref ? chatTabKey(ref) : null;
  };
  const chats = (Array.isArray(chat.keys) ? chat.keys : []).flatMap((key) => toChatKey(key) ?? []);
  const sections = OLD_SECTIONS.flatMap(({ panes }) => {
    const arrangement = parseArrangement(readJson(storage, panes), isWorkspaceKey);
    return arrangement ? [arrangement] : [];
  });
  const joined = joinLayouts(chats, toChatKey(chat.active), sections, isWorkspaceKey);
  const arrangement = joined ?? startingArrangement();
  const chatHistories = parseHistories(chat.histories);
  const histories: Record<string, { back: string[]; forward: string[] }> = {};
  for (const [key, history] of Object.entries(chatHistories)) {
    const tab = toChatKey(key);
    if (tab === null) continue;
    histories[tab] = {
      back: history.back.flatMap((entry) => toChatKey(entry) ?? []),
      forward: history.forward.flatMap((entry) => toChatKey(entry) ?? []),
    };
  }
  for (const { history } of OLD_SECTIONS) {
    Object.assign(histories, parseHistories(readJson(storage, history)));
  }
  dropOldLayouts(storage);
  return {
    linked: linkedArrangement(arrangement),
    histories: keepHistories(histories, allTabs(arrangement)),
  };
}

function dropOldLayouts(storage: StorageLike | null) {
  try {
    const keys = [
      OLD_CHAT_TABS_KEY,
      ...OLD_KEYS,
      ...OLD_SECTIONS.flatMap((s) => [s.panes, s.history]),
    ];
    for (const key of keys) storage?.removeItem(key);
    if (storage && "length" in storage && "key" in storage) {
      const all = storage as Storage;
      const doomed: string[] = [];
      for (let index = 0; index < all.length; index += 1) {
        const key = all.key(index);
        if (key && OLD_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
      }
      for (const key of doomed) storage.removeItem(key);
    }
  } catch {
    // Blocked storage keeps the old keys; they are only read once.
  }
}

function recordOf(ref: ScopedThreadRef): PanelRecord {
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  return {
    isOpen: state.isOpen,
    activeSurfaceId: state.activeSurfaceId,
    surfaceIds: state.surfaces.map((surface) => surface.id),
  };
}

function sameRecord(a: PanelRecord | null, b: PanelRecord) {
  return (
    a !== null &&
    a.isOpen === b.isOpen &&
    a.activeSurfaceId === b.activeSurfaceId &&
    a.surfaceIds.length === b.surfaceIds.length &&
    a.surfaceIds.every((id, index) => b.surfaceIds[index] === id)
  );
}

/** One of a chat's surfaces, as its thread's record holds it now. */
export function surfaceOfKey(key: string): RightPanelSurface | null {
  const parsed = parseChatSurfaceKey(key);
  const ref = parsed ? parseChatTabKey(parsed.chatKey) : null;
  if (!parsed || !ref) return null;
  return (
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.find(
      (surface) => surface.id === parsed.surfaceId,
    ) ?? null
  );
}

/** How the chat `front`'s record's surfaces are named among the shared panes' tabs. */
function surfaceKeysOf(front: string, state: LinkedArrangement): SurfaceKeys {
  return {
    key: (id) => chatSurfaceKey(front, id),
    id: (key) => {
      const parsed = parseChatSurfaceKey(key);
      return parsed?.chatKey === front ? parsed.surfaceId : null;
    },
    linked: (key) => state.owners[key] === front,
    splitFrom: leafWithTab(state.arrangement.root, front)?.id ?? null,
  };
}

function storage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createWorkspace(storageOf: () => StorageLike | null = storage) {
  let state: LinkedArrangement | null = null;
  let histories: TabHistories = {};
  let snapshot: WorkspaceSnapshot | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  // The front chat's record as last mirrored, and whose it is.
  let record: PanelRecord | null = null;
  let recordOwner: string | null = null;
  let writing = false;
  let target: { paneId: string; until: number } | null = null;
  let groups: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  let panel: PanelProps | null = null;
  let panelSnapshot: PanelProps | null = null;
  const listeners = new Set<() => void>();
  const panelListeners = new Set<() => void>();

  const refOf = (chatKey: string | null) => (chatKey === null ? null : parseChatTabKey(chatKey));
  const context: LinkContext = {
    isOwner: (key) => parseChatTabKey(key) !== null,
    shows: (owner, front) => owner === front || groups.get(owner)?.has(front) === true,
    open: (front) => {
      const ref = refOf(front);
      return ref !== null && recordOf(ref).isOpen;
    },
    arriving: (front) => {
      const ref = refOf(front);
      return ref === null ? [] : recordOf(ref).surfaceIds.map((id) => chatSurfaceKey(front, id));
    },
  };

  const current = (): LinkedArrangement => {
    if (state === null) {
      const loaded = loadWorkspace(storageOf());
      state = settleLinks(loaded.linked, context);
      histories = loaded.histories;
      record = null;
      recordOwner = null;
      state = mirror(state, false);
    }
    return state;
  };

  const flush = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    if (!state) return;
    const store = storageOf();
    try {
      const { arrangement, owners, parked, front } = state;
      if (isStarting(arrangement) && Object.keys(parked).length === 0) {
        store?.removeItem(WORKSPACE_STORAGE_KEY);
      } else {
        store?.setItem(
          WORKSPACE_STORAGE_KEY,
          JSON.stringify({ ...arrangement, owners, parked, front }),
        );
      }
      if (Object.keys(histories).length === 0) store?.removeItem(HISTORY_STORAGE_KEY);
      else store?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(histories));
    } catch {
      // Storage full or blocked: the panes still work until the page goes away.
    }
  };

  /**
   * Brings the front chat's surfaces in line with its thread's record, and gives an open panel
   * with nothing in it an empty tab of its own, as T3 Code's empty panel shows its launcher.
   * `closing`: the user just closed the chat's last linked tab, so its panel closes instead.
   */
  function mirror(next: LinkedArrangement, closing: boolean): LinkedArrangement {
    const front = next.front;
    const ref = refOf(front);
    if (front === null || ref === null) {
      record = null;
      recordOwner = null;
      return next;
    }
    const now = recordOf(ref);
    const previous = recordOwner === front ? record : null;
    record = now;
    recordOwner = front;
    if (!now.isOpen || closing) return next;
    const asked = target && target.until > Date.now() ? target.paneId : null;
    const keys = surfaceKeysOf(front, next);
    const followed = followRecord(next.arrangement, previous, now, asked, keys);
    if (followed.consumedTarget) target = null;
    let out: LinkedArrangement = { ...next, arrangement: followed.arrangement };
    for (const id of now.surfaceIds) {
      const key = keys.key(id);
      if (leafWithTab(out.arrangement.root, key) && out.owners[key] !== front) {
        out = linkTab(out, key, front);
      }
    }
    if (!allTabs(out.arrangement).some((key) => out.owners[key] === front)) {
      const { arrangement } = out;
      const key = `empty/${arrangement.seq}`;
      out = openLinked({ ...out, arrangement: { ...arrangement, seq: arrangement.seq + 1 } }, key);
    }
    const settled = settleLinks(out, context);
    return settled.arrangement === next.arrangement && settled.owners === next.owners
      ? next
      : settled;
  }

  /** Brings the record's active surface in line with the panes, if it says otherwise. */
  const writeRecord = () => {
    const front = state?.front ?? null;
    const ref = refOf(front);
    if (!state || front === null || !ref || !record?.isOpen) return;
    const wanted = activeSurfaceFor(state.arrangement, record, surfaceKeysOf(front, state));
    if (wanted === null || wanted === record.activeSurfaceId) return;
    const surface = surfaceOfKey(chatSurfaceKey(front, wanted));
    if (!surface) return;
    writing = true;
    try {
      if (panel) panel.onActivate(surface);
      else useRightPanelStore.getState().activateSurface(ref, surface.id);
    } finally {
      writing = false;
    }
    record = recordOf(ref);
  };

  /** The snapshot as the state stands; whether it changed. Pure enough for render to call. */
  const takeSnapshot = (): boolean => {
    const linked = current();
    const front = linked.front;
    const host =
      front !== null && record !== null && recordOwner === front
        ? hostPaneId(linked.arrangement, record, surfaceKeysOf(front, linked))
        : null;
    if (snapshot && snapshot.linked === linked && snapshot.hostPaneId === host) return false;
    snapshot = { arrangement: linked.arrangement, hostPaneId: host, linked };
    return true;
  };

  const publish = () => {
    if (!takeSnapshot()) return;
    for (const listener of listeners) listener();
  };

  /** Applies a change, the links and the front chat's record following; `history` too. */
  const apply = (
    change: (linked: LinkedArrangement) => LinkedArrangement,
    history?: (before: TabHistories) => TabHistories,
  ) => {
    const before = current();
    const changed = change(before);
    let next = settleLinks(changed, context);
    // The front chat's last linked tab closed by hand: its panel closes rather than refill.
    const front = next.front;
    const ownedIn = (linked: LinkedArrangement) =>
      front !== null && allTabs(linked.arrangement).some((key) => linked.owners[key] === front);
    const closing = front !== null && front === before.front && ownedIn(before) && !ownedIn(next);
    next = mirror(next, closing);
    const nextHistories = keepHistories(
      history ? history(histories) : histories,
      allTabs(next.arrangement),
    );
    if (next !== before || nextHistories !== histories) {
      state = next;
      histories = nextHistories;
      pending ??= setTimeout(flush, PERSIST_DELAY_MS);
    }
    writeRecord();
    publish();
    const ref = refOf(front);
    if (closing && ref) useRightPanelStore.getState().close(ref);
  };

  const update = (change: (arrangement: Arrangement) => Arrangement) =>
    apply((linked) => {
      const arrangement = change(linked.arrangement);
      return arrangement === linked.arrangement ? linked : { ...linked, arrangement };
    });

  const updateWithHistory = (
    change: (arrangement: Arrangement) => Arrangement,
    history?: (before: TabHistories) => TabHistories,
  ) =>
    apply((linked) => {
      const arrangement = change(linked.arrangement);
      return arrangement === linked.arrangement ? linked : { ...linked, arrangement };
    }, history);

  /** Takes in a change T3 Code made to the front chat's record. */
  const takeRecord = () => {
    const front = current().front;
    const ref = refOf(front);
    if (!ref) return;
    const now = recordOf(ref);
    if (recordOwner === front && sameRecord(record, now)) return;
    if (writing) {
      record = now;
      return;
    }
    apply((linked) => linked);
  };

  const store: PaneArrangementStore & {
    flush(): void;
    getSnapshot(): WorkspaceSnapshot | null;
  } = {
    update,
    getSnapshot: () => {
      takeSnapshot();
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush,
  };

  /** Shows `key`: in front where it is open, else in `paneId` (the focused pane), or beside it. */
  const open = (key: string, placement: "tab" | "beside" = "tab", paneId?: string) =>
    update((arrangement) => {
      if (leafWithTab(arrangement.root, key) && placement === "tab") {
        return activateTab(arrangement, key);
      }
      const target = paneId ?? arrangement.focused;
      return placement === "beside"
        ? openBeside(arrangement, key, target, "right")
        : openTab(arrangement, key, target);
    });

  /** Opens tabs dragged from a sidebar where they land, `front` in front (see `placeTabs`). */
  const place = (
    keys: readonly string[],
    front: string,
    paneId: string,
    drop: { readonly side: Side | null; readonly index: number },
  ) => update((arrangement) => placeTabs(arrangement, keys, paneId, drop, front));

  /**
   * Shows `key` as a sidebar row's click does: in the focused pane's tab in front (or `paneId`'s,
   * which takes focus), which remembers what it showed. One open already comes to the front; an
   * empty tab, a chat, or one with unsaved edits makes way for a new tab, and a linked tab is
   * left to its owner.
   */
  const show = (key: string, paneId?: string) => {
    const linked = current();
    const { arrangement } = linked;
    const pane =
      (paneId === undefined ? undefined : findLeaf(arrangement.root, paneId)) ??
      focusedPane(arrangement);
    const active = pane.active;
    const keep =
      leafWithTab(arrangement.root, key) !== undefined ||
      isEmptyTab(active) ||
      hasUnsavedEdits(active) ||
      parseChatTabKey(active) !== null ||
      active in linked.owners;
    if (keep) {
      open(key, "tab", pane.id);
      return;
    }
    updateWithHistory(
      (before) => focusPane(replaceTab(before, active, key), pane.id),
      (tabHistories) => replaceInHistory(tabHistories, active, key),
    );
  };

  /** Steps the focused pane's tab in front back or forward through what it showed. */
  const step = (direction: HistoryDirection) => {
    const { arrangement } = current();
    const active = focusedPane(arrangement).active;
    let tabHistories = histories;
    let goTo = historyTarget(tabHistories, active, direction);
    while (goTo !== null && !isWorkspaceKey(goTo)) {
      tabHistories = dropHistoryTarget(tabHistories, active, direction);
      goTo = historyTarget(tabHistories, active, direction);
    }
    const pruned = tabHistories;
    if (goTo === null || hasUnsavedEdits(active) || leafWithTab(arrangement.root, goTo)) {
      const to = goTo;
      updateWithHistory(
        (before) =>
          to === null
            ? before
            : leafWithTab(before.root, to)
              ? activateTab(before, to)
              : openTab(before, to, before.focused),
        () => pruned,
      );
      return;
    }
    const stepped = stepHistory(pruned, active, direction);
    if (!stepped) return;
    const to = goTo;
    updateWithHistory(
      (before) => replaceTab(before, active, to),
      () => stepped.histories,
    );
  };

  const canStep = (direction: HistoryDirection) =>
    historyTarget(histories, focusedPane(current().arrangement).active, direction) !== null;

  const close = (key: string) => update((arrangement) => closeTab(arrangement, key));

  /** The pane chats open in: the front chat's, else the focused pane. */
  const chatPaneId = (arrangement: Arrangement, front: string | null) => {
    const fronts = leaves(arrangement.root);
    return (
      (front === null ? undefined : leafWithTab(arrangement.root, front)) ??
      (parseChatTabKey(focusedPane(arrangement).active) !== null
        ? focusedPane(arrangement)
        : undefined) ??
      fronts.find((leaf) => parseChatTabKey(leaf.active) !== null) ??
      focusedPane(arrangement)
    ).id;
  };

  /**
   * The route shows the chat `key` now, as following a link in a browser tab: where it is open it
   * comes to the front, else it takes the place of the chat in front, which joins its history.
   */
  const arriveChat = (key: string) => {
    const linked = current();
    const { arrangement, front } = linked;
    if (leafWithTab(arrangement.root, key)) {
      update((before) => activateTab(before, key));
      return;
    }
    const replacing =
      front !== null && leaves(arrangement.root).some((leaf) => leaf.active === front)
        ? front
        : null;
    if (replacing !== null) {
      updateWithHistory(
        (before) => {
          const replaced = replaceTab(before, replacing, key);
          const pane = leafWithTab(replaced.root, key);
          return pane ? focusPane(replaced, pane.id) : replaced;
        },
        (tabHistories) => replaceInHistory(tabHistories, replacing, key),
      );
      return;
    }
    update((before) => openTab(before, key, chatPaneId(before, front)));
  };

  /** Opens chats as tabs after the chat in front, which stays in front. */
  const openChatsBesideFront = (keys: readonly string[]) =>
    apply((linked) => {
      const { arrangement, front } = linked;
      const paneId = chatPaneId(arrangement, front);
      const pane = findLeaf(arrangement.root, paneId);
      if (!pane) return linked;
      const index = pane.tabs.indexOf(pane.active) + 1;
      const fresh = keys.filter((key) => !leafWithTab(arrangement.root, key));
      if (fresh.length === 0) return linked;
      const placed = placeTabs(arrangement, fresh, paneId, { side: null, index }, pane.active);
      return { ...linked, arrangement: placed };
    });

  /** Opens a chat in a new tab after the chat in front; the route shows it next. */
  const openChatNew = (key: string) =>
    update((arrangement) => {
      if (leafWithTab(arrangement.root, key)) return arrangement;
      const paneId = chatPaneId(arrangement, current().front);
      return openTab(arrangement, key, paneId, false);
    });

  /**
   * Opens `key` linked to `owner` (the chat in front by default) beside it, in front where it is
   * open already. The owner's panel opens with it.
   */
  const openLinkedTab = (key: string, owner?: string) => {
    const linked = current();
    const by = owner ?? linked.front;
    if (by === null) {
      open(key, "beside");
      return;
    }
    const ref = refOf(linked.front);
    if (ref && !recordOf(ref).isOpen) useRightPanelStore.getState().show(ref);
    apply((before) => {
      const opened = leafWithTab(before.arrangement.root, key)
        ? { ...before, arrangement: activateTab(before.arrangement, key, false) }
        : openLinked(before, key);
      return by === before.front ? opened : linkTab(unlinkTab(opened, key), key, by);
    });
  };

  /** Links an open tab to `owner` (the chat in front by default). */
  const link = (key: string, owner?: string) => {
    const linked = current();
    const by = owner ?? linked.front;
    if (by === null) return;
    const ref = refOf(by);
    if (ref && !recordOf(ref).isOpen) useRightPanelStore.getState().show(ref);
    apply((before) => linkTab(before, key, by));
  };

  const unlink = (key: string) => apply((before) => unlinkTab(before, key));

  return {
    store,
    /** The arrangement as it stands. */
    arrangement: () => current().arrangement,
    linked: current,
    open,
    place,
    show,
    step,
    canStep,
    close,
    update,
    updateWithHistory,
    arriveChat,
    openChatNew,
    openChatsBesideFront,
    openLinked: openLinkedTab,
    link,
    unlink,
    /** The thread of the chat in front, whose surfaces the panes show. */
    frontRef: () => refOf(current().front),
    /** The next surface the front chat's record gains within a few seconds opens in this pane. */
    targetPane(paneId: string) {
      target = { paneId, until: Date.now() + TARGET_WINDOW_MS };
    },
    /** The change groups' threads, by group tab key, whose linked tabs show beside them. */
    setGroups(next: ReadonlyMap<string, ReadonlySet<string>>) {
      const same =
        next.size === groups.size &&
        [...next].every(([key, members]) => {
          const before = groups.get(key);
          return before?.size === members.size && [...members].every((m) => before.has(m));
        });
      groups = next;
      if (!same && state !== null) apply((linked) => linked);
    },
    /**
     * Follows T3 Code's changes to the front chat's record until the returned function is called,
     * first taking in any made since the panes loaded.
     */
    follow() {
      takeRecord();
      return useRightPanelStore.subscribe(takeRecord);
    },
    /** What the front chat's ChatView last gave its right panel; null before it renders. */
    getPanel: () => panel,
    /**
     * Takes the front chat's ChatView's latest panel props. Handlers are read from them when used;
     * the panes re-render only when something they draw from changed.
     */
    setPanel(next: PanelProps) {
      const before = panel;
      panel = next;
      if (before && samePanelDrawing(before, next)) return;
      panelSnapshot = next;
      for (const listener of panelListeners) listener();
    },
    /** Lets go of panel props from a ChatView no longer in front. */
    clearPanel(from: PanelProps) {
      if (panel !== from) return;
      panel = null;
      panelSnapshot = null;
      for (const listener of panelListeners) listener();
    },
    getPanelSnapshot: () => panelSnapshot,
    subscribePanel(listener: () => void) {
      panelListeners.add(listener);
      return () => {
        panelListeners.delete(listener);
      };
    },
  };
}

function samePanelDrawing(before: PanelProps, next: PanelProps) {
  return (
    before.open === next.open &&
    before.environmentId === next.environmentId &&
    before.previewSessions === next.previewSessions &&
    before.desktopByTabId === next.desktopByTabId &&
    before.terminalLabelsById === next.terminalLabelsById &&
    before.pendingSurfaceIds === next.pendingSurfaceIds &&
    before.pullRequestStatusSeeds === next.pullRequestStatusSeeds &&
    before.browserAvailable === next.browserAvailable &&
    before.terminalAvailable === next.terminalAvailable &&
    before.diffAvailable === next.diffAvailable &&
    before.filesAvailable === next.filesAvailable &&
    before.pullRequestAvailable === next.pullRequestAvailable &&
    before.pullRequestsAvailable === next.pullRequestsAvailable &&
    before.deviceAvailable === next.deviceAvailable &&
    before.graphAvailable === next.graphAvailable &&
    before.lineageAvailable === next.lineageAvailable
  );
}

export type Workspace = ReturnType<typeof createWorkspace>;

/** The device's shared panes. */
export const workspace = createWorkspace();

// The hooks read the panes from outside their factory, so the React Compiler never lifts their
// callbacks away from the panes they read.

export function useWorkspaceSnapshot(): WorkspaceSnapshot | null {
  return useSyncExternalStore(workspace.store.subscribe, workspace.store.getSnapshot);
}

/** The pane showing the front chat's live surface, if one does. */
export function useWorkspaceHostPaneId(): string | null {
  return useSyncExternalStore(
    workspace.store.subscribe,
    () => workspace.store.getSnapshot()?.hostPaneId ?? null,
  );
}

export function useWorkspaceArrangement(): Arrangement {
  return useSyncExternalStore(workspace.store.subscribe, workspace.arrangement);
}

/** Every open tab's key, in pane order. */
export function useWorkspaceOpenKeys(): readonly string[] {
  return allTabs(useWorkspaceArrangement());
}

/** The key of the focused pane's tab in front. */
export function useWorkspaceFocusedKey(): string {
  return useSyncExternalStore(
    workspace.store.subscribe,
    () => focusedPane(workspace.arrangement()).active,
  );
}

/** The chat in front, whose linked tabs show. */
export function useWorkspaceFront(): string | null {
  return useSyncExternalStore(workspace.store.subscribe, () => workspace.linked().front);
}

/** The owner a tab is linked to, if any. */
export function useTabOwner(key: string): string | null {
  return useSyncExternalStore(
    workspace.store.subscribe,
    () => workspace.linked().owners[key] ?? null,
  );
}

/** Whether the focused pane's tab in front has anything back (or forward) to show. */
export function useWorkspaceTabHistory() {
  const canGoBack = useSyncExternalStore(workspace.store.subscribe, () =>
    workspace.canStep("back"),
  );
  const canGoForward = useSyncExternalStore(workspace.store.subscribe, () =>
    workspace.canStep("forward"),
  );
  return { canGoBack, canGoForward };
}
