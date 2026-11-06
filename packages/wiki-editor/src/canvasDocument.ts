import { applyCanvasHandEdits, type CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import {
  canvasCardName,
  canvasChangedCards,
  canvasData,
  canvasEntries,
  type CanvasData,
} from "@mercurian/wiki/canvas";

import { CANVAS_GAP } from "./canvasArrange";

/** Two nudges this close together undo as one step. Obsidian's window wasn't measured. */
const NUDGE_MERGE_MS = 1_000;

type Raw = Readonly<Record<string, unknown>>;

interface HistoryStep {
  undo: ReadonlyArray<CanvasHandEdit>;
  redo: ReadonlyArray<CanvasHandEdit>;
  readonly merge: string | undefined;
  at: number;
}

interface Typing {
  readonly card: string;
  readonly original: string;
  text: string;
}

export interface CanvasDocumentState {
  readonly data: CanvasData;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What a person needs told: both versions of a card kept, say. */
  readonly notice: string | null;
  /** The cards a commit from elsewhere just changed, and the commit. */
  readonly flash: { readonly revision: string; readonly cards: ReadonlySet<string> } | null;
}

export interface CanvasTakenEdits {
  readonly edits: ReadonlyArray<CanvasHandEdit>;
  /** Hand back to `landed` once these are in. */
  readonly through: number;
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** A card's or arrow's id, as Obsidian mints them. */
export const mintCanvasId = (): string => randomHex(8);

const nodesOf = (document: unknown) =>
  canvasEntries((document as { nodes?: unknown } | null)?.nodes, "node");

function nodeById(document: unknown, id: string): Raw | undefined {
  return nodesOf(document).find((entry) => entry.id === id)?.raw;
}

const textOf = (raw: Raw | undefined) => (typeof raw?.text === "string" ? raw.text : undefined);

/**
 * One board being edited, outside React: the last version read with this person's unlanded edits
 * replayed on it, so a commit from elsewhere enters without touching them. Edits replay by id, so
 * taking them twice does no harm, and undo is each step's inverse as a new edit, so it reaches past
 * what has already saved.
 */
export class CanvasDocument {
  #base: unknown;
  #revision: string;
  #document: unknown;
  #state: CanvasDocumentState;
  /** Not known to have landed, oldest first. */
  #pending: Array<{ readonly seq: number; readonly edits: ReadonlyArray<CanvasHandEdit> }> = [];
  #seq = 0;
  #history: HistoryStep[] = [];
  #future: HistoryStep[] = [];
  #typing: Typing | null = null;
  /** What this person's saves left as the head; a read of an older one is its own stale echo. */
  #latestLanded: string | null = null;
  readonly #ownCommits = new Set<string>();
  /** Text this person sent, so what comes back isn't taken for someone else's. */
  readonly #sentText = new Map<string, Set<string>>();
  readonly #listeners = new Set<() => void>();
  readonly #onEdited: () => void;
  readonly #mint: () => string;
  readonly #now: () => number;

  constructor(options: {
    readonly document: unknown;
    readonly revision: string;
    /** Something new to save. */
    readonly onEdited?: () => void;
    readonly mint?: () => string;
    readonly now?: () => number;
  }) {
    this.#base = options.document;
    this.#document = options.document;
    this.#revision = options.revision;
    this.#onEdited = options.onEdited ?? (() => {});
    this.#mint = options.mint ?? mintCanvasId;
    this.#now = options.now ?? Date.now;
    this.#state = {
      data: canvasData(options.document),
      canUndo: false,
      canRedo: false,
      notice: null,
      flash: null,
    };
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getState = () => this.#state;

  readonly mint = () => this.#mint();

  /** The file's JSON, as shown now, for what must carry a card's unknown keys. */
  get document() {
    return this.#document;
  }

  /** A card as the file holds it, unknown keys included. */
  raw(id: string) {
    return nodeById(this.#document, id);
  }

  #publish(patch: Partial<CanvasDocumentState> = {}) {
    this.#state = {
      ...this.#state,
      data: canvasData(this.#document),
      canUndo: this.#history.length > 0,
      canRedo: this.#future.length > 0,
      ...patch,
    };
    for (const listener of this.#listeners) listener();
  }

  #apply(edits: ReadonlyArray<CanvasHandEdit>) {
    const { document, inverse } = applyCanvasHandEdits(this.#document, edits);
    this.#document = document;
    this.#seq += 1;
    this.#pending.push({ seq: this.#seq, edits });
    return inverse;
  }

  /** One gesture's edits, as one step of undo; steps sharing `merge` run together. */
  commit(edits: ReadonlyArray<CanvasHandEdit>, options: { readonly merge?: string } = {}) {
    if (edits.length === 0) return;
    const inverse = this.#apply(edits);
    const now = this.#now();
    const last = this.#history.at(-1);
    if (
      options.merge !== undefined &&
      last?.merge === options.merge &&
      now - last.at < NUDGE_MERGE_MS
    ) {
      last.undo = [...inverse, ...last.undo];
      last.redo = [...last.redo, ...edits];
      last.at = now;
    } else {
      this.#history.push({ undo: inverse, redo: edits, merge: options.merge, at: now });
    }
    this.#future = [];
    this.#publish();
    this.#onEdited();
  }

  undo() {
    const step = this.#history.pop();
    if (step === undefined) return;
    const inverse = this.#apply(step.undo);
    this.#future.push({ ...step, undo: step.undo, redo: inverse });
    this.#publish();
    this.#onEdited();
  }

  redo() {
    const step = this.#future.pop();
    if (step === undefined) return;
    const inverse = this.#apply(step.redo);
    this.#history.push({ ...step, undo: inverse, redo: step.redo });
    this.#publish();
    this.#onEdited();
  }

  /** A card's editor opened: what's typed saves as it goes, and is one step when it closes. */
  startTyping(card: string) {
    const original = textOf(this.raw(card)) ?? "";
    this.#typing = { card, original, text: original };
  }

  /** Typing moves no state a board draws, so nothing renders per keystroke. */
  type(text: string) {
    if (this.#typing === null || this.#typing.text === text) return;
    this.#typing.text = text;
    this.#onEdited();
  }

  /** The editor closed. */
  finishTyping() {
    const typing = this.#typing;
    this.#typing = null;
    if (typing === null || typing.text === typing.original) return;
    this.commit([{ op: "set-card", card: typing.card, keys: { text: typing.text } }]);
  }

  /** What to save now, or null. Everything not known to have landed goes again. */
  take(): CanvasTakenEdits | null {
    const typing = this.#typing;
    const typed: ReadonlyArray<CanvasHandEdit> =
      typing === null || typing.text === typing.original
        ? []
        : [{ op: "set-card", card: typing.card, keys: { text: typing.text } }];
    const edits = [...this.#pending.flatMap((batch) => batch.edits), ...typed];
    if (edits.length === 0) return null;
    for (const edit of edits) {
      if (edit.op !== "set-card" || typeof edit.keys.text !== "string") continue;
      const sent = this.#sentText.get(edit.card);
      if (sent === undefined) this.#sentText.set(edit.card, new Set([edit.keys.text]));
      else sent.add(edit.keys.text);
    }
    return { edits, through: this.#seq };
  }

  /** Those edits are on the head. `commit` is null when they changed nothing there. */
  landed(through: number, commit: string | null) {
    this.#pending = this.#pending.filter((batch) => batch.seq > through);
    if (commit === null) return;
    if (this.#latestLanded !== null) this.#ownCommits.add(this.#latestLanded);
    this.#latestLanded = commit;
  }

  /** Keeps both versions of what typing and a commit from elsewhere each changed. */
  #keepBoth(before: unknown): { readonly edits: CanvasHandEdit[]; readonly names: string[] } {
    const mine = new Map<string, string>();
    for (const batch of this.#pending) {
      for (const edit of batch.edits) {
        if (edit.op === "set-card" && typeof edit.keys.text === "string") {
          mine.set(edit.card, edit.keys.text);
        }
      }
    }
    if (this.#typing !== null) mine.set(this.#typing.card, this.#typing.text);
    const edits: CanvasHandEdit[] = [];
    const names: string[] = [];
    for (const [card, text] of mine) {
      const was = nodeById(before, card);
      const now = nodeById(this.#base, card);
      if (now === undefined) {
        if (was === undefined) continue;
        edits.push({ op: "put-card", node: { ...was, text } });
        names.push(canvasCardName({ ...was, text }));
        continue;
      }
      const theirs = textOf(now);
      if (
        theirs === undefined ||
        theirs === textOf(was) ||
        theirs === text ||
        this.#sentText.get(card)?.has(theirs)
      ) {
        continue;
      }
      const y = typeof now.y === "number" ? now.y : 0;
      const height = typeof now.height === "number" ? now.height : 0;
      edits.push({
        op: "put-card",
        node: { ...now, id: this.#mint(), y: y + height + CANVAS_GAP },
      });
      names.push(canvasCardName(now));
    }
    return { edits, names };
  }

  /** A version read from the wiki. This person's unlanded edits stay on top of it. */
  receive(document: unknown, revision: string) {
    if (revision === this.#revision) return;
    if (this.#ownCommits.has(revision)) return;
    const before = this.#base;
    const shown = this.#state.data;
    this.#base = document;
    this.#revision = revision;
    let next = document;
    for (const batch of this.#pending) next = applyCanvasHandEdits(next, batch.edits).document;
    this.#document = next;
    const { edits, names } = this.#keepBoth(before);
    if (edits.length > 0) this.#apply(edits);
    if (this.#pending.length === 0 && this.#typing === null) this.#sentText.clear();
    const data = canvasData(this.#document);
    const changed = canvasChangedCards(shown, data);
    this.#publish({
      ...(names.length > 0
        ? {
            notice:
              names.length === 1
                ? `"${names[0]}" also changed elsewhere. Both versions are on the board.`
                : `${names.length} cards also changed elsewhere. Both versions are on the board.`,
          }
        : {}),
      ...(changed.size > 0 ? { flash: { revision, cards: changed } } : {}),
    });
    if (edits.length > 0) this.#onEdited();
  }

  /** Forgets everything unlanded, as discarding a draft does: what's shown is what was read. */
  discard() {
    this.#pending = [];
    this.#typing = null;
    this.#history = [];
    this.#future = [];
    this.#document = this.#base;
    this.#publish();
  }

  dismissNotice() {
    if (this.#state.notice !== null) this.#publish({ notice: null });
  }
}
