import { parseCanvas, type CanvasData } from "@mercurian/wiki/canvas";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { BaseBlock } from "./BaseBlock";
import {
  CanvasAssetView,
  CanvasBoard,
  type CanvasAsset,
  type CanvasBoardHost,
} from "./CanvasBoard";
import { cardFileName } from "./canvasGeometry";
import { CanvasMinimap } from "./CanvasMinimap";
import { MobileMermaid } from "./MobileMermaid";
import { documentKey, type WikiEditorPage } from "./mobilePageController";
import type { WikiEditorEvent } from "./protocol";

type Post = (event: WikiEditorEvent) => void;

const useAsset = (page: WikiEditorPage, path: string) =>
  useSyncExternalStore(
    (listener) => page.watchAsset(path, listener),
    () => page.getAsset(path),
  );

/** A file the page can't play: its name, and the app's viewer. */
function OpenFile({ path, post }: { readonly path: string; readonly post: Post }) {
  return (
    <div className="canvas-open">
      <span>{cardFileName(path)}</span>
      <button type="button" className="cv-button" onClick={() => post({ type: "openFile", path })}>
        Open
      </button>
    </div>
  );
}

/** A card's bytes, at the address the app found for them. */
function Asset({
  page,
  asset,
  post,
}: {
  readonly page: WikiEditorPage;
  readonly asset: Exclude<CanvasAsset, { readonly kind: "pdf" }>;
  readonly post: Post;
}) {
  const url = useAsset(page, asset.path);
  const [failed, setFailed] = useState<string | null>(null);
  if (url === undefined) return null;
  if (url === null || url === failed) {
    return asset.kind === "background" ? null : <OpenFile path={asset.path} post={post} />;
  }
  return <CanvasAssetView asset={asset} url={url} onError={() => setFailed(url)} />;
}

/** A repository image in a base's cell or cover. */
function BaseImage({
  page,
  path,
  className,
}: {
  readonly page: WikiEditorPage;
  readonly path: string;
  readonly className: string;
}) {
  const url = useAsset(page, path);
  if (url === undefined || url === null) return <span className={className} data-image-missing />;
  return <img className={className} src={url} alt="" loading="lazy" decoding="async" />;
}

/**
 * A canvas alone on the page. A thread's reads nothing; a wiki's reads its cards through the app,
 * at the commit shown.
 */
export function MobileCanvas({
  page,
  data,
  post,
}: {
  readonly page: WikiEditorPage;
  readonly data: CanvasData;
  readonly post: Post;
}) {
  const { revision, camera, knownDocuments, marks } = useSyncExternalStore(
    page.subscribe,
    page.getState,
  );
  const { setBoard, reportCamera } = page;
  const host = useMemo((): CanvasBoardHost => {
    const onOpenUrl = (href: string) => post({ type: "openUrl", href });
    const onOpenCode: CanvasBoardHost["onOpenCode"] = (code, url) =>
      post({ type: "openCode", code, url });
    if (revision === null) return { onOpenUrl, onOpenCode };
    const onOpenNote = (name: string) => post({ type: "openNote", name });
    return {
      onOpenUrl,
      onOpenCode,
      onOpenLink: onOpenNote,
      isResolved: (name) => knownDocuments === null || knownDocuments.has(documentKey(name)),
      readFiles: page.readFiles,
      readCodeStatus: page.readCodeStatus,
      renderAsset: (asset): ReactNode =>
        asset.kind === "pdf" ? (
          <OpenFile path={asset.path} post={post} />
        ) : (
          <Asset page={page} asset={asset} post={post} />
        ),
      renderMermaid: (source) => <MobileMermaid source={source} />,
      renderBase: (file, view) => (
        <BaseBlock
          page={page}
          source={`![[${file}${view ? `#${view}` : ""}]]`}
          onOpenNote={onOpenNote}
          onOpenUrl={onOpenUrl}
          renderImage={(image, className) =>
            image.kind === "file" ? (
              <BaseImage page={page} path={image.path} className={className} />
            ) : null
          }
        />
      ),
    };
  }, [page, post, revision, knownDocuments]);
  return (
    <div className="canvas-page">
      <CanvasBoard
        ref={setBoard}
        data={data}
        mode="free"
        host={host}
        label="Canvas"
        revision={revision ?? undefined}
        camera={camera}
        onCamera={reportCamera}
        {...(marks === null ? {} : { marks })}
      />
    </div>
  );
}

/** `![[Board.canvas]]` in a note: a static picture of the board, which opens it. */
export function MobileCanvasEmbed({
  page,
  target,
  onOpen,
}: {
  readonly page: WikiEditorPage;
  readonly target: string;
  readonly onOpen: (name: string) => void;
}) {
  const path = target.split(/[#|]/)[0]?.trim() ?? target;
  const read = useSyncExternalStore(
    (listener) => page.watchFile(path, listener),
    () => page.getFile(path),
  );
  const parsed = useMemo(() => parseCanvas(read?.text ?? ""), [read?.text]);
  const title = cardFileName(path).replace(/\.canvas$/i, "");
  return (
    <button type="button" className="canvas-embed" onClick={() => onOpen(read?.file ?? path)}>
      <span className="canvas-embed-title">{title}</span>
      <span className="canvas-embed-body">
        {read === undefined ? null : !read.exists ? (
          `"${path}" could not be found.`
        ) : parsed.ok ? (
          <CanvasMinimap data={parsed.data} label={`The canvas ${title}`} />
        ) : (
          `${path} isn't valid JSON.`
        )}
      </span>
    </button>
  );
}
