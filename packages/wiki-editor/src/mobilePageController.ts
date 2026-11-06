import type { CanvasData, CanvasMarks } from "@mercurian/wiki/canvas";

import type { CanvasBoardHandle } from "./CanvasBoard";
import type { CanvasCamera } from "./canvasGeometry";
import { WikiNoteBuffer } from "./noteBuffer";
import type {
  WikiEditorBaseResult,
  WikiEditorCodeReference,
  WikiEditorCodeStatus,
  WikiEditorCommand,
  WikiEditorEmbeddedFile,
  WikiEditorEvent,
  WikiEditorFile,
} from "./protocol";

/** How long a board's camera rests before the app hears where it is. */
const CAMERA_REPORT_MS = 250;

/** Compared as a wiki compares names. */
export const documentKey = (name: string) => name.normalize("NFC").toLowerCase();

/** A ```base block's view as the page holds it: nothing yet, a view, or why it can't show. */
export interface WikiEditorBase {
  readonly result: WikiEditorBaseResult | null;
  readonly error: string | null;
}

export interface WikiEditorPageState {
  readonly mode: "read" | "edit";
  /** The base the page shows alone, by source, in place of the note; null shows the note. */
  readonly base: string | null;
  /** Whether that base's notes edit in place. */
  readonly baseEditable: boolean;
  /** The canvas the page shows alone, in place of the note and any base. */
  readonly canvas: CanvasData | null;
  /** What a review marks on the board. */
  readonly marks: CanvasMarks | null;
  /** The commit a wiki's board reads at; null for a thread's, which reads nothing. */
  readonly revision: string | null;
  /** Where the board opens; null fits it. */
  readonly camera: CanvasCamera | null;
  /** What the wiki holds, by `documentKey`; null until the app says, which dims no link. */
  readonly knownDocuments: ReadonlySet<string> | null;
  readonly theme: Extract<WikiEditorCommand, { type: "theme" }>["theme"] | null;
  /** The `@` types the wiki uses, which the editor suggests. */
  readonly linkTypes: ReadonlyArray<string>;
}

/**
 * The editor page's side of the protocol: it applies the app's commands to the note's buffer,
 * and tells the app when the buffer's unsaved state changes. The page renders from `buffer`
 * and `getState`; this holds no DOM.
 */
export function createWikiEditorPage(post: (event: WikiEditorEvent) => void) {
  const buffer = new WikiNoteBuffer();
  let state: WikiEditorPageState = {
    mode: "read",
    base: null,
    baseEditable: false,
    canvas: null,
    marks: null,
    revision: null,
    camera: null,
    knownDocuments: null,
    theme: null,
    linkTypes: [],
  };
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

  // The notes link previews show, by name: asked for once each, then kept current by the app.
  const notes = new Map<string, string | null>();
  const noteListeners = new Set<() => void>();
  const asked = new Set<string>();
  const watchNote = (name: string, listener: () => void) => {
    if (!asked.has(name)) {
      asked.add(name);
      post({ type: "readNote", name });
    }
    noteListeners.add(listener);
    return () => {
      noteListeners.delete(listener);
    };
  };

  // What a board's cards read, each request answered by id; files may arrive in several parts.
  let nextRequest = 1;
  const fileReads = new Map<
    number,
    {
      readonly files: WikiEditorFile[];
      received: number;
      readonly resolve: (files: ReadonlyArray<WikiEditorFile>) => void;
    }
  >();
  const codeReads = new Map<number, (statuses: ReadonlyArray<WikiEditorCodeStatus>) => void>();
  const readFiles = (paths: ReadonlyArray<string>) =>
    new Promise<ReadonlyArray<WikiEditorFile>>((resolve) => {
      const requestId = nextRequest++;
      fileReads.set(requestId, { files: [], received: 0, resolve });
      post({ type: "readFiles", requestId, paths });
    });
  const readCodeStatus = (references: ReadonlyArray<WikiEditorCodeReference>) =>
    new Promise<ReadonlyArray<WikiEditorCodeStatus>>((resolve) => {
      const requestId = nextRequest++;
      codeReads.set(requestId, resolve);
      post({ type: "readCodeStatus", requestId, references });
    });

  // A card's bytes, by address. An address stays shown until a newer one lands, so a commit that
  // leaves an image alone doesn't blank it, and is asked for again once it stops working.
  const assets = new Map<
    string,
    { readonly url: string | null; readonly revision: string; readonly expiresAt: number }
  >();
  const assetsAsked = new Set<string>();
  const assetListeners = new Set<() => void>();
  const watchAsset = (path: string, listener: () => void) => {
    const revision = state.revision ?? "";
    const known = assets.get(path);
    const current = known?.revision === revision && known.expiresAt > Date.now();
    const asking = JSON.stringify([revision, path]);
    if (!current && !assetsAsked.has(asking)) {
      assetsAsked.add(asking);
      post({ type: "readAsset", path });
    }
    assetListeners.add(listener);
    return () => {
      assetListeners.delete(listener);
    };
  };

  // The files a note embeds, by path: asked for once each, then kept current by the app.
  const files = new Map<string, WikiEditorEmbeddedFile>();
  const fileListeners = new Set<() => void>();
  const filesAsked = new Set<string>();
  const watchFile = (path: string, listener: () => void) => {
    if (!filesAsked.has(path)) {
      filesAsked.add(path);
      post({ type: "readFile", path });
    }
    fileListeners.add(listener);
    return () => {
      fileListeners.delete(listener);
    };
  };

  let board: CanvasBoardHandle | null = null;
  let cameraTimer: ReturnType<typeof setTimeout> | undefined;
  let cameraSent: string | null = null;
  const reportCamera = (camera: CanvasCamera | null) => {
    clearTimeout(cameraTimer);
    cameraTimer = setTimeout(() => {
      const sent = JSON.stringify(camera);
      if (sent === cameraSent) return;
      cameraSent = sent;
      post({ type: "camera", camera });
    }, CAMERA_REPORT_MS);
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
        setState({ base: command.source, baseEditable: command.editable === true });
        return;
      case "linkTypes":
        setState({ linkTypes: command.types });
        return;
      case "noteRead":
        notes.set(command.name, command.source);
        for (const listener of noteListeners) listener();
        return;
      case "showCanvas":
        setState({
          canvas: command.data,
          marks: command.marks ?? null,
          revision: command.revision ?? null,
          camera: command.camera ?? null,
        });
        return;
      case "canvasRevision":
        setState({ revision: command.revision });
        return;
      case "focusCard":
        if (command.select) board?.selectCard(command.id);
        else board?.focusCard(command.id);
        return;
      case "knownDocuments":
        setState({ knownDocuments: new Set(command.names.map(documentKey)) });
        return;
      case "filesRead": {
        const read = fileReads.get(command.requestId);
        if (read === undefined) return;
        command.files.forEach((file, position) => {
          read.files[command.start + position] = file;
        });
        read.received += command.files.length;
        if (read.received < command.total) return;
        fileReads.delete(command.requestId);
        read.resolve(read.files);
        return;
      }
      case "codeStatusRead":
        codeReads.get(command.requestId)?.(command.statuses);
        codeReads.delete(command.requestId);
        return;
      case "assetRead":
        assetsAsked.delete(JSON.stringify([command.revision, command.path]));
        assets.set(command.path, {
          url: command.url,
          revision: command.revision,
          expiresAt: command.expiresAt,
        });
        for (const listener of assetListeners) listener();
        return;
      case "fileRead":
        files.set(command.path, command.file);
        for (const listener of fileListeners) listener();
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
    watchNote,
    /** A note's text, null when it isn't written, undefined until the app answers. */
    getNote: (name: string): string | null | undefined => notes.get(name),
    readFiles,
    readCodeStatus,
    watchAsset,
    /** A file's address at the commit shown, null when it has none, undefined until told. */
    getAsset: (path: string): string | null | undefined => assets.get(path)?.url,
    watchFile,
    getFile: (path: string): WikiEditorEmbeddedFile | undefined => files.get(path),
    reportCamera,
    /** The board shown, for what the app drives from outside it, such as Jump to group. */
    setBoard(handle: CanvasBoardHandle | null) {
      board = handle;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      clearTimeout(cameraTimer);
      stopReporting();
      buffer.release();
    },
  };
}

export type WikiEditorPage = ReturnType<typeof createWikiEditorPage>;
