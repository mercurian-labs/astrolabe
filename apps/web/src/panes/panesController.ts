import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import type { RightPanelTabs } from "../components/RightPanelTabs";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import type { Arrangement } from "./arrangement";
import { loadArrangement, writeArrangement, type StorageLike } from "./persistence";
import {
  followRecord,
  hostPaneId,
  recordFor,
  type MirrorState,
  type PanelRecord,
} from "./surfaceMirror";

/**
 * What ChatView hands its right panel's strip, which the panes take in its place: the
 * surfaces' labels, the ways to add and close them, and (as `children`) the active surface's
 * content.
 */
export type PanelProps = ComponentProps<typeof RightPanelTabs>;

/** Writes are batched so dragging a divider does not write storage on every pointer move. */
const PERSIST_DELAY_MS = 150;
/** How long a pane's New tab menu waits for the surface it asked for to arrive. */
const TARGET_WINDOW_MS = 10_000;

export interface PanesSnapshot {
  readonly threadKey: string;
  readonly arrangement: Arrangement;
  readonly record: PanelRecord;
  /** The pane showing the record's active surface, where its content goes. */
  readonly hostPaneId: string | null;
}

function recordOf(ref: ScopedThreadRef): PanelRecord {
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  return {
    isOpen: state.isOpen,
    activeSurfaceId: state.activeSurfaceId,
    surfaceIds: state.surfaces.map((surface) => surface.id),
  };
}

function sameRecord(a: PanelRecord, b: PanelRecord) {
  return (
    a.isOpen === b.isOpen &&
    a.activeSurfaceId === b.activeSurfaceId &&
    a.surfaceIds.length === b.surfaceIds.length &&
    a.surfaceIds.every((id, index) => b.surfaceIds[index] === id)
  );
}

function surfaceOf(ref: ScopedThreadRef, surfaceId: string): RightPanelSurface | null {
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === surfaceId) ?? null;
}

/**
 * One thread's panes at a time: its arrangement, loaded from and saved to the device, kept in
 * line with T3 Code's right-panel record in both directions (see `surfaceMirror.ts`).
 *
 * T3 Code's own changes to the record arrive through the store subscription and move the panes.
 * The panes' changes write the record back through ChatView's own handlers where it gave them
 * (`panel`), so activating a surface does everything ChatView does when its strip is clicked.
 * While the panes write, the subscription only takes note, so neither side echoes the other.
 */
export interface PanesController {
  load(ref: ScopedThreadRef, threadKey: string): void;
  follow(): () => void;
  update(change: (arrangement: Arrangement) => Arrangement): void;
  targetPane(paneId: string): void;
  getSnapshot(): PanesSnapshot | null;
  subscribe(listener: () => void): () => void;
  getPanel(): PanelProps | null;
  setPanel(next: PanelProps): void;
  getPanelSnapshot(): PanelProps | null;
  subscribePanel(listener: () => void): () => void;
  threadRef(): ScopedThreadRef | null;
  flush(): void;
}

export function createPanesController(storage: StorageLike | null): PanesController {
  let ref: ScopedThreadRef | null = null;
  let threadKey = "";
  let mirror: MirrorState | null = null;
  let previous: PanelRecord | null = null;
  let snapshot: PanesSnapshot | null = null;
  let writing = false;
  let target: { paneId: string; until: number } | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let panel: PanelProps | null = null;
  let panelSnapshot: PanelProps | null = null;
  const listeners = new Set<() => void>();
  const panelListeners = new Set<() => void>();

  const publish = () => {
    if (!mirror || !previous) return;
    const next: PanesSnapshot = {
      threadKey,
      arrangement: mirror.arrangement,
      record: previous,
      hostPaneId: hostPaneId(mirror.arrangement, previous),
    };
    if (
      snapshot &&
      snapshot.threadKey === next.threadKey &&
      snapshot.arrangement === next.arrangement &&
      snapshot.record === next.record &&
      snapshot.hostPaneId === next.hostPaneId
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const flush = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    if (mirror && threadKey) writeArrangement(storage, threadKey, mirror.arrangement);
  };

  const schedulePersist = () => {
    pending ??= setTimeout(flush, PERSIST_DELAY_MS);
  };

  /** Writes what the record should say for the panes as they stand, if it says otherwise. */
  const writeRecord = () => {
    if (!ref || !mirror || !previous) return;
    const wanted = recordFor(mirror.arrangement, previous);
    const changed =
      wanted.isOpen !== previous.isOpen ||
      (wanted.isOpen && wanted.activeSurfaceId !== previous.activeSurfaceId);
    if (!changed) return;
    writing = true;
    try {
      if (!wanted.isOpen) {
        useRightPanelStore.getState().close(ref);
      } else if (wanted.activeSurfaceId !== null) {
        const surface = surfaceOf(ref, wanted.activeSurfaceId);
        if (surface && panel) panel.onActivate(surface);
        else if (surface) useRightPanelStore.getState().activateSurface(ref, surface.id);
      }
    } finally {
      writing = false;
    }
    previous = recordOf(ref);
  };

  const takeRecord = (record: PanelRecord) => {
    if (!mirror) return;
    if (previous && sameRecord(previous, record)) return;
    if (writing) {
      previous = record;
      return;
    }
    const asked = target && target.until > Date.now() ? target.paneId : null;
    const followed = followRecord(mirror, previous, record, asked);
    if (followed.consumedTarget) target = null;
    previous = record;
    const changed = followed.arrangement !== mirror.arrangement;
    mirror = { arrangement: followed.arrangement, hidden: followed.hidden };
    if (changed) schedulePersist();
    writeRecord();
    publish();
  };

  return {
    /** Shows a thread's panes: as last left on this device, brought in line with its record. */
    load(nextRef: ScopedThreadRef, nextKey: string) {
      if (nextKey === threadKey && mirror) return;
      flush();
      ref = nextRef;
      threadKey = nextKey;
      target = null;
      mirror = { arrangement: loadArrangement(storage, nextKey), hidden: null };
      // First load: the record as it stands, against no earlier record.
      const record = recordOf(nextRef);
      const followed = followRecord(mirror, null, record);
      mirror = { arrangement: followed.arrangement, hidden: followed.hidden };
      previous = record;
      writeRecord();
      publish();
    },
    /**
     * Follows T3 Code's changes to the record until the returned function is called, first
     * taking in any made since the thread loaded.
     */
    follow() {
      if (ref) takeRecord(recordOf(ref));
      return useRightPanelStore.subscribe((state) => {
        if (!ref) return;
        const current = selectThreadRightPanelState(state.byThreadKey, ref);
        takeRecord({
          isOpen: current.isOpen,
          activeSurfaceId: current.activeSurfaceId,
          surfaceIds: current.surfaces.map((surface) => surface.id),
        });
      });
    },
    /** Applies a change the panes made; the record follows (see `writeRecord`). */
    update(change: (arrangement: Arrangement) => Arrangement) {
      if (!mirror) return;
      const arrangement = change(mirror.arrangement);
      if (arrangement === mirror.arrangement) return;
      mirror = { ...mirror, arrangement };
      schedulePersist();
      writeRecord();
      publish();
    },
    /** The next surface the record gains within a few seconds opens in this pane. */
    targetPane(paneId: string) {
      target = { paneId, until: Date.now() + TARGET_WINDOW_MS };
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** What ChatView last gave its right panel's strip; null before ChatView first renders. */
    getPanel: () => panel,
    /**
     * Takes ChatView's latest panel props. Handlers are read from them when used; the strip
     * re-renders only when something it draws from changed.
     */
    setPanel(next: PanelProps) {
      const before = panel;
      panel = next;
      if (
        before &&
        before.previewSessions === next.previewSessions &&
        before.desktopByTabId === next.desktopByTabId &&
        before.terminalLabelsById === next.terminalLabelsById &&
        before.pendingSurfaceIds === next.pendingSurfaceIds &&
        before.pullRequestStatusSeeds === next.pullRequestStatusSeeds &&
        before.environmentId === next.environmentId &&
        before.browserAvailable === next.browserAvailable &&
        before.terminalAvailable === next.terminalAvailable &&
        before.diffAvailable === next.diffAvailable &&
        before.filesAvailable === next.filesAvailable &&
        before.pullRequestAvailable === next.pullRequestAvailable &&
        before.pullRequestsAvailable === next.pullRequestsAvailable &&
        before.deviceAvailable === next.deviceAvailable
      ) {
        return;
      }
      panelSnapshot = next;
      for (const listener of panelListeners) listener();
    },
    /**
     * ChatView's panel props as of the last change to anything the strip draws. Render reads
     * this; handlers read `getPanel`, whose callbacks are current.
     */
    getPanelSnapshot: () => panelSnapshot,
    subscribePanel(listener: () => void) {
      panelListeners.add(listener);
      return () => {
        panelListeners.delete(listener);
      };
    },
    threadRef: () => ref,
    flush,
  };
}
