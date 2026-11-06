import type { CanvasCodeReference } from "@mercurian/wiki/canvas";
import {
  CanvasAssetView,
  type CanvasAsset,
  type CanvasBoardHost,
} from "@mercurian/wiki-editor/canvas-board";
import { canvasFileKind } from "@mercurian/wiki-editor/canvas-geometry";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { useAssetUrlState } from "~/assets/assetUrls";
import { readLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useStableCallback } from "~/hooks/useStableCallback";
import { wikiEnvironment } from "~/state/wiki";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { noteKey, wikiDocumentName, wikiDocumentNames } from "./wiki.logic";
import { WikiBase } from "./WikiBaseView";
import { WikiMermaid } from "./WikiMermaid";

const QUIET_READ = { reportFailure: false, reportDefect: false };

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
  if (state._tag !== "Success") return null;
  return asset.kind === "pdf" ? (
    <BrowserDocumentFrame
      src={state.url}
      title={asset.path}
      pdf
      documentKey={`${commit}:${asset.path}`}
    />
  ) : (
    <CanvasAssetView asset={asset} url={state.url} />
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
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly commit: string;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  /** Without it, a code card opens its saved link. */
  readonly onOpenTab?: ((key: string) => void) | undefined;
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
  };
}
