import "@mercurian/editor/markdown/katex.css";
import "./canvasBoard.css";

import {
  canvasBounds,
  canvasChangedCards,
  CANVAS_MARK_LABELS,
  parseCanvas,
  type CanvasBounds,
  type CanvasCodeReference,
  type CanvasData,
  type CanvasEdge,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasLinkNode,
  type CanvasMark,
  type CanvasMarks,
  type CanvasNode,
  type CanvasSide,
  type CanvasStep,
  canvasStepData,
  canvasSteps,
} from "@mercurian/wiki/canvas";
import { pastedFileName } from "@mercurian/wiki/placement";
import {
  createContext,
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
  CanvasBottomBar,
  CanvasColorPicker,
  CanvasEmptyHint,
  CanvasHelp,
  CanvasMenu,
  CanvasPicker,
  CanvasPrompt,
  CanvasToolbarButton,
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
  type CanvasLooseEnd,
  type CanvasSelection,
} from "./canvasGestures";
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
import { drawCanvasOverview } from "./canvasOverview";
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
  | "help";

/** What a board's page drives from outside, such as Jump to group. */
export interface CanvasBoardHandle {
  readonly focusCard: (id: string) => void;
  /** Brings a card or arrow into view and selects it, above whatever covers it. */
  readonly selectCard: (id: string) => void;
  readonly run: (command: CanvasBoardCommand) => void;
}

const FIT_PADDING = { fit: 8, free: 32 };
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

const CardNode = memo(function CardNode({
  node,
  selected,
  alone,
  simple,
  mark,
  flash,
  editing,
  editable,
  raised,
  lit,
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
  /** Where a click left it among the cards it overlaps, for this session. */
  readonly raised: number | undefined;
  /** Whether the step being walked shows it; unset outside a walk. */
  readonly lit: boolean | undefined;
  /** Shown beside the step's frame, away from its place: the step it belongs to, from 1. */
  readonly from: string | undefined;
}) {
  const { mode } = useBoard();
  const { style, ...color } = colorProps(node.color);
  const live = mode === "fit" || selected;
  const noteFile =
    editing && node.type === "file" && canvasFileKind(node.file) === "note" ? node.file : null;
  return (
    <article
      className="cv-card"
      data-kind={node.type}
      data-card-id={node.id}
      data-selected={selected || undefined}
      data-mark={mark}
      data-lit={lit}
      data-from={from}
      data-editing={editing || undefined}
      style={{ ...position(node), ...style, ...(raised === undefined ? {} : { zIndex: raised }) }}
      {...color}
    >
      {node.type === "file" ? <FileCardLabel node={node} /> : null}
      <MarkBadge mark={mark} />
      <Flash revision={flash} />
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
      {editable && !editing ? <Dots /> : null}
      {editable && alone && !editing ? <Handles /> : null}
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
      aria-label="Group label"
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
  /** The story's steps this group is, numbered on its label. */
  readonly steps: ReadonlyArray<StepChipProps> | undefined;
}) {
  const { host } = useBoard();
  const { style, ...color } = colorProps(node.color);
  // Smaller above larger, and all beneath the cards: their order on the page says so.
  return (
    <div
      className="cv-group"
      data-card-id={node.id}
      data-selected={selected || undefined}
      data-mark={mark}
      data-lit={lit}
      style={{ ...position(node), ...style }}
      {...color}
    >
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

const CORNERS = ["nw", "ne", "se", "sw"] as const;

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

/** Every step's number, and those of the steps that are groups by their group. */
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
  steps.forEach((each, index) => {
    const chip = all[index];
    if (each.group === undefined || each.heading !== undefined || chip === undefined) return;
    byGroup.set(each.group, [...(byGroup.get(each.group) ?? []), chip]);
  });
  return { all, byGroup };
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

/**
 * A story's step on the board that no group is: a viewfinder over its cards, which a walk moves
 * to. Its number sits on the bottom-right corner, away from the top-left where groups are named.
 */
function StoryFrame({
  frame,
  lit,
  chip,
}: {
  readonly frame: CanvasBounds;
  readonly lit: boolean | undefined;
  readonly chip: StepChipProps;
}) {
  return (
    <div className="cv-group cv-story-frame" data-lit={lit} style={position(frame)}>
      {CORNERS.map((corner) => (
        <span key={corner} className="cv-frame-corner" data-corner={corner} />
      ))}
      <StepChip {...chip} />
    </div>
  );
}

/** Screen pixels apart, under which two frames' numbers would cover each other. */
const CHIP_NEAR = 26;

/**
 * Sets each frame's number beside any other already on the same corner, as the reader sees them:
 * frames far apart on the board can share a corner once it's zoomed out.
 */
function stackChips(world: HTMLElement, frames: ReadonlyArray<CanvasBounds>, zoom: number) {
  const placed: Array<{ readonly x: number; readonly y: number }> = [];
  const elements = world.querySelectorAll<HTMLElement>(":scope > .cv-story-frame");
  frames.forEach((frame, index) => {
    const corner = { x: (frame.x + frame.width) * zoom, y: (frame.y + frame.height) * zoom };
    const stack = placed.filter(
      (each) => Math.abs(each.x - corner.x) < CHIP_NEAR && Math.abs(each.y - corner.y) < CHIP_NEAR,
    ).length;
    placed.push(corner);
    const element = elements[index];
    if (element !== undefined && element.dataset.stack !== String(stack)) {
      element.dataset.stack = String(stack);
      element.style.setProperty("--cv-stack", String(stack));
    }
  });
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
  const { style, ...color } = colorProps(edge.color);
  return (
    <g
      className="cv-edge"
      data-edge-id={edge.id}
      data-selected={selected || undefined}
      data-mark={mark}
      data-lit={lit}
      style={style}
      {...color}
    >
      <path className="cv-edge-line" d={path} />
      <path className="cv-edge-hit" d={path} />
      {heads.map((head) => (
        <path key={head} className="cv-edge-head" d={head} />
      ))}
    </g>
  );
});

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
  edge,
  at,
  onDone,
}: {
  readonly edge: CanvasEdge;
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
      defaultValue={edge.label ?? ""}
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

interface Layout {
  /** Largest first, so each draws above those it sits in. */
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<Exclude<CanvasNode, CanvasGroupNode>>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
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
  const area = (node: CanvasNode) => node.width * node.height;
  const nodes = data.nodes.map((node) => {
    const before = previous?.byId.get(node.id);
    return before !== undefined && sameFields(before, node) ? before : node;
  });
  const shapesBefore = new Map(previous?.shapes.map((shape) => [shape.edge.id, shape]));
  return {
    groups: nodes
      .filter((node): node is CanvasGroupNode => node.type === "group")
      .sort((a, b) => area(b) - area(a)),
    cards: nodes.filter(
      (node): node is Exclude<CanvasNode, CanvasGroupNode> => node.type !== "group",
    ),
    shapes: canvasEdgeShapes(data).map((shape) => {
      const before = shapesBefore.get(shape.edge.id);
      return before !== undefined &&
        before.path === shape.path &&
        sameFields(before.edge, shape.edge) &&
        before.heads.join() === shape.heads.join()
        ? before
        : shape;
    }),
    byId: new Map(nodes.map((node) => [node.id, node])),
  };
}

interface Shown {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<Exclude<CanvasNode, CanvasGroupNode>>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
  readonly simple: boolean;
}

/** Where a card a step brought in comes from; empty when it's only elsewhere on the board. */
const dockedLabel = (step: CanvasStep | null, id: string) => {
  const docked = step?.docked.get(id);
  if (docked === undefined) return undefined;
  if (docked.from !== undefined) return `From step ${docked.from + 1}`;
  return docked.group === undefined ? "" : `From ${docked.group}`;
};

const NOTHING: Shown = { groups: [], cards: [], shapes: [], simple: false };
const NO_MARKS: CanvasMarks = { cards: {}, arrows: {} };
/** As long as `.cv-flash` plays, and a little over. */
const FLASH_MS = 1400;

interface Flashed {
  readonly revision: string;
  readonly cards: ReadonlySet<string>;
}
const OVERVIEW: Shown = { ...NOTHING, simple: true };

function inView(layout: Layout, view: CanvasBounds, simple: boolean): Shown {
  return {
    groups: layout.groups.filter((node) => overlaps(node, view)),
    cards: layout.cards.filter((node) => overlaps(node, view)),
    shapes: layout.shapes.filter((shape) => overlaps(shape.bounds, view)),
    simple,
  };
}

const sameItems = <A,>(a: ReadonlyArray<A>, b: ReadonlyArray<A>) =>
  a.length === b.length && a.every((item, position) => item === b[position]);

const sameShown = (a: Shown, b: Shown) =>
  a.simple === b.simple &&
  sameItems(a.cards, b.cards) &&
  sameItems(a.groups, b.groups) &&
  sameItems(a.shapes, b.shapes);

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
  revision: string | undefined = undefined;
  editing: CanvasEditing | null = null;
  openMenu: OpenMenu | null = null;
  readAt: string | undefined = undefined;
  walkable = false;
  frames: ReadonlyArray<CanvasBounds> = [];
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
  /** Runs when it closes, whatever was chosen. */
  readonly onClose?: () => void;
}

type ToolbarPopover = "color" | "align" | "direction" | "background" | null;

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
  /** The host's controls, floating over the board's foot; what fits stays clear of them. */
  readonly children?: ReactNode;
  readonly ref?: Ref<CanvasBoardHandle>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const documentState: CanvasDocumentState | null = useSyncExternalStore(
    canvasDocument?.subscribe ?? NO_SUBSCRIPTION,
    canvasDocument?.getState ?? NO_DOCUMENT_STATE,
  );
  const data = documentState?.data ?? dataProp;
  const editable = canvasDocument !== null && !readOnly && mode === "free";
  const [view] = useState(() => new CanvasView());
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
  const bounds = active?.bounds ?? whole;
  // A step moves the cards it recalls beside its frame; an edited board always shows where they are.
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
  const [raised, setRaised] = useState<ReadonlyMap<string, number>>(new Map());
  const [selecting, setSelecting] = useState(false);
  const [localNotice, setNotice] = useState<string | null>(null);
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
    const rects = arrow === undefined ? nodes : [arrow.bounds];
    if (rects.length === 0) return;
    const top = Math.min(...rects.map((rect) => rect.y));
    const left = Math.min(...rects.map((rect) => rect.x));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const { x, y } = view.toFrame({ x: (left + right) / 2, y: top });
    const frame = boardRef.current;
    const half = toolbar.offsetWidth / 2;
    const clampedX = Math.max(half + 4, Math.min(x, (frame?.clientWidth ?? 0) - half - 4));
    const clampedY = Math.max(toolbar.offsetHeight + 8, y - 12);
    toolbar.style.transform = `translate(${clampedX}px, ${clampedY}px) translate(-50%, -100%)`;
  }, [view, live]);

  const [show] = useState(() => (camera: CanvasCamera, width: number, height: number) => {
    // A walk's camera moves are animated: what's about to come into view must already be there.
    const window = live.walkable ? live.whole : cameraWindow(camera, width, height, CULL_MARGIN);
    const next = inView(live.layout, window, camera.zoom < live.settings.simpleZoom);
    const overview = next.simple && next.cards.length > OVERVIEW_CARDS;
    if (overview && overviewRef.current !== null) {
      drawCanvasOverview(overviewRef.current, camera, width, height, next, live.marks);
    }
    const mounted = overview ? OVERVIEW : next;
    setShown((now) => (sameShown(now, mounted) ? now : mounted));
    live.onCamera?.(view.fitted ? null : camera);
    placeToolbar();
    if (worldRef.current !== null) stackChips(worldRef.current, live.frames, camera.zoom);
    if (next.simple) return;
    reads.files.want(
      next.cards.flatMap((card) =>
        card.type === "file" && live.marks.cards[card.id] !== "removed" ? [card.file] : [],
      ),
    );
    reads.code.want(
      next.cards.flatMap((card) => {
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
        selection: () => live.selection,
        select: commands.select,
        raise: (id) =>
          setRaised((now) => {
            if (now.size > 0 && [...now.keys()].at(-1) === id) return now;
            const next = new Map(now);
            next.delete(id);
            next.set(id, next.size + 2);
            return next;
          }),
        document: () => (live.editable ? live.canvasDocument : null),
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
        addTextAt: (point) => commands.addTextAt(point),
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
      frames: steps.flatMap((each) =>
        each.group === undefined && each.heading === undefined ? [each.frame] : [],
      ),
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
    return board === null || overlay === null ? 0 : board.clientHeight - overlay.offsetTop;
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a free board's camera is the reader's: only a change of step moves it, outside React
  useLayoutEffect(() => {
    if (mode !== "free" || live.walkedTo === activeFrame) return;
    live.update({ walkedTo: activeFrame });
    view.setInset(overlayInset(), false);
    view.fit(true);
  }, [activeFrame, mode, view, live, overlayInset]);

  const overlaid = children !== undefined && children !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the host's controls are laid out by the browser and change size as a story is walked
  useLayoutEffect(() => {
    const measure = () => view.setInset(overlayInset());
    measure();
    if (!overlaid) return;
    const observer = new ResizeObserver(measure);
    for (const each of [overlayRef.current, boardRef.current]) if (each) observer.observe(each);
    return () => observer.disconnect();
  }, [view, overlaid, overlayInset]);

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
        const rect = node ?? arrow?.bounds;
        if (rect === undefined) return;
        view.focus(rect);
        commands.select(
          node !== undefined
            ? { cards: new Set([id]), arrow: null }
            : { cards: new Set(), arrow: id },
        );
      },
      run,
    }),
    [view, commands, run, live],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingTyping(event.target)) return;
    if ((event.target as Element).closest(".cv-chrome") !== null) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const canEdit = live.editable;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[key as keyof typeof arrows];
    const anything = selection.cards.size > 0 || selection.arrow !== null;
    if (key === " ") {
      if (!event.repeat) {
        live.update({ spaceHeld: true, spaceUsed: false });
        boardRef.current?.classList.add("cv-panning");
      }
    } else if (arrow !== undefined) {
      const [dx = 0, dy = 0] = arrow;
      if (event.altKey) commands.selectToward(dx, dy);
      else if (mod && canEdit) commands.grow(dx, dy, event.shiftKey);
      else if (selection.cards.size > 0 && canEdit) commands.nudge(dx, dy, event.shiftKey);
      else view.pan(-dx * PAN_STEP, -dy * PAN_STEP);
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
  useRestoreFocus(board, selection.cards.size > 0 || selection.arrow !== null);

  // What's selected can go in a commit from elsewhere: the toolbar goes with it.
  const gone =
    [...selection.cards].some((id) => !layout.byId.has(id)) ||
    (selection.arrow !== null && !layout.shapes.some((shape) => shape.edge.id === selection.arrow));
  if (gone) {
    setSelection({
      cards: new Set([...selection.cards].filter((id) => layout.byId.has(id))),
      arrow: null,
    });
  }

  const [lone] = selection.cards;
  const single = selection.cards.size === 1 ? layout.byId.get(lone ?? "") : undefined;
  const hasSelection = selection.cards.size > 0 || selection.arrow !== null;
  const showToolbar = mode === "free" && hasSelection && editing === null;
  const selectedEdge =
    selection.arrow === null
      ? undefined
      : layout.shapes.find((shape) => shape.edge.id === selection.arrow)?.edge;
  const editedArrow =
    editing?.kind === "arrow"
      ? layout.shapes.find((shape) => shape.edge.id === editing.id)
      : undefined;
  const closeDialog = () => setDialog(null);

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
                shines?.group === node.id
                  ? true
                  : active !== null || shines?.group !== undefined
                    ? false
                    : undefined
              }
              steps={chips.byGroup.get(node.id)}
            />
          ))}
          {steps.map((each, index) => {
            const lit = shines === null ? undefined : index === current;
            const chip = chips.all[index]!;
            if (each.heading !== undefined) {
              // oxlint-disable-next-line react/no-array-index-key -- a step is its place in the story; headings hold no state
              return <StepHeading key={index} heading={each.heading} lit={lit} chip={chip} />;
            }
            if (each.group !== undefined) return null;
            // oxlint-disable-next-line react/no-array-index-key -- a step is its place in the story; frames hold no state
            return <StoryFrame key={index} frame={each.frame} lit={lit} chip={chip} />;
          })}
          <svg className="cv-edges" aria-hidden="true" width="1" height="1">
            {shown.shapes.map((shape) => (
              <EdgeNode
                key={shape.edge.id}
                shape={shape}
                selected={shape.edge.id === selection.arrow}
                mark={marks.arrows[shape.edge.id]}
                lit={shines === null ? undefined : shines.arrows.has(shape.edge.id)}
              />
            ))}
          </svg>
          {shown.shapes.flatMap(({ edge, labelAt }) =>
            edge.label === undefined || editedArrow?.edge.id === edge.id
              ? []
              : [
                  <EdgeLabel
                    key={edge.id}
                    edge={edge}
                    at={labelAt}
                    lit={shines === null ? undefined : shines.arrows.has(edge.id)}
                  />,
                ],
          )}
          {editedArrow === undefined ? null : (
            <EdgeLabelEditor
              edge={editedArrow.edge}
              at={editedArrow.labelAt}
              onDone={(text) => finishArrowLabel(editedArrow.edge.id, text)}
            />
          )}
          {shown.cards.map((node) => (
            <CardNode
              key={node.id}
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
              raised={raised.get(node.id)}
              lit={shines === null ? undefined : shines.cards.has(node.id)}
              from={dockedLabel(active, node.id)}
            />
          ))}
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
          popover={popover}
          setPopover={setPopover}
        />
      ) : null}
      {mode === "free" && canvasDocument !== null ? (
        editable ? (
          <CanvasBottomBar
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
            onAdd={(kind, at) => {
              if (kind === "text") commands.addTextAt(at);
              else void commands.addFile(kind, at);
            }}
          >
            {host.touch === true ? (
              <CanvasToolbarButton
                label="Select"
                pressed={selecting}
                onClick={() => setSelecting((on) => !on)}
              />
            ) : null}
          </CanvasBottomBar>
        ) : null
      ) : null}
      {mode === "free" ? (
        <div className="cv-chrome cv-controls">
          {canvasDocument === null ? null : readOnly ? (
            onReadOnly === undefined ? null : (
              <CanvasToolbarButton label="Disable read-only" onClick={() => onReadOnly(false)}>
                Edit
              </CanvasToolbarButton>
            )
          ) : (
            <CanvasToolbarButton
              label="Canvas settings"
              onClick={() => {
                const rect = boardRef.current?.getBoundingClientRect();
                setMenu({
                  label: "Canvas settings",
                  x: (rect?.width ?? 0) - 240,
                  y:
                    (boardRef.current?.querySelector(".cv-controls")?.getBoundingClientRect().top ??
                      12) - (rect?.top ?? 0),
                  items: [
                    {
                      label: "Snap to grid",
                      checked: settings.snapToGrid,
                      run: () => onSettings?.({ snapToGrid: !settings.snapToGrid }),
                    },
                    {
                      label: "Snap to objects",
                      checked: settings.snapToObjects,
                      run: () => onSettings?.({ snapToObjects: !settings.snapToObjects }),
                    },
                    { label: "Read-only", checked: false, run: () => onReadOnly?.(true) },
                    ...(host.renderExportDialog !== undefined
                      ? [
                          "separator" as const,
                          { label: "Export as image…", run: () => run("export-image") },
                        ]
                      : []),
                  ],
                });
              }}
            >
              ⚙
            </CanvasToolbarButton>
          )}
          <button type="button" aria-label="Zoom in" onClick={() => view.zoomIn()}>
            +
          </button>
          <button type="button" aria-label="Reset zoom" onClick={() => view.resetZoom()}>
            1:1
          </button>
          <button type="button" aria-label="Fit the board in view" onClick={() => view.fit()}>
            Fit
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => view.zoomOut()}>
            −
          </button>
          {canvasDocument === null ? null : (
            <>
              <CanvasToolbarButton
                label="Undo"
                disabled={!editable || documentState?.canUndo !== true}
                onClick={() => canvasDocument.undo()}
              >
                ↶
              </CanvasToolbarButton>
              <CanvasToolbarButton
                label="Redo"
                disabled={!editable || documentState?.canRedo !== true}
                onClick={() => canvasDocument.redo()}
              >
                ↷
              </CanvasToolbarButton>
              {host.touch === true ? null : (
                <CanvasToolbarButton label="Canvas help" onClick={() => run("help")}>
                  ?
                </CanvasToolbarButton>
              )}
            </>
          )}
        </div>
      ) : null}
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
  popover,
  setPopover,
}: {
  readonly ref: Ref<HTMLDivElement>;
  readonly commands: CanvasCommands;
  readonly editable: boolean;
  readonly single: CanvasNode | undefined;
  readonly edge: CanvasEdge | undefined;
  readonly count: number;
  readonly popover: ToolbarPopover;
  readonly setPopover: (popover: ToolbarPopover) => void;
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
  const color = edge?.color ?? single?.color;
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
      <CanvasToolbarButton
        label="Set color"
        pressed={popover === "color"}
        onClick={() => toggle("color")}
      >
        Color
      </CanvasToolbarButton>
      {zoom}
      {editsText ? (
        <CanvasToolbarButton label="Edit" onClick={() => commands.editSelected()} />
      ) : null}
      {count > 1 ? (
        <CanvasToolbarButton
          label="Create group"
          onClick={() => {
            setPopover(null);
            commands.createGroup({ x: 0, y: 0 });
          }}
        >
          Group
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
      {popover === "color" ? (
        <CanvasColorPicker
          value={color}
          onPick={(next) => {
            commands.setColor(next);
          }}
        />
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
