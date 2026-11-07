import type { CanvasData, CanvasMarks } from "@mercurian/wiki/canvas";
import { linkFiles, type WikiLinkFiles } from "@mercurian/wiki/resolve-link";

import type { CanvasBoardHandle, CanvasBoardSettings } from "./CanvasBoard";
import type { WikiLinkScope } from "./linkTools";
import { CanvasDocument } from "./canvasDocument";
import type { CanvasCamera } from "./canvasGeometry";
import type { WikiEmbedAddress } from "./incoming";
import { WikiNoteBuffer } from "./noteBuffer";
import type {
  WikiEditorBaseResult,
  WikiEditorCanvasAnswer,
  WikiEditorCanvasAsk,
  WikiEditorCodeReference,
  WikiEditorCodeStatus,
  WikiEditorCommand,
  WikiEditorEmbeddedFile,
  WikiEditorEvent,
  WikiEditorFile,
  WikiEditorResolvedLink,
} from "./protocol";

/** How long a board's camera rests before the app hears where it is. */
const CAMERA_REPORT_MS = 250;
/** How often the app hears that the person is typing. */
const EDIT_REPORT_MS = 500;

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
  /** The board being edited; null while it can only be read. */
  readonly editing: CanvasDocument | null;
  readonly readOnly: boolean;
  readonly settings: CanvasBoardSettings | undefined;
  /** What a review marks on the board. */
  readonly marks: CanvasMarks | null;
  /** The commit a wiki's note or board reads at; null for a thread's, which reads nothing. */
  readonly revision: string | null;
  /** Where the board opens; null fits it. */
  readonly camera: CanvasCamera | null;
  /** What the wiki holds, and the file linking to it; null until the app says, dimming no link. */
  readonly knownDocuments: { readonly files: WikiLinkFiles; readonly from: string } | null;
  readonly theme: Extract<WikiEditorCommand, { type: "theme" }>["theme"] | null;
  /** The `@` types the wiki uses, which the editor suggests. */
  readonly linkTypes: ReadonlyArray<string>;
  readonly linkScope: WikiLinkScope | null;
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
    editing: null,
    readOnly: false,
    settings: undefined,
    marks: null,
    revision: null,
    camera: null,
    knownDocuments: null,
    theme: null,
    linkTypes: [],
    linkScope: null,
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

  // Typing crosses the bridge at a walking pace: the app only needs to know it hasn't stopped.
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  let editedSince = false;
  const reportEdit = () => {
    if (editTimer !== undefined) {
      editedSince = true;
      return;
    }
    post({ type: "edited" });
    editTimer = setTimeout(() => {
      editTimer = undefined;
      if (!editedSince) return;
      editedSince = false;
      reportEdit();
    }, EDIT_REPORT_MS);
  };
  const stopReportingEdits = buffer.onEdit(reportEdit);

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
  const noteLinks = new Map<string, WikiEditorResolvedLink>();
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

  /** Where a file is, once the app says: at the commit shown, or the last one that had it. */
  const assetAddress = (path: string) =>
    new Promise<WikiEmbedAddress>((resolve) => {
      let stop = () => {};
      const answered = () => {
        const known = assets.get(path);
        if (known === undefined) return;
        if (known.url === null && known.revision !== (state.revision ?? "")) return;
        stop();
        resolve(known);
      };
      stop = watchAsset(path, answered);
      answered();
    });

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

  // A board's edits, crossed to the app at the pace typing does: it saves the latest whole list.
  let editing: CanvasDocument | null = null;
  let editedTimer: ReturnType<typeof setTimeout> | undefined;
  let editedAgain = false;
  const reportCanvasEdits = () => {
    if (editedTimer !== undefined) {
      editedAgain = true;
      return;
    }
    const taken = editing?.take() ?? null;
    if (taken !== null) post({ type: "canvasEdited", ...taken });
    editedTimer = setTimeout(() => {
      editedTimer = undefined;
      if (!editedAgain) return;
      editedAgain = false;
      reportCanvasEdits();
    }, EDIT_REPORT_MS);
  };
  const canvasAsks = new Map<number, (answer: WikiEditorCanvasAnswer) => void>();
  const askApp = (ask: WikiEditorCanvasAsk) =>
    new Promise<WikiEditorCanvasAnswer>((resolve) => {
      const requestId = nextRequest++;
      canvasAsks.set(requestId, resolve);
      post({ type: "canvasAsk", requestId, ask });
    });

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
        buffer.receive(command.source, command.author, command.commit ?? null);
        setState({ revision: command.commit ?? null });
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
        buffer.markSaved(command.text, command.commit ?? null);
        return;
      case "discard":
        buffer.discard();
        return;
      case "loadChanged":
        buffer.loadChanged();
        return;
      case "requestText":
        post({
          type: "text",
          requestId: command.requestId,
          text: buffer.current(),
          ...(buffer.version() === null ? {} : { commit: buffer.version() ?? "" }),
        });
        return;
      case "showBase":
        setState({ base: command.source, baseEditable: command.editable === true });
        return;
      case "linkTypes":
        setState({
          linkTypes: command.types,
          linkScope:
            command.files === undefined
              ? null
              : { files: linkFiles(command.files), from: command.from ?? null },
        });
        return;
      case "noteRead":
        notes.set(command.name, command.source);
        if (command.link !== undefined) noteLinks.set(command.name, command.link);
        for (const listener of noteListeners) listener();
        return;
      case "showCanvas":
        if (command.document === undefined) {
          editing = null;
        } else if (editing === null) {
          editing = new CanvasDocument({
            document: command.document,
            revision: command.revision ?? "",
            onEdited: reportCanvasEdits,
          });
        } else {
          editing.receive(command.document, command.revision ?? "");
        }
        setState({
          canvas: command.data,
          editing,
          readOnly: command.readOnly === true,
          settings: command.settings,
          marks: command.marks ?? null,
          revision: command.revision ?? null,
          camera: command.camera ?? null,
        });
        return;
      case "canvasLanded":
        editing?.landed(command.through, command.commit);
        return;
      case "canvasAnswer":
        canvasAsks.get(command.requestId)?.(command.answer);
        canvasAsks.delete(command.requestId);
        return;
      case "canvasRevision":
        setState({ revision: command.revision });
        return;
      case "focusCard":
        if (command.select) board?.selectCard(command.id);
        else board?.focusCard(command.id);
        return;
      case "knownDocuments":
        setState({ knownDocuments: { files: linkFiles(command.files), from: command.from } });
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
    getNoteLink: (name: string): WikiEditorResolvedLink | undefined => noteLinks.get(name),
    readFiles,
    readCodeStatus,
    watchAsset,
    assetAddress,
    /** A file's address at the commit shown, null when it has none, undefined until told. */
    getAsset: (path: string): string | null | undefined => assets.get(path)?.url,
    watchFile,
    getFile: (path: string): WikiEditorEmbeddedFile | undefined => files.get(path),
    reportCamera,
    askApp,
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
      clearTimeout(editTimer);
      clearTimeout(editedTimer);
      stopReportingEdits();
      stopReporting();
      buffer.release();
    },
  };
}

export type WikiEditorPage = ReturnType<typeof createWikiEditorPage>;
