/**
 * Astrolabe: the turn a thread was last asked to show, by whatever opened the thread there (intent
 * blame). The chat reads it for its own thread, loads history back to the turn, and scrolls to it.
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
