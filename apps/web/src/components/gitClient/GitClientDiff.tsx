import type { FileDiffMetadata } from "@pierre/diffs";
import type { DraftId } from "~/composerDraftStore";
import type {
  EnvironmentId,
  GitClientCommit,
  GitClientFile,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { DiffStatLabel } from "../chat/DiffStatLabel";
import { AnnotatableCodeView } from "../diffs/AnnotatableCodeView";
import { DiffFileLoadingBoundary } from "../diffs/DiffFileLoadingBoundary";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { useReviewFilePatches } from "../diffs/useReviewFilePatches";
import { Button } from "../ui/button";
import { shortSha, stageState } from "./gitClientLogic";

/** What the right side shows: some changed files, a commit, or nothing chosen yet. */
export type GitDiffSubject =
  | { readonly kind: "files"; readonly title: string; readonly files: readonly GitClientFile[] }
  | { readonly kind: "commit"; readonly commit: GitClientCommit }
  | null;

const STAGE_LABEL = {
  staged: "Staged",
  partly: "Partly staged",
  unstaged: "Not staged",
  conflicted: "Conflicted",
} as const;

/**
 * Astrolabe: the Git tab's diff of what is selected, in the diff view the Projects section's
 * changes use. A file's diff is against HEAD, staged and unstaged together; its header says which
 * it is. A line's comment goes to the composer of the checkout's thread when it has one.
 */
export function GitClientDiff({
  environmentId,
  projectId,
  cwd,
  subject,
  commentTarget,
  onOpenFile,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly subject: GitDiffSubject;
  readonly commentTarget: ScopedThreadRef | DraftId | null;
  readonly onOpenFile: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const commitSha = subject?.kind === "commit" ? subject.commit.sha : null;
  const previewInput = commitSha === null ? { cwd } : { cwd, commitSha };
  const preview = useEnvironmentQuery(
    subject === null ? null : reviewEnvironment.diffPreview({ environmentId, input: previewInput }),
  );
  const sourceKind = commitSha === null ? "working-tree" : "commit";
  const source = preview.data?.sources.find((candidate) => candidate.kind === sourceKind) ?? null;
  const lazySource = source?.truncated && source.files ? source : null;
  const renderablePatch = lazySource
    ? null
    : getRenderablePatch(source?.diff, `git-client-diff:${resolvedTheme}`, {
        compactPartialHunkOffsets: true,
      });
  const { renderableFiles, readyFilePaths, remainingFileCount, loadNextFiles } =
    useReviewFilePatches({
      environmentId,
      cwd: preview.data?.cwd,
      source: lazySource,
      baseRef: lazySource?.baseRef ?? null,
      ignoreWhitespace: false,
      theme: resolvedTheme,
      previewInput,
      preview: renderablePatch,
    });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  if (subject === null) {
    return <Quiet>Select a file, a turn or a commit to see its changes.</Quiet>;
  }
  const shown = subject.kind === "files" ? new Set(subject.files.map((file) => file.path)) : null;
  const byPath = new Map(
    subject.kind === "files" ? subject.files.map((file) => [file.path, file]) : [],
  );
  const files = renderableFiles
    .filter((fileDiff) => !lazySource || readyFilePaths.has(resolveFileDiffPath(fileDiff)))
    .filter((fileDiff) => shown === null || shown.has(resolveFileDiffPath(fileDiff)))
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
  const toggle = (fileKey: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });

  const heading =
    subject.kind === "commit" ? (
      <CommitHeading commit={subject.commit} />
    ) : (
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border/60 px-4 py-2 text-sm">
        <span className="min-w-0 truncate font-medium text-foreground">{subject.title}</span>
      </div>
    );

  const body = (() => {
    if (preview.error !== null && preview.data === null) {
      return (
        <Quiet>
          {`Couldn't read the changes. ${preview.error}`}
          <Button size="xs" variant="outline" onClick={preview.refresh}>
            Retry
          </Button>
        </Quiet>
      );
    }
    if (preview.data === null) return <Quiet>Reading changes…</Quiet>;
    if (renderablePatch?.kind === "raw") {
      return (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-2xs text-muted-foreground">
          {renderablePatch.text}
        </pre>
      );
    }
    if (files.length === 0 && pendingFiles.length === 0 && remainingFileCount === 0) {
      return (
        <Quiet>
          {subject.kind === "commit"
            ? "This commit changes no files."
            : "These changes are gone: the checkout moved on since."}
        </Quiet>
      );
    }
    const options = {
      diffStyle: "unified" as const,
      lineDiffType: "none" as const,
      overflow: "scroll" as const,
      theme: resolveDiffThemeName(resolvedTheme),
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      themeType: resolvedTheme,
      stickyHeaders: true,
    };
    const renderHeaderMetadata = (fileDiff: FileDiffMetadata): ReactNode => {
      const path = resolveFileDiffPath(fileDiff);
      const changed = byPath.get(path);
      const stat = source?.files?.find((file) => file.path === path);
      return (
        <span className="flex items-center gap-2">
          {changed ? (
            <span className="text-2xs text-muted-foreground">
              {STAGE_LABEL[stageState(changed)]}
            </span>
          ) : null}
          {stat ? <DiffStatLabel additions={stat.additions} deletions={stat.deletions} /> : null}
        </span>
      );
    };
    const renderHeaderPrefix = (
      _fileDiff: FileDiffMetadata,
      fileKey: string,
      isCollapsed: boolean,
    ) => (
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={isCollapsed ? "Expand file" : "Collapse file"}
        onClick={() => toggle(fileKey)}
      >
        {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
      </Button>
    );
    const renderHeaderFilenameSuffix = (fileDiff: FileDiffMetadata) =>
      subject.kind === "files" &&
      byPath.get(resolveFileDiffPath(fileDiff))?.workingTree !== "deleted" ? (
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => onOpenFile(resolveFileDiffPath(fileDiff))}
        >
          Open
        </Button>
      ) : null;
    const footer = () =>
      remainingFileCount > 0 ? (
        <DiffFileLoadingBoundary load={loadNextFiles} count={remainingFileCount} />
      ) : null;
    const viewKey = `git-client:${cwd}:${commitSha ?? "working-tree"}`;
    if (commentTarget === null) {
      return (
        <StyledDiffCodeView
          key={viewKey}
          className="min-h-0 flex-1 overflow-auto"
          items={files.map(({ fileDiff, fileKey, fileVersion, collapsed: isCollapsed }) => ({
            id: fileKey,
            type: "diff" as const,
            fileDiff,
            collapsed: isCollapsed,
            version: fileVersion * 2 + (isCollapsed ? 1 : 0),
          }))}
          options={options}
          renderCodeViewFooter={footer}
          renderHeaderMetadata={(item) =>
            item.type === "diff" ? renderHeaderMetadata(item.fileDiff) : null
          }
          renderHeaderFilenameSuffix={(item) =>
            item.type === "diff" ? renderHeaderFilenameSuffix(item.fileDiff) : null
          }
          renderHeaderPrefix={(item) =>
            item.type === "diff"
              ? renderHeaderPrefix(item.fileDiff, item.id, item.collapsed === true)
              : null
          }
        />
      );
    }
    return (
      <AnnotatableCodeView
        environmentId={environmentId}
        projectId={projectId}
        codeViewKey={viewKey}
        className="min-h-0 flex-1 overflow-auto"
        files={files}
        pendingFiles={pendingFiles}
        sectionId={viewKey}
        sectionTitle={subject.kind === "commit" ? subject.commit.subject : subject.title}
        composerDraftTarget={commentTarget}
        renderCodeViewFooter={footer}
        renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
        renderHeaderMetadata={renderHeaderMetadata}
        renderHeaderPrefix={renderHeaderPrefix}
        onRevealSearchMatch={(fileKey) =>
          setCollapsed((current) => {
            const next = new Set(current);
            next.delete(fileKey);
            return next;
          })
        }
        options={options}
      />
    );
  })();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {heading}
      {body}
    </div>
  );
}

function CommitHeading({ commit }: { readonly commit: GitClientCommit }) {
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border/60 px-4 py-2">
      <span className="text-sm font-medium text-foreground">{commit.subject}</span>
      {commit.body.length > 0 ? (
        <p className="max-h-32 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
          {commit.body}
        </p>
      ) : null}
      <span className="text-2xs text-muted-foreground">
        {[
          shortSha(commit.sha),
          commit.authorName,
          formatRelativeTimeLabel(commit.authoredAt),
          commit.pushed ? null : "not pushed",
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

function Quiet({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}
