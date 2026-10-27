import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import type { RightPanelTabs } from "../components/RightPanelTabs";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { type Arrangement } from "./arrangement";
import { loadArrangement, writeArrangement, type StorageLike } from "./persistence";
import { activeSurfaceFor, followRecord, hostPaneId, type PanelRecord } from "./surfaceMirror";

/**
 * What ChatView hands its right panel's strip, which the right panel's panes take in its place: the
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
 * One thread's right-panel panes at a time, saved on the device and mirrored both ways with T3
 * Code's right-panel record (`surfaceMirror.ts`). Pane changes write back through ChatView's own
 * handlers (`panel`) so activating a surface does what clicking its strip does; while the panes
 * write, the store subscription only takes note, so neither side echoes the other.
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
  let arrangement: Arrangement | null = null;
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
    if (!arrangement || !previous) return;
    const next: PanesSnapshot = {
      threadKey,
      arrangement,
      record: previous,
      hostPaneId: hostPaneId(arrangement, previous),
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
    if (arrangement && threadKey) writeArrangement(storage, threadKey, arrangement);
  };

  const schedulePersist = () => {
    pending ??= setTimeout(flush, PERSIST_DELAY_MS);
  };

  /** Brings the record's active surface in line with the panes, if it says otherwise. */
  const writeRecord = () => {
    if (!ref || !arrangement || !previous || !previous.isOpen) return;
    const wanted = activeSurfaceFor(arrangement, previous);
    if (wanted === null || wanted === previous.activeSurfaceId) return;
    const surface = surfaceOf(ref, wanted);
    if (!surface) return;
    writing = true;
    try {
      if (panel) panel.onActivate(surface);
      else useRightPanelStore.getState().activateSurface(ref, surface.id);
    } finally {
      writing = false;
    }
    previous = recordOf(ref);
  };

  const takeRecord = (record: PanelRecord) => {
    if (!arrangement) return;
    if (previous && sameRecord(previous, record)) return;
    if (writing) {
      previous = record;
      return;
    }
    const asked = target && target.until > Date.now() ? target.paneId : null;
    const followed = followRecord(arrangement, previous, record, asked);
    if (followed.consumedTarget) target = null;
    previous = record;
    const changed = followed.arrangement !== arrangement;
    arrangement = followed.arrangement;
    if (changed) schedulePersist();
    writeRecord();
    publish();
  };

  /** Applies a change the panes made; the record follows (see `writeRecord`). */
  const update = (change: (current: Arrangement) => Arrangement) => {
    if (!arrangement) return;
    const next = change(arrangement);
    if (next === arrangement) return;
    arrangement = next;
    schedulePersist();
    writeRecord();
    publish();
  };

  return {
    /** Shows a thread's panes: as last left on this device, brought in line with its record. */
    load(nextRef: ScopedThreadRef, nextKey: string) {
      if (nextKey === threadKey && arrangement) return;
      flush();
      ref = nextRef;
      threadKey = nextKey;
      target = null;
      // First load: the record as it stands, against no earlier record.
      const record = recordOf(nextRef);
      arrangement = followRecord(loadArrangement(storage, nextKey), null, record).arrangement;
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
      const stopRecord = useRightPanelStore.subscribe((state) => {
        if (!ref) return;
        const current = selectThreadRightPanelState(state.byThreadKey, ref);
        takeRecord({
          isOpen: current.isOpen,
          activeSurfaceId: current.activeSurfaceId,
          surfaceIds: current.surfaces.map((surface) => surface.id),
        });
      });
      return stopRecord;
    },
    update,
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
        before.open === next.open &&
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
        before.deviceAvailable === next.deviceAvailable &&
        before.graphAvailable === next.graphAvailable &&
        before.lineageAvailable === next.lineageAvailable
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
