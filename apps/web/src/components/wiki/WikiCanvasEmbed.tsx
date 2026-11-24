/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { parseCanvas } from "@mercurian/wiki/canvas";
import { CanvasMinimap, canvasFigureView } from "@mercurian/wiki-editor/canvas-minimap";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { documentTitle } from "./wiki.logic";

/** An embed's canvas, and the frame its `#` names: `Board.canvas#Checkout`. */
function canvasEmbedTarget(target: string): { file: string; frame: string | undefined } {
  const [file = "", ...rest] = target.split("|")[0]?.split("#") ?? [];
  const frame = rest.join("#").trim();
  return { file: file.trim(), frame: frame === "" ? undefined : frame };
}

/**
 * `![[Board.canvas]]` in a note: a static picture of the board, which opens it. With `#Group` it
 * frames that named group, the rest dimmed, and opens the board on it.
 */
export default function WikiCanvasEmbed({
  environmentId,
  wikiId,
  changeRequestId,
  target,
  from,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The canvas as the embed writes it, with its `#Group`. */
  readonly target: string;
  /** The note the embed is in. */
  readonly from: string;
  /** Opens the board, by the link that names it and its frame. */
  readonly onOpen: (link: string) => void;
}) {
  const { file, frame } = canvasEmbedTarget(target);
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const { data } = useEnvironmentQuery(
    wikiEnvironment.files({ environmentId, input: { wikiId, ...scope, from, paths: [file] } }),
  );
  const read = data?.files[0];
  const parsed = parseCanvas(read?.text ?? "");
  const title = documentTitle(file);
  const view = parsed.ok ? canvasFigureView(parsed.data, frame) : undefined;
  const shown = frame === undefined || view?.missing === true ? title : `${title} › ${frame}`;
  return (
    <button
      type="button"
      className="block w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-transparent p-0 text-left"
      onClick={() => onOpen(`${read?.file ?? file}${frame === undefined ? "" : `#${frame}`}`)}
    >
      <span className="flex items-baseline gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{shown}</span>
        {view?.missing === true ? (
          <span className="shrink-0">{`No group named "${frame}": showing the whole board`}</span>
        ) : null}
      </span>
      <span className="block h-44 p-2">
        {read !== undefined && !read.exists ? (
          <span className="text-xs text-muted-foreground">{`"${file}" could not be found.`}</span>
        ) : parsed.ok ? (
          <CanvasMinimap data={parsed.data} label={`The canvas ${shown}`} frame={frame} words />
        ) : (
          <span className="text-xs text-destructive">{`${file} isn't valid JSON.`}</span>
        )}
      </span>
    </button>
  );
}
