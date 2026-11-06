import type { CanvasCardEditor } from "@mercurian/wiki-editor/canvas-board";
import { focusCardEditor, useCanvasCardSession } from "@mercurian/wiki-editor/canvas-card-session";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { wikiDocumentNames } from "./wiki.logic";
import { WikiBase } from "./WikiBaseView";
import { WikiMermaid } from "./WikiMermaid";
import { WikiNoteEditor } from "./WikiNoteEditor";

const NO_LINK_TYPES: ReadonlyArray<string> = [];

/** The note editor, on the one card being typed in: Vim, keys and `[[` as in any note. */
export default function WikiCanvasCardEditor({
  editor,
  environmentId,
  wikiId,
  changeRequestId,
  onOpenNote,
}: {
  readonly editor: CanvasCardEditor;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly onOpenNote: (name: string) => void;
}) {
  const session = useCanvasCardSession(editor);
  const frame = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- the caret goes in once the session's editor exists
  useEffect(() => focusCardEditor(frame.current), [session]);
  const index = useEnvironmentQuery(
    wikiEnvironment.index({
      environmentId,
      input: { wikiId, ...(changeRequestId === undefined ? {} : { changeRequestId }) },
    }),
  );
  if (session === null) return null;
  return (
    <div ref={frame}>
      <WikiNoteEditor
        session={session}
        onOpenNote={onOpenNote}
        linkTypes={index.data?.linkTypes ?? NO_LINK_TYPES}
        linkNames={index.data === null ? [] : wikiDocumentNames(index.data)}
        renderLinkPreview={() => null}
        renderBase={(source) => (
          <WikiBase
            environmentId={environmentId}
            wikiId={wikiId}
            changeRequestId={changeRequestId}
            from={{ source, note: "" }}
            onOpenNote={onOpenNote}
          />
        )}
        renderMermaid={(source) => <WikiMermaid source={source} />}
      />
    </div>
  );
}
