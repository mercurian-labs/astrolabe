import type { CanvasCodeReference } from "@mercurian/wiki/canvas";
import {
  CanvasAssetView,
  type CanvasAsset,
  type CanvasBoardHost,
} from "@mercurian/wiki-editor/canvas-board";
import { canvasFileKind } from "@mercurian/wiki-editor/canvas-geometry";
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
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { noteKey, wikiDocumentName, wikiDocumentNames } from "./wiki.logic";
import { WikiBase } from "./WikiBaseView";
import { useWikiAutosaveCommand } from "./wikiEnvironment";
import { WikiMermaid } from "./WikiMermaid";

const WikiCanvasCardEditor = lazy(() => import("./WikiCanvasCardEditor"));

const QUIET_READ = { reportFailure: false, reportDefect: false };
const QUIET_MINT = { ...QUIET_READ, refresh: true };

const openUrl = (href: string) => {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(href);
  else window.open(href, "_blank", "noopener,noreferrer");
};

/** A wiki's file at the commit on screen, which holds what a change request adds, too. */
function WikiAsset({
  environmentId,
  wikiId,
  commit,
  asset,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly commit: string;
  readonly asset: CanvasAsset;
}) {
  const state = useAssetUrlState(environmentId, {
    _tag: "wiki-file",
    wikiId,
    commit,
    path: asset.path,
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

/** What a board of a wiki's needs from the app, reading its cards at `commit`. */
export function useWikiCanvasHost({
  environmentId,
  wikiId,
  changeRequestId,
  commit,
  onOpenNote,
  onOpenFile,
  onOpenTab,
  savesTo,
  onOpenInNewTab,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly commit: string;
  readonly onOpenNote: (name: string) => void;
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
  const known = index.data === null ? null : new Set(wikiDocumentNames(index.data).map(noteKey));
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
  const openNote = useStableCallback(onOpenNote);
  const openFile = useStableCallback((path: string) => onOpenFile?.(path));
  const readFiles = useStableCallback(async (paths: ReadonlyArray<string>) => {
    const result = await runFiles({ environmentId, input: { wikiId, commit, paths: [...paths] } });
    return result._tag === "Success" ? result.value.files : [];
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
    return outcome.ok ? null : outcome.message;
  });
  const attachFile = useStableCallback(async (name: string, base64: string) => {
    const outcome = await send({
      environmentId,
      input: {
        wikiId,
        ...landing,
        document: name,
        write: { kind: "attachment", file: name, base64 },
      },
    });
    return outcome.ok ? name : null;
  });
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
      input: { resource: { _tag: "wiki-file", wikiId, commit, path } },
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
      const document = canvasFileKind(name) === "other" ? name : wikiDocumentName(name);
      if (document === null) openFile(name);
      else openNote(document);
    },
    isResolved: (name) => known === null || known.has(noteKey(name)),
    readFiles,
    readCodeStatus,
    renderAsset: (asset) => (
      <WikiAsset environmentId={environmentId} wikiId={wikiId} commit={commit} asset={asset} />
    ),
    renderMermaid: (source) => <WikiMermaid source={source} />,
    renderBase: (base, view) => (
      <WikiBase
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        from={{ base }}
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
          onOpenNote={openNote}
        />
      </Suspense>
    ),
    listFiles,
    writeNote,
    attachFile,
    renameDocument,
    assetUrl,
    readFileText,
    openInNewTab,
    copyText: (text) => void navigator.clipboard?.writeText(text),
    draggedFiles: draggedWikiFiles,
    onLeaderKey: () =>
      document.activeElement !== null && openLeaderFrom(document.activeElement, " "),
    canExport: true,
  };
}
