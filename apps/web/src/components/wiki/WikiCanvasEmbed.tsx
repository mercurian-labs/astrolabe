import { parseCanvas } from "@mercurian/wiki/canvas";
import { CanvasMinimap } from "@mercurian/wiki-editor/canvas-minimap";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { documentTitle } from "./wiki.logic";

/** `![[Board.canvas]]` in a note: a static picture of the board, which opens it. */
export default function WikiCanvasEmbed({
  environmentId,
  wikiId,
  changeRequestId,
  file,
  from,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The canvas as the embed writes it. */
  readonly file: string;
  /** The note the embed is in. */
  readonly from: string;
  readonly onOpen: (file: string) => void;
}) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const { data } = useEnvironmentQuery(
    wikiEnvironment.files({ environmentId, input: { wikiId, ...scope, from, paths: [file] } }),
  );
  const read = data?.files[0];
  const parsed = parseCanvas(read?.text ?? "");
  const title = documentTitle(file);
  return (
    <button
      type="button"
      className="block w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-transparent p-0 text-left"
      onClick={() => onOpen(read?.file ?? file)}
    >
      <span className="block truncate border-b border-border px-3 py-1 text-xs text-muted-foreground">
        {title}
      </span>
      <span className="block h-44 p-2">
        {read !== undefined && !read.exists ? (
          <span className="text-xs text-muted-foreground">{`"${file}" could not be found.`}</span>
        ) : parsed.ok ? (
          <CanvasMinimap data={parsed.data} label={`The canvas ${title}`} />
        ) : (
          <span className="text-xs text-destructive">{`${file} isn't valid JSON.`}</span>
        )}
      </span>
    </button>
  );
}
