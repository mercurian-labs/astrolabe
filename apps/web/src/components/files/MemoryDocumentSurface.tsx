import type { SelectedLineRange } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import type {
  MemoryDocumentResult,
  MemoryDocumentSelection,
  MemoryDocumentTarget,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { BookOpenIcon, Code2, Eye, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import { DIFF_SURFACE_THEME_UNSAFE_CSS, resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { buildMemoryDocumentReviewComment } from "~/reviewCommentContext";
import { useRightPanelStore } from "~/rightPanelStore";
import { useReadMemoryDocument } from "~/state/mercurianMemory";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { MemoryMarkdown } from "../mercurian/memoryMarkdown";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
} from "./fileCommentAnnotations";

const MEMORY_SURFACE_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }
`;

type MemoryDocumentReadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly result: MemoryDocumentResult };

/**
 * A memory document at one immutable version, read lazily and never edited.
 * Comments stage into the composer's pending review context with the exact
 * environment, target, and range; wikilinks open siblings at the same position.
 */
export function MemoryDocumentSurface({
  memory,
  threadRef,
  composerDraftTarget,
  renderMarkdown,
  onRenderMarkdownChange,
  wordWrap,
}: {
  readonly memory: MemoryDocumentSelection;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly renderMarkdown: boolean;
  readonly onRenderMarkdownChange: (rendered: boolean) => void;
  readonly wordWrap: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const readDocument = useReadMemoryDocument(memory.environmentId);
  const { target } = memory;
  const [read, setRead] = useState<{
    readonly target: MemoryDocumentTarget;
    readonly value: MemoryDocumentReadState;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void readDocument({ target }).then((outcome) => {
      if (!active) return;
      setRead({
        target,
        value: outcome.ok
          ? { kind: "ready", result: outcome.value }
          : {
              kind: "error",
              message:
                outcome.error instanceof Error
                  ? outcome.error.message
                  : "Could not read this memory document.",
            },
      });
    });
    return () => {
      active = false;
    };
  }, [readDocument, target]);
  const state: MemoryDocumentReadState = read?.target === target ? read.value : { kind: "loading" };

  const openSibling = useCallback(
    (sibling: MemoryDocumentTarget) =>
      useRightPanelStore
        .getState()
        .openMemoryDocument(threadRef, { environmentId: memory.environmentId, target: sibling }),
    [memory.environmentId, threadRef],
  );
  const available =
    state.kind === "ready" && state.result.kind === "available" ? state.result : null;
  const links = useMemo(
    () =>
      (available?.links ?? []).map((link) => ({ name: link.name, exists: link.target !== null })),
    [available],
  );
  const openNote = useCallback(
    (name: string) => {
      const link = available?.links.find(
        (candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (link?.target) openSibling(link.target);
    },
    [available, openSibling],
  );
  const versionLabel = target.deleted
    ? "Former version, before deletion"
    : `Version ${target.blobOid.slice(0, 8)} · read-only`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3"
        data-surface-subheader
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <BookOpenIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{target.path}</span>
          <span className="shrink-0 text-muted-foreground">· {versionLabel}</span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={renderMarkdown}
                onPressedChange={onRenderMarkdownChange}
                aria-label={renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
                variant="ghost"
                size="sm"
              >
                {renderMarkdown ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
              </Toggle>
            }
          />
          <TooltipPopup>
            {renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {available?.map !== null && available?.map !== undefined && "refusal" in available.map ? (
        <p className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-[11px] text-warning-foreground">
          This map could not be parsed: {available.map.refusal}. The source below is still exact.
        </p>
      ) : null}
      {state.kind === "loading" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
          {state.message}
        </div>
      ) : state.result.kind === "unavailable" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground">
          This memory version is unavailable: {state.result.reason}.
        </div>
      ) : renderMarkdown ? (
        <ScrollArea className="min-h-0 flex-1">
          <MemoryMarkdown
            className="px-4 py-4"
            links={links}
            markdown={state.result.markdown}
            onOpenNote={openNote}
          />
        </ScrollArea>
      ) : (
        <MemoryDocumentSource
          key={`${target.blobOid}:${resolvedTheme}`}
          composerDraftTarget={composerDraftTarget}
          contents={state.result.markdown}
          memory={memory}
          resolvedTheme={resolvedTheme}
          wordWrap={wordWrap}
        />
      )}
    </div>
  );
}

function MemoryDocumentSource({
  memory,
  contents,
  composerDraftTarget,
  resolvedTheme,
  wordWrap,
}: {
  readonly memory: MemoryDocumentSelection;
  readonly contents: string;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly resolvedTheme: "light" | "dark";
  readonly wordWrap: boolean;
}) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null);

  const removeEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) =>
        current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        }),
      );
    },
    [composerDraftTarget, removeReviewComment],
  );
  const submitEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildMemoryDocumentReviewComment({
            id: entry.id,
            environmentId: memory.environmentId,
            target: memory.target,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((candidate) =>
              candidate.id === entryId ? { ...candidate, kind: "comment", text } : candidate,
            ),
          },
        })),
      );
    },
    [addReviewComment, composerDraftTarget, contents, lineAnnotations, memory],
  );
  const beginComment = useCallback((range: SelectedLineRange) => {
    const { startLine, endLine } = normalizeFileCommentRange(range);
    const draftEntry: FileCommentAnnotationEntry = {
      id: nextFileCommentId(),
      kind: "draft",
      startLine,
      endLine,
      text: "",
    };
    setLineAnnotations((current) => {
      const withoutDraft = current.flatMap((annotation) => {
        const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
        return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
      });
      const existing = withoutDraft.find((annotation) => annotation.lineNumber === endLine);
      return existing === undefined
        ? [...withoutDraft, { lineNumber: endLine, metadata: { entries: [draftEntry] } }]
        : withoutDraft.map((annotation) =>
            annotation === existing
              ? {
                  ...annotation,
                  metadata: { entries: [...annotation.metadata.entries, draftEntry] },
                }
              : annotation,
          );
    });
  }, []);
  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );

  return (
    <Virtualizer
      className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
      config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
    >
      <File<FileCommentAnnotationGroup>
        file={{
          name: memory.target.path,
          contents,
          cacheKey: `memory:${memory.target.blobOid}`,
        }}
        options={{
          disableFileHeader: true,
          enableGutterUtility: !hasOpenCommentForm,
          enableLineSelection: !hasOpenCommentForm,
          onGutterUtilityClick: setSelectedRange,
          onLineSelectionChange: setSelectedRange,
          onLineSelectionEnd: (range) => {
            setSelectedRange(range);
            if (range) beginComment(range);
          },
          overflow: wordWrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(resolvedTheme),
          preferredHighlighter: PREFERRED_HIGHLIGHTER,
          themeType: resolvedTheme,
          unsafeCSS: MEMORY_SURFACE_UNSAFE_CSS,
        }}
        selectedLines={selectedRange}
        lineAnnotations={lineAnnotations}
        renderAnnotation={(annotation) => (
          <div className="py-1">
            {annotation.metadata.entries.map((entry) => (
              <DiffCommentAnnotation
                key={entry.id}
                kind={entry.kind}
                rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                text={entry.text}
                onCancel={() => removeEntry(entry.id)}
                onComment={(text) => submitEntry(entry.id, text)}
                onDelete={() => removeEntry(entry.id)}
              />
            ))}
          </div>
        )}
        className="min-h-full"
      />
    </Virtualizer>
  );
}
