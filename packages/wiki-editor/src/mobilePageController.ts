import { WikiNoteBuffer } from "./noteBuffer";
import type { WikiEditorBaseResult, WikiEditorCommand, WikiEditorEvent } from "./protocol";

/** A ```base block's view as the page holds it: nothing yet, a view, or why it can't show. */
export interface WikiEditorBase {
  readonly result: WikiEditorBaseResult | null;
  readonly error: string | null;
}

export interface WikiEditorPageState {
  readonly mode: "read" | "edit";
  /** The base the page shows alone, by source, in place of the note; null shows the note. */
  readonly base: string | null;
  readonly theme: Extract<WikiEditorCommand, { type: "theme" }>["theme"] | null;
}

/**
 * The editor page's side of the protocol: it applies the app's commands to the note's buffer,
 * and tells the app when the buffer's unsaved state changes. The page renders from `buffer`
 * and `getState`; this holds no DOM.
 */
export function createWikiEditorPage(post: (event: WikiEditorEvent) => void) {
  const buffer = new WikiNoteBuffer();
  let state: WikiEditorPageState = { mode: "read", base: null, theme: null };
  const listeners = new Set<() => void>();
  const setState = (next: Partial<WikiEditorPageState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  // The app's header (Save, Discard, the changed-underneath notice) follows the buffer.
  let reported: { dirty: boolean; changedUnderneath: boolean } | null = null;
  const report = () => {
    const { dirty, changedUnderneath } = buffer.getSnapshot();
    if (reported?.dirty === dirty && reported.changedUnderneath === changedUnderneath) return;
    reported = { dirty, changedUnderneath };
    post({ type: "state", dirty, changedUnderneath });
  };
  // A command's own steps (a live version landing before its baseline moves, say) are not
  // reported one by one: the app hears how the buffer stands once the command is applied.
  let applying = false;
  const stopReporting = buffer.subscribe(() => {
    if (!applying) report();
  });

  // The ```base blocks on screen, by source: asked for once each, then kept current by the app.
  const bases = new Map<string, WikiEditorBase>();
  const baseListeners = new Set<() => void>();
  const watchBase = (source: string, listener: () => void) => {
    if (!bases.has(source)) {
      bases.set(source, { result: null, error: null });
      post({ type: "queryBase", source });
    }
    baseListeners.add(listener);
    return () => {
      baseListeners.delete(listener);
    };
  };

  const handle = (command: WikiEditorCommand) => {
    applying = true;
    try {
      apply(command);
    } finally {
      applying = false;
    }
    report();
  };

  const apply = (command: WikiEditorCommand) => {
    switch (command.type) {
      case "receive":
        buffer.receive(command.source, command.author);
        // Outside a running turn a write is the whole turn: it settles at once.
        if (!command.turnRunning) buffer.endTurn();
        return;
      case "mode":
        setState({ mode: command.mode });
        return;
      case "theme":
        setState({ theme: command.theme });
        return;
      case "markSaved":
        buffer.markSaved(command.text);
        return;
      case "discard":
        buffer.discard();
        return;
      case "loadChanged":
        buffer.loadChanged();
        return;
      case "requestText":
        post({ type: "text", requestId: command.requestId, text: buffer.current() });
        return;
      case "showBase":
        setState({ base: command.source });
        return;
      case "baseResult":
        bases.set(command.source, { result: command.result, error: command.error });
        for (const listener of baseListeners) listener();
        return;
    }
  };

  return {
    buffer,
    handle,
    getState: () => state,
    watchBase,
    getBase: (source: string): WikiEditorBase | undefined => bases.get(source),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      stopReporting();
      buffer.release();
    },
  };
}

export type WikiEditorPage = ReturnType<typeof createWikiEditorPage>;
