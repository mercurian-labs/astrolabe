import "@mercurian/editor/markdown/katex.css";
import "./canvasBoard.css";

import {
  canvasBounds,
  canvasChangedCards,
  canvasGroups,
  canvasLayerOf,
  canvasStack,
  CANVAS_MARK_LABELS,
  parseCanvas,
  type CanvasBounds,
  type CanvasCodeReference,
  type CanvasData,
  type CanvasEdge,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasInk,
  type CanvasLinkNode,
  type CanvasMark,
  type CanvasMarks,
  type CanvasNode,
  type CanvasShape,
  type CanvasSide,
  type CanvasStep,
  canvasStepData,
  canvasSteps,
} from "@mercurian/wiki/canvas";
import { canvasStepPick, canvasStoryEdit } from "@mercurian/wiki/canvas-edits";
import { pastedFileName } from "@mercurian/wiki/placement";
import {
  createContext,
  Fragment,
  memo,
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { CANVAS_CLIP_TYPE, parseClip, serializeClip } from "./canvasActions";
import { lineDirectionOf, type CanvasHandle, type CanvasPoint } from "./canvasArrange";
import {
  arrangementEntries,
  CANVAS_TOOL_KEYS,
  CanvasEmptyHint,
  CanvasHelp,
  CanvasMenu,
  CanvasPicker,
  CanvasPrompt,
  CanvasToolbarButton,
  CanvasToolRow,
  CanvasTips,
  tipProps,
  useRestoreFocus,
  type CanvasMenuEntry,
} from "./CanvasChrome";
import {
  CanvasCommands,
  type CanvasEditHost,
  type CanvasEditing,
  type CanvasPicked,
  type CanvasPickerRequest,
  type CanvasPromptRequest,
} from "./canvasCommands";
import type { CanvasDocument, CanvasDocumentState } from "./canvasDocument";
import {
  CanvasGestures,
  NO_SELECTION,
  selectedDrawings,
  type CanvasLooseEnd,
  type CanvasSelection,
  type CanvasTool,
} from "./canvasGestures";
import { canvasInkShapes, type CanvasInkShape } from "./canvasInk";
import {
  cameraWindow,
  canvasColor,
  canvasEdgeShapes,
  canvasFileKind,
  cardFileName,
  isOpenableUrl,
  overlaps,
  ZOOM_STEP,
  type CanvasCamera,
  type CanvasEdgeShape,
} from "./canvasGeometry";
import { drawCanvasOverview, type CanvasBoardLayer } from "./canvasOverview";
import {
  CANVAS_WIDTH_STEPS,
  canvasPaint,
  canvasTint,
  type CanvasPaintKind,
  type CanvasPaint as Paint,
} from "./canvasPaint";
import { canvasPenOfItems, canvasPenOfTool, type CanvasPen } from "./canvasPen";
import { CanvasStylePanel, canvasStyleSession, useCanvasStyleSession } from "./CanvasStylePanel";
import { CanvasMarkdown, type CanvasMarkdownHost } from "./CanvasMarkdown";
import { CanvasMinimap } from "./CanvasMinimap";
import { arrowMenu, boardMenu, cardMenu, readOnlyMenu, selectionMenu } from "./canvasMenus";
import { noteSection } from "./canvasNote";
import { BatchedReads } from "./canvasReads";
import { CanvasView } from "./canvasView";

/** A file a board asked for, as the wiki holds it at the commit shown. */
export interface CanvasFileRead {
  readonly exists: boolean;
  /** Null for a file with no text to show. */
  readonly text: string | null;
}

export type CanvasCodeStatus = "current" | "changed" | "gone" | "unknown";

/** A wiki's file a board shows but can't fetch itself: only the host can reach its bytes. */
export type CanvasAsset =
  | { readonly kind: "pdf"; readonly path: string }
  | { readonly kind: "image" | "audio" | "video"; readonly path: string }
  | { readonly kind: "background"; readonly path: string; readonly style: string | undefined };

/** An asset drawn at the address its host found for it. A PDF needs a viewer only a host has. */
export function CanvasAssetView({
  asset,
  url,
  onError,
}: {
  readonly asset: Exclude<CanvasAsset, { readonly kind: "pdf" }>;
  readonly url: string;
  /** The engine can't show it, or the address no longer answers. */
  readonly onError?: () => void;
}) {
  switch (asset.kind) {
    case "image":
      return (
        <img
          className="cv-asset-image"
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onError}
        />
      );
    case "audio":
      return (
        <audio className="cv-asset-media" src={url} controls preload="metadata" onError={onError} />
      );
    case "video":
      return (
        <video
          className="cv-asset-media"
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={onError}
        />
      );
    case "background":
      return (
        <div
          className="cv-group-background"
          data-style={asset.style}
          style={{ backgroundImage: `url("${encodeURI(url)}")` }}
        />
      );
  }
}

export type { CanvasMenuEntry } from "./CanvasChrome";

/** What a board can do outside itself. A missing callback leaves that card inert. */
export interface CanvasBoardHost
  extends Omit<CanvasMarkdownHost, "renderEmbed" | "renderImage">, CanvasEditHost {
  /** A code card, with the link a saved one carries for where its project isn't here. */
  readonly onOpenCode?: (code: CanvasCodeReference, url: string) => void;
  /** Reads a card's file. Without it, file cards show their names. */
  readonly readFiles?: (paths: ReadonlyArray<string>) => Promise<ReadonlyArray<CanvasFileRead>>;
  readonly readCodeStatus?: (
    references: ReadonlyArray<Required<Omit<CanvasCodeReference, "lines">>>,
  ) => Promise<ReadonlyArray<CanvasCodeStatus>>;
  readonly renderAsset?: (asset: CanvasAsset) => ReactNode;
  /** A base's view; `view` is the one a card pins, by name. */
  readonly renderBase?: (file: string, view: string | undefined) => ReactNode;
  /** A selected link card shows its page in a frame, one at a time. Off, a click opens it. */
  readonly liveLinks?: boolean;
  /** The one real editor, on the card being edited. Without it, cards can't be typed in. */
  readonly renderCardEditor?: (editor: CanvasCardEditor) => ReactNode;
  /** Whether Escape is the editor's to take, as Vim's insert mode's is. */
  readonly editorTakesEscape?: (target: Element) => boolean;
  /** Paths being dragged from outside the board, such as a wiki's rows; a folder's ends in `/`. */
  readonly draggedFiles?: () => ReadonlyArray<string> | null;
  /** A plain key the board didn't use: the app's menu may want it. True when it did. */
  readonly onLeaderKey?: (key: string) => boolean;
  /** Image export's dialog: left out where a platform can't save one. */
  readonly renderExportDialog?: (dialog: CanvasExportRequest) => ReactNode;
  /** Whether a finger drives this board. */
  readonly touch?: boolean;
}

/** What a host's editor is asked to edit. */
export interface CanvasCardEditor {
  readonly initialText: string;
  readonly onChange: (text: string) => void;
  /** Leaves editing, as Escape does. */
  readonly onExit: () => void;
  readonly file: string | undefined;
}

/** What an export is of. */
export interface CanvasExportRequest {
  readonly data: CanvasData;
  readonly viewport: CanvasBounds;
  readonly name: string;
  readonly onClose: () => void;
}

/** A board's settings: the Wikis page's, and the board's own menu writes back. */
export interface CanvasBoardSettings {
  readonly wheel: "pan" | "zoom";
  readonly cardNames: "always" | "hover" | "never";
  readonly snapToGrid: boolean;
  readonly snapToObjects: boolean;
  readonly simpleZoom: number;
}

const DEFAULT_SETTINGS: CanvasBoardSettings = {
  wheel: "pan",
  cardNames: "always",
  snapToGrid: true,
  snapToObjects: true,
  simpleZoom: 0.3,
};

/** The commands a page can run on the board in front, by name. */
export type CanvasBoardCommand =
  | "export-image"
  | "convert-to-file"
  | "select-all"
  | "zoom-to-fit"
  | "zoom-to-selection"
  | "undo"
  | "redo"
  | "add-card"
  | "add-note"
  | "add-media"
  | "add-web-page"
  | "create-group"
  | "bring-forward"
  | "send-backward"
  | "bring-to-front"
  | "send-to-back"
  | "help";

/** What a board's page drives from outside, such as Jump to section. */
export interface CanvasBoardHandle {
  readonly focusCard: (id: string) => void;
  /** Brings a card, arrow or drawing into view and selects it, above whatever covers it. */
  readonly selectCard: (id: string) => void;
  readonly run: (command: CanvasBoardCommand) => void;
}

const FIT_PADDING = { fit: 8, free: 32 };
/** Between a button and the menu it opens, as the app's menus keep. */
const MENU_GAP = 6;
const MORE_MENU = "More tools";
const PAN_STEP = 60;
/** More cards in view than this, and a pan would stall mounting them: they draw on one canvas. */
const OVERVIEW_CARDS = 600;

/** How far outside the frame, in screen pixels, a card stays mounted. */
const CULL_MARGIN = 160;
const FILE_READ_BATCH = 64;
const NO_HOST: CanvasBoardHost = {};

interface BoardContext {
  readonly host: CanvasBoardHost;
  readonly files: BatchedReads<CanvasFileRead>;
  readonly code: BatchedReads<CanvasCodeStatus>;
  readonly mode: "fit" | "free";
  /** Set while cards can change. */
  readonly commands: CanvasCommands | null;
  readonly endEditing: () => void;
  readonly revision: () => string | undefined;
  readonly notify: (message: string) => void;
}

const Board = createContext<BoardContext | null>(null);

const useBoard = () => {
  const board = use(Board);
  if (board === null) throw new Error("A card outside a board");
  return board;
};

function colorProps(color: string | undefined) {
  const { preset, hex } = canvasColor(color);
  return {
    ...(preset === undefined ? {} : { "data-color": preset }),
    ...(hex === undefined ? {} : { style: { "--cv-tint": hex } as Record<string, string> }),
  };
}

/** What the stylesheet needs of an item's paint, beside its colour: the rest it draws itself. */
function paintProps(item: Parameters<typeof canvasPaint>[0]) {
  const paint = canvasPaint(item);
  const { fill, dashArray } = paint;
  const { style: tint, ...color } = colorProps(item.color);
  const style: Record<string, string | number> = {
    ...tint,
    "--cv-w": paint.width,
    ...(paint.opacity === 1 ? {} : { opacity: paint.opacity }),
    ...(paint.kind === "card" || paint.kind === "section" ? { borderRadius: paint.radius } : {}),
    ...(dashArray === null ? {} : { "--cv-dash-on": dashArray[0], "--cv-dash-off": dashArray[1] }),
  };
  // A fill its style chose; the tint a colour gives is the stylesheet's.
  const chosen = item.astrolabe?.style?.fill !== undefined && fill.kind !== "surface";
  if (chosen && fill.kind === "tint") {
    style["--cv-fill"] = fill.color ?? "var(--muted-foreground)";
    style["--cv-fill-amount"] = `${fill.amount * 100}%`;
  }
  return {
    paint,
    props: {
      ...color,
      style,
      ...(paint.dash === "solid" ? {} : { "data-dash": paint.dash }),
      ...(chosen ? { "data-fill": fill.kind === "none" ? "none" : "" } : {}),
    },
  };
}

/** A dashed or dotted box's line, drawn over its edge where a CSS border can't dash to match. */
const BoxLine = ({ paint }: { readonly paint: Paint }) =>
  paint.dash === "solid" ? null : (
    <svg className="cv-box-line" aria-hidden="true">
      <rect x="0" y="0" width="100%" height="100%" rx={paint.radius} data-dash={paint.dash} />
    </svg>
  );

const position = ({ x, y, width, height }: CanvasBounds) => ({
  left: x,
  top: y,
  width,
  height,
});

const useFile = (path: string) => {
  const { files } = useBoard();
  return useSyncExternalStore(files.subscribe, () => files.get(path));
};

const codeKey = (code: CanvasCodeReference) =>
  JSON.stringify([code.repository, code.commit, code.path]);

function codeOfKey(key: string): Required<Omit<CanvasCodeReference, "lines">> {
  const [repository = "", commit = "", path = ""] = JSON.parse(key) as ReadonlyArray<string>;
  return { repository, commit, path };
}

function CodeCard({
  code,
  url,
  caption,
}: {
  readonly code: CanvasCodeReference;
  readonly url: string;
  readonly caption: string | undefined;
}) {
  const { host, code: statuses } = useBoard();
  const status = useSyncExternalStore(statuses.subscribe, () => statuses.get(codeKey(code)));
  const slash = code.path.lastIndexOf("/");
  const lines = code.lines
    ? code.lines[0] === code.lines[1]
      ? `:${code.lines[0]}`
      : `:${code.lines[0]}–${code.lines[1]}`
    : "";
  const body = (
    <>
      <span className="cv-code-path">
        {slash >= 0 ? (
          <span className="cv-code-folder">{code.path.slice(0, slash + 1)}</span>
        ) : null}
        <span className="cv-code-file">
          {code.path.slice(slash + 1)}
          {lines}
        </span>
      </span>
      {status === "changed" || status === "gone" ? (
        <span className="cv-code-stale" data-status={status}>
          {status === "changed" ? "Changed since this commit" : "Gone from the project's head"}
        </span>
      ) : null}
      {caption === undefined ? null : <CanvasMarkdown text={caption} host={host} />}
    </>
  );
  const { onOpenCode } = host;
  if (onOpenCode === undefined) return <div className="cv-card-body">{body}</div>;
  return (
    <button
      type="button"
      className="cv-card-body cv-card-open"
      onClick={() => onOpenCode(code, url)}
    >
      {body}
    </button>
  );
}

function LinkCard({ node, live }: { readonly node: CanvasLinkNode; readonly live: boolean }) {
  const { host, mode } = useBoard();
  const { url } = node;
  const caption = node.astrolabe?.caption;
  const openable = isOpenableUrl(url);
  if (live && mode === "free" && host.liveLinks === true && /^https?:/i.test(url)) {
    // A page that refuses to be framed stays blank here: only Electron's webview gets past that.
    return (
      <iframe
        className="cv-frame"
        title={url}
        src={url}
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-scripts"
      />
    );
  }
  const body = (
    <>
      <span className="cv-link-url">{url}</span>
      {caption === undefined ? null : <CanvasMarkdown text={caption} host={host} />}
    </>
  );
  const { onOpenUrl } = host;
  if (onOpenUrl === undefined || !openable) return <div className="cv-card-body">{body}</div>;
  return (
    <button type="button" className="cv-card-body cv-card-open" onClick={() => onOpenUrl(url)}>
      {body}
    </button>
  );
}

const EMBEDS_DEEP = 1;

/** What a card's `![[embed]]` draws: the file as its own card would, one level down. */
function Embed({ target, depth }: { readonly target: string; readonly depth: number }) {
  const { files } = useBoard();
  const [name = "", subpath] = target.split("|")[0]?.split("#") ?? [];
  const file = canvasFileKind(name) === "other" ? `${name}.md` : name;
  const read = useFile(file);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an embed appears with the card's Markdown, which the board can't see to ask for it
  useEffect(() => files.want([file]), [files, file]);
  if (depth >= EMBEDS_DEEP) return <span className="cv-embed-name">{name}</span>;
  return (
    <FileBody
      file={file}
      subpath={subpath === undefined ? undefined : `#${subpath}`}
      read={read}
      live
      depth={depth + 1}
    />
  );
}

function useMarkdownHost(depth: number): CanvasMarkdownHost {
  const { host } = useBoard();
  return useMemo(
    () => ({
      ...host,
      renderEmbed: (target) => <Embed target={target} depth={depth} />,
      renderImage: (path) => host.renderAsset?.({ kind: "image", path }),
    }),
    [host, depth],
  );
}

function TextCard({ text }: { readonly text: string }) {
  const host = useMarkdownHost(0);
  return (
    <div className="cv-card-body">
      <CanvasMarkdown text={text} host={host} />
    </div>
  );
}

function NoteBody({
  file,
  subpath,
  read,
  depth,
}: {
  readonly file: string;
  readonly subpath: string | undefined;
  readonly read: CanvasFileRead | undefined;
  readonly depth: number;
}) {
  const host = useMarkdownHost(depth);
  if (read === undefined) return <p className="cv-muted">Loading…</p>;
  const { properties, text } = noteSection(read.text ?? "", subpath);
  if (text === null) {
    return (
      <p className="cv-muted">
        {cardFileName(file)} has no {subpath}.
      </p>
    );
  }
  return (
    <>
      {subpath === undefined && depth === 0 ? (
        <p className="cv-md-heading" data-level="1">
          {cardFileName(file)}
        </p>
      ) : null}
      {properties === null ? null : <pre className="cv-note-properties">{properties}</pre>}
      <CanvasMarkdown text={text} host={host} />
    </>
  );
}

function NestedCanvas({
  file,
  read,
}: {
  readonly file: string;
  readonly read: CanvasFileRead | undefined;
}) {
  const parsed = useMemo(() => parseCanvas(read?.text ?? ""), [read?.text]);
  if (read === undefined) return null;
  if (!parsed.ok) return <p className="cv-muted">{file} isn't valid JSON.</p>;
  return <CanvasMinimap data={parsed.data} label={cardFileName(file)} />;
}

function FileBody({
  file,
  subpath,
  read,
  live,
  depth = 0,
  node,
}: {
  readonly file: string;
  readonly subpath: string | undefined;
  readonly read: CanvasFileRead | undefined;
  readonly live: boolean;
  readonly depth?: number;
  readonly node?: CanvasFileNode;
}) {
  const { host } = useBoard();
  if (read?.exists === false) return <MissingFile file={file} node={node} />;
  const kind = canvasFileKind(file);
  if (host.readFiles === undefined) return <SimpleFile file={file} />;
  switch (kind) {
    case "note":
      return (
        <div className="cv-card-body">
          <NoteBody file={file} subpath={subpath} read={read} depth={depth} />
        </div>
      );
    case "canvas":
      return <NestedCanvas file={file} read={read} />;
    case "base":
      return (
        <div className="cv-card-body">
          {host.renderBase?.(file, subpath?.replace(/^#/, "")) ?? cardFileName(file)}
        </div>
      );
    case "image":
      return host.renderAsset?.({ kind, path: file }) ?? null;
    case "audio":
    case "video":
      return host.renderAsset?.({ kind, path: file }) ?? null;
    case "pdf":
      return live ? (host.renderAsset?.({ kind, path: file }) ?? null) : <SimpleFile file={file} />;
    case "other":
      return <SimpleFile file={file} />;
  }
}

function MissingFile({
  file,
  node,
}: {
  readonly file: string;
  readonly node: CanvasFileNode | undefined;
}) {
  const { host, commands } = useBoard();
  const note = canvasFileKind(file) === "note";
  const newNote =
    commands !== null && node !== undefined
      ? () => void commands.newNote(node)
      : host.onOpenLink === undefined
        ? undefined
        : () => host.onOpenLink?.(file);
  return (
    <div className="cv-card-body cv-missing">
      <p>"{file}" could not be found.</p>
      {note && newNote !== undefined ? (
        <button type="button" className="cv-button" onClick={newNote}>
          New note
        </button>
      ) : null}
      {commands !== null && node !== undefined ? (
        <>
          <button
            type="button"
            className="cv-button"
            onClick={() => void commands.swapFile(node.id)}
          >
            Swap file
          </button>
          <button
            type="button"
            className="cv-button"
            onClick={() => commands.document?.commit([{ op: "remove-card", card: node.id }])}
          >
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}

const SimpleFile = ({ file }: { readonly file: string }) => (
  <div className="cv-simple-name">{cardFileName(file)}</div>
);

const SimpleText = () => (
  <div className="cv-simple-text" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

function fileLabel(node: CanvasFileNode) {
  const name = cardFileName(node.file);
  return node.subpath === undefined ? name : `${name} › ${node.subpath.replace(/^#/, "")}`;
}

function FileCardLabel({ node }: { readonly node: CanvasFileNode }) {
  const read = useFile(node.file);
  return (
    <div className="cv-card-label" data-missing={read?.exists === false || undefined}>
      {fileLabel(node)}
    </div>
  );
}

function FileCard({ node, live }: { readonly node: CanvasFileNode; readonly live: boolean }) {
  return (
    <FileBody
      file={node.file}
      subpath={node.subpath}
      read={useFile(node.file)}
      live={live}
      node={node}
    />
  );
}

/** One textarea's worth of editor, for a host with no editor of its own. */
function PlainEditor({ editor }: { readonly editor: CanvasCardEditor }) {
  return (
    <textarea
      className="cv-plain-editor"
      aria-label="Card text"
      autoFocus
      defaultValue={editor.initialText}
      onChange={(event) => editor.onChange(event.target.value)}
    />
  );
}

/** The one real editor on the board, in place of its card's content. */
function CardEditorFrame({ editor }: { readonly editor: CanvasCardEditor }) {
  const { host } = useBoard();
  return (
    <div
      className="cv-card-editor"
      data-card-editor
      data-live
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        if (host.editorTakesEscape?.(event.target as Element) === true) return;
        event.preventDefault();
        event.stopPropagation();
        editor.onExit();
      }}
    >
      {host.renderCardEditor?.(editor) ?? <PlainEditor editor={editor} />}
    </div>
  );
}

function TextCardEditor({ node }: { readonly node: CanvasNode }) {
  const { commands, endEditing } = useBoard();
  const [editor] = useState((): CanvasCardEditor => ({
    initialText: node.type === "text" ? node.text : "",
    file: undefined,
    onChange: (text) => commands?.document?.type(text),
    onExit: endEditing,
  }));
  return <CardEditorFrame editor={editor} />;
}

/** A pause after this, a note card's text saves, as a note's own tab does. */
const NOTE_SAVE_MS = 2_000;

/** Editing a note card writes the note. Its text is read before the editor starts. */
function NoteCardEditor({ file }: { readonly file: string }) {
  const read = useFile(file);
  // Keyed by nothing that changes: a later read mustn't remount the editor under the caret.
  const text = read?.text;
  if (text === undefined || text === null) return <p className="cv-muted cv-card-body">Loading…</p>;
  return <LoadedNoteEditor file={file} initialText={text} />;
}

function LoadedNoteEditor({
  file,
  initialText,
}: {
  readonly file: string;
  readonly initialText: string;
}) {
  const { host, endEditing, revision, notify } = useBoard();
  const [saver] = useState(() => {
    let text: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (text === null) return;
      const writing = text;
      text = null;
      void host.writeNote?.(file, writing, revision()).then((failure) => {
        if (failure) notify(failure);
      });
    };
    return {
      save,
      edited: (next: string) => {
        text = next;
        clearTimeout(timer);
        timer = setTimeout(save, NOTE_SAVE_MS);
      },
    };
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaving the editor flushes what its timer hadn't saved yet
  useEffect(() => saver.save, [saver]);
  const [editor] = useState((): CanvasCardEditor => ({
    initialText,
    file,
    onChange: saver.edited,
    onExit: endEditing,
  }));
  return <CardEditorFrame editor={editor} />;
}

function SimpleCard({ node }: { readonly node: CanvasNode }) {
  const { host } = useBoard();
  switch (node.type) {
    case "text":
      return <SimpleText />;
    case "file":
      return canvasFileKind(node.file) === "image" ? (
        (host.renderAsset?.({ kind: "image", path: node.file }) ?? <SimpleFile file={node.file} />)
      ) : (
        <SimpleFile file={node.file} />
      );
    default:
      return (
        <div className="cv-simple-name">
          {node.type === "link" ? (node.astrolabe?.code?.path ?? node.url) : ""}
        </div>
      );
  }
}

const MarkBadge = ({ mark }: { readonly mark: CanvasMark | undefined }) =>
  mark === undefined ? null : <span className="cv-mark">{CANVAS_MARK_LABELS[mark]}</span>;

/** Mounted anew for each commit that changes a card, which is what replays its one highlight. */
const Flash = ({ revision }: { readonly revision: string | undefined }) =>
  revision === undefined ? null : <span key={revision} className="cv-flash" aria-hidden />;

const HANDLES: ReadonlyArray<CanvasHandle> = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const SIDES: ReadonlyArray<CanvasSide> = ["top", "right", "bottom", "left"];

/** Corners and edges outside a selected card; the middle of each edge is a connection dot. */
const Handles = () => (
  <>
    {HANDLES.map((handle) => (
      <span key={handle} className="cv-handle" data-handle={handle} aria-hidden="true" />
    ))}
  </>
);

const Dots = () => (
  <>
    {SIDES.map((side) => (
      <span key={side} className="cv-dot" data-side={side} aria-hidden="true" />
    ))}
  </>
);

/**
 * The only card selected, framed above everything on the board so its handles and dots stay in
 * reach whatever stacks over it. Only they take a press: the rest clicks through to the board.
 */
const SelectionFrame = memo(function SelectionFrame({
  node,
}: {
  readonly node: Exclude<CanvasNode, CanvasGroupNode>;
}) {
  return (
    <div
      className="cv-selection-frame"
      data-frame-for={node.id}
      style={{ ...position(node), borderRadius: canvasPaint(node).radius }}
    >
      <Dots />
      <Handles />
    </div>
  );
});

/** A shaped card's outline, stretched to its box with the line's width kept. */
const ShapeOutline = ({
  shape,
  dash,
}: {
  readonly shape: CanvasShape;
  readonly dash: Paint["dash"];
}) => {
  const dashed = dash === "solid" ? undefined : dash;
  return (
    <svg className="cv-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {shape === "ellipse" ? (
        <ellipse
          cx="50"
          cy="50"
          rx="50"
          ry="50"
          vectorEffect="non-scaling-stroke"
          data-dash={dashed}
        />
      ) : (
        <polygon
          points="50,0 100,50 50,100 0,50"
          vectorEffect="non-scaling-stroke"
          data-dash={dashed}
        />
      )}
    </svg>
  );
};

const CardNode = memo(function CardNode({
  node,
  selected,
  alone,
  simple,
  mark,
  flash,
  editing,
  editable,
  lit,
  focus,
  steps,
  from,
}: {
  readonly node: Exclude<CanvasNode, CanvasGroupNode>;
  readonly selected: boolean;
  /** The only card selected: it has handles. */
  readonly alone: boolean;
  readonly simple: boolean;
  readonly mark: CanvasMark | undefined;
  /** The commit it just changed in. */
  readonly flash: string | undefined;
  readonly editing: boolean;
  readonly editable: boolean;
  /** Whether the step being walked shows it; unset outside a walk. */
  readonly lit: boolean | undefined;
  /** It's what the step walked or peeked at points at, being one of its loose cards. */
  readonly focus: boolean;
  /** The story's steps that point at it, numbered on its corner. */
  readonly steps: ReadonlyArray<StepChipProps> | undefined;
  /** Shown beside what the step points at, away from its place: the step it belongs to, from 1. */
  readonly from: string | undefined;
}) {
  const { mode } = useBoard();
  const { paint, props } = paintProps(node);
  const { style, ...painted } = props;
  const live = mode === "fit" || selected;
  const noteFile =
    editing && node.type === "file" && canvasFileKind(node.file) === "note" ? node.file : null;
  const shape = node.type === "text" ? node.astrolabe?.shape : undefined;
  return (
    <article
      className="cv-card"
      data-kind={node.type}
      data-shape={shape}
      data-card-id={node.id}
      data-selected={selected || undefined}
      data-mark={mark}
      data-lit={lit}
      data-focus={focus || undefined}
      data-from={from}
      data-editing={editing || undefined}
      style={{ ...position(node), ...style }}
      {...painted}
    >
      {node.type === "file" ? <FileCardLabel node={node} /> : null}
      {shape === undefined ? (
        <BoxLine paint={paint} />
      ) : (
        <ShapeOutline shape={shape} dash={paint.dash} />
      )}
      <MarkBadge mark={mark} />
      <Flash revision={flash} />
      {steps === undefined ? null : (
        <span className="cv-card-steps">
          {steps.map((each) => (
            <StepChip key={each.index} {...each} />
          ))}
        </span>
      )}
      <div className="cv-card-content" data-live={(live && !simple) || undefined}>
        {noteFile !== null ? (
          <NoteCardEditor file={noteFile} />
        ) : editing ? (
          <TextCardEditor node={node} />
        ) : simple ? (
          <SimpleCard node={node} />
        ) : node.type === "text" ? (
          <TextCard text={node.text} />
        ) : node.type === "file" ? (
          // A removed card's file may be gone too, which isn't what this card is saying.
          mark === "removed" ? (
            <SimpleFile file={node.file} />
          ) : (
            <FileCard node={node} live={live} />
          )
        ) : node.astrolabe?.code !== undefined ? (
          <CodeCard code={node.astrolabe.code} url={node.url} caption={node.astrolabe.caption} />
        ) : (
          <LinkCard node={node} live={live} />
        )}
      </div>
      {/* The only card selected has its dots and handles above everything, on its frame. */}
      {editable && !editing && !alone ? <Dots /> : null}
    </article>
  );
});

/** A one-line editor for a group's label: Enter commits it, as Escape and clicking away do. */
function GroupLabelEditor({
  label,
  onDone,
}: {
  readonly label: string;
  readonly onDone: (label: string) => void;
}) {
  return (
    <input
      className="cv-group-label cv-label-editor"
      data-card-editor
      aria-label="Section label"
      autoFocus
      defaultValue={label}
      onFocus={(event) => event.target.select()}
      onBlur={(event) => onDone(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}

const GroupNode = memo(function GroupNode({
  node,
  selected,
  alone,
  mark,
  flash,
  editing,
  editable,
  onLabel,
  lit,
  steps,
}: {
  readonly node: CanvasGroupNode;
  readonly selected: boolean;
  readonly alone: boolean;
  readonly mark: CanvasMark | undefined;
  readonly flash: string | undefined;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly onLabel: (id: string, label: string) => void;
  readonly lit: boolean | undefined;
  /** The story's steps that point at this group, numbered on its label. */
  readonly steps: ReadonlyArray<StepChipProps> | undefined;
}) {
  const { host } = useBoard();
  const { paint, props } = paintProps(node);
  const { style, ...painted } = props;
  // Smaller above larger, and all beneath the cards: their order on the page says so.
  return (
    <div
      className="cv-group"
      data-card-id={node.id}
      data-selected={selected || undefined}
      data-mark={mark}
      data-lit={lit}
      style={{ ...position(node), ...style }}
      {...painted}
    >
      <BoxLine paint={paint} />
      <MarkBadge mark={mark} />
      <Flash revision={flash} />
      {node.background === undefined
        ? null
        : host.renderAsset?.({
            kind: "background",
            path: node.background,
            style: node.backgroundStyle,
          })}
      {editing ? (
        <GroupLabelEditor label={node.label ?? ""} onDone={(label) => onLabel(node.id, label)} />
      ) : steps !== undefined ? (
        <span className="cv-group-label" data-steps>
          {steps.map((each) => (
            <StepChip key={each.index} {...each} />
          ))}
          {node.label === undefined ? null : <span className="cv-group-name">{node.label}</span>}
        </span>
      ) : node.label === undefined ? null : (
        <span className="cv-group-label">{node.label}</span>
      )}
      {editable && selected ? <Dots /> : null}
      {editable && alone ? <Handles /> : null}
    </div>
  );
});

interface StepChipProps {
  readonly index: number;
  readonly label: string | undefined;
  /** The step walked or peeked at. */
  readonly current: boolean;
  readonly open: boolean;
  readonly onOpen: ((step: number, chip: HTMLElement) => void) | undefined;
  readonly onPeek: (step: number | null) => void;
}

/** A step's number: hovering it shows what the step covers, clicking it asks for its details. */
function StepChip({ index, label, current, open, onOpen, onPeek }: StepChipProps) {
  const name = `Step ${index + 1}${label === undefined ? "" : `: ${label}`}`;
  const peek = {
    onPointerEnter: () => onPeek(index),
    onPointerLeave: () => onPeek(null),
    onFocus: () => onPeek(index),
    onBlur: () => onPeek(null),
  };
  return onOpen === undefined ? (
    <span
      className="cv-frame-chip"
      data-current={current || undefined}
      aria-hidden="true"
      {...peek}
    >
      {index + 1}
    </span>
  ) : (
    <button
      type="button"
      className="cv-frame-chip"
      data-current={current || undefined}
      aria-label={name}
      aria-expanded={open}
      aria-haspopup="dialog"
      {...peek}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(index, event.currentTarget);
      }}
    >
      {index + 1}
    </button>
  );
}

/** Every step's number, and each by what it points at: its groups, else its cards. */
function stepChips(
  steps: ReadonlyArray<CanvasStep>,
  at: Pick<StepChipProps, "onOpen" | "onPeek"> & {
    readonly current: number | null;
    readonly open: number | null;
  },
) {
  const all = steps.map((each, index): StepChipProps => ({
    index,
    label: each.label,
    current: index === at.current,
    open: index === at.open,
    onOpen: at.onOpen,
    onPeek: at.onPeek,
  }));
  const byGroup = new Map<string, StepChipProps[]>();
  const byCard = new Map<string, StepChipProps[]>();
  steps.forEach((each, index) => {
    const chip = all[index];
    if (each.heading !== undefined || chip === undefined) return;
    const [on, ids] = each.groups.length > 0 ? [byGroup, each.groups] : [byCard, each.cards];
    for (const id of ids) on.set(id, [...(on.get(id) ?? []), chip]);
  });
  return { all, byGroup, byCard };
}

/** A lanes board's step, named above its column: what a frame would say, where nothing else is. */
function StepHeading({
  heading,
  lit,
  chip,
}: {
  readonly heading: CanvasBounds;
  readonly lit: boolean | undefined;
  readonly chip: StepChipProps;
}) {
  return (
    <div className="cv-step-heading" data-lit={lit} style={position(heading)}>
      <StepChip {...chip} />
      {chip.label === undefined ? null : <span className="cv-step-heading-name">{chip.label}</span>}
    </div>
  );
}

const EdgeNode = memo(function EdgeNode({
  shape,
  selected,
  mark,
  lit,
}: {
  readonly shape: CanvasEdgeShape;
  readonly selected: boolean;
  readonly mark: CanvasMark | undefined;
  readonly lit: boolean | undefined;
}) {
  const { edge, path, heads } = shape;
  const { props } = paintProps(edge);
  return (
    <LayerSvg bounds={shape.bounds}>
      <g
        className="cv-edge"
        data-edge-id={edge.id}
        data-selected={selected || undefined}
        data-mark={mark}
        data-lit={lit}
        {...props}
      >
        <path className="cv-edge-line" d={path} />
        <path className="cv-edge-hit" d={path} />
        {heads.map((head) => (
          <path key={head} className="cv-edge-head" d={head} />
        ))}
      </g>
    </LayerSvg>
  );
});

/** Room round a line's box for its width and heads; past it, the svg still paints. */
const LAYER_PAD = 16;

/** An arrow's or drawing's own svg, sized to it, so it stacks among the cards as one of them. */
const LayerSvg = ({
  bounds,
  children,
}: {
  readonly bounds: CanvasBounds;
  readonly children: ReactNode;
}) => {
  const x = bounds.x - LAYER_PAD;
  const y = bounds.y - LAYER_PAD;
  const width = bounds.width + LAYER_PAD * 2;
  const height = bounds.height + LAYER_PAD * 2;
  return (
    <svg
      className="cv-layer"
      aria-hidden="true"
      style={{ left: x, top: y, width, height }}
      viewBox={`${x} ${y} ${width} ${height}`}
    >
      {children}
    </svg>
  );
};

function EdgeLabel({
  edge,
  at,
  lit,
}: {
  readonly edge: CanvasEdge;
  readonly at: CanvasEdgeShape["labelAt"];
  readonly lit: boolean | undefined;
}) {
  return (
    <span
      className="cv-edge-label"
      data-edge-label={edge.id}
      data-lit={lit}
      style={{ left: at.x, top: at.y }}
    >
      {edge.label}
    </span>
  );
}

/** An arrow's label. Enter makes a new line, so Escape, Tab or clicking away commits it. */
function EdgeLabelEditor({
  label,
  at,
  onDone,
}: {
  readonly label: string | undefined;
  readonly at: CanvasEdgeShape["labelAt"];
  readonly onDone: (label: string) => void;
}) {
  return (
    <textarea
      className="cv-edge-label cv-label-editor"
      data-card-editor
      aria-label="Connection label"
      style={{ left: at.x, top: at.y }}
      autoFocus
      defaultValue={label ?? ""}
      onBlur={(event) => onDone(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A stroke or drawn arrow: one path to see, one wider to hit, and an arrow's head. */
const InkNode = memo(function InkNode({
  shape,
  selected,
  mark,
  lit,
}: {
  readonly shape: CanvasInkShape;
  readonly selected: boolean;
  readonly mark: CanvasMark | undefined;
  readonly lit: boolean | undefined;
}) {
  const { ink, path, head } = shape;
  const { props } = paintProps(ink);
  return (
    <LayerSvg bounds={shape.bounds}>
      <g
        className="cv-ink"
        data-kind={ink.type}
        data-drawing-id={ink.id}
        data-selected={selected || undefined}
        data-mark={mark}
        data-lit={lit}
        {...props}
      >
        <path className="cv-ink-hit" d={path} />
        <path className="cv-ink-line" d={path} />
        {head === undefined ? null : <path className="cv-ink-head" d={head} />}
      </g>
    </LayerSvg>
  );
});

type Layer = CanvasBoardLayer;

const layerKey = (layer: Layer) =>
  layer.kind === "card"
    ? `card:${layer.node.id}`
    : layer.kind === "arrow"
      ? `arrow:${layer.shape.edge.id}`
      : `drawing:${layer.shape.ink.id}`;

interface Layout {
  /** As they stack, bottom first: see `canvasStack`. */
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<Exclude<CanvasNode, CanvasGroupNode>>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
  readonly inks: ReadonlyArray<CanvasInkShape>;
  /** Cards, arrows and drawings in the one order they stack in, bottom first. */
  readonly layers: ReadonlyArray<Layer>;
  readonly byId: ReadonlyMap<string, CanvasNode>;
}

const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    JSON.stringify(a) === JSON.stringify(b));

function sameFields<A extends object>(a: A, b: A) {
  const keys = Object.keys(a) as Array<keyof A>;
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

/** What didn't change keeps its object: a card's memo is what keeps it from drawing again. */
function layoutOf(data: CanvasData, previous: Layout | null): Layout {
  const nodes = data.nodes.map((node) => {
    const before = previous?.byId.get(node.id);
    return before !== undefined && sameFields(before, node) ? before : node;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const shapesBefore = new Map(previous?.shapes.map((shape) => [shape.edge.id, shape]));
  const inksBefore = new Map(previous?.inks.map((shape) => [shape.ink.id, shape]));
  const shapes = canvasEdgeShapes(data).map((shape) => {
    const before = shapesBefore.get(shape.edge.id);
    return before !== undefined &&
      before.path === shape.path &&
      sameFields(before.edge, shape.edge) &&
      before.heads.join() === shape.heads.join()
      ? before
      : shape;
  });
  const inks = canvasInkShapes(data).map((shape) => {
    const before = inksBefore.get(shape.ink.id);
    return before !== undefined &&
      before.path === shape.path &&
      before.head === shape.head &&
      sameFields(before.ink, shape.ink)
      ? before
      : shape;
  });
  // Kinds can share an id, so each is found among its own.
  const shapeOf = new Map(shapes.map((shape) => [shape.edge.id, shape]));
  const inkOf = new Map(inks.map((shape) => [shape.ink.id, shape]));
  const stack = canvasStack(data);
  const layersBefore = new Map(previous?.layers.map((layer) => [layerKey(layer), layer]));
  // A layer holding what it held keeps its object, so what's shown is seen to be the same.
  const kept = (layer: Layer): Layer => {
    const before = layersBefore.get(layerKey(layer));
    if (before === undefined) return layer;
    const same =
      before.kind === "card" && layer.kind === "card"
        ? before.node === layer.node
        : before.kind !== "card" && layer.kind !== "card" && before.shape === layer.shape;
    return same ? before : layer;
  };
  const layers = stack.content.flatMap((layer): Layer[] => {
    const { id } = canvasLayerOf(layer);
    if (layer.kind === "card") {
      const node = byId.get(id);
      return node === undefined || node.type === "group" ? [] : [kept({ kind: "card", node })];
    }
    const shape = layer.kind === "arrow" ? shapeOf.get(id) : undefined;
    if (shape !== undefined) return [kept({ kind: "arrow", shape })];
    const ink = layer.kind === "drawing" ? inkOf.get(id) : undefined;
    return ink === undefined ? [] : [kept({ kind: "drawing", shape: ink })];
  });
  return {
    groups: stack.sections.flatMap((node) => {
      const kept = byId.get(node.id);
      return kept?.type === "group" ? [kept] : [];
    }),
    cards: layers.flatMap((layer) => (layer.kind === "card" ? [layer.node] : [])),
    shapes,
    inks,
    layers,
    byId,
  };
}

interface Shown {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly layers: ReadonlyArray<Layer>;
  readonly simple: boolean;
}

/** Where a card a step brought in comes from; empty when it's only elsewhere on the board. */
const dockedLabel = (step: CanvasStep | null, id: string) => {
  const docked = step?.docked.get(id);
  if (docked === undefined) return undefined;
  if (docked.from !== undefined) return `From step ${docked.from + 1}`;
  return docked.group === undefined ? "" : `From ${docked.group}`;
};

const NOTHING: Shown = { groups: [], layers: [], simple: false };
const NO_MARKS: CanvasMarks = { cards: {}, arrows: {} };
/** As long as `.cv-flash` plays, and a little over. */
const FLASH_MS = 1400;

interface Flashed {
  readonly revision: string;
  readonly cards: ReadonlySet<string>;
}
const OVERVIEW: Shown = { ...NOTHING, simple: true };

const boundsOfLayer = (layer: Layer) => (layer.kind === "card" ? layer.node : layer.shape.bounds);

function inView(layout: Layout, view: CanvasBounds, simple: boolean): Shown {
  return {
    groups: layout.groups.filter((node) => overlaps(node, view)),
    layers: layout.layers.filter((layer) => overlaps(boundsOfLayer(layer), view)),
    simple,
  };
}

const sameItems = <A,>(a: ReadonlyArray<A>, b: ReadonlyArray<A>) =>
  a.length === b.length && a.every((item, position) => item === b[position]);

const sameShown = (a: Shown, b: Shown) =>
  a.simple === b.simple && sameItems(a.layers, b.layers) && sameItems(a.groups, b.groups);

const shownCards = (shown: Shown) =>
  shown.layers.flatMap((layer) => (layer.kind === "card" ? [layer.node] : []));

/** What gestures and commands read at the moment they act, outside any render. */
class BoardLive {
  data: CanvasData;
  layout: Layout;
  bounds: CanvasBounds;
  marks: CanvasMarks;
  selection: CanvasSelection = NO_SELECTION;
  editable = false;
  canvasDocument: CanvasDocument | null = null;
  settings = DEFAULT_SETTINGS;
  host: CanvasBoardHost = NO_HOST;
  selecting = false;
  tool: CanvasTool = "select";
  shape: CanvasShape = "ellipse";
  revision: string | undefined = undefined;
  editing: CanvasEditing | null = null;
  openMenu: OpenMenu | null = null;
  readAt: string | undefined = undefined;
  walkable = false;
  /** The frame a free board's camera last moved to. */
  walkedTo: string | null = null;
  whole: CanvasBounds = { x: 0, y: 0, width: 0, height: 0 };
  openingCamera: CanvasCamera | null | undefined;
  onCamera: ((camera: CanvasCamera | null) => void) | undefined = undefined;
  onSettings: ((patch: Partial<CanvasBoardSettings>) => void) | undefined = undefined;
  onReadOnly: ((on: boolean) => void) | undefined = undefined;
  openBoardMenu: (clientX: number, clientY: number, target: Element) => void = () => {};
  openLooseEnd: (
    end: CanvasLooseEnd,
    at: CanvasPoint,
    clientX: number,
    clientY: number,
    done: () => void,
  ) => void = () => {};
  closeEditing: () => void = () => {};
  /** Space pans while held; tapped, it's the app's. */
  spaceHeld = false;
  spaceUsed = false;
  /** Where the pointer last was on the board. */
  pointer: CanvasPoint | null = null;
  board: HTMLElement | null = null;
  world: HTMLElement | null = null;

  constructor(data: CanvasData, marks: CanvasMarks, camera: CanvasCamera | null | undefined) {
    this.data = data;
    this.layout = layoutOf(data, null);
    this.bounds = canvasBounds(data);
    this.marks = marks;
    this.openingCamera = camera;
  }

  update(next: Partial<BoardLive>) {
    Object.assign(this, next);
  }

  /** A commit's result, ahead of the render it causes: a command often acts on what it made. */
  currentData = () => this.canvasDocument?.getState().data ?? this.data;
}

const NO_DOCUMENT_STATE = () => null;
const NO_SUBSCRIPTION = () => () => {};

type Dialog =
  | {
      readonly kind: "prompt";
      readonly request: CanvasPromptRequest;
      readonly done: (value: string | null) => void;
    }
  | {
      readonly kind: "picker";
      readonly request: CanvasPickerRequest;
      readonly done: (picked: CanvasPicked | null) => void;
    }
  | { readonly kind: "help" }
  | { readonly kind: "export" };

interface OpenMenu {
  readonly label: string;
  readonly items: ReadonlyArray<CanvasMenuEntry>;
  readonly x: number;
  readonly y: number;
  readonly alignEnd?: boolean;
  /** Runs when it closes, whatever was chosen. */
  readonly onClose?: () => void;
}

type ToolbarPopover = "align" | "direction" | "background" | null;

/** The kind a tool draws, whose style the panel shows with nothing selected. */
const TOOL_KINDS: Partial<Record<CanvasTool, CanvasPaintKind>> = {
  card: "card",
  section: "section",
  shape: "shape",
  arrow: "arrow",
  pen: "stroke",
};

/** Smaller than this, a board opens its style panel over what it shows only when asked. */
const ROOMY_BOARD = { width: 640, height: 480 };

/** Entries without a separator first, last, or twice over. */
const tidySeparators = (entries: ReadonlyArray<CanvasMenuEntry>) =>
  entries.filter(
    (entry, at) =>
      entry !== "separator" ||
      (at > 0 &&
        entries[at - 1] !== "separator" &&
        entries.slice(at + 1).some((next) => next !== "separator")),
  );

const editingTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable='true'], [data-card-editor]") !== null;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

/** Files out of a drop, a folder's included, as `webkitGetAsEntry` reads them. */
async function droppedFiles(transfer: DataTransfer): Promise<ReadonlyArray<File>> {
  const read = async (entry: FileSystemEntry | null): Promise<File[]> => {
    if (entry === null) return [];
    if (entry.isFile) {
      return new Promise((resolve) =>
        (entry as FileSystemFileEntry).file(
          (file) => resolve([file]),
          () => resolve([]),
        ),
      );
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    return (await Promise.all(entries.map(read))).flat();
  };
  const items = [...transfer.items].filter((item) => item.kind === "file");
  if (items.length === 0 || items[0]?.webkitGetAsEntry === undefined) return [...transfer.files];
  return (await Promise.all(items.map((item) => read(item.webkitGetAsEntry())))).flat();
}

/**
 * A JSON Canvas as DOM cards and SVG arrows in one transformed element. `fit` shows it all; `free`
 * pans and zooms through `CanvasView`, so only what's near the frame is mounted, and a first click
 * selects a card, only then making it live. With a `document` it edits: gestures run in
 * `CanvasGestures`, outside React, and what's drawn comes from the document.
 */
export function CanvasBoard({
  data: dataProp,
  mode,
  host = NO_HOST,
  label,
  revision,
  camera: openingCamera,
  onCamera,
  marks = NO_MARKS,
  wheelOnceFocused = false,
  document: canvasDocument = null,
  readOnly = false,
  onReadOnly,
  settings = DEFAULT_SETTINGS,
  onSettings,
  story = 0,
  step = null,
  openFrame = null,
  onFrame,
  onStepAdded,
  onPresent,
  menuItems,
  children,
  ref,
}: {
  readonly data: CanvasData;
  readonly mode: "fit" | "free";
  readonly host?: CanvasBoardHost;
  readonly label: string;
  /** What a review marks on the board. */
  readonly marks?: CanvasMarks;
  /** In a page that scrolls, the wheel stays the page's until the board is clicked. */
  readonly wheelOnceFocused?: boolean;
  /** Changes when the wiki does: known files are read again, and the camera stays. */
  readonly revision?: string | undefined;
  /** Where the board opens, for a page that had to load again; read once. Unset, it fits. */
  readonly camera?: CanvasCamera | null | undefined;
  /** Hears the camera each time it draws: null while it still fits the board. */
  readonly onCamera?: ((camera: CanvasCamera | null) => void) | undefined;
  /** The board being edited, in place of `data`. Without one it only reads. */
  readonly document?: CanvasDocument | null | undefined;
  /** This board's own toggle, which leaves `document` showing but stops edits. */
  readonly readOnly?: boolean;
  readonly onReadOnly?: ((on: boolean) => void) | undefined;
  readonly settings?: CanvasBoardSettings;
  readonly onSettings?: ((patch: Partial<CanvasBoardSettings>) => void) | undefined;
  /** Which of the board's stories its frames and walk are, from 0. */
  readonly story?: number;
  /** The story's step being walked, from 0: the camera shows only it. */
  readonly step?: number | null;
  /** The step whose details the host is showing, which stays picked out until they close. */
  readonly openFrame?: number | null;
  /** Asked for a step's details, as its frame's number is clicked, beside that number. */
  readonly onFrame?: ((step: number, chip: HTMLElement) => void) | undefined;
  /** Lets a board being edited add what's selected to its story, as the step after the one shown. */
  readonly onStepAdded?: ((step: number) => void) | undefined;
  /** Starts walking the story from its first step: the host owns the walk. */
  readonly onPresent?: (() => void) | undefined;
  /** The host's own actions, in the board's menu after its own. */
  readonly menuItems?: ReadonlyArray<CanvasMenuEntry> | undefined;
  /** The host's controls, floating over the board's foot; what fits stays clear of them. */
  readonly children?: ReactNode;
  readonly ref?: Ref<CanvasBoardHandle>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLSpanElement | null>(null);
  const tipBoard = useCallback(() => boardRef.current, []);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const documentState: CanvasDocumentState | null = useSyncExternalStore(
    canvasDocument?.subscribe ?? NO_SUBSCRIPTION,
    canvasDocument?.getState ?? NO_DOCUMENT_STATE,
  );
  const data = documentState?.data ?? dataProp;
  const editable = canvasDocument !== null && !readOnly && mode === "free";
  const [view] = useState(() => new CanvasView());
  // The zoom moves between the chip and the tool bar as editing starts and stops: each starts
  // from the camera as it stands, and the camera writes it as it paints, not React.
  const zoomLevel = useCallback(
    (element: HTMLSpanElement | null) => {
      zoomRef.current = element;
      if (element !== null) element.textContent = `${Math.round(view.camera.zoom * 100)}%`;
    },
    [view],
  );
  const [live] = useState(() => new BoardLive(data, marks, openingCamera));
  const steps = useMemo(() => canvasSteps(data, story), [data, story]);
  const active = step === null ? null : (steps[step] ?? null);
  const [hovered, setHovered] = useState<number | null>(null);
  const peekIndex = active === null ? (hovered ?? openFrame) : null;
  const peeked = peekIndex === null ? null : (steps[peekIndex] ?? null);
  // A walk shows only its step; a peek, outside one, dims what the step leaves out.
  const shines = active ?? peeked;
  const current = step ?? peekIndex;
  const chips = useMemo(
    () => stepChips(steps, { current, open: openFrame, onOpen: onFrame, onPeek: setHovered }),
    [steps, current, openFrame, onFrame],
  );
  const whole = useMemo(() => canvasBounds(data), [data]);
  // A step moves the cards it recalls beside its frame; an edited board always shows where they are.
  const bounds = active === null ? whole : canvasDocument === null ? active.bounds : active.inPlace;
  const shownData = useMemo(
    () => (active === null || canvasDocument !== null ? data : canvasStepData(data, active)),
    [data, active, canvasDocument],
  );
  const layout = useMemo(() => layoutOf(shownData, live.layout), [shownData, live]);
  const [shown, setShown] = useState(NOTHING);
  const [selection, setSelection] = useState<CanvasSelection>(NO_SELECTION);
  const [editing, setEditing] = useState<CanvasEditing | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [popover, setPopover] = useState<ToolbarPopover>(null);
  const [selecting, setSelecting] = useState(false);
  const [toolChosen, setTool] = useState<CanvasTool>("select");
  // Leaving editing puts the tools down: a board opened for editing again starts on Select.
  if (!editable && toolChosen !== "select") setTool("select");
  const tool = editable ? toolChosen : "select";
  const [shapeKind, setShapeKind] = useState<CanvasShape>("ellipse");
  const [localNotice, setNotice] = useState<string | null>(null);
  const styleSession = useCanvasStyleSession();
  const [stylePeek, setStylePeek] = useState(false);
  const [compact, setCompact] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the board's size is the browser's layout, read before the first paint so a small board never flashes its panel open
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    setCompact(board.clientWidth < ROOMY_BOARD.width || board.clientHeight < ROOMY_BOARD.height);
  }, []);
  const notice = localNotice ?? documentState?.notice ?? null;
  const [reads] = useState(() => ({
    files: new BatchedReads<CanvasFileRead>(FILE_READ_BATCH),
    code: new BatchedReads<CanvasCodeStatus>(FILE_READ_BATCH),
  }));

  const placeToolbar = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) return;
    const { selection: current } = live;
    const byId = live.layout.byId;
    const nodes = [...current.cards].flatMap((id) => {
      const node = byId.get(id);
      return node === undefined ? [] : [node];
    });
    const arrow =
      current.arrow === null
        ? undefined
        : live.layout.shapes.find((shape) => shape.edge.id === current.arrow);
    const drawings = selectedDrawings(current);
    const inks = live.layout.inks.flatMap((shape) =>
      drawings.has(shape.ink.id) ? [shape.bounds] : [],
    );
    const rects = arrow === undefined ? [...nodes, ...inks] : [arrow.bounds];
    if (rects.length === 0) return;
    const top = Math.min(...rects.map((rect) => rect.y));
    const left = Math.min(...rects.map((rect) => rect.x));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const { x, y } = view.toFrame({ x: (left + right) / 2, y: top });
    const frame = boardRef.current;
    const half = toolbar.offsetWidth / 2;
    let clampedX = Math.max(half + 4, Math.min(x, (frame?.clientWidth ?? 0) - half - 4));
    // Under the tool bar at the board's top, never over it.
    const bar = topBarRef.current;
    const ceiling = bar === null ? 0 : bar.offsetTop + bar.offsetHeight;
    const clampedY = Math.max(ceiling + toolbar.offsetHeight + 8, y - 12);
    // Beside the style panel, never over it.
    const panel = styleRef.current;
    if (panel !== null && clampedY - toolbar.offsetHeight < panel.offsetTop + panel.offsetHeight) {
      clampedX = Math.max(clampedX, panel.offsetLeft + panel.offsetWidth + 8 + half);
    }
    toolbar.style.transform = `translate(${clampedX}px, ${clampedY}px) translate(-50%, -100%)`;
  }, [view, live]);

  const [show] = useState(() => (camera: CanvasCamera, width: number, height: number) => {
    // A walk's camera moves are animated: what's about to come into view must already be there.
    const window = live.walkable ? live.whole : cameraWindow(camera, width, height, CULL_MARGIN);
    const next = inView(live.layout, window, camera.zoom < live.settings.simpleZoom);
    const cards = shownCards(next);
    const overview = next.simple && cards.length > OVERVIEW_CARDS;
    if (overview && overviewRef.current !== null) {
      drawCanvasOverview(overviewRef.current, camera, width, height, next, live.marks);
    }
    const mounted = overview ? OVERVIEW : next;
    setCompact(width < ROOMY_BOARD.width || height < ROOMY_BOARD.height);
    setShown((now) => (sameShown(now, mounted) ? now : mounted));
    if (zoomRef.current !== null) zoomRef.current.textContent = `${Math.round(camera.zoom * 100)}%`;
    live.onCamera?.(view.fitted ? null : camera);
    placeToolbar();
    if (next.simple) return;
    reads.files.want(
      cards.flatMap((card) =>
        card.type === "file" && live.marks.cards[card.id] !== "removed" ? [card.file] : [],
      ),
    );
    reads.code.want(
      cards.flatMap((card) => {
        const code = card.type === "link" ? card.astrolabe?.code : undefined;
        return code?.repository !== undefined && code.commit !== undefined ? [codeKey(code)] : [];
      }),
    );
  });

  const closeEditing = useCallback(() => {
    // A label commits as it blurs, which it wouldn't get to do if it just went.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches(".cv-label-editor")) {
      active.blur();
      return;
    }
    live.canvasDocument?.finishTyping();
    setEditing(null);
    boardRef.current?.focus({ preventScroll: true });
  }, [live]);

  const [commands] = useState(
    () =>
      new CanvasCommands({
        view,
        document: () => (live.editable ? live.canvasDocument : null),
        data: live.currentData,
        selection: () => live.selection,
        select: (next) => {
          live.update({ selection: next });
          setSelection(next);
        },
        host: () => live.host,
        edit: setEditing,
        pick: (request) =>
          new Promise((resolve) => {
            setDialog({ kind: "picker", request, done: resolve });
          }),
        prompt: (request) =>
          new Promise((resolve) => {
            setDialog({ kind: "prompt", request, done: resolve });
          }),
        notify: setNotice,
        reread: (file) => {
          reads.files.invalidate();
          reads.files.want([file]);
        },
        element: (id) =>
          live.world?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`) ?? null,
        openExport: () => setDialog({ kind: "export" }),
        pen: () => canvasStyleSession.get().pen,
      }),
  );

  const openBoardMenu = useCallback(
    (clientX: number, clientY: number, target: Element) => {
      const rect = boardRef.current?.getBoundingClientRect();
      const at = view.toWorld(clientX, clientY);
      const place = { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
      const { selection: current, editable: canEdit } = live;
      const arrowHit = target.closest("[data-edge-id], [data-edge-label]");
      const arrow =
        arrowHit?.getAttribute("data-edge-id") ?? arrowHit?.getAttribute("data-edge-label");
      if (arrow !== undefined && arrow !== null) {
        const edge = live.currentData().edges.find((each) => each.id === arrow);
        if (edge === undefined || !canEdit) return;
        commands.select({ cards: new Set(), arrow });
        setMenu({ label: "Connection", items: arrowMenu(commands, edge, at), ...place });
        return;
      }
      const hit = target.closest(".cv-card, .cv-group-label, .cv-handle");
      const id = hit?.closest("[data-card-id]")?.getAttribute("data-card-id") ?? null;
      const node = id === null ? undefined : live.layout.byId.get(id);
      if (node !== undefined) {
        if (current.cards.size > 1 && current.cards.has(node.id)) {
          setMenu({
            label: "Selection",
            items: canEdit ? selectionMenu(commands, at) : readOnlyMenu(commands),
            ...place,
          });
          return;
        }
        commands.select({ cards: new Set([node.id]), arrow: null });
        const missing = node.type === "file" && reads.files.get(node.file)?.exists === false;
        setMenu({
          label: "Card",
          items: canEdit ? cardMenu(commands, node, at, missing) : readOnlyMenu(commands),
          ...place,
        });
        return;
      }
      if (!canEdit) return;
      setMenu({
        label: "Board",
        items: boardMenu({
          commands,
          at,
          snapToGrid: live.settings.snapToGrid,
          snapToObjects: live.settings.snapToObjects,
          setSnap: (key, on) => live.onSettings?.({ [key]: on }),
          setReadOnly: (on) => live.onReadOnly?.(on),
          canAttachNotes: live.host.listFiles !== undefined,
        }),
        ...place,
      });
    },
    [commands, reads, view, live],
  );

  const openLooseEnd = useCallback(
    (end: CanvasLooseEnd, at: CanvasPoint, clientX: number, clientY: number, done: () => void) => {
      const rect = boardRef.current?.getBoundingClientRect();
      setMenu({
        label: "New card",
        x: clientX - (rect?.left ?? 0),
        y: clientY - (rect?.top ?? 0),
        onClose: done,
        items: [
          { label: "Add card", run: () => commands.addCardToLooseEnd(end, at) },
          {
            label: "Add note from wiki",
            run: () => void commands.addNoteToLooseEnd(end, at),
          },
        ],
      });
    },
    [commands],
  );

  const [gestures] = useState(
    () =>
      new CanvasGestures({
        view,
        board: () => live.board,
        world: () => live.world,
        data: live.currentData,
        shapes: () => live.layout.shapes,
        inks: () => live.layout.inks,
        selection: () => live.selection,
        select: commands.select,
        document: () => (live.editable ? live.canvasDocument : null),
        styled: commands.styled,
        pen: () => {
          const { pen } = canvasStyleSession.get();
          return {
            width: CANVAS_WIDTH_STEPS.stroke[pen.width ?? "medium"],
            color: canvasTint(pen.color ?? undefined),
          };
        },
        snap: () => ({
          grid: live.settings.snapToGrid,
          objects: live.settings.snapToObjects,
        }),
        selectMode: () => live.selecting,
        spaceHeld: () => {
          if (live.spaceHeld) live.update({ spaceUsed: true });
          return live.spaceHeld;
        },
        openMenu: (clientX, clientY, target) => live.openBoardMenu(clientX, clientY, target),
        closeOverlays: () => {
          live.openMenu?.onClose?.();
          setMenu(null);
          setPopover(null);
          if (live.editing !== null) live.closeEditing();
        },
        openFileCard: (id) => {
          const node = live.layout.byId.get(id);
          if (node?.type === "file") live.host.onOpenLink?.(node.file);
        },
        followSmallLink: (id) => {
          const node = live.layout.byId.get(id);
          const simple = live.world?.closest(".cv-board")?.hasAttribute("data-simple") ?? false;
          if (node?.type !== "link" || !simple) return false;
          live.host.onOpenUrl?.(node.url);
          return true;
        },
        editCard: (id) => commands.editCard(id),
        editGroupLabel: (id) => setEditing({ kind: "group", id }),
        editArrowLabel: (id) => setEditing({ kind: "arrow", id }),
        editInkLabel: (id) => setEditing({ kind: "drawing", id }),
        addTextAt: (point) => commands.addTextAt(point),
        tool: () => live.tool,
        inked: (points) => commands.addStroke(points),
        drawn: (tool, box, at) => {
          if (tool === "card") commands.drawCard(box, at);
          else if (tool === "shape") commands.drawShape(live.shape, box, at);
          else commands.drawSection(box, at);
          live.update({ tool: "select" });
          setTool("select");
        },
        toolDone: () => {
          live.update({ tool: "select" });
          setTool("select");
        },
        fitToContent: (id, handle) => commands.fitToContent(id, handle),
        looseEnd: (end, at, clientX, clientY, done) =>
          live.openLooseEnd(end, at, clientX, clientY, done),
      }),
  );

  const finishGroupLabel = useCallback(
    (id: string, label: string) => {
      const trimmed = label.trim();
      live.canvasDocument?.commit([
        { op: "set-card", card: id, keys: { label: trimmed === "" ? null : trimmed } },
      ]);
      setEditing(null);
      boardRef.current?.focus({ preventScroll: true });
    },
    [live],
  );
  const finishInkLabel = useCallback(
    (id: string, label: string) => {
      live.canvasDocument?.commit([
        { op: "set-drawing", drawing: id, keys: { label: label === "" ? null : label } },
      ]);
      setEditing(null);
      boardRef.current?.focus({ preventScroll: true });
    },
    [live],
  );
  const finishArrowLabel = useCallback(
    (id: string, label: string) => {
      live.canvasDocument?.commit([
        { op: "set-arrow", arrow: id, keys: { label: label === "" ? null : label } },
      ]);
      setEditing(null);
      boardRef.current?.focus({ preventScroll: true });
    },
    [live],
  );

  const context = useMemo(
    () => ({
      host,
      mode,
      ...reads,
      commands: editable ? commands : null,
      endEditing: closeEditing,
      revision: () => live.revision,
      notify: setNotice,
    }),
    [host, mode, reads, editable, commands, closeEditing, live],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gestures and commands run outside React and read the latest of these when they act
  useLayoutEffect(() => {
    live.update({
      data,
      selection,
      editable,
      canvasDocument,
      settings,
      host,
      selecting,
      tool,
      shape: shapeKind,
      revision,
      editing,
      openMenu: menu,
      onSettings,
      onReadOnly,
      openBoardMenu,
      openLooseEnd,
      closeEditing,
    });
    placeToolbar();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame the browser laid out and follows its resizes; the view's paint callback reads the latest layout outside React
  useLayoutEffect(() => {
    const board = boardRef.current;
    const world = worldRef.current;
    if (board === null || world === null) return;
    live.update({ board, world });
    const detach = view.attach(board, world, live.bounds, FIT_PADDING[mode], show);
    if (live.openingCamera) view.restore(live.openingCamera);
    return detach;
  }, [view, mode, show, live]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- new contents reach the view outside React, keeping a reader's camera where it was
  useLayoutEffect(() => {
    live.update({
      onCamera,
      layout,
      marks,
      bounds,
      walkable: steps.length > 0,
      whole,
    });
    reads.files.readFrom((paths) => host.readFiles?.(paths) ?? Promise.resolve([]));
    reads.code.readFrom(
      (keys) => host.readCodeStatus?.(keys.map(codeOfKey)) ?? Promise.resolve([]),
    );
    view.setBounds(bounds, mode === "fit");
  }, [view, reads, host, layout, marks, bounds, whole, steps, mode, onCamera, live]);

  const activeFrame = active === null ? null : `${story}:${step}`;
  // A step's note grows the host's controls in the same commit that moves to it.
  const overlayInset = useCallback(() => {
    const board = boardRef.current;
    const overlay = overlayRef.current;
    const bar = topBarRef.current;
    return {
      top: bar === null ? 0 : bar.offsetTop + bar.offsetHeight,
      bottom: board === null || overlay === null ? 0 : board.clientHeight - overlay.offsetTop,
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a free board's camera is the reader's: only a change of step moves it, outside React
  useLayoutEffect(() => {
    if (mode !== "free" || live.walkedTo === activeFrame) return;
    live.update({ walkedTo: activeFrame });
    view.setInset(overlayInset(), false);
    view.fit(true);
  }, [activeFrame, mode, view, live, overlayInset]);

  const overlaid = children !== undefined && children !== null;
  const barShown = mode === "free" && canvasDocument !== null && editable && active === null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the host's controls and the tool bar are laid out by the browser and change size as a story is walked
  useLayoutEffect(() => {
    const measure = () => view.setInset(overlayInset());
    measure();
    if (!overlaid && !barShown) return;
    const observer = new ResizeObserver(measure);
    for (const each of [overlayRef.current, topBarRef.current, boardRef.current]) {
      if (each) observer.observe(each);
    }
    return () => observer.disconnect();
  }, [view, overlaid, barShown, overlayInset]);

  // Changing a commit's cards catches the eye once; the marks are what stay. A board with no
  // revision never changes under its reader, and one being edited says which cards came from
  // elsewhere, so a person's own edits don't highlight.
  const [flash, setFlash] = useState<Flashed | null>(null);
  const [drawn, setDrawn] = useState({ revision, data });
  const documentFlash = documentState?.flash ?? null;
  const [flashSeen, setFlashSeen] = useState(documentFlash);
  if (documentFlash !== flashSeen) {
    setFlashSeen(documentFlash);
    setFlash(documentFlash);
  }
  if (drawn.revision !== revision) {
    setDrawn({ revision, data });
    const cards =
      revision === undefined || canvasDocument !== null
        ? null
        : canvasChangedCards(drawn.data, data);
    if (drawn.revision !== undefined && cards !== null && cards.size > 0) {
      setFlash({ revision: revision ?? "", cards });
    }
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a card scrolled back into view mounts anew, and must not replay a highlight that has finished
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new commit in the wiki reads what's in view again, through the view, which knows what that is
  useEffect(() => {
    if (live.readAt === revision) return;
    const first = live.readAt === undefined;
    live.update({ readAt: revision });
    if (first) return;
    reads.files.invalidate();
    reads.code.invalidate();
    view.setBounds(live.bounds, false);
  }, [revision, reads, view, live]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wheel listener must be non-passive to keep the page from scrolling, and React's is passive
  useEffect(() => {
    const board = boardRef.current;
    if (board === null || mode !== "free") return;
    const onWheel = (event: WheelEvent) => {
      if (wheelOnceFocused && !board.contains(document.activeElement)) return;
      const scrollable = (event.target as Element).closest("[data-live]");
      if (scrollable !== null && scrollable.scrollHeight > scrollable.clientHeight) return;
      event.preventDefault();
      if (live.spaceHeld) live.update({ spaceUsed: true });
      view.wheel(event, live.settings.wheel === "zoom", live.spaceHeld);
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [view, mode, wheelOnceFocused, live]);

  const dropPoint = useCallback(
    (clientX: number, clientY: number) => view.toWorld(clientX, clientY),
    [view],
  );

  const attachAndPlace = useCallback(
    async (files: ReadonlyArray<File>, at: CanvasPoint, pasted: boolean) => {
      const { attachFile } = live.host;
      if (attachFile === undefined) return;
      const paths: string[] = [];
      const refused: string[] = [];
      for (const file of files) {
        const name = pasted || file.name === "" ? pastedFileName(file, new Date()) : file.name;
        const base64 = toBase64(new Uint8Array(await file.arrayBuffer()));
        const saved = await attachFile(name, base64);
        if (saved !== null) paths.push(saved);
        else refused.push(name);
      }
      commands.placeFiles(paths, at);
      if (refused.length > 0) setNotice(`Couldn't add ${refused.join(", ")} to this wiki.`);
    },
    [commands, live],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a pane around the board listens for drops natively, so only a native listener here hears them first
  useEffect(() => {
    const board = boardRef.current;
    if (board === null || mode !== "free") return;
    const dragged = () => (live.editable ? live.host.draggedFiles?.() : null);
    const onDragOver = (event: DragEvent) => {
      if (!live.editable) return;
      const hasFiles = event.dataTransfer?.types.includes("Files") ?? false;
      if (!hasFiles && (dragged() ?? null) === null) return;
      event.preventDefault();
      event.stopPropagation();
      // A sidebar's row allows a move and nothing else: asking for a copy refuses the drop.
      if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
    };
    const onDrop = (event: DragEvent) => {
      if (!live.editable) return;
      const at = dropPoint(event.clientX, event.clientY);
      const fromWiki = dragged();
      if (fromWiki !== null && fromWiki !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        void commands.placeDropped(fromWiki, at);
        return;
      }
      const transfer = event.dataTransfer;
      if (transfer === null || !transfer.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      void droppedFiles(transfer).then((files) => attachAndPlace(files, at, false));
    };
    board.addEventListener("dragover", onDragOver);
    board.addEventListener("drop", onDrop);
    return () => {
      board.removeEventListener("dragover", onDragOver);
      board.removeEventListener("drop", onDrop);
    };
  }, [mode, commands, dropPoint, attachAndPlace, live]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an on-screen keyboard is the browser's: the card being typed in moves clear of it
  useEffect(() => {
    if (editing === null) return;
    const viewport = window.visualViewport;
    if (viewport === null) return;
    const reveal = () => {
      const node = live.layout.byId.get(editing.id);
      const top = boardRef.current?.getBoundingClientRect().top ?? 0;
      if (node !== undefined) view.reveal(node, viewport.height - top);
    };
    viewport.addEventListener("resize", reveal);
    return () => viewport.removeEventListener("resize", reveal);
  }, [editing, view, live]);

  const run = useCallback(
    (command: CanvasBoardCommand) => {
      switch (command) {
        case "export-image":
          setDialog({ kind: "export" });
          return;
        case "convert-to-file": {
          const [only] = commands.selected;
          if (only?.type === "text") void commands.convertToFile(only.id);
          return;
        }
        case "select-all":
          commands.selectAll();
          return;
        case "zoom-to-fit":
          view.fit();
          return;
        case "zoom-to-selection":
          commands.zoomToSelection();
          return;
        case "undo":
          live.canvasDocument?.undo();
          return;
        case "redo":
          live.canvasDocument?.redo();
          return;
        case "add-card":
          commands.addTextAt(null);
          return;
        case "add-note":
          void commands.addFile("note", null);
          return;
        case "add-media":
          void commands.addFile("media", null);
          return;
        case "add-web-page":
          void commands.addWebPage(null);
          return;
        case "create-group":
          commands.createGroup(null);
          return;
        case "bring-forward":
          commands.order("forward");
          return;
        case "send-backward":
          commands.order("backward");
          return;
        case "bring-to-front":
          commands.order("front");
          return;
        case "send-to-back":
          commands.order("back");
          return;
        case "help":
          setDialog({ kind: "help" });
          return;
      }
    },
    [commands, view, live],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusCard: (id) => {
        const node = live.layout.byId.get(id);
        if (node !== undefined) view.focus(node);
      },
      selectCard: (id) => {
        const node = live.layout.byId.get(id);
        const arrow = live.layout.shapes.find((shape) => shape.edge.id === id);
        const ink = live.layout.inks.find((shape) => shape.ink.id === id);
        const rect = node ?? arrow?.bounds ?? ink?.bounds;
        if (rect === undefined) return;
        view.focus(rect);
        commands.select(
          node !== undefined
            ? { cards: new Set([id]), arrow: null }
            : arrow !== undefined
              ? { cards: new Set(), arrow: id }
              : { cards: new Set(), arrow: null, drawings: new Set([id]) },
        );
      },
      run,
    }),
    [view, commands, run, live],
  );

  const canToggleEdit = canvasDocument !== null && mode === "free" && onReadOnly !== undefined;
  const canPresent = onPresent !== undefined && steps.length > 0 && active === null;
  const canvasMenu = (): ReadonlyArray<CanvasMenuEntry> => {
    const groups = canvasGroups(data);
    return tidySeparators([
      ...(canToggleEdit
        ? [
            readOnly
              ? { label: "Edit board", hint: "E", run: () => onReadOnly?.(false) }
              : { label: "Read-only", hint: "E", run: () => onReadOnly?.(true) },
          ]
        : []),
      ...(canPresent ? [{ label: "Present", hint: "P", run: () => onPresent?.() }] : []),
      ...(groups.length > 0
        ? [
            {
              label: "Jump to section",
              items: groups.map((group) => ({
                label: group.label,
                run: () => {
                  const node = live.layout.byId.get(group.id);
                  if (node !== undefined) view.focus(node);
                },
              })),
            },
          ]
        : []),
      "separator",
      ...(menuItems ?? []),
      ...(host.renderExportDialog === undefined
        ? []
        : [{ label: "Export image…", run: () => run("export-image") }]),
      ...(host.touch === true
        ? []
        : [{ label: "Keys and help", hint: "?", run: () => run("help") }]),
      "separator",
      ...(onSettings !== undefined && editable
        ? [
            {
              label: "Snap to grid",
              checked: settings.snapToGrid,
              run: () => onSettings({ snapToGrid: !settings.snapToGrid }),
            },
            {
              label: "Snap to objects",
              checked: settings.snapToObjects,
              run: () => onSettings({ snapToObjects: !settings.snapToObjects }),
            },
          ]
        : []),
    ]);
  };
  const toggleCanvasMenu = () => {
    if (menu?.label === "Canvas menu") {
      setMenu(null);
      return;
    }
    const frame = boardRef.current?.getBoundingClientRect();
    // The chip the button sits in, which is what the menu keeps its distance from.
    const chip = menuButtonRef.current?.parentElement?.getBoundingClientRect();
    if (frame === undefined || chip === undefined) return;
    setMenu({
      label: "Canvas menu",
      items: canvasMenu(),
      x: chip.right - frame.left,
      y: chip.bottom - frame.top + MENU_GAP,
      alignEnd: true,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingTyping(event.target)) return;
    if ((event.target as Element).closest(".cv-chrome") !== null) return;
    const mod = event.metaKey || event.ctrlKey;
    const plain = !mod && !event.altKey && !event.shiftKey;
    const key = event.key;
    const canEdit = live.editable;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[key as keyof typeof arrows];
    const anything =
      selection.cards.size > 0 || selection.arrow !== null || drawingsSelected.size > 0;
    if (key === " ") {
      if (!event.repeat) {
        live.update({ spaceHeld: true, spaceUsed: false });
        boardRef.current?.classList.add("cv-panning");
      }
    } else if (arrow !== undefined) {
      const [dx = 0, dy = 0] = arrow;
      if (event.altKey) commands.selectToward(dx, dy);
      else if (mod && canEdit) commands.grow(dx, dy, event.shiftKey);
      else if ((selection.cards.size > 0 || drawingsSelected.size > 0) && canEdit) {
        commands.nudge(dx, dy, event.shiftKey);
      }
      // A story being presented is stepped by its host.
      else if (active !== null) return;
      else view.pan(-dx * PAN_STEP, -dy * PAN_STEP);
    } else if (mod && (event.code === "BracketRight" || event.code === "BracketLeft")) {
      if (!canEdit || !anything) return;
      const up = event.code === "BracketRight";
      commands.order(event.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
    } else if (mod && key.toLowerCase() === "a") {
      commands.selectAll();
    } else if (mod && key.toLowerCase() === "z" && canEdit) {
      if (event.shiftKey) canvasDocument?.redo();
      else canvasDocument?.undo();
    } else if (mod && key.toLowerCase() === "y" && canEdit) {
      canvasDocument?.redo();
    } else if ((key === "Backspace" || key === "Delete") && canEdit && anything) {
      commands.remove();
    } else if (key === "Enter" && canEdit && anything) {
      commands.editSelected();
    } else if (key === "+" || key === "=") {
      view.zoomBy(ZOOM_STEP);
    } else if (key === "-") {
      view.zoomBy(1 / ZOOM_STEP);
    } else if (event.code === "Digit1" && event.shiftKey) {
      view.fit();
    } else if (event.code === "Digit2" && event.shiftKey) {
      commands.zoomToSelection();
    } else if (event.code === "Digit0" && event.shiftKey) {
      view.resetZoom();
    } else if (plain && canEdit && CANVAS_TOOL_KEYS[key.toLowerCase()] !== undefined) {
      setTool(CANVAS_TOOL_KEYS[key.toLowerCase()]!);
    } else if (plain && key.toLowerCase() === "e" && canToggleEdit) {
      onReadOnly?.(!readOnly);
    } else if (plain && key.toLowerCase() === "p" && canPresent) {
      onPresent?.();
    } else if (key === "?" && !mod && host.touch !== true) {
      setDialog({ kind: "help" });
    } else if (key === "Escape" && tool !== "select") {
      setTool("select");
    } else if (key === "Escape" && anything) {
      commands.select(NO_SELECTION);
    } else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      const element =
        selection.cards.size > 0
          ? commands.element([...selection.cards][0] ?? "")
          : boardRef.current;
      const rect = element?.getBoundingClientRect();
      if (rect && element) openBoardMenu(rect.left + 8, rect.top + 8, element);
    } else if (!live.host.onLeaderKey?.(key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== " " || !live.spaceHeld) return;
    live.update({ spaceHeld: false });
    boardRef.current?.classList.remove("cv-panning");
    if (!live.spaceUsed) live.host.onLeaderKey?.(" ");
  };

  const onCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (editingTyping(event.target)) return;
    const copied = commands.clip();
    if (copied === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", copied.text);
    event.clipboardData.setData(CANVAS_CLIP_TYPE, serializeClip(copied.clip));
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (editingTyping(event.target) || !live.editable) return;
    event.preventDefault();
    const at = live.pointer ?? commands.centre;
    const clip = parseClip(event.clipboardData.getData(CANVAS_CLIP_TYPE));
    if (clip !== null) {
      commands.pasteClip(clip, at);
      return;
    }
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (images.length > 0) {
      void attachAndPlace(images, at, true);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text !== "") commands.pasteText(text, at);
  };

  const interactive =
    mode === "free"
      ? {
          tabIndex: 0,
          onPointerDown: (event: PointerEvent<HTMLDivElement>) => gestures.press(event.nativeEvent),
          onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            live.update({ pointer: view.toWorld(event.clientX, event.clientY) });
            gestures.move(event.nativeEvent);
          },
          onPointerUp: (event: PointerEvent<HTMLDivElement>) => gestures.release(event.nativeEvent),
          onPointerCancel: (event: PointerEvent<HTMLDivElement>) =>
            gestures.cancel(event.nativeEvent),
          onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
            if (!gestures.takeSwallowedClick()) return;
            event.preventDefault();
            event.stopPropagation();
          },
          onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
            if (canvasDocument === null) return;
            if ((event.target as Element).closest(".cv-chrome, [data-card-editor]") !== null) {
              return;
            }
            event.preventDefault();
            gestures.contextMenu();
            openBoardMenu(event.clientX, event.clientY, event.target as Element);
          },
          onKeyDown,
          onKeyUp,
          onBlur: (event: { readonly relatedTarget: EventTarget | null }) => {
            if (event.relatedTarget === null) {
              live.update({ spaceHeld: false });
              boardRef.current?.classList.remove("cv-panning");
            }
          },
          onCopy,
          onCut: (event: ReactClipboardEvent<HTMLDivElement>) => {
            if (editingTyping(event.target) || !live.editable) return;
            onCopy(event);
            commands.remove();
          },
          onPaste,
        }
      : {};

  const board = useCallback(() => boardRef.current, []);
  useRestoreFocus(board, menu !== null || dialog !== null || popover !== null);
  useRestoreFocus(
    board,
    selection.cards.size > 0 || selection.arrow !== null || selectedDrawings(selection).size > 0,
  );

  // What's selected can go in a commit from elsewhere: the toolbar goes with it.
  const drawingsSelected = selectedDrawings(selection);
  const inkIds = new Set(layout.inks.map((shape) => shape.ink.id));
  const gone =
    [...selection.cards].some((id) => !layout.byId.has(id)) ||
    [...drawingsSelected].some((id) => !inkIds.has(id)) ||
    (selection.arrow !== null && !layout.shapes.some((shape) => shape.edge.id === selection.arrow));
  if (gone) {
    const drawings = [...drawingsSelected].filter((id) => inkIds.has(id));
    setSelection({
      cards: new Set([...selection.cards].filter((id) => layout.byId.has(id))),
      arrow: null,
      ...(drawings.length === 0 ? {} : { drawings: new Set(drawings) }),
    });
  }

  const [lone] = selection.cards;
  const single = selection.cards.size === 1 ? layout.byId.get(lone ?? "") : undefined;
  const hasSelection =
    selection.cards.size > 0 || selection.arrow !== null || drawingsSelected.size > 0;
  const selectedEdge =
    selection.arrow === null
      ? undefined
      : layout.shapes.find((shape) => shape.edge.id === selection.arrow)?.edge;
  const showToolbar = mode === "free" && hasSelection && editing === null;
  const toolKind = TOOL_KINDS[tool];
  // With Select or Hand and nothing picked there's nothing to style: it waits as its button.
  const styleIdle = !hasSelection && toolKind === undefined;
  const styleShown = hasSelection
    ? canvasPenOfItems([
        ...[...selection.cards].flatMap((id) => layout.byId.get(id) ?? []),
        ...(selectedEdge === undefined ? [] : [selectedEdge]),
        ...layout.inks.flatMap((shape) => (drawingsSelected.has(shape.ink.id) ? shape.ink : [])),
      ])
    : canvasPenOfTool(toolKind ?? "card", styleSession.pen);
  const styleOpen = styleIdle
    ? stylePeek
    : (styleSession.open ?? !(host.touch === true || compact));
  const showStyle = editable && active === null;
  const toggleStyle = () => {
    if (styleOpen) {
      setStylePeek(false);
      if (!styleIdle) canvasStyleSession.set({ open: false });
    } else {
      setStylePeek(styleIdle);
      canvasStyleSession.set({ open: true });
    }
  };
  const setStyle = (patch: Partial<CanvasPen>) => {
    if (hasSelection) commands.setStyle(patch);
    else canvasStyleSession.set({ pen: { ...styleSession.pen, ...patch } });
  };
  const editedArrow =
    editing?.kind === "arrow"
      ? layout.shapes.find((shape) => shape.edge.id === editing.id)
      : undefined;
  const editedInk =
    editing?.kind === "drawing"
      ? layout.inks.find((shape) => shape.ink.id === editing.id)
      : undefined;
  const closeDialog = () => setDialog(null);
  const addStep =
    canvasDocument === null || onStepAdded === undefined
      ? undefined
      : () => {
          const pick = canvasStepPick(data, selection.cards);
          if (pick === null) return;
          const at = step === null ? steps.length : step + 1;
          const made = canvasDocument.mint();
          canvasDocument.commit(
            canvasStoryEdit(
              canvasDocument.document,
              { kind: "add-step", story, at, step: pick },
              () => made,
            ),
          );
          if ("around" in pick) {
            setSelection({ cards: new Set([made]), arrow: null });
            setEditing({ kind: "group", id: made });
          }
          onStepAdded(at);
        };
  // Presenting hands the camera to the story, as on a read-only board: only the pill stays.
  const addBar = barShown ? (
    <CanvasToolRow
      ref={topBarRef}
      tool={tool}
      onTool={(next) => {
        setTool(next);
        boardRef.current?.focus({ preventScroll: true });
      }}
      onStep={addStep}
      stepReady={selection.cards.size > 0}
      onDone={canToggleEdit ? () => onReadOnly?.(true) : undefined}
      shape={shapeKind}
      onShape={(next) => {
        setShapeKind(next);
        setTool("shape");
        boardRef.current?.focus({ preventScroll: true });
      }}
      files={host.listFiles !== undefined}
      toBoard={(clientX, clientY) => {
        const rect = boardRef.current?.getBoundingClientRect();
        const inside =
          rect !== undefined &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom;
        return inside ? view.toWorld(clientX, clientY) : null;
      }}
      onAdd={(kind, at) => void commands.addFile(kind, at)}
      history={{
        canUndo: documentState?.canUndo === true,
        canRedo: documentState?.canRedo === true,
        undo: () => canvasDocument.undo(),
        redo: () => canvasDocument.redo(),
      }}
      zoom={{
        zoomIn: () => view.zoomIn(),
        zoomOut: () => view.zoomOut(),
        fit: () => view.fit(),
        level: zoomLevel,
        percent: () => `${Math.round(view.camera.zoom * 100)}%`,
      }}
      moreOpen={menu?.label === MORE_MENU}
      onMore={(button, items) => {
        if (menu?.label === MORE_MENU) {
          setMenu(null);
          return;
        }
        const frame = boardRef.current?.getBoundingClientRect();
        const bar = button.closest(".cv-tools")?.getBoundingClientRect();
        if (frame === undefined || bar === undefined) return;
        setMenu({
          label: MORE_MENU,
          items,
          x: button.getBoundingClientRect().right - frame.left,
          y: bar.bottom - frame.top + MENU_GAP,
          alignEnd: true,
          onClose: () => button.focus({ preventScroll: true }),
        });
      }}
    >
      {host.touch === true && tool === "select" ? (
        <CanvasToolbarButton
          label="Select several"
          pressed={selecting}
          onClick={() => setSelecting((on) => !on)}
        >
          Several
        </CanvasToolbarButton>
      ) : null}
    </CanvasToolRow>
  ) : null;

  return (
    <div
      ref={boardRef}
      className="cv-board"
      data-mode={mode}
      data-simple={shown.simple || undefined}
      data-editable={editable || undefined}
      data-takes-documents={(editable && mode === "free") || undefined}
      data-card-names={settings.cardNames}
      data-walkable={steps.length > 0 || undefined}
      data-walking={active !== null || undefined}
      data-touch={host.touch === true || undefined}
      data-tool={editable && tool !== "select" ? tool : undefined}
      // A board inline in a scrolling page keeps its zoom out of the way until it's pointed at.
      data-zoom-hover={(wheelOnceFocused && host.touch !== true) || undefined}
      data-peeking={peeked !== null || undefined}
      role="group"
      aria-label={label}
      {...interactive}
    >
      <Board.Provider value={context}>
        <div ref={worldRef} className="cv-world">
          {shown.groups.map((node) => (
            <GroupNode
              key={node.id}
              node={node}
              selected={selection.cards.has(node.id)}
              alone={single === node}
              mark={marks.cards[node.id]}
              flash={flash?.cards.has(node.id) ? flash.revision : undefined}
              editing={editing?.kind === "group" && editing.id === node.id}
              editable={editable}
              onLabel={finishGroupLabel}
              lit={
                shines?.groups.includes(node.id)
                  ? true
                  : active !== null || (shines?.groups.length ?? 0) > 0
                    ? false
                    : undefined
              }
              steps={chips.byGroup.get(node.id)}
            />
          ))}
          {steps.map((each, index) =>
            each.heading === undefined ? null : (
              <StepHeading
                // oxlint-disable-next-line react/no-array-index-key -- a step is its place in the story; headings hold no state
                key={index}
                heading={each.heading}
                lit={shines === null ? undefined : index === current}
                chip={chips.all[index]!}
              />
            ),
          )}
          {shown.layers.map((layer) => {
            if (layer.kind === "card") {
              const { node } = layer;
              return (
                <CardNode
                  key={`card:${node.id}`}
                  node={node}
                  selected={selection.cards.has(node.id)}
                  alone={single === node}
                  simple={shown.simple}
                  mark={marks.cards[node.id]}
                  flash={flash?.cards.has(node.id) ? flash.revision : undefined}
                  editing={
                    (editing?.kind === "card" || editing?.kind === "note") && editing.id === node.id
                  }
                  editable={editable}
                  lit={shines === null ? undefined : shines.cards.has(node.id)}
                  focus={shines !== null && shines.groups.length === 0 && shines.cards.has(node.id)}
                  steps={chips.byCard.get(node.id)}
                  from={dockedLabel(active, node.id)}
                />
              );
            }
            if (layer.kind === "arrow") {
              const { shape } = layer;
              const { edge, labelAt } = shape;
              const lit = shines === null ? undefined : shines.arrows.has(edge.id);
              return (
                <Fragment key={`arrow:${edge.id}`}>
                  <EdgeNode
                    shape={shape}
                    selected={edge.id === selection.arrow}
                    mark={marks.arrows[edge.id]}
                    lit={lit}
                  />
                  {edge.label === undefined || editedArrow?.edge.id === edge.id ? null : (
                    <EdgeLabel edge={edge} at={labelAt} lit={lit} />
                  )}
                </Fragment>
              );
            }
            const { shape } = layer;
            const { ink, labelAt } = shape;
            // A step holds cards, never drawings: they dim with what it leaves out.
            const lit = shines === null ? undefined : false;
            return (
              <Fragment key={`drawing:${ink.id}`}>
                <InkNode
                  shape={shape}
                  selected={drawingsSelected.has(ink.id)}
                  mark={marks.drawings?.[ink.id]}
                  lit={lit}
                />
                {ink.type !== "arrow" ||
                ink.label === undefined ||
                editedInk?.ink.id === ink.id ? null : (
                  <span
                    className="cv-edge-label"
                    data-drawing-label={ink.id}
                    data-lit={lit}
                    style={{ left: labelAt.x, top: labelAt.y }}
                  >
                    {ink.label}
                  </span>
                )}
              </Fragment>
            );
          })}
          {/* What's being drawn and edited, and the selected card's frame, sit above it all. */}
          <svg className="cv-edges cv-drafts" aria-hidden="true" width="1" height="1" />
          {editedArrow === undefined ? null : (
            <EdgeLabelEditor
              label={editedArrow.edge.label}
              at={editedArrow.labelAt}
              onDone={(text) => finishArrowLabel(editedArrow.edge.id, text)}
            />
          )}
          {editedInk?.ink.type === "arrow" ? (
            <EdgeLabelEditor
              label={editedInk.ink.label}
              at={editedInk.labelAt}
              onDone={(text) => finishInkLabel(editedInk.ink.id, text)}
            />
          ) : null}
          {editable && single !== undefined && single.type !== "group" && editing === null ? (
            <SelectionFrame node={single} />
          ) : null}
        </div>
      </Board.Provider>
      <canvas ref={overviewRef} className="cv-overview" hidden={shown !== OVERVIEW} />
      {editable && data.nodes.length === 0 ? <CanvasEmptyHint /> : null}
      {showToolbar ? (
        <SelectionToolbar
          ref={toolbarRef}
          commands={commands}
          editable={editable}
          single={single}
          edge={selectedEdge}
          count={selection.cards.size}
          drawings={commands.selectedDrawings}
          popover={popover}
          setPopover={setPopover}
          onStep={addStep}
        />
      ) : null}
      {addBar}
      {showStyle ? (
        <CanvasStylePanel
          ref={styleRef}
          open={styleOpen}
          onToggle={toggleStyle}
          shown={styleShown}
          onChange={setStyle}
          onOrder={hasSelection ? (move) => commands.order(move) : undefined}
          compact={compact}
        />
      ) : null}
      {mode === "free" ? (
        <>
          <div className="cv-chrome cv-menu-button">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Canvas menu"
              {...tipProps(["Canvas menu"])}
              aria-haspopup="menu"
              aria-expanded={menu?.label === "Canvas menu"}
              onClick={toggleCanvasMenu}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
              </svg>
            </button>
          </div>
          {addBar === null ? (
            <div className="cv-chrome cv-zoom" role="toolbar" aria-label="Zoom">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => view.zoomOut()}
                {...tipProps(["Zoom out", "−"])}
              >
                −
              </button>
              <button
                type="button"
                className="cv-zoom-level"
                aria-label="Fit the board in view"
                onClick={() => view.fit()}
                {...tipProps(["Fit the board", "⇧1"])}
              >
                <span ref={zoomLevel} />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => view.zoomIn()}
                {...tipProps(["Zoom in", "+"])}
              >
                +
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <CanvasTips board={tipBoard} />
      {children === undefined || children === null ? null : (
        <div
          ref={overlayRef}
          className="cv-chrome cv-overlay"
          // Its popups portal out, though their events still bubble here through React.
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      )}
      {notice === null ? null : (
        <div className="cv-chrome cv-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              canvasDocument?.dismissNotice();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {menu === null ? null : (
        <CanvasMenu
          label={menu.label}
          items={menu.items}
          x={menu.x}
          y={menu.y}
          alignEnd={menu.alignEnd === true}
          onClose={() => {
            menu.onClose?.();
            setMenu(null);
          }}
        />
      )}
      {dialog?.kind === "prompt" ? (
        <CanvasPrompt
          request={dialog.request}
          onDone={(value) => {
            dialog.done(value);
            closeDialog();
          }}
        />
      ) : null}
      {dialog?.kind === "picker" ? (
        <CanvasPicker
          request={dialog.request}
          onDone={(picked) => {
            dialog.done(picked);
            closeDialog();
          }}
        />
      ) : null}
      {dialog?.kind === "help" ? <CanvasHelp onClose={closeDialog} /> : null}
      {dialog?.kind === "export"
        ? host.renderExportDialog?.({
            data,
            viewport: view.window(),
            name: label,
            onClose: closeDialog,
          })
        : null}
    </div>
  );
}

function SelectionToolbar({
  ref,
  commands,
  editable,
  single,
  edge,
  count,
  drawings,
  popover,
  setPopover,
  onStep,
}: {
  readonly ref: Ref<HTMLDivElement>;
  readonly commands: CanvasCommands;
  readonly editable: boolean;
  readonly single: CanvasNode | undefined;
  readonly edge: CanvasEdge | undefined;
  readonly count: number;
  /** The strokes and drawn arrows selected with the cards. */
  readonly drawings: ReadonlyArray<CanvasInk>;
  readonly popover: ToolbarPopover;
  readonly setPopover: (popover: ToolbarPopover) => void;
  readonly onStep: (() => void) | undefined;
}) {
  const toggle = (next: ToolbarPopover) => setPopover(popover === next ? null : next);
  const zoom = (
    <CanvasToolbarButton label="Zoom to selection" onClick={() => commands.zoomToSelection()}>
      Zoom
    </CanvasToolbarButton>
  );
  if (!editable) {
    return (
      <div ref={ref} className="cv-chrome cv-toolbar" role="toolbar" aria-label="Selection">
        {zoom}
      </div>
    );
  }
  const [drawn, another] = drawings;
  const inkArrow = count === 0 && another === undefined && drawn?.type === "arrow";
  const group = single?.type === "group" ? single : undefined;
  const editsText =
    single?.type === "text" || (single?.type === "file" && canvasFileKind(single.file) === "note");
  const closeThen = (run: () => void) => () => {
    setPopover(null);
    run();
  };
  return (
    <div ref={ref} className="cv-chrome cv-toolbar" role="toolbar" aria-label="Selection">
      <CanvasToolbarButton label="Remove" onClick={() => commands.remove()} />
      {zoom}
      {onStep === undefined || edge !== undefined || count === 0 ? null : (
        <CanvasToolbarButton label="Add as a step" onClick={closeThen(onStep)}>
          Step
        </CanvasToolbarButton>
      )}
      {editsText ? (
        <CanvasToolbarButton label="Edit" onClick={() => commands.editSelected()} />
      ) : null}
      {inkArrow ? (
        <CanvasToolbarButton label="Edit label" onClick={() => commands.editSelected()} />
      ) : null}
      {count > 1 ? (
        <CanvasToolbarButton
          label="Create section"
          onClick={() => {
            setPopover(null);
            commands.createGroup({ x: 0, y: 0 });
          }}
        >
          Section
        </CanvasToolbarButton>
      ) : null}
      {count > 1 || group !== undefined ? (
        <CanvasToolbarButton
          label="Align"
          pressed={popover === "align"}
          onClick={() => toggle("align")}
        />
      ) : null}
      {edge !== undefined ? (
        <>
          <CanvasToolbarButton
            label="Line direction"
            pressed={popover === "direction"}
            onClick={() => toggle("direction")}
          >
            Direction
          </CanvasToolbarButton>
          <CanvasToolbarButton label="Edit label" onClick={() => commands.editSelected()} />
        </>
      ) : null}
      {group !== undefined ? (
        <>
          <CanvasToolbarButton label="Edit label" onClick={() => commands.editSelected()} />
          <CanvasToolbarButton
            label={group.background === undefined ? "Set background" : "Edit background"}
            pressed={popover === "background"}
            onClick={() =>
              group.background === undefined
                ? void commands.setBackground(group)
                : toggle("background")
            }
          />
        </>
      ) : null}
      {popover === "align" ? (
        <div className="cv-toolbar-list" role="menu" aria-label="Align">
          {arrangementEntries((kind) => commands.arrange(kind)).map((entry) =>
            entry === "separator" ? null : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  entry.run?.();
                  setPopover(null);
                }}
              >
                {entry.label}
              </button>
            ),
          )}
        </div>
      ) : null}
      {popover === "direction" && edge !== undefined ? (
        <div className="cv-toolbar-list" role="menu" aria-label="Line direction">
          {(
            [
              ["none", "Nondirectional"],
              ["end", "Unidirectional"],
              ["both", "Bidirectional"],
            ] as const
          ).map(([direction, name]) => (
            <button
              key={direction}
              type="button"
              role="menuitemradio"
              aria-checked={lineDirectionOf(edge) === direction}
              onClick={closeThen(() => commands.setLineDirection(edge.id, direction))}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {popover === "background" && group !== undefined ? (
        <div className="cv-toolbar-list" role="menu" aria-label="Background">
          {(
            [
              ["cover", "Cover"],
              ["ratio", "Keep aspect ratio"],
              ["repeat", "Repeat"],
            ] as const
          ).map(([style, name]) => (
            <button
              key={style}
              type="button"
              role="menuitemradio"
              aria-checked={(group.backgroundStyle ?? "cover") === style}
              onClick={closeThen(() => void commands.setBackgroundStyle(group, style))}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={closeThen(() => void commands.setBackground(group))}
          >
            Change image…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={closeThen(() => commands.removeBackground(group))}
          >
            Remove background
          </button>
        </div>
      ) : null}
    </div>
  );
}
