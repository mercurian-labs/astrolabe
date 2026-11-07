import type { CanvasCodeReference } from "@mercurian/wiki/canvas";
import {
  CanvasAssetView,
  type CanvasAsset,
  type CanvasBoardHost,
} from "@mercurian/wiki-editor/canvas-board";
import { EditorView } from "@codemirror/view";
import { vimAtRest, vimInsertMode } from "@mercurian/editor/vim";
import { canvasFileKind } from "@mercurian/wiki-editor/canvas-geometry";
import { ambiguousLink } from "@mercurian/wiki-editor/incoming";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { lazy, Suspense, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { readLocalApi } from "~/localApi";
import { draggedWikiFiles } from "~/panes/drag";
import { assetEnvironment } from "~/state/assets";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useStableCallback } from "~/hooks/useStableCallback";
import { wikiEnvironment } from "~/state/wiki";
import { openLeaderFrom } from "~/whichKey/doors";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import {
  isDocumentFile,
  NO_NOTE_FROM_RELATIVE_LINK,
  resolveWikiLink,
  wikiDocumentFiles,
  wikiLinkFile,
  wikiLinkOpens,
} from "./wiki.logic";
import { typedNoteFile } from "@mercurian/wiki/placement";
import { toastManager } from "../ui/toast";
import { useWikiAttachments } from "./useWikiAttachments";
import { WikiBase } from "./WikiBaseView";
import { useWikiAutosaveCommand, useWikiPlacement } from "./wikiEnvironment";
import { WikiMermaid } from "./WikiMermaid";

const WikiCanvasCardEditor = lazy(() => import("./WikiCanvasCardEditor"));
const CanvasExportDialog = lazy(() =>
  import("@mercurian/wiki-editor/canvas-export").then(({ CanvasExportDialog }) => ({
    default: CanvasExportDialog,
  })),
);

const QUIET_READ = { reportFailure: false, reportDefect: false };
const QUIET_MINT = { ...QUIET_READ, refresh: true };

/** Vim's insert mode takes the first Escape; the next leaves the card. */
function vimHoldsEscape(target: Element) {
  const view = EditorView.findFromDOM(target.closest<HTMLElement>(".cm-editor") ?? document.body);
  return view !== null && vimInsertMode(view) !== null && !vimAtRest(view);
}

const openUrl = (href: string) => {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(href);
  else window.open(href, "_blank", "noopener,noreferrer");
};

/** A wiki's file at the commit on screen, which holds what a change request adds, too. */
export function WikiAsset({
  environmentId,
  wikiId,
  commit,
  board,
  asset,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly commit: string;
  readonly board: string;
  readonly asset: CanvasAsset;
}) {
  const state = useAssetUrlState(environmentId, {
    _tag: "wiki-file",
    wikiId,
    commit,
    path: asset.path,
    from: board,
  });
  // A commit that leaves an image alone doesn't blank it while its new address is found.
  const [url, setUrl] = useState<string | null>(null);
  if (state._tag === "Success" && state.url !== url) setUrl(state.url);
  if (url === null) return null;
  return asset.kind === "pdf" ? (
    <BrowserDocumentFrame
      src={url}
      title={asset.path}
      pdf
      documentKey={`${commit}:${asset.path}`}
    />
  ) : (
    <CanvasAssetView asset={asset} url={url} />
  );
}

/** Holds the draft a save landed in, for reads that run before React next renders. */
function lastDraft() {
  let draft: WikiChangeRequestId | undefined;
  return {
    get: () => draft,
    set: (next: WikiChangeRequestId | undefined) => {
      draft = next;
    },
  };
}

/** What a board of a wiki's needs from the app, reading its cards at `commit`. */
export function useWikiCanvasHost({
  environmentId,
  wikiId,
  file: boardFile,
  changeRequestId,
  draftId,
  commit,
  onOpenNote,
  onOpenFile,
  onOpenTab,
  savesTo,
  onOpenInNewTab,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  /** The board's own file, which its text cards' links are written in. */
  readonly file: string;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** Where a card looks for a file the board's commit doesn't have. */
  readonly draftId?: WikiChangeRequestId | undefined;
  readonly commit: string;
  readonly onOpenNote: (file: string) => void;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  /** Without it, a code card opens its saved link. */
  readonly onOpenTab?: ((key: string) => void) | undefined;
  /** Where a board's edits land; none lands in the person's draft. */
  readonly savesTo?: WikiChangeRequestId | undefined;
  readonly onOpenInNewTab?: ((name: string) => void) | undefined;
}): CanvasBoardHost {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope } }),
  );
  // The first note of a new draft reads back before the list of change requests has it.
  const [noteDraft] = useState(lastDraft);
  const projects = useProjects();
  const runFiles = useAtomQueryRunner(wikiEnvironment.files, QUIET_READ);
  const runCode = useAtomQueryRunner(wikiEnvironment.codeStatus, QUIET_READ);

  // Stable, so a redrawn page leaves the host, and so its cards, alone.
  const openCode = useStableCallback((code: CanvasCodeReference, url: string) => {
    const project = projects.find(
      (each) =>
        each.environmentId === environmentId &&
        each.repositoryIdentity?.canonicalKey === code.repository,
    );
    if (project === undefined || onOpenTab === undefined) {
      if (url !== "") openUrl(url);
      return;
    }
    onOpenTab(
      repositoryTabKey({
        kind: "file",
        environmentId,
        projectId: project.id,
        checkout: { cwd: project.workspaceRoot },
        path: code.path,
      }),
    );
  });
  // Follows a link; a file comes through as itself, its path being the first thing a link tries.
  const placement = useWikiPlacement(environmentId);
  const openNote = useStableCallback((target: string, from: string = boardFile) => {
    const file = wikiLinkOpens(index.data, target, from, placement);
    if (file !== null) onOpenNote(file);
    else toastManager.add({ type: "warning", title: NO_NOTE_FROM_RELATIVE_LINK });
  });
  const openFile = useStableCallback((path: string) => onOpenFile?.(path));
  const readFiles = useStableCallback(async (paths: ReadonlyArray<string>) => {
    const read = async (
      from: { commit: string } | { changeRequestId: WikiChangeRequestId },
      wanted: ReadonlyArray<string>,
    ) => {
      const result = await runFiles({
        environmentId,
        input: { wikiId, ...from, from: boardFile, paths: [...wanted] },
      });
      return result._tag === "Success" ? result.value.files : [];
    };
    const found = await read({ commit }, paths);
    const missing = found.filter((file) => !file.exists).map((file) => file.file);
    const fallback = draftId ?? noteDraft.get();
    if (fallback === undefined || missing.length === 0) return found;
    const drafted = new Map(
      (await read({ changeRequestId: fallback }, missing)).map((file) => [file.file, file]),
    );
    return found.map((file) => drafted.get(file.file) ?? file);
  });
  const readCodeStatus = useStableCallback(
    async (references: ReadonlyArray<Required<Omit<CanvasCodeReference, "lines">>>) => {
      const result = await runCode({ environmentId, input: { references: [...references] } });
      return result._tag === "Success" ? result.value.statuses : [];
    },
  );

  const send = useWikiAutosaveCommand();
  const runFileList = useAtomQueryRunner(wikiEnvironment.fileList, QUIET_READ);
  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const landing = savesTo === undefined ? {} : { changeRequestId: savesTo };
  const listFiles = useStableCallback(async () => {
    const result = await runFileList({ environmentId, input: { wikiId, ...scope } });
    return result._tag === "Success" ? result.value.files.map(({ file }) => file) : [];
  });
  const writeNote = useStableCallback(async (file: string, text: string, readAt?: string) => {
    const outcome = await send({
      environmentId,
      input: {
        wikiId,
        ...landing,
        document: file,
        write: { kind: "text", file, text, ...(readAt === undefined ? {} : { readAt }) },
      },
    });
    if (outcome.ok) noteDraft.set(outcome.value.changeRequest?.changeRequestId);
    return outcome.ok ? null : outcome.message;
  });
  const { attach: attachFile } = useWikiAttachments({
    environmentId,
    wikiId,
    savesTo,
    source: boardFile,
    placement,
  });
  const placeNote = useStableCallback((name: string) =>
    typedNoteFile(name, boardFile, placement, index.data ? wikiDocumentFiles(index.data) : []),
  );
  const renameDocument = useStableCallback(async (file: string, to: string) => {
    const from = file.replace(/\.md$/i, "");
    const outcome = await send({
      environmentId,
      input: {
        wikiId,
        ...landing,
        document: file,
        write: { kind: "transform", transform: { kind: "rename", from, to } },
      },
    });
    return outcome.ok ? null : outcome.message;
  });
  const assetUrl = useStableCallback(async (path: string) => {
    const result = await mintUrl({
      environmentId,
      input: { resource: { _tag: "wiki-file", wikiId, commit, path, from: boardFile } },
    });
    const state = assetUrlStateFromResult(result, httpBaseUrl);
    return state._tag === "Success" ? state.url : null;
  });
  const readFileText = useStableCallback(async (path: string) => {
    const result = await runFiles({ environmentId, input: { wikiId, commit, paths: [path] } });
    return result._tag === "Success" ? (result.value.files[0]?.text ?? null) : null;
  });
  const openInNewTab = useStableCallback((file: string) => onOpenInNewTab?.(file));

  return {
    liveLinks: true,
    onOpenUrl: openUrl,
    onOpenCode: openCode,
    // A bare name is a note's. Anything with a file's extension that's no document opens as a file.
    onOpenLink: (name) => {
      const media = !["other", "note", "canvas", "base"].includes(canvasFileKind(name));
      if (!media && isDocumentFile(wikiLinkFile(index.data, name, boardFile))) openNote(name);
      else void readFiles([name]).then(([read]) => openFile(read?.file ?? name));
    },
    isResolved: (name) =>
      index.data === null || resolveWikiLink(index.data, name, boardFile).file !== null,
    linkHover: (name, link) => {
      const said =
        index.data === null
          ? undefined
          : ambiguousLink(resolveWikiLink(index.data, name, boardFile));
      return said === undefined ? (
        link
      ) : (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipPopup>{said}</TooltipPopup>
        </Tooltip>
      );
    },
    readFiles,
    readCodeStatus,
    renderAsset: (asset) => (
      <WikiAsset
        environmentId={environmentId}
        wikiId={wikiId}
        commit={commit}
        board={boardFile}
        asset={asset}
      />
    ),
    renderMermaid: (source) => <WikiMermaid source={source} />,
    renderBase: (base, view) => (
      <WikiBase
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        from={{ base, note: boardFile }}
        view={view}
        onOpenNote={openNote}
        onOpenFile={openFile}
      />
    ),
    renderCardEditor: (editor) => (
      <Suspense fallback={null}>
        <WikiCanvasCardEditor
          editor={editor}
          environmentId={environmentId}
          wikiId={wikiId}
          changeRequestId={changeRequestId}
          commit={commit}
          boardFile={boardFile}
          onOpenNote={openNote}
        />
      </Suspense>
    ),
    listFiles,
    writeNote,
    attachFile,
    placeNote,
    renameDocument,
    assetUrl,
    readFileText,
    openInNewTab,
    copyText: (text) => void navigator.clipboard?.writeText(text),
    editorTakesEscape: vimHoldsEscape,
    draggedFiles: draggedWikiFiles,
    onLeaderKey: (key) =>
      document.activeElement !== null && openLeaderFrom(document.activeElement, key),
    renderExportDialog: (dialog) => (
      <Suspense fallback={null}>
        <CanvasExportDialog {...dialog} assetUrl={assetUrl} />
      </Suspense>
    ),
  };
}
