import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

export interface FileCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  startLine: number;
  endLine: number;
  text: string;
}

export interface FileCommentAnnotationGroup {
  entries: FileCommentAnnotationEntry[];
}

export type FileCommentLineAnnotation = LineAnnotation<FileCommentAnnotationGroup>;

let fileCommentSequence = 0;

export function nextFileCommentId(): string {
  fileCommentSequence += 1;
  return `file-comment-${Date.now()}-${fileCommentSequence}`;
}

export function normalizeFileCommentRange(range: SelectedLineRange): {
  startLine: number;
  endLine: number;
} {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

export function formatFileCommentRange(
  startLine: number,
  endLine: number,
  resolve: MessageResolver = m,
): string {
  return startLine === endLine
    ? `L${startLine}`
    : resolve(msg("L{start} to L{end}", { start: String(startLine), end: String(endLine) }));
}
