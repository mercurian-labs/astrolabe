import {
  Annotation,
  type ChangeSet,
  EditorState,
  type Extension,
  type Text,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  type ExcerptControls,
  type ExcerptMark,
  enterExcerpt,
  excerpt,
  excerptBounds,
  setExcerptBounds,
  setExcerptMarks,
  setExcerptReach,
} from "./excerpt.ts";
import {
  boundsOfSpan,
  EXCERPT_CONTEXT_LINES,
  EXCERPT_EXPAND_LINES,
  type ExcerptBounds,
  excerptSpans,
  expandSpan,
  type LineOfInterest,
  type LineSpan,
  mapBounds,
  spanOfBounds,
  touchingGroups,
  updateSpans,
} from "./excerpts.ts";

/**
 * Astrolabe: a multi-file view as stacked editors, one per excerpt, over its file's whole text. A
 * file's excerpts share one live document through a headless editor here, the session's only
 * editor, so an edit in one reaches the others at once. Each excerpt keeps its own undo.
 */

/** A file's live document as the multibuffer needs it: `DocumentSession` fits. */
export interface ExcerptDocument {
  /** The text and the extension that keeps the editor in step, once the document opened. */
  initialState(): { readonly text: string; readonly extension: Extension } | null;
  attach(editor: {
    readonly state: EditorState;
    readonly dispatch: (transaction: Transaction | TransactionSpec) => void;
  }): void;
  detach(): void;
  /** After each edit made here. */
  changed(): void;
}

/** A range to mark in a file, 1-based lines and 0-based columns (UTF-16). */
export interface FileMark {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly className?: string;
}

export interface MultibufferFileInput {
  readonly path: string;
  /** What the excerpts are about; each gets context lines around it. */
  readonly lines: readonly LineOfInterest[];
  readonly marks?: readonly FileMark[];
  /** The lines as last seen elsewhere (a search result), shown until the document opens. */
  readonly preview?: ReadonlyMap<number, string>;
}

export interface MultibufferExcerpt {
  readonly id: string;
  readonly file: MultibufferFile;
  /** The lines before the document opened; afterwards `bounds`. */
  span: LineSpan;
  bounds: ExcerptBounds | null;
  /** Its editor's state, once it was shown, kept while it scrolls out of view. */
  state: EditorState | null;
  view: EditorView | null;
}

export interface MultibufferFile {
  readonly path: string;
  readonly excerpts: MultibufferExcerpt[];
  marks: readonly FileMark[];
  preview: ReadonlyMap<number, string>;
  /** The headless editor bound to the document, once it opened. */
  hub: EditorState | null;
  document: ExcerptDocument | null;
  failed: string | null;
}

export type MultibufferRow =
  | { readonly kind: "header"; readonly key: string; readonly file: MultibufferFile }
  | { readonly kind: "excerpt"; readonly key: string; readonly excerpt: MultibufferExcerpt };

/**
 * Where the caret should go next: an excerpt, its first or last line, and a column there; or
 * `"kept"`, where its selection already is, for an excerpt whose editor was rebuilt with the caret.
 */
export interface FocusRequest {
  readonly excerpt: MultibufferExcerpt;
  readonly line: "first" | "last" | "kept" | number;
  readonly column: number;
  readonly id: number;
}

/** Marks edits that came from the file's other editors. */
const fromSibling = Annotation.define<true>();

export interface MultibufferOptions {
  /** Opens a file's live document; the multibuffer attaches once it has text. */
  readonly open: (path: string) => ExcerptDocument;
  /** Called when a document stops being needed (the view closed, or its file left). */
  readonly close: (path: string, document: ExcerptDocument) => void;
  /** Opens the file in its own tab at a 1-based line. */
  readonly openFile: (path: string, line: number) => void;
  readonly context?: number;
}

let nextExcerptId = 1;

function markRange(doc: Text, mark: FileMark): ExcerptMark | null {
  if (mark.line < 1 || mark.line > doc.lines) return null;
  const start = doc.line(mark.line);
  const end = doc.line(Math.min(Math.max(mark.endLine, mark.line), doc.lines));
  const from = start.from + Math.min(Math.max(mark.column, 0), start.length);
  const to = Math.max(from, end.from + Math.min(Math.max(mark.endColumn, 0), end.length));
  return { from, to, ...(mark.className === undefined ? {} : { className: mark.className }) };
}

export class Multibuffer {
  private files: MultibufferFile[] = [];
  private rowsCache: MultibufferRow[] | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly focusListeners = new Set<() => void>();
  private focus: FocusRequest | null = null;
  private nextFocusId = 1;

  constructor(private readonly options: MultibufferOptions) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly rows = (): readonly MultibufferRow[] => {
    this.rowsCache ??= this.files.flatMap((file): MultibufferRow[] => [
      { kind: "header", key: `file:${file.path}`, file },
      ...file.excerpts.map((item): MultibufferRow => ({
        kind: "excerpt",
        key: `excerpt:${item.id}`,
        excerpt: item,
      })),
    ]);
    return this.rowsCache;
  };

  readonly fileList = (): readonly MultibufferFile[] => this.files;

  /** Asks for a caret move the view carries out once the excerpt's editor is shown. */
  readonly onFocusRequest = (listener: () => void): (() => void) => {
    this.focusListeners.add(listener);
    return () => this.focusListeners.delete(listener);
  };

  readonly focusRequest = (): FocusRequest | null => this.focus;

  /** The view has carried out request `id`. */
  focusDone(id: number) {
    if (this.focus?.id === id) this.focus = null;
  }

  /**
   * Shows these files' excerpts. A file already shown keeps the excerpts it had where new ones
   * overlap them (with any context added since), and loses the rest; a file not listed goes.
   */
  set(inputs: readonly MultibufferFileInput[]) {
    const context = this.options.context ?? EXCERPT_CONTEXT_LINES;
    const previous = new Map(this.files.map((file) => [file.path, file]));
    const next: MultibufferFile[] = [];
    for (const input of inputs) {
      const old = previous.get(input.path);
      previous.delete(input.path);
      const lineCount = old?.hub ? old.hub.doc.lines : Number.MAX_SAFE_INTEGER;
      const spans = excerptSpans(input.lines, lineCount, context);
      if (old === undefined) {
        const file: MultibufferFile = {
          path: input.path,
          excerpts: [],
          marks: input.marks ?? [],
          preview: input.preview ?? new Map(),
          hub: null,
          document: null,
          failed: null,
        };
        for (const span of spans) file.excerpts.push(this.makeExcerpt(file, span));
        next.push(file);
        continue;
      }
      old.marks = input.marks ?? [];
      old.preview = input.preview ?? new Map();
      const current = old.excerpts.map((item) => this.spanOf(item));
      const updated = updateSpans(current, spans);
      const kept = new Set<MultibufferExcerpt>();
      const excerpts = updated.map((span) => {
        const reuse = span.kept
          .map((index) => old.excerpts[index]!)
          .find((item) => !kept.has(item));
        if (reuse === undefined) return this.makeExcerpt(old, span);
        kept.add(reuse);
        this.setSpan(reuse, span);
        return reuse;
      });
      for (const item of old.excerpts) if (!kept.has(item)) this.dropExcerpt(item);
      old.excerpts.splice(0, old.excerpts.length, ...excerpts);
      this.refreshExcerpts(old);
      next.push(old);
    }
    for (const file of previous.values()) this.closeFile(file);
    this.files = next;
    this.changed();
  }

  /** Opens the file's document if it is not open yet; its excerpts get editors once it has text. */
  need(file: MultibufferFile) {
    if (file.document !== null || !this.files.includes(file)) return;
    file.document = this.options.open(file.path);
    // The document may have had its text before `open` returned.
    this.documentReady(file);
  }

  /**
   * The document has text (or failed): binds the file's excerpts to it. Called by whoever opened
   * it, whenever its state changes; does nothing once bound.
   */
  documentReady(file: MultibufferFile) {
    const document = file.document;
    if (document === null || file.hub !== null) return;
    const initial = document.initialState();
    if (initial === null) return;
    const hub = EditorState.create({ doc: initial.text, extensions: initial.extension });
    file.hub = hub;
    for (const item of file.excerpts) item.bounds = boundsOfSpan(hub.doc, item.span);
    document.attach({
      get state() {
        return file.hub!;
      },
      dispatch: (spec) => this.hubDispatch(file, spec),
    });
    if (!this.mergeTouching(file)) this.refreshExcerpts(file);
    this.changed();
  }

  documentFailed(file: MultibufferFile, message: string) {
    file.failed = message;
    this.changed();
  }

  /** The editor state to show an excerpt with, made the first time it is shown. */
  stateFor(item: MultibufferExcerpt, extensions: (item: MultibufferExcerpt) => Extension) {
    const hub = item.file.hub;
    if (hub === null) return null;
    if (item.state !== null) return item.state;
    const bounds = item.bounds ?? boundsOfSpan(hub.doc, item.span);
    const marks = item.file.marks.flatMap((mark) => {
      const range = markRange(hub.doc, mark);
      return range !== null && range.from >= bounds.from && range.to <= bounds.to ? [range] : [];
    });
    const reach = this.reachOf(item, bounds);
    item.state = EditorState.create({
      doc: hub.doc,
      extensions: [
        extensions(item),
        excerpt({ bounds, reach, marks, controls: this.controls(item) }),
      ],
    });
    item.bounds = null;
    return item.state;
  }

  /** The excerpt's editor is shown in `view` (built from `stateFor`). */
  shown(item: MultibufferExcerpt, view: EditorView) {
    item.view = view;
  }

  /**
   * The excerpt's editor scrolled out of view; its state stays for when it comes back. One that had
   * the caret gets it back in its next editor, as when React builds an editor twice.
   */
  hidden(item: MultibufferExcerpt, view: EditorView) {
    if (item.view !== view) return;
    item.state = view.state;
    item.view = null;
    if (view.hasFocus && this.focus === null) {
      this.focus = { excerpt: item, line: "kept", column: 0, id: this.nextFocusId++ };
    }
  }

  /** For `EditorView`'s `dispatchTransactions`: applies the view's transactions and shares edits. */
  dispatchFrom(item: MultibufferExcerpt) {
    return (transactions: readonly Transaction[], view: EditorView) => {
      view.update(transactions);
      item.state = view.state;
      for (const tr of transactions) {
        if (tr.docChanged && tr.annotation(fromSibling) === undefined) this.local(item, tr);
      }
    };
  }

  expand(item: MultibufferExcerpt, up: number, down: number) {
    const hub = item.file.hub;
    if (hub === null || !item.file.excerpts.includes(item)) return;
    const amount = (lines: number) => (lines === 0 ? EXCERPT_EXPAND_LINES : lines);
    const both = up === 0 && down === 0;
    const span = expandSpan(
      spanOfBounds(hub.doc, this.boundsOf(item)!),
      hub.doc.lines,
      both || up > 0 ? amount(up) : 0,
      both || down > 0 ? amount(down) : 0,
    );
    this.setSpan(item, span);
    if (!this.mergeTouching(item.file)) this.refreshExcerpts(item.file);
    this.changed();
  }

  /** Moves the caret into the excerpt after (1) or before (-1) `item`. */
  leave(item: MultibufferExcerpt, direction: 1 | -1, column: number) {
    const excerpts = this.files.flatMap((file) => file.excerpts);
    const index = excerpts.indexOf(item);
    const target = excerpts[index + direction];
    if (index === -1 || target === undefined) return;
    this.requestFocus(target, direction === 1 ? "first" : "last", column);
  }

  /** Moves the caret to the first excerpt of the next (1) or previous (-1) file. */
  jumpFile(item: MultibufferExcerpt | null, direction: 1 | -1) {
    const index = item === null ? -1 : this.files.indexOf(item.file);
    const start = index === -1 ? (direction === 1 ? 0 : this.files.length - 1) : index + direction;
    for (let at = start; at >= 0 && at < this.files.length; at += direction) {
      const target = this.files[at]!.excerpts[0];
      if (target !== undefined) return this.requestFocus(target, "first", 0);
    }
  }

  /** Opens a file in its own tab at a 1-based line. */
  openFileAt(path: string, line: number) {
    this.options.openFile(path, line);
  }

  /** Puts the caret on 1-based `line` of `item`'s file inside `item`. */
  focusLine(item: MultibufferExcerpt, line: number, column = 0) {
    this.requestFocus(item, line, column);
  }

  /** Carries out a focus request on a shown editor. */
  applyFocus(request: FocusRequest, view: EditorView) {
    this.focusDone(request.id);
    if (request.line === "kept") {
      // Only where the caret went nowhere else meanwhile.
      const active = view.root.activeElement;
      if (active === null || active === view.dom.ownerDocument.body) view.focus();
      return;
    }
    const state = view.state;
    const spec =
      typeof request.line === "number"
        ? (() => {
            const bounds = excerptBounds(state);
            const doc = state.doc;
            const line = doc.line(Math.min(Math.max(request.line, 1), doc.lines));
            const head = Math.min(Math.max(line.from + request.column, bounds.from), bounds.to);
            return { selection: { anchor: head }, scrollIntoView: true };
          })()
        : enterExcerpt(state, request.line, request.column);
    view.dispatch(spec);
    view.focus();
  }

  /**
   * Closes every document and drops every editor state; the files and their excerpts stay, and
   * open again when next needed.
   */
  release() {
    for (const file of this.files) this.closeFile(file);
    this.changed();
  }

  /** The excerpt's lines as positions, once its document is open. */
  boundsOf(item: MultibufferExcerpt): ExcerptBounds | null {
    if (item.view !== null) return excerptBounds(item.view.state);
    if (item.state !== null) return excerptBounds(item.state);
    return item.bounds;
  }

  private spanOf(item: MultibufferExcerpt): LineSpan {
    const hub = item.file.hub;
    const bounds = this.boundsOf(item);
    return hub !== null && bounds !== null ? spanOfBounds(hub.doc, bounds) : item.span;
  }

  private setSpan(item: MultibufferExcerpt, span: LineSpan) {
    item.span = span;
    const hub = item.file.hub;
    if (hub === null) return;
    const bounds = boundsOfSpan(hub.doc, span);
    if (item.view !== null) item.view.dispatch({ effects: setExcerptBounds.of(bounds) });
    else if (item.state !== null) {
      item.state = item.state.update({ effects: setExcerptBounds.of(bounds) }).state;
    } else item.bounds = bounds;
  }

  /** The lines an excerpt's bars count: those before the file's excerpts above and below it. */
  private reachOf(item: MultibufferExcerpt, bounds: ExcerptBounds): ExcerptBounds {
    const length = item.file.hub?.doc.length ?? 0;
    let from = 0;
    let to = length;
    for (const other of item.file.excerpts) {
      const near = other === item ? null : this.boundsOf(other);
      if (near === null) continue;
      if (near.to < bounds.from) from = Math.max(from, Math.min(near.to + 1, length));
      else if (near.from > bounds.to) to = Math.min(to, Math.max(near.from - 1, 0));
    }
    return { from, to };
  }

  /** Hands each excerpt of the file its marks and its reach, after its excerpts changed. */
  private refreshExcerpts(file: MultibufferFile) {
    const hub = file.hub;
    if (hub === null) return;
    const marks = file.marks.flatMap((mark) => markRange(hub.doc, mark) ?? []);
    for (const item of file.excerpts) {
      const bounds = this.boundsOf(item);
      if (bounds === null) continue;
      const inside = marks.filter((mark) => mark.from >= bounds.from && mark.to <= bounds.to);
      const effects = [setExcerptMarks.of(inside), setExcerptReach.of(this.reachOf(item, bounds))];
      if (item.view !== null) item.view.dispatch({ effects });
      else if (item.state !== null) item.state = item.state.update({ effects }).state;
    }
  }

  private makeExcerpt(file: MultibufferFile, span: LineSpan): MultibufferExcerpt {
    const hub = file.hub;
    return {
      id: String(nextExcerptId++),
      file,
      span,
      bounds: hub === null ? null : boundsOfSpan(hub.doc, span),
      state: null,
      view: null,
    };
  }

  private dropExcerpt(item: MultibufferExcerpt) {
    item.state = null;
    if (this.focus?.excerpt === item) this.focus = null;
  }

  private closeFile(file: MultibufferFile) {
    for (const item of file.excerpts) {
      item.span = this.spanOf(item);
      item.bounds = null;
      this.dropExcerpt(item);
    }
    const document = file.document;
    file.document = null;
    file.hub = null;
    if (document !== null) {
      document.detach();
      this.options.close(file.path, document);
    }
  }

  private controls(item: MultibufferExcerpt): ExcerptControls {
    return {
      expand: (up, down) => this.expand(item, up, down),
      leave: (edge, column) => this.leave(item, edge === "up" ? -1 : 1, column),
      open: (line) => this.options.openFile(item.file.path, line),
      jumpFile: (direction) => this.jumpFile(item, direction),
    };
  }

  private requestFocus(item: MultibufferExcerpt, line: FocusRequest["line"], column: number) {
    this.focus = { excerpt: item, line, column, id: this.nextFocusId++ };
    if (item.view !== null) return this.applyFocus(this.focus, item.view);
    for (const listener of this.focusListeners) listener();
  }

  /** The session's own transactions on the file: remote edits and its resets. */
  private hubDispatch(file: MultibufferFile, spec: Transaction | TransactionSpec) {
    const hub = file.hub;
    if (hub === null) return;
    const tr = spec instanceof Transaction ? spec : hub.update(spec);
    file.hub = tr.state;
    if (tr.docChanged) this.share(file, tr.changes, null);
  }

  /** An edit typed into `item`: into the document, then to the file's other excerpts. */
  private local(item: MultibufferExcerpt, tr: Transaction) {
    const file = item.file;
    const hub = file.hub;
    // An excerpt merged into another may get one more edit before its editor goes.
    if (hub === null || !file.excerpts.includes(item)) return;
    const userEvent = tr.annotation(Transaction.userEvent);
    file.hub = hub.update({
      changes: tr.changes,
      ...(userEvent === undefined ? {} : { annotations: Transaction.userEvent.of(userEvent) }),
    }).state;
    this.share(file, tr.changes, item);
    file.document?.changed();
  }

  private share(file: MultibufferFile, changes: ChangeSet, origin: MultibufferExcerpt | null) {
    const spec = {
      changes,
      annotations: [
        fromSibling.of(true),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
      ],
      filter: false,
    };
    const doc = file.hub!.doc;
    for (const item of file.excerpts) {
      if (item === origin) continue;
      if (item.view !== null) item.view.dispatch(spec);
      else if (item.state !== null) item.state = item.state.update(spec).state;
      else if (item.bounds !== null) item.bounds = mapBounds(item.bounds, changes, doc);
    }
    if (this.mergeTouching(file)) this.changed();
  }

  /** Merges the file's excerpts that came to overlap or touch; whether any did. */
  private mergeTouching(file: MultibufferFile): boolean {
    const hub = file.hub;
    if (hub === null || file.excerpts.length < 2) return false;
    const spans = file.excerpts.map((item) => spanOfBounds(hub.doc, this.boundsOf(item)!));
    const groups = touchingGroups(spans);
    if (groups.length === 0) return false;
    const removed = new Set<MultibufferExcerpt>();
    for (const group of groups) {
      // The one with an editor on screen stays, so the caret and its history stay with it.
      const keep =
        group.map((index) => file.excerpts[index]!).find((item) => item.view !== null) ??
        file.excerpts[group[0]!]!;
      const first = Math.min(...group.map((index) => spans[index]!.first));
      const last = Math.max(...group.map((index) => spans[index]!.last));
      for (const index of group) {
        const item = file.excerpts[index]!;
        if (item !== keep) removed.add(item);
      }
      this.setSpan(keep, { first, last });
    }
    for (const item of removed) {
      if (this.focus?.excerpt === item) this.focus = null;
      item.state = null;
    }
    const kept = file.excerpts.filter((item) => !removed.has(item));
    file.excerpts.splice(0, file.excerpts.length, ...kept);
    this.refreshExcerpts(file);
    return true;
  }

  private changed() {
    this.rowsCache = null;
    for (const listener of this.listeners) listener();
  }
}
