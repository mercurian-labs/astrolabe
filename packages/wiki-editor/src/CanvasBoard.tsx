import "@mercurian/editor/markdown/katex.css";
import "./canvasBoard.css";

import {
  canvasBounds,
  parseCanvas,
  type CanvasBounds,
  type CanvasCodeReference,
  type CanvasData,
  type CanvasEdge,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasLinkNode,
  type CanvasNode,
} from "@mercurian/wiki/canvas";
import {
  createContext,
  memo,
  use,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import {
  cameraWindow,
  canvasColor,
  canvasEdgeShapes,
  canvasFileKind,
  cardFileName,
  isOpenableUrl,
  overlaps,
  SIMPLE_ZOOM,
  ZOOM_STEP,
  type CanvasCamera,
  type CanvasEdgeShape,
} from "./canvasGeometry";
import { CanvasMarkdown, type CanvasMarkdownHost } from "./CanvasMarkdown";
import { CanvasMinimap } from "./CanvasMinimap";
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
  | { readonly kind: "image" | "pdf" | "audio" | "video"; readonly path: string }
  | { readonly kind: "background"; readonly path: string; readonly style: string | undefined };

/** An asset drawn at the address its host found for it. */
export function CanvasAssetView({
  asset,
  url,
}: {
  readonly asset: CanvasAsset;
  readonly url: string;
}) {
  switch (asset.kind) {
    case "image":
      return <img className="cv-asset-image" src={url} alt="" loading="lazy" decoding="async" />;
    case "audio":
      return <audio className="cv-asset-media" src={url} controls preload="metadata" />;
    case "video":
      return <video className="cv-asset-media" src={url} controls preload="metadata" />;
    case "pdf":
      return <iframe className="cv-asset-frame" src={url} title={asset.path} sandbox="" />;
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
export interface CanvasBoardHost extends Omit<CanvasMarkdownHost, "renderEmbed" | "renderImage"> {
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
}

/** What a board's page drives from outside, such as Jump to group. */
export interface CanvasBoardHandle {
  readonly focusCard: (id: string) => void;
}

const FIT_PADDING = { fit: 8, free: 32 };
const PAN_STEP = 60;
/** A left-edge touch belongs to the phone's back swipe, not the board. */
const BACK_SWIPE_EDGE = 24;
/** How far outside the frame, in screen pixels, a card stays mounted. */
const CULL_MARGIN = 160;
/** A press that moves further is a pan, not a click. */
const CLICK_SLOP = 4;
const FILE_READ_BATCH = 64;
const NO_HOST: CanvasBoardHost = {};

interface BoardContext {
  readonly host: CanvasBoardHost;
  readonly files: BatchedReads<CanvasFileRead>;
  readonly code: BatchedReads<CanvasCodeStatus>;
  readonly mode: "fit" | "free";
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

const position = ({ x, y, width, height }: CanvasNode) => ({
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
}: {
  readonly file: string;
  readonly subpath: string | undefined;
  readonly read: CanvasFileRead | undefined;
  readonly live: boolean;
  readonly depth?: number;
}) {
  const { host } = useBoard();
  if (read?.exists === false) return <MissingFile file={file} />;
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

function MissingFile({ file }: { readonly file: string }) {
  const { host } = useBoard();
  const note = canvasFileKind(file) === "note";
  return (
    <div className="cv-card-body cv-missing">
      <p>"{file}" could not be found.</p>
      {note && host.onOpenLink !== undefined ? (
        <button
          type="button"
          className="cv-button"
          onClick={() => host.onOpenLink?.(cardFileName(file))}
        >
          New note
        </button>
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
  return <FileBody file={node.file} subpath={node.subpath} read={useFile(node.file)} live={live} />;
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

const CardNode = memo(function CardNode({
  node,
  selected,
  simple,
}: {
  readonly node: Exclude<CanvasNode, CanvasGroupNode>;
  readonly selected: boolean;
  readonly simple: boolean;
}) {
  const { mode } = useBoard();
  const { style, ...color } = colorProps(node.color);
  const live = mode === "fit" || selected;
  return (
    <article
      className="cv-card"
      data-kind={node.type}
      data-card-id={node.id}
      data-selected={selected || undefined}
      style={{ ...position(node), ...style }}
      {...color}
    >
      {node.type === "file" ? <FileCardLabel node={node} /> : null}
      <div className="cv-card-content" data-live={(live && !simple) || undefined}>
        {simple ? (
          <SimpleCard node={node} />
        ) : node.type === "text" ? (
          <TextCard text={node.text} />
        ) : node.type === "file" ? (
          <FileCard node={node} live={live} />
        ) : node.astrolabe?.code !== undefined ? (
          <CodeCard code={node.astrolabe.code} url={node.url} caption={node.astrolabe.caption} />
        ) : (
          <LinkCard node={node} live={live} />
        )}
      </div>
    </article>
  );
});

const GroupNode = memo(function GroupNode({
  node,
  selected,
}: {
  readonly node: CanvasGroupNode;
  readonly selected: boolean;
}) {
  const { host } = useBoard();
  const { style, ...color } = colorProps(node.color);
  // Smaller above larger, and all beneath the cards: their order on the page says so.
  return (
    <div
      className="cv-group"
      data-card-id={node.id}
      data-selected={selected || undefined}
      style={{ ...position(node), ...style }}
      {...color}
    >
      {node.background === undefined
        ? null
        : host.renderAsset?.({
            kind: "background",
            path: node.background,
            style: node.backgroundStyle,
          })}
      {node.label === undefined ? null : <span className="cv-group-label">{node.label}</span>}
    </div>
  );
});

const EdgeNode = memo(function EdgeNode({ shape }: { readonly shape: CanvasEdgeShape }) {
  const { edge, path, heads } = shape;
  const { style, ...color } = colorProps(edge.color);
  return (
    <g className="cv-edge" style={style} {...color}>
      <path className="cv-edge-line" d={path} />
      {heads.map((head) => (
        <path key={head} className="cv-edge-head" d={head} />
      ))}
    </g>
  );
});

function EdgeLabel({
  edge,
  at,
}: {
  readonly edge: CanvasEdge;
  readonly at: CanvasEdgeShape["labelAt"];
}) {
  return (
    <span className="cv-edge-label" style={{ left: at.x, top: at.y }}>
      {edge.label}
    </span>
  );
}

interface Layout {
  /** Largest first, so each draws above those it sits in. */
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<Exclude<CanvasNode, CanvasGroupNode>>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
  readonly byId: ReadonlyMap<string, CanvasNode>;
}

function layoutOf(data: CanvasData): Layout {
  const area = (node: CanvasNode) => node.width * node.height;
  return {
    groups: data.nodes
      .filter((node): node is CanvasGroupNode => node.type === "group")
      .sort((a, b) => area(b) - area(a)),
    cards: data.nodes.filter(
      (node): node is Exclude<CanvasNode, CanvasGroupNode> => node.type !== "group",
    ),
    shapes: canvasEdgeShapes(data),
    byId: new Map(data.nodes.map((node) => [node.id, node])),
  };
}

interface Shown {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<Exclude<CanvasNode, CanvasGroupNode>>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
  readonly simple: boolean;
}

const NOTHING: Shown = { groups: [], cards: [], shapes: [], simple: false };

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

/**
 * A JSON Canvas as DOM cards and SVG arrows inside one transformed element. `fit` shows the whole
 * board, leaving scrolling to the page around it. `free` pans and zooms through `CanvasView`, so a
 * gesture re-renders no card that stays in view: only what's near the frame is mounted, and a
 * first click selects a card, only then making its content live.
 */
export function CanvasBoard({
  data,
  mode,
  host = NO_HOST,
  label,
  revision,
  ref,
}: {
  readonly data: CanvasData;
  readonly mode: "fit" | "free";
  readonly host?: CanvasBoardHost;
  readonly label: string;
  /** Changes when the wiki does: known files are read again, and the camera stays. */
  readonly revision?: string | undefined;
  readonly ref?: Ref<CanvasBoardHandle>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view] = useState(() => new CanvasView());
  const bounds = useMemo(() => canvasBounds(data), [data]);
  const layout = useMemo(() => layoutOf(data), [data]);
  const [shown, setShown] = useState(NOTHING);
  const [selected, setSelected] = useState<string | null>(null);
  const layoutRef = useRef(layout);
  const boundsRef = useRef(bounds);
  const [reads] = useState(() => ({
    files: new BatchedReads<CanvasFileRead>(FILE_READ_BATCH),
    code: new BatchedReads<CanvasCodeStatus>(FILE_READ_BATCH),
  }));
  const context = useMemo(() => ({ host, mode, ...reads }), [host, mode, reads]);

  const [show] = useState(() => (camera: CanvasCamera, width: number, height: number) => {
    const window = cameraWindow(camera, width, height, CULL_MARGIN);
    const next = inView(layoutRef.current, window, camera.zoom < SIMPLE_ZOOM);
    setShown((current) => (sameShown(current, next) ? current : next));
    if (next.simple) return;
    reads.files.want(next.cards.flatMap((card) => (card.type === "file" ? [card.file] : [])));
    reads.code.want(
      next.cards.flatMap((card) => {
        const code = card.type === "link" ? card.astrolabe?.code : undefined;
        return code?.repository !== undefined && code.commit !== undefined ? [codeKey(code)] : [];
      }),
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame the browser laid out and follows its resizes; the view's paint callback reads the latest layout outside React
  useLayoutEffect(() => {
    const board = boardRef.current;
    const world = worldRef.current;
    if (board === null || world === null) return;
    return view.attach(board, world, boundsRef.current, FIT_PADDING[mode], show);
  }, [view, mode, show]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- new contents reach the view outside React, keeping a reader's camera where it was
  useLayoutEffect(() => {
    reads.files.readFrom((paths) => host.readFiles?.(paths) ?? Promise.resolve([]));
    reads.code.readFrom(
      (keys) => host.readCodeStatus?.(keys.map(codeOfKey)) ?? Promise.resolve([]),
    );
    layoutRef.current = layout;
    boundsRef.current = bounds;
    view.setBounds(bounds, mode === "fit");
  }, [view, reads, host, layout, bounds, mode]);

  const readAt = useRef(revision);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new commit in the wiki reads what's in view again, through the view, which knows what that is
  useEffect(() => {
    if (readAt.current === revision) return;
    readAt.current = revision;
    reads.files.invalidate();
    reads.code.invalidate();
    view.setBounds(boundsRef.current, false);
  }, [revision, reads, view]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wheel listener must be non-passive to keep the page from scrolling, and React's is passive
  useEffect(() => {
    const board = boardRef.current;
    if (board === null || mode !== "free") return;
    const onWheel = (event: WheelEvent) => {
      const scrollable = (event.target as Element).closest("[data-live]");
      if (scrollable !== null && scrollable.scrollHeight > scrollable.clientHeight) return;
      event.preventDefault();
      view.wheel(event);
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [view, mode]);

  useImperativeHandle(
    ref,
    () => ({
      focusCard: (id) => {
        const node = layoutRef.current.byId.get(id);
        if (node !== undefined) view.focus(node);
      },
    }),
    [view],
  );

  const press = useRef<{
    readonly target: Element;
    readonly x: number;
    readonly y: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest(".cv-controls, [data-live]") !== null) return;
    const board = event.currentTarget;
    if (
      event.pointerType === "touch" &&
      event.clientX - board.getBoundingClientRect().left < BACK_SWIPE_EDGE
    ) {
      return;
    }
    press.current = { target, x: event.clientX, y: event.clientY, moved: false };
    board.setPointerCapture(event.pointerId);
    view.press(event.pointerId, event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current;
    if (pressed !== null && !pressed.moved) {
      pressed.moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP;
    }
    view.drag(event.pointerId, event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    view.release(event.pointerId);
    const pressed = press.current;
    press.current = null;
    if (pressed === null || pressed.moved) return;
    // A group's body clicks through, as the board does; only its label picks it.
    const hit = pressed.target.closest(".cv-card, .cv-group-label");
    setSelected(hit?.closest("[data-card-id]")?.getAttribute("data-card-id") ?? null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pan = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const step = pan[event.key as keyof typeof pan];
    if (step !== undefined) {
      view.pan(step[0]! * PAN_STEP, step[1]! * PAN_STEP);
    } else if (event.key === "+" || event.key === "=") {
      view.zoomBy(ZOOM_STEP);
    } else if (event.key === "-") {
      view.zoomBy(1 / ZOOM_STEP);
    } else if (event.code === "Digit1" && event.shiftKey) {
      view.fit();
    } else if (event.code === "Digit2" && event.shiftKey) {
      const node = selected === null ? undefined : layout.byId.get(selected);
      if (node !== undefined) view.focus(node);
    } else if (event.key === "Escape" && selected !== null) {
      setSelected(null);
    } else {
      return;
    }
    event.preventDefault();
  };

  const interactive =
    mode === "free"
      ? {
          tabIndex: 0,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
            press.current = null;
            view.release(event.pointerId);
          },
          onDoubleClick: (event: PointerEvent<HTMLDivElement>) => {
            const card = (event.target as Element).closest(".cv-card-label");
            const id = card?.closest("[data-card-id]")?.getAttribute("data-card-id");
            const node = id ? layout.byId.get(id) : undefined;
            if (node?.type === "file") host.onOpenLink?.(node.file);
          },
          onKeyDown,
        }
      : {};

  return (
    <div
      ref={boardRef}
      className="cv-board"
      data-mode={mode}
      data-simple={shown.simple || undefined}
      role="group"
      aria-label={label}
      {...interactive}
    >
      <Board.Provider value={context}>
        <div ref={worldRef} className="cv-world">
          {shown.groups.map((node) => (
            <GroupNode key={node.id} node={node} selected={node.id === selected} />
          ))}
          <svg className="cv-edges" aria-hidden="true" width="1" height="1">
            {shown.shapes.map((shape) => (
              <EdgeNode key={shape.edge.id} shape={shape} />
            ))}
          </svg>
          {shown.shapes.flatMap(({ edge, labelAt }) =>
            edge.label === undefined ? [] : [<EdgeLabel key={edge.id} edge={edge} at={labelAt} />],
          )}
          {shown.cards.map((node) => (
            <CardNode
              key={node.id}
              node={node}
              selected={node.id === selected}
              simple={shown.simple}
            />
          ))}
        </div>
      </Board.Provider>
      {mode === "free" ? (
        <div className="cv-controls">
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
        </div>
      ) : null}
    </div>
  );
}
