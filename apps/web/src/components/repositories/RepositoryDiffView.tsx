import type { FileDiffMetadata } from "@pierre/diffs";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as DateTime from "effect/DateTime";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { useProject, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { DiffStatLabel } from "../chat/DiffStatLabel";
import { AnnotatableCodeView } from "../diffs/AnnotatableCodeView";
import { DiffFileLoadingBoundary } from "../diffs/DiffFileLoadingBoundary";
import { useReviewFilePatches } from "../diffs/useReviewFilePatches";
import { Button } from "../ui/button";
import { repositoryPanes } from "./repositoryPanes";
import { repositoryTabKey, type RepositoryTab } from "./repositoryTabs";

type DiffTab = Extract<RepositoryTab, { kind: "diff" }>;

/**
 * Astrolabe: a checkout's changes in the Repositories area: its uncommitted changes, or its
 * branch against its base, in the diff view a thread's Diffs uses. A line's comment goes to the
 * composer of the thread working in that checkout, or else of the repository's new thread. A
 * file's header opens the file.
 */
export function RepositoryDiffView({ tab }: { readonly tab: DiffTab }) {
  const { environmentId, cwd, source: sourceKind } = tab;
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const { resolvedTheme } = useTheme();
  const preview = useEnvironmentQuery(
    canReadFiles ? reviewEnvironment.diffPreview({ environmentId, input: { cwd } }) : null,
  );
  const refresh = preview.refresh;
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const source = preview.data?.sources.find((candidate) => candidate.kind === sourceKind) ?? null;
  const lazySource = source?.truncated && source.files ? source : null;
  const renderablePatch = useMemo(
    () =>
      lazySource
        ? null
        : getRenderablePatch(source?.diff, `repository-diff:${resolvedTheme}`, {
            compactPartialHunkOffsets: true,
          }),
    [lazySource, resolvedTheme, source?.diff],
  );
  const { renderableFiles, readyFilePaths, settledFileCount, loadNextFiles } = useReviewFilePatches(
    {
      environmentId,
      cwd: preview.data?.cwd,
      source: lazySource,
      baseRef: lazySource?.baseRef ?? null,
      ignoreWhitespace: false,
      theme: resolvedTheme,
      revision: preview.data ? DateTime.formatIso(preview.data.generatedAt) : undefined,
      preview: renderablePatch,
    },
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const files = useMemo(
    () =>
      renderableFiles
        .filter((fileDiff) => !lazySource || readyFilePaths.has(resolveFileDiffPath(fileDiff)))
        .map((fileDiff) => {
          const fileKey = buildFileDiffIdentityKey(fileDiff);
          return {
            fileDiff,
            filePath: resolveFileDiffPath(fileDiff),
            fileKey,
            fileVersion: buildFileDiffContentVersion(fileDiff),
            collapsed: collapsed.has(fileKey) || fileDiff.cacheKey?.endsWith(":pending") === true,
          };
        }),
    [collapsed, lazySource, readyFilePaths, renderableFiles],
  );
  const pendingFiles = renderableFiles.filter((file) => file.cacheKey?.endsWith(":pending"));
  const target = useCommentTarget(tab);
  const title =
    sourceKind === "working-tree"
      ? "Uncommitted changes"
      : `Changes against ${source?.baseRef ?? "the base"}`;

  if (!canReadFiles) return <Notice>This connection cannot read this repository's files.</Notice>;
  if (preview.error !== null && preview.data === null)
    return <Notice>{String(preview.error)}</Notice>;
  if (preview.data === null) return <Notice>Reading changes…</Notice>;
  if (source === null || (!lazySource && renderablePatch === null)) {
    return (
      <Notice>
        {sourceKind === "working-tree"
          ? "No uncommitted changes."
          : "This branch has no changes against its base."}
      </Notice>
    );
  }
  if (renderablePatch?.kind === "raw") {
    return (
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-2xs text-muted-foreground">
        {renderablePatch.text}
      </pre>
    );
  }
  const openFile = (fileDiff: FileDiffMetadata) =>
    repositoryPanes.open(
      repositoryTabKey({ ...tab, kind: "file", path: resolveFileDiffPath(fileDiff) }),
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-mono">{cwd.slice(cwd.lastIndexOf("/") + 1)}</span>
      </div>
      {target === null ? null : (
        <AnnotatableCodeView
          codeViewKey={`repository-diff:${cwd}:${sourceKind}`}
          className="min-h-0 flex-1 overflow-auto"
          files={files}
          pendingFiles={pendingFiles}
          sectionId={`repository-diff:${cwd}:${sourceKind}`}
          sectionTitle={title}
          composerDraftTarget={target}
          renderCodeViewFooter={() =>
            settledFileCount < renderableFiles.length ? (
              <DiffFileLoadingBoundary
                load={loadNextFiles}
                count={renderableFiles.length - settledFileCount}
              />
            ) : null
          }
          renderHeaderFilenameSuffix={(fileDiff) => (
            <Button size="xs" variant="ghost-muted" onClick={() => openFile(fileDiff)}>
              Open
            </Button>
          )}
          renderHeaderMetadata={(fileDiff) => {
            const stat = source.files?.find((file) => file.path === resolveFileDiffPath(fileDiff));
            return stat ? (
              <DiffStatLabel additions={stat.additions} deletions={stat.deletions} />
            ) : null;
          }}
          renderHeaderPrefix={(_fileDiff, fileKey, isCollapsed) => (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={isCollapsed ? "Expand file" : "Collapse file"}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(fileKey)) next.delete(fileKey);
                  else next.add(fileKey);
                  return next;
                })
              }
            >
              {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            </Button>
          )}
          onRevealSearchMatch={(fileKey) =>
            setCollapsed((current) => {
              const next = new Set(current);
              next.delete(fileKey);
              return next;
            })
          }
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
          }}
        />
      )}
      {target === null ? (
        <Notice>Start a thread in this repository to review its changes line by line.</Notice>
      ) : null}
    </div>
  );
}

function Notice({ children }: { readonly children: string }) {
  return (
    <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Where a line's comment goes: the newest thread working in the tab's checkout, else the
 * repository's new-thread draft, else the repository's newest thread. Null with none of them.
 */
function useCommentTarget(tab: DiffTab) {
  const project = useProject({ environmentId: tab.environmentId, projectId: tab.projectId });
  const threads = useThreadShells();
  // The id alone: the store builds the draft's object anew on every read.
  const draftId = useComposerDraftStore(
    (store) =>
      store.getDraftThreadByProjectRef(scopeProjectRef(tab.environmentId, tab.projectId))
        ?.draftId ?? null,
  );
  return useMemo(() => {
    const own = threads
      .filter(
        (thread) =>
          thread.environmentId === tab.environmentId && thread.projectId === tab.projectId,
      )
      .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const here = own.find((thread) => (thread.worktreePath ?? project?.workspaceRoot) === tab.cwd);
    if (here) return scopeThreadRef(here.environmentId, here.id);
    if (draftId !== null) return draftId;
    const newest = own[0];
    return newest ? scopeThreadRef(newest.environmentId, newest.id) : null;
  }, [draftId, project?.workspaceRoot, tab, threads]);
}
