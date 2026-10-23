import { useSyncExternalStore } from "react";

/**
 * The turn each thread's chat is showing, by thread key: the user message of the turn its
 * timeline's minimap marks current. The chat writes it as it scrolls; the Lineage tab reads it to
 * mark the turn being read, without the chat re-rendering for it.
 */
const reading = new Map<string, string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setReadingTurn(threadKey: string, messageId: string | null) {
  if ((reading.get(threadKey) ?? null) === messageId) return;
  if (messageId === null) reading.delete(threadKey);
  else reading.set(threadKey, messageId);
  for (const listener of listeners) listener();
}

export function useReadingTurn(threadKey: string): string | null {
  return useSyncExternalStore(subscribe, () => reading.get(threadKey) ?? null);
}
