// @effect-diagnostics globalTimers:off globalDate:off - A pause in typing, timed outside an Effect runtime.
/**
 * Astrolabe: when a wiki document's edits land, shared by web and mobile. A store with no
 * framework in it: an edit only moves a timer, so nothing renders or writes per keystroke, and
 * `status` changes only at the moments a person can see.
 */

/** How long a document rests after an edit before it saves. */
const WIKI_AUTOSAVE_DELAY_MS = 2_000;
/** A discrete edit needn't wait for typing to stop. */
export const WIKI_BASE_AUTOSAVE_DELAY_MS = 1_000;
/** The longest unbroken typing goes unsaved. */
const WIKI_AUTOSAVE_MAX_WAIT_MS = 20_000;
const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 30_000;

/** How one save went. `retry` says whether trying the same save again can help. */
export type WikiSaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly retry: boolean };

export type WikiAutosaveStatus =
  | { readonly kind: "idle"; readonly saved: boolean }
  | { readonly kind: "saving" }
  /** An agent is mid-turn in the change request; the edits land when it ends. */
  | { readonly kind: "waiting-for-turn" }
  | { readonly kind: "failed"; readonly message: string; readonly retrying: boolean };

export interface WikiAutosave {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getStatus: () => WikiAutosaveStatus;
  /** Something changed; `save` reads what, when it runs. */
  readonly edited: () => void;
  /** While held, edits wait. */
  readonly setHeld: (held: boolean) => void;
  /** Saves now. True once nothing is unsaved; false if a save failed or edits are held. */
  readonly flush: () => Promise<boolean>;
  /** Tries a failed save again now. */
  readonly retry: () => void;
  /** Forgets anything unsaved. A save already sent still lands. */
  readonly cancel: () => void;
  /**
   * The view is going away: with anything unsaved or on its way, `save` replaces the view's own,
   * holding what it last showed, and this runs until that lands. A failure from then on goes to
   * `onOrphanedFailure`.
   */
  readonly retire: (save: () => Promise<WikiSaveOutcome>) => void;
}

export function createWikiAutosave(options: {
  /** Saves everything unsaved as it stands now. */
  readonly save: () => Promise<WikiSaveOutcome>;
  readonly delayMs?: number;
  readonly maxWaitMs?: number;
  readonly onOrphanedFailure?: (message: string) => void;
}): WikiAutosave {
  const delayMs = options.delayMs ?? WIKI_AUTOSAVE_DELAY_MS;
  const maxWaitMs = options.maxWaitMs ?? WIKI_AUTOSAVE_MAX_WAIT_MS;
  let save = options.save;
  let status: WikiAutosaveStatus = { kind: "idle", saved: false };
  let saved = false;
  let unsaved = false;
  let held = false;
  let retired = false;
  let sending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsavedSince: number | null = null;
  let failure: { readonly message: string; readonly retrying: boolean } | null = null;
  let attempts = 0;
  let flushes: Array<(landed: boolean) => void> = [];
  const listeners = new Set<() => void>();

  const publish = () => {
    const next: WikiAutosaveStatus =
      failure !== null
        ? { kind: "failed", ...failure }
        : held && unsaved
          ? { kind: "waiting-for-turn" }
          : unsaved || sending
            ? { kind: "saving" }
            : { kind: "idle", saved };
    if (
      next.kind === status.kind &&
      (next.kind !== "failed" ||
        status.kind !== "failed" ||
        (next.message === status.message && next.retrying === status.retrying)) &&
      (next.kind !== "idle" || status.kind !== "idle" || next.saved === status.saved)
    ) {
      return;
    }
    status = next;
    for (const listener of listeners) listener();
  };

  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const settleFlushes = (landed: boolean) => {
    const waiting = flushes;
    flushes = [];
    for (const resolve of waiting) resolve(landed);
  };

  const send = () => {
    stopTimer();
    if (sending || held || !unsaved) return;
    sending = true;
    unsaved = false;
    publish();
    void save()
      .catch((cause: unknown): WikiSaveOutcome => ({
        ok: false,
        message: cause instanceof Error ? cause.message : "The save failed.",
        retry: true,
      }))
      .then(finish);
  };

  const schedule = () => {
    stopTimer();
    if (sending || held || !unsaved) return;
    const now = Date.now();
    const deadline = (unsavedSince ?? now) + maxWaitMs;
    timer = setTimeout(send, Math.max(0, Math.min(delayMs, deadline - now)));
  };

  function finish(outcome: WikiSaveOutcome) {
    sending = false;
    if (outcome.ok) {
      failure = null;
      attempts = 0;
      saved = true;
      if (unsaved) {
        // A person waiting on a flush wants the edits made since it began too.
        if (flushes.length > 0) send();
        else schedule();
      } else {
        unsavedSince = null;
        settleFlushes(true);
      }
      publish();
      return;
    }
    unsaved = true;
    failure = { message: outcome.message, retrying: outcome.retry };
    settleFlushes(false);
    if (retired && attempts === 0) options.onOrphanedFailure?.(outcome.message);
    if (outcome.retry) {
      timer = setTimeout(send, Math.min(FIRST_RETRY_MS * 2 ** attempts, LAST_RETRY_MS));
      attempts += 1;
    }
    publish();
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStatus: () => status,
    edited: () => {
      unsaved = true;
      unsavedSince ??= Date.now();
      // A retry already has its own time; a save that can't be retried gets a new try.
      if (failure?.retrying !== true) schedule();
      publish();
    },
    setHeld: (next) => {
      if (held === next) return;
      held = next;
      if (held) stopTimer();
      else send();
      publish();
    },
    flush: () => {
      if (!unsaved && !sending) return Promise.resolve(true);
      if (held) return Promise.resolve(false);
      return new Promise((resolve) => {
        flushes.push(resolve);
        send();
      });
    },
    retry: () => {
      attempts = 0;
      send();
    },
    cancel: () => {
      stopTimer();
      unsaved = false;
      unsavedSince = null;
      failure = null;
      attempts = 0;
      settleFlushes(true);
      publish();
    },
    retire: (next) => {
      if (!unsaved && !sending) return;
      save = next;
      retired = true;
      held = false;
      if (failure === null) send();
      else options.onOrphanedFailure?.(failure.message);
    },
  };
}
