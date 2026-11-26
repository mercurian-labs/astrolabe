/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
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
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { WikiSaveOutcome } from "@t3tools/client-runtime/wikiAutosave";
import { describeWikiFailure, wikiSaveFailure } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  WikiChangeRequestId,
  ProjectRootId,
  WikiTransform,
} from "@t3tools/contracts";
import type { WikiLinkLanding } from "@mercurian/wiki-editor/link-tools";
import { lazy, Suspense, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { readLocalApi } from "~/localApi";
import { draggedWikiFiles } from "~/panes/drag";
import { assetEnvironment } from "~/state/assets";
import { useProjects } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useStableCallback } from "~/hooks/useStableCallback";
import { wikiEnvironment } from "~/state/wiki";
import { openLeaderFrom } from "~/whichKey/doors";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import {
  documentTitle,
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

/**
 * A wiki's file at the commit on screen, which holds what a change request adds, too; with
 * `checkout`, as it stands there on disk.
 */
export function WikiAsset({
  environmentId,
  wikiId,
  commit,
  checkout,
  board,
  asset,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
  readonly commit: string;
  readonly checkout?: string | undefined;
  readonly board: string;
  readonly asset: CanvasAsset;
}) {
  const state = useAssetUrlState(
    environmentId,
    checkout === undefined
      ? { _tag: "wiki-file", wikiId, commit, path: asset.path, from: board }
      : { _tag: "draft-workspace-file", cwd: checkout, path: asset.path },
  );
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

/** What the server says of a transform that leaves the files as they were: nothing to save. */
const NOTHING_CHANGED = "This amendment changes nothing.";

/**
 * Astrolabe: a board's writes into a folder on disk, uncommitted: canvas-aware transforms through
 * the wiki, a note's whole text as a file.
 */
export function useCanvasDiskWrites(environmentId: EnvironmentId, wikiId: ProjectRootId) {
  const runTransform = useAtomCommand(wikiEnvironment.transform, { reportFailure: false });
  const runWrite = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const outcome = (result: AtomCommandResult<unknown, unknown>): WikiSaveOutcome => {
    if (result._tag === "Success") return { ok: true };
    if (isAtomCommandInterrupted(result)) {
      return { ok: false, message: "The save was cancelled.", retry: true };
    }
    const failure = squashAtomCommandFailure(result);
    return describeWikiFailure(failure) === NOTHING_CHANGED
      ? { ok: true }
      : wikiSaveFailure(failure);
  };
  return {
    transform: async (checkout: string, document: string, transform: WikiTransform) =>
      outcome(
        await runTransform({
          environmentId,
          input: { wikiId, checkout, message: `Edit ${documentTitle(document)}`, transform },
        }),
      ),
    writeText: async (checkout: string, file: string, text: string) =>
      outcome(
        await runWrite({
          environmentId,
          input: { cwd: checkout, relativePath: file, contents: text },
        }),
      ),
  };
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

/**
 * Astrolabe: a project's links in place of one root's: where a link on the board lands across the
 * project's roots, and following one there.
 */
export interface CanvasProjectLinks {
  readonly resolve: (target: string) => WikiLinkLanding;
  readonly follow: (target: string, from: string) => void;
}

/**
 * What a board of a wiki's needs from the app, reading its cards at `commit`. With `checkout`,
 * its cards are read and every write lands in that folder on disk, uncommitted.
 */
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
  checkout,
  projectLinks,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
  readonly checkout?: string | undefined;
  readonly projectLinks?: CanvasProjectLinks | undefined;
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
  const scope =
    checkout !== undefined
      ? { checkout }
      : changeRequestId === undefined
        ? {}
        : { changeRequestId };
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
    if (projectLinks !== undefined) return projectLinks.follow(target, from);
    const file = wikiLinkOpens(index.data, target, from, placement);
    if (file !== null) onOpenNote(file);
    else toastManager.add({ type: "warning", title: NO_NOTE_FROM_RELATIVE_LINK });
  });
  const openFile = useStableCallback((path: string) => onOpenFile?.(path));
  const readFiles = useStableCallback(async (paths: ReadonlyArray<string>) => {
    const read = async (
      from: { commit: string } | { changeRequestId: WikiChangeRequestId } | { checkout: string },
      wanted: ReadonlyArray<string>,
    ) => {
      const result = await runFiles({
        environmentId,
        input: { wikiId, ...from, from: boardFile, paths: [...wanted] },
      });
      return result._tag === "Success" ? result.value.files : [];
    };
    if (checkout !== undefined) return read({ checkout }, paths);
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
    async (references: ReadonlyArray<Required<Omit<CanvasCodeReference, "lines" | "root">>>) => {
      const result = await runCode({ environmentId, input: { references: [...references] } });
      return result._tag === "Success" ? result.value.statuses : [];
    },
  );

  const send = useWikiAutosaveCommand();
  const disk = useCanvasDiskWrites(environmentId, wikiId);
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
    if (checkout !== undefined) {
      const written = await disk.writeText(checkout, file, text);
      return written.ok ? null : written.message;
    }
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
    checkout,
    source: boardFile,
    placement,
  });
  const placeNote = useStableCallback((name: string) =>
    typedNoteFile(name, boardFile, placement, index.data ? wikiDocumentFiles(index.data) : []),
  );
  const renameDocument = useStableCallback(async (file: string, to: string) => {
    const from = file.replace(/\.md$/i, "");
    if (checkout !== undefined) {
      const moved = await disk.transform(checkout, file, { kind: "rename", from, to });
      return moved.ok ? null : moved.message;
    }
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
      input: {
        resource:
          checkout === undefined
            ? { _tag: "wiki-file", wikiId, commit, path, from: boardFile }
            : { _tag: "draft-workspace-file", cwd: checkout, path },
      },
    });
    const state = assetUrlStateFromResult(result, httpBaseUrl);
    return state._tag === "Success" ? state.url : null;
  });
  const readFileText = useStableCallback(async (path: string) => {
    const result = await runFiles({
      environmentId,
      input: { wikiId, ...(checkout === undefined ? { commit } : { checkout }), paths: [path] },
    });
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
    isResolved: (name) => {
      if (projectLinks !== undefined) {
        const found = projectLinks.resolve(name);
        return found.file !== null || (found.ambiguous?.length ?? 0) > 0;
      }
      return index.data === null || resolveWikiLink(index.data, name, boardFile).file !== null;
    },
    linkHover: (name, link) => {
      const said =
        projectLinks !== undefined
          ? ambiguousLink(projectLinks.resolve(name))
          : index.data === null
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
        checkout={checkout}
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
        checkout={checkout}
        revision={commit}
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
          checkout={checkout}
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
