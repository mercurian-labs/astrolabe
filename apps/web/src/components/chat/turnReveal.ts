import type { LegendListRef } from "@legendapp/list/react";
import { useEffect, useSyncExternalStore, type RefObject } from "react";

import type { MessagesTimelineHistoryControls } from "./MessagesTimeline";

/**
 * Astrolabe: the turn a thread was last asked to show, by whatever opened the thread there (the
 * Git tab's turns). The chat reads it for its own thread, loads history back to the turn, and
 * scrolls to it.
 */
export interface TurnReveal {
  readonly threadKey: string;
  /** The person's message that started the turn: its row in the timeline. */
  readonly messageId: string;
  readonly id: number;
}

const listeners = new Set<() => void>();
let current: TurnReveal | null = null;
let nextId = 1;

function changed() {
  for (const listener of listeners) listener();
}

export const turnReveal = {
  request(threadKey: string, messageId: string) {
    current = { threadKey, messageId, id: nextId++ };
    changed();
  },
  get: (): TurnReveal | null => current,
  done(id: number) {
    if (current?.id !== id) return;
    current = null;
    changed();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Scrolls a chat's timeline to a turn asked of its thread, loading earlier history until it shows. */
export function useTurnReveal(input: {
  readonly threadKey: string | null;
  readonly list: RefObject<LegendListRef | null>;
  readonly history: MessagesTimelineHistoryControls | undefined;
  /** The timeline's loaded rows; the effect runs again as earlier history arrives. */
  readonly loaded: ReadonlyArray<unknown>;
  readonly scrollTo: (messageId: string) => void;
}) {
  const pending = useSyncExternalStore(turnReveal.subscribe, turnReveal.get);
  const { threadKey, list, history, loaded, scrollTo } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the list to the asked-for turn once its row is in it, loading earlier history until it is
  useEffect(() => {
    if (pending === null || pending.threadKey !== threadKey) return;
    const timeline = list.current;
    if (timeline === null) return;
    if (timeline.getState().indexByKey(pending.messageId) !== undefined) {
      scrollTo(pending.messageId);
      turnReveal.done(pending.id);
      return;
    }
    if (history?.hasMoreHistory !== true) {
      // All of the thread is loaded and the turn is not in it.
      if (loaded.length > 0) turnReveal.done(pending.id);
      return;
    }
    if (history.loading || history.error) return;
    history.onLoadEarlier(pending.messageId);
  }, [pending, threadKey, list, history, loaded, scrollTo]);
}
