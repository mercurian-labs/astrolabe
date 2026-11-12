/**
 * The messages between a native app and the wiki editor page it shows in a web view. The app
 * keeps the server connection: it reads the note and hands each version to the page, and the
 * page edits it and says what the person did. Plain data both ways, as JSON.
 */

import type { CanvasCodeReference, CanvasData, CanvasMarks } from "@mercurian/wiki/canvas";
import type { CanvasHandEdit } from "@mercurian/wiki/canvas-edits";

import type { BaseCellValue } from "./baseCells";
import type { CanvasBoardSettings } from "./CanvasBoard";
import type { CanvasCamera } from "./canvasGeometry";

/** A column's summary, as Obsidian displays its value. */
export interface WikiEditorBaseSummary {
  readonly column: string;
  readonly name: string;
  readonly value: string;
}

/** An image a card or cell shows: a file in the wiki's repository, a web address, or a colour. */
export type WikiEditorBaseImage =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "color"; readonly color: string };

/** How a cell shows when it isn't text. */
export type WikiEditorBaseDisplay =
  | { readonly kind: "date"; readonly date: string }
  | { readonly kind: "url"; readonly href: string; readonly text: string }
  | { readonly kind: "html"; readonly html: string }
  | { readonly kind: "icon"; readonly name: string }
  | { readonly kind: "image"; readonly image: WikiEditorBaseImage }
  | { readonly kind: "error"; readonly message: string };

/** The settings a view is drawn with, as Obsidian keys them (see the server's `viewSettings`). */
export interface WikiEditorBaseSettings {
  readonly groupBy?: { readonly property: string; readonly direction: "ASC" | "DESC" } | undefined;
  readonly columnSize?: Readonly<Record<string, number>> | undefined;
  readonly rowHeight?: string | undefined;
  readonly cardSize?: number | undefined;
  readonly image?: string | undefined;
  readonly imageFit?: string | undefined;
  readonly imageAspectRatio?: number | undefined;
  readonly markers?: string | undefined;
  readonly indentProperties?: boolean | undefined;
  readonly separator?: string | undefined;
  readonly coordinates?: string | undefined;
  readonly mapHeight?: number | undefined;
}

export interface WikiEditorBaseRow {
  readonly name: string;
  readonly file: string;
  readonly values: Readonly<Record<string, BaseCellValue>>;
  readonly group?: BaseCellValue | undefined;
  readonly display?: Readonly<Record<string, WikiEditorBaseDisplay>> | undefined;
  readonly cover?: WikiEditorBaseImage | undefined;
  readonly marker?:
    | {
        readonly lat: number;
        readonly lng: number;
        readonly icon?: string | undefined;
        readonly color?: string | undefined;
      }
    | undefined;
}

/** One view of a ```base block, run by the app on the server (`wiki.query`). */
export interface WikiEditorBaseResult {
  readonly view: {
    readonly name: string;
    readonly type: "table" | "cards" | "list" | "kanban" | "map";
  };
  readonly settings?: WikiEditorBaseSettings | undefined;
  readonly columns: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly groupBy: { readonly id: string; readonly label: string } | null;
  readonly rows: ReadonlyArray<WikiEditorBaseRow>;
  readonly groups?:
    | ReadonlyArray<{
        readonly value: BaseCellValue;
        readonly count?: number | undefined;
        readonly summaries: ReadonlyArray<WikiEditorBaseSummary>;
      }>
    | undefined;
  readonly summaries?: ReadonlyArray<WikiEditorBaseSummary> | undefined;
  readonly total: number;
  readonly truncated: boolean;
}

/** Who wrote a version that lands live, in which turn; the page marks it in their colour. */
export interface WikiEditorAuthor {
  readonly name: string;
  readonly color: string;
  readonly turnId: string;
}

/** The app's colours, as CSS custom properties on the page's root (`--background`, …). */
export interface WikiEditorTheme {
  readonly appearance: "light" | "dark";
  readonly variables: Readonly<Record<string, string>>;
}

/** A card's file as the page holds it. */
export interface WikiEditorFile {
  readonly exists: boolean;
  /** Null for a file with no text to show. */
  readonly text: string | null;
}

export type WikiEditorCodeStatus = "current" | "changed" | "gone" | "unknown";

/** A code card's file, asked about at its project's head. */
export interface WikiEditorCodeReference {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
}

/** What the app tells the page. */
/** What a board on the page can't reach by itself. */
export type WikiEditorCanvasAsk =
  | { readonly kind: "list-files" }
  | { readonly kind: "read-file"; readonly path: string }
  | { readonly kind: "asset-url"; readonly path: string }
  | {
      readonly kind: "write-note";
      readonly file: string;
      readonly text: string;
      readonly readAt?: string | undefined;
    }
  | { readonly kind: "rename"; readonly file: string; readonly to: string }
  | { readonly kind: "place-note"; readonly name: string };

export type WikiEditorCanvasAnswer =
  | { readonly kind: "files"; readonly files: ReadonlyArray<string> }
  /** A file's text or address, null when it has none. */
  | { readonly kind: "value"; readonly value: string | null }
  /** Why a write failed, null when it didn't. */
  | { readonly kind: "failure"; readonly message: string | null };

/** Where a link landed, as `resolveLink` says. */
export interface WikiEditorResolvedLink {
  readonly file: string | null;
  readonly others: ReadonlyArray<string>;
}

export type WikiEditorCommand =
  /** A read of the note. With `author`, a changed version lands live as theirs. */
  | {
      readonly type: "receive";
      readonly source: string;
      readonly author: WikiEditorAuthor | null;
      /** While the author's turn runs, its writes stay one reviewable change. */
      readonly turnRunning: boolean;
      /** The commit it was read at. */
      readonly commit?: string | undefined;
    }
  /** Reading follows links on a tap; editing types. A skill map is never editable. */
  | { readonly type: "mode"; readonly mode: "read" | "edit" }
  | { readonly type: "theme"; readonly theme: WikiEditorTheme }
  /** The edits were saved as `text`, at `commit`: the next read should bring it back. */
  | { readonly type: "markSaved"; readonly text: string; readonly commit?: string | undefined }
  | { readonly type: "discard" }
  /** Drops the edits for the version that changed underneath them. */
  | { readonly type: "loadChanged" }
  /** Asks for the buffer's text, answered with a `text` event carrying `requestId`. */
  | { readonly type: "requestText"; readonly requestId: number }
  /**
   * The page shows one base alone, read only, instead of the note: a `.base` file opened on
   * its own. It asks for `source` with `queryBase` as it would a block's.
   */
  | {
      readonly type: "showBase";
      readonly source: string;
      /** Its notes' cells edit in place, and a board's cards move, as `editBase` events. */
      readonly editable?: boolean | undefined;
    }
  /**
   * Shows a canvas alone, in place of the note, to pan and zoom. With `revision`, a wiki's board
   * at that commit, whose cards read through the app; without, a thread's, which needs nothing.
   */
  | {
      readonly type: "showCanvas";
      readonly data: CanvasData;
      readonly revision?: string | undefined;
      /** Where a page that had to load again left off; null fits the board. */
      readonly camera?: CanvasCamera | null | undefined;
      /** What a review marks on it. */
      readonly marks?: CanvasMarks | undefined;
      /** The file's JSON, which a person edits: what it draws takes `data`'s place. */
      readonly document?: unknown;
      /** This board's own toggle. */
      readonly readOnly?: boolean | undefined;
      readonly settings?: CanvasBoardSettings | undefined;
    }
  /** The wiki moved on and the board's own file didn't: cards read at this commit from now on. */
  | { readonly type: "canvasRevision"; readonly revision: string }
  /** A `canvasEdited` is on the head. `commit` is null when it changed nothing there. */
  | {
      readonly type: "canvasLanded";
      readonly through: number;
      readonly commit: string | null;
    }
  /** Answers a `canvasAsk`. */
  | {
      readonly type: "canvasAnswer";
      readonly requestId: number;
      readonly answer: WikiEditorCanvasAnswer;
    }
  /** Brings a card or group into view, as Jump to section does; a review's list selects it too. */
  | { readonly type: "focusCard"; readonly id: string; readonly select?: boolean | undefined }
  /** The documents the wiki holds, and the file on the page that links to them. */
  | {
      readonly type: "knownDocuments";
      readonly files: ReadonlyArray<string>;
      readonly from: string;
    }
  /** Part of the answer to `readFiles`: `files[0]` answers `paths[start]` of `total`. */
  | {
      readonly type: "filesRead";
      readonly requestId: number;
      readonly start: number;
      readonly total: number;
      readonly files: ReadonlyArray<WikiEditorFile>;
    }
  /** The answer to `readCodeStatus`, in its order; empty when the app couldn't ask. */
  | {
      readonly type: "codeStatusRead";
      readonly requestId: number;
      readonly statuses: ReadonlyArray<WikiEditorCodeStatus>;
    }
  /** Where a `readAsset` file is at `revision`, for the page to load; null when it can't be. */
  | {
      readonly type: "assetRead";
      readonly path: string;
      readonly revision: string;
      readonly url: string | null;
      /** When `url` stops working, in milliseconds since the epoch. */
      readonly expiresAt: number;
    }
  /** A file a `readFile` asked for, sent again if it changes. */
  | { readonly type: "fileRead"; readonly path: string; readonly file: WikiEditorEmbeddedFile }
  /** The `@` types the wiki's links use, which the editor suggests. */
  | {
      readonly type: "linkTypes";
      readonly types: ReadonlyArray<string>;
      /** The wiki's documents and this note's own path, which its links search from. */
      readonly files?: ReadonlyArray<string>;
      readonly from?: string;
    }
  /** A note a link preview asked for, sent again if it changes; null when it isn't written. */
  | {
      readonly type: "noteRead";
      readonly name: string;
      readonly source: string | null;
      /** Where the link landed, for its preview to say when other files fit it too. */
      readonly link?: WikiEditorResolvedLink;
    }
  /** A ```base block's view, sent again whenever it changes; `error` says why it can't show. */
  | {
      readonly type: "baseResult";
      readonly source: string;
      readonly result: WikiEditorBaseResult | null;
      readonly error: string | null;
    };

/** A file a note embeds, with the path the repository holds it under. */
export interface WikiEditorEmbeddedFile extends WikiEditorFile {
  readonly file: string;
}

/** What the page tells the app. */
export type WikiEditorEvent =
  /** The page is listening; the app sends the theme, mode and note. */
  | { readonly type: "ready" }
  | {
      readonly type: "state";
      /** The buffer holds edits that are not saved. */
      readonly dirty: boolean;
      /** The note changed underneath unsaved edits. */
      readonly changedUnderneath: boolean;
    }
  /** Follows a link, or opens a file. `from` is the file it's written in, if not the page's. */
  | { readonly type: "openNote"; readonly name: string; readonly from?: string }
  | { readonly type: "openUrl"; readonly href: string }
  /** A code card, with the link a saved one carries for where its project isn't here. */
  | { readonly type: "openCode"; readonly code: CanvasCodeReference; readonly url: string }
  /** A wiki file the page can't play itself. */
  | { readonly type: "openFile"; readonly path: string }
  /** The buffer's text, and the commit it last took in. */
  | {
      readonly type: "text";
      readonly requestId: number;
      readonly text: string;
      readonly commit?: string | undefined;
    }
  /** The person typed. Sent at most a couple of times a second, so the app can autosave. */
  | { readonly type: "edited" }
  /** A ```base block is on screen: the app runs it and keeps its view current. */
  | { readonly type: "queryBase"; readonly source: string }
  /** A link's preview is open: the app reads its note and keeps it current. */
  | { readonly type: "readNote"; readonly name: string }
  /** Visible cards' files, batched, at the commit shown: the app answers with `filesRead`. */
  | {
      readonly type: "readFiles";
      readonly requestId: number;
      readonly paths: ReadonlyArray<string>;
    }
  /** Visible code cards: the app answers with `codeStatusRead`. */
  | {
      readonly type: "readCodeStatus";
      readonly requestId: number;
      readonly references: ReadonlyArray<WikiEditorCodeReference>;
    }
  /** A card shows a file's bytes: the app finds the address and answers with `assetRead`. */
  | { readonly type: "readAsset"; readonly path: string }
  /** A note embeds a file: the app reads it and keeps it current with `fileRead`. */
  | { readonly type: "readFile"; readonly path: string }
  /** The board's camera, once it settles; null while it fits the board. */
  | { readonly type: "camera"; readonly camera: CanvasCamera | null }
  /** Everything the board hasn't heard has landed: the app autosaves it, replacing the last. */
  | {
      readonly type: "canvasEdited";
      readonly edits: ReadonlyArray<CanvasHandEdit>;
      readonly through: number;
    }
  /** What a board needs the app for; the app answers with `canvasAnswer`. */
  | {
      readonly type: "canvasAsk";
      readonly requestId: number;
      readonly ask: WikiEditorCanvasAsk;
    }
  | { readonly type: "canvasSettings"; readonly settings: Partial<CanvasBoardSettings> }
  | { readonly type: "canvasReadOnly"; readonly on: boolean }
  /** A diagram of a type the page hasn't loaded: the app injects its script. */
  | { readonly type: "loadDiagram"; readonly diagram: string }
  /** A note's property set from the base shown alone: a cell edited, or a card moved. */
  | {
      readonly type: "editBase";
      readonly file: string;
      readonly property: string;
      readonly value: BaseCellValue;
    }
  /** The page failed (see `WIKI_EDITOR_ERROR_HOOK`); it may show nothing. */
  | { readonly type: "error"; readonly message: string };

/**
 * Installed by the app before the page's own script runs, so even a page that dies while
 * loading says so instead of staying blank.
 */
export const WIKI_EDITOR_ERROR_HOOK = `(function(){function send(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",message:String(m)}))}window.addEventListener("error",function(e){send(e.message||"The page failed.")});window.addEventListener("unhandledrejection",function(e){send(e.reason&&e.reason.message||e.reason||"The page failed.")})})();true;`;

/** The page's global the app calls with a command, through `injectJavaScript`. */
export const WIKI_EDITOR_RECEIVE = "__wikiEditorReceive";

/** The page's global the injected script of a `loadDiagram` calls: see `peleOnDemand.ts`. */
export const WIKI_EDITOR_DIAGRAM = "__wikiEditorDiagram";

/** The JavaScript that delivers `command` to the page. */
export function wikiEditorCommandScript(command: WikiEditorCommand): string {
  return `window.${WIKI_EDITOR_RECEIVE}&&window.${WIKI_EDITOR_RECEIVE}(${JSON.stringify(command)});true;`;
}

/** A message into the page is one script: more than this and a phone stalls evaluating it. */
export const WIKI_EDITOR_MESSAGE_CHARS = 256 * 1024;
/** A card shows the top of a note; past this, the rest stays off the phone. */
const CARD_NOTE_CHARS = 512 * 1024;

/** What of a file a card needs: a huge note is cut, and says so. */
export function cardFile(path: string, file: WikiEditorFile): WikiEditorFile {
  const { text } = file;
  return text !== null && text.length > CARD_NOTE_CHARS && /\.md$/i.test(path)
    ? { ...file, text: `${text.slice(0, CARD_NOTE_CHARS)}\n\n…` }
    : file;
}

/** The `filesRead` messages that answer a `readFiles`, each small enough to send at once. */
export function filesReadMessages(
  requestId: number,
  files: ReadonlyArray<WikiEditorFile>,
): ReadonlyArray<Extract<WikiEditorCommand, { type: "filesRead" }>> {
  const total = files.length;
  const messages: Array<Extract<WikiEditorCommand, { type: "filesRead" }>> = [];
  let start = 0;
  let chars = 0;
  files.forEach((file, position) => {
    const size = file.text?.length ?? 0;
    if (position > start && chars + size > WIKI_EDITOR_MESSAGE_CHARS) {
      messages.push({
        type: "filesRead",
        requestId,
        start,
        total,
        files: files.slice(start, position),
      });
      start = position;
      chars = 0;
    }
    chars += size;
  });
  messages.push({ type: "filesRead", requestId, start, total, files: files.slice(start) });
  return messages;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((each) => typeof each === "string");

const isResolvedLink = (value: unknown): value is WikiEditorResolvedLink =>
  typeof value === "object" &&
  value !== null &&
  "file" in value &&
  (typeof value.file === "string" || value.file === null) &&
  "others" in value &&
  isStringArray(value.others);

const isFile = (value: unknown): value is WikiEditorFile =>
  isRecord(value) &&
  typeof value.exists === "boolean" &&
  (typeof value.text === "string" || value.text === null);

const isCodeReference = (value: unknown): value is WikiEditorCodeReference =>
  isRecord(value) &&
  typeof value.repository === "string" &&
  typeof value.commit === "string" &&
  typeof value.path === "string";

const readCamera = (value: unknown): CanvasCamera | null =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.zoom === "number"
    ? { x: value.x, y: value.y, zoom: value.zoom }
    : null;

/** An event from the page's raw message, or null for anything malformed. */
export function parseWikiEditorEvent(raw: string): WikiEditorEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "state":
      return typeof value.dirty === "boolean" && typeof value.changedUnderneath === "boolean"
        ? { type: "state", dirty: value.dirty, changedUnderneath: value.changedUnderneath }
        : null;
    case "openNote":
      return typeof value.name === "string" && value.name.length > 0
        ? {
            type: "openNote",
            name: value.name,
            ...(typeof value.from === "string" ? { from: value.from } : {}),
          }
        : null;
    case "openUrl":
      return typeof value.href === "string" ? { type: "openUrl", href: value.href } : null;
    case "openCode":
      return isRecord(value.code) && typeof value.code.path === "string"
        ? {
            type: "openCode",
            code: value.code as unknown as CanvasCodeReference,
            url: typeof value.url === "string" ? value.url : "",
          }
        : null;
    case "openFile":
      return typeof value.path === "string" ? { type: "openFile", path: value.path } : null;
    case "text":
      return typeof value.requestId === "number" && typeof value.text === "string"
        ? {
            type: "text",
            requestId: value.requestId,
            text: value.text,
            ...(typeof value.commit === "string" ? { commit: value.commit } : {}),
          }
        : null;
    case "edited":
      return { type: "edited" };
    case "queryBase":
      return typeof value.source === "string" ? { type: "queryBase", source: value.source } : null;
    case "readNote":
      return typeof value.name === "string" && value.name.length > 0
        ? { type: "readNote", name: value.name }
        : null;
    case "readFiles":
      return typeof value.requestId === "number" && isStringArray(value.paths)
        ? { type: "readFiles", requestId: value.requestId, paths: value.paths }
        : null;
    case "readCodeStatus":
      return typeof value.requestId === "number" &&
        Array.isArray(value.references) &&
        value.references.every(isCodeReference)
        ? { type: "readCodeStatus", requestId: value.requestId, references: value.references }
        : null;
    case "readAsset":
      return typeof value.path === "string" ? { type: "readAsset", path: value.path } : null;
    case "readFile":
      return typeof value.path === "string" ? { type: "readFile", path: value.path } : null;
    case "camera":
      return { type: "camera", camera: readCamera(value.camera) };
    case "canvasEdited":
      return Array.isArray(value.edits) && typeof value.through === "number"
        ? {
            type: "canvasEdited",
            edits: value.edits as ReadonlyArray<CanvasHandEdit>,
            through: value.through,
          }
        : null;
    case "canvasAsk":
      return typeof value.requestId === "number" && isRecord(value.ask)
        ? {
            type: "canvasAsk",
            requestId: value.requestId,
            ask: value.ask as unknown as WikiEditorCanvasAsk,
          }
        : null;
    case "canvasSettings":
      return isRecord(value.settings)
        ? { type: "canvasSettings", settings: value.settings as Partial<CanvasBoardSettings> }
        : null;
    case "canvasReadOnly":
      return { type: "canvasReadOnly", on: value.on === true };
    case "loadDiagram":
      return typeof value.diagram === "string"
        ? { type: "loadDiagram", diagram: value.diagram }
        : null;
    case "editBase":
      return typeof value.file === "string" &&
        typeof value.property === "string" &&
        isCellValue(value.value)
        ? { type: "editBase", file: value.file, property: value.property, value: value.value }
        : null;
    case "error":
      return typeof value.message === "string" ? { type: "error", message: value.message } : null;
    default:
      return null;
  }
}

/** A command from the app, or null for anything malformed. */
export function parseWikiEditorCommand(value: unknown): WikiEditorCommand | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "receive":
      if (typeof value.source !== "string" || typeof value.turnRunning !== "boolean") return null;
      return {
        type: "receive",
        source: value.source,
        author: readAuthor(value.author),
        turnRunning: value.turnRunning,
        ...(typeof value.commit === "string" ? { commit: value.commit } : {}),
      };
    case "mode":
      return value.mode === "read" || value.mode === "edit"
        ? { type: "mode", mode: value.mode }
        : null;
    case "theme": {
      const theme = value.theme;
      if (!isRecord(theme) || (theme.appearance !== "light" && theme.appearance !== "dark")) {
        return null;
      }
      const variables: Record<string, string> = {};
      if (isRecord(theme.variables)) {
        for (const [name, color] of Object.entries(theme.variables)) {
          if (name.startsWith("--") && typeof color === "string") variables[name] = color;
        }
      }
      return { type: "theme", theme: { appearance: theme.appearance, variables } };
    }
    case "markSaved":
      return typeof value.text === "string" ? { type: "markSaved", text: value.text } : null;
    case "discard":
      return { type: "discard" };
    case "loadChanged":
      return { type: "loadChanged" };
    case "requestText":
      return typeof value.requestId === "number"
        ? { type: "requestText", requestId: value.requestId }
        : null;
    case "showBase":
      return typeof value.source === "string"
        ? { type: "showBase", source: value.source, editable: value.editable === true }
        : null;
    case "showCanvas": {
      // The app's own page: the board is placed by the app, and checked only far enough to draw.
      const { data, marks, document, settings } = value;
      const camera = readCamera(value.camera);
      return isRecord(data) && Array.isArray(data.nodes) && Array.isArray(data.edges)
        ? {
            type: "showCanvas",
            data: data as unknown as CanvasData,
            ...(typeof value.revision === "string" ? { revision: value.revision } : {}),
            ...(camera === null ? {} : { camera }),
            ...(isRecord(marks) && isRecord(marks.cards) && isRecord(marks.arrows)
              ? { marks: marks as unknown as CanvasMarks }
              : {}),
            ...(isRecord(document) ? { document } : {}),
            ...(value.readOnly === true ? { readOnly: true } : {}),
            ...(isRecord(settings) ? { settings: settings as unknown as CanvasBoardSettings } : {}),
          }
        : null;
    }
    case "canvasLanded":
      return typeof value.through === "number"
        ? {
            type: "canvasLanded",
            through: value.through,
            commit: typeof value.commit === "string" ? value.commit : null,
          }
        : null;
    case "canvasAnswer":
      return typeof value.requestId === "number" && isRecord(value.answer)
        ? {
            type: "canvasAnswer",
            requestId: value.requestId,
            answer: value.answer as unknown as WikiEditorCanvasAnswer,
          }
        : null;
    case "canvasRevision":
      return typeof value.revision === "string"
        ? { type: "canvasRevision", revision: value.revision }
        : null;
    case "focusCard":
      return typeof value.id === "string"
        ? { type: "focusCard", id: value.id, select: value.select === true }
        : null;
    case "knownDocuments":
      return isStringArray(value.files) && typeof value.from === "string"
        ? { type: "knownDocuments", files: value.files, from: value.from }
        : null;
    case "filesRead":
      return typeof value.requestId === "number" &&
        typeof value.start === "number" &&
        typeof value.total === "number" &&
        Array.isArray(value.files) &&
        value.files.every(isFile)
        ? {
            type: "filesRead",
            requestId: value.requestId,
            start: value.start,
            total: value.total,
            files: value.files,
          }
        : null;
    case "codeStatusRead":
      return typeof value.requestId === "number" && Array.isArray(value.statuses)
        ? {
            type: "codeStatusRead",
            requestId: value.requestId,
            statuses: value.statuses as ReadonlyArray<WikiEditorCodeStatus>,
          }
        : null;
    case "assetRead":
      return typeof value.path === "string" &&
        typeof value.revision === "string" &&
        typeof value.expiresAt === "number" &&
        (typeof value.url === "string" || value.url === null)
        ? {
            type: "assetRead",
            path: value.path,
            revision: value.revision,
            url: value.url,
            expiresAt: value.expiresAt,
          }
        : null;
    case "fileRead":
      return typeof value.path === "string" &&
        isFile(value.file) &&
        typeof (value.file as { file?: unknown }).file === "string"
        ? { type: "fileRead", path: value.path, file: value.file as WikiEditorEmbeddedFile }
        : null;
    case "linkTypes":
      return Array.isArray(value.types)
        ? {
            type: "linkTypes",
            types: value.types.filter((type): type is string => typeof type === "string"),
            ...(Array.isArray(value.files)
              ? { files: value.files.filter((file): file is string => typeof file === "string") }
              : {}),
            ...(typeof value.from === "string" ? { from: value.from } : {}),
          }
        : null;
    case "noteRead":
      return typeof value.name === "string" &&
        (typeof value.source === "string" || value.source === null)
        ? {
            type: "noteRead",
            name: value.name,
            source: value.source,
            ...(isResolvedLink(value.link) ? { link: value.link } : {}),
          }
        : null;
    case "baseResult": {
      if (typeof value.source !== "string") return null;
      // The app's own page: the shape is the server's, checked only far enough to draw it.
      const result = value.result;
      const drawable =
        isRecord(result) &&
        isRecord(result.view) &&
        Array.isArray(result.columns) &&
        Array.isArray(result.rows);
      return {
        type: "baseResult",
        source: value.source,
        result: drawable ? (result as unknown as WikiEditorBaseResult) : null,
        error:
          typeof value.error === "string"
            ? value.error
            : drawable
              ? null
              : "The base sent no view.",
      };
    }
    default:
      return null;
  }
}

function readAuthor(value: unknown): WikiEditorAuthor | null {
  if (!isRecord(value)) return null;
  const { name, color, turnId } = value;
  return typeof name === "string" && typeof color === "string" && typeof turnId === "string"
    ? { name, color, turnId }
    : null;
}

/**
 * The base an embed names, when a base's `source` is an embed such as `![[Open.base#Table]]`
 * rather than a block's YAML: its file and view.
 */
export function embeddedBase(
  source: string,
): { readonly base: string; readonly view: string | undefined } | null {
  const target = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(source.trim())?.[1];
  if (target === undefined) return null;
  const [base = "", view] = target.split("#");
  return base.trim() ? { base: base.trim(), view: view?.trim() || undefined } : null;
}

const isScalar = (value: unknown) =>
  value === null || ["string", "number", "boolean"].includes(typeof value);
const isCellValue = (value: unknown): value is BaseCellValue =>
  isScalar(value) || (Array.isArray(value) && value.every(isScalar));
