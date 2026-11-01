import type { FileDiffMetadata } from "@pierre/diffs";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import { workspace } from "~/panes/workspace";
import { TabHeader } from "~/panes/TabHeader";
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
  const previewInput = canReadFiles ? { cwd } : undefined;
  const preview = useEnvironmentQuery(
    previewInput ? reviewEnvironment.diffPreview({ environmentId, input: previewInput }) : null,
  );
  const refresh = preview.refresh;
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const source = preview.data?.sources.find((candidate) => candidate.kind === sourceKind) ?? null;
  const lazySource = source?.truncated && source.files ? source : null;
  const renderablePatch = lazySource
    ? null
    : getRenderablePatch(source?.diff, `repository-diff:${resolvedTheme}`, {
        compactPartialHunkOffsets: true,
      });
  const { renderableFiles, readyFilePaths, settledFileCount, loadNextFiles } = useReviewFilePatches(
    {
      environmentId,
      cwd: preview.data?.cwd,
      source: lazySource,
      baseRef: lazySource?.baseRef ?? null,
      ignoreWhitespace: false,
      theme: resolvedTheme,
      previewInput,
      preview: renderablePatch,
    },
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const files = renderableFiles
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
    });
  const pendingFiles = renderableFiles.filter((file) => file.cacheKey?.endsWith(":pending"));
  const target = useCommentTarget(tab);
  const title =
    sourceKind === "working-tree"
      ? "Uncommitted changes"
      : `Changes against ${source?.baseRef ?? "the base"}`;

  // No scroll fade below: each file's header sticks to the diff's top edge, where it would fade.
  const header = (
    <TabHeader.Root>
      <TabHeader.Title label="Changes" parent={cwd.slice(cwd.lastIndexOf("/") + 1)}>
        {title}
      </TabHeader.Title>
    </TabHeader.Root>
  );
  const notice = (text: string) => (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <Notice>{text}</Notice>
    </div>
  );

  if (!canReadFiles) return notice("This connection cannot read this repository's files.");
  if (preview.error !== null && preview.data === null) return notice(String(preview.error));
  if (preview.data === null) return notice("Reading changes…");
  if (source === null || (!lazySource && renderablePatch === null)) {
    return notice(
      sourceKind === "working-tree"
        ? "No uncommitted changes."
        : "This branch has no changes against its base.",
    );
  }
  if (renderablePatch?.kind === "raw") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-2xs text-muted-foreground">
          {renderablePatch.text}
        </pre>
      </div>
    );
  }
  const openFile = (fileDiff: FileDiffMetadata) =>
    workspace.open(repositoryTabKey({ ...tab, kind: "file", path: resolveFileDiffPath(fileDiff) }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
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
  const own = threads
    .filter(
      (thread) => thread.environmentId === tab.environmentId && thread.projectId === tab.projectId,
    )
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const here = own.find((thread) => (thread.worktreePath ?? project?.workspaceRoot) === tab.cwd);
  if (here) return scopeThreadRef(here.environmentId, here.id);
  if (draftId !== null) return draftId;
  const newest = own[0];
  return newest ? scopeThreadRef(newest.environmentId, newest.id) : null;
}
