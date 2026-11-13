import type { AssetResource } from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import {
  binaryPreviewKind,
  isWorkspaceAudioPreviewPath,
  isWorkspaceFontPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
  officePreviewKind,
} from "@t3tools/shared/filePreview";

/** How a viewer reads the file: shown as its type, or whole as a download (too big, or not text). */
export type FileAssetUse = "show" | "download";

/**
 * The asset a viewer loads. A Projects tab has no thread, so the server signs its file for the
 * folder alone.
 */
export function fileAssetResource(
  target: { readonly cwd: string; readonly path: string },
  use: FileAssetUse,
) {
  return {
    _tag: "draft-workspace-file",
    cwd: target.cwd,
    path: target.path,
    ...(use === "download" ? { disposition: "attachment" } : {}),
  } as const satisfies AssetResource;
}

/** A text file's rendered form, which its tab's header switches the editor for. */
export type RenderedForm = "table" | "mermaid" | "html";

/**
 * How a file tab shows a file, from its path alone, so a file that is not text never opens a
 * document. The types are the thread's file panel's (`FilePreviewPanel`). A `document` is an
 * Office file, a notebook, a font, an archive or a database.
 */
export type FileView =
  | { readonly kind: "video" | "audio" | "image" | "pdf" | "document" }
  | { readonly kind: "text"; readonly rendered: RenderedForm | null };

export function fileView(path: string): FileView {
  if (isWorkspaceVideoPreviewPath(path)) return { kind: "video" };
  if (isWorkspaceAudioPreviewPath(path)) return { kind: "audio" };
  if (isWorkspaceImagePreviewPath(path)) return { kind: "image" };
  if (/\.pdf$/i.test(path)) return { kind: "pdf" };
  if (
    binaryPreviewKind({ name: path }) !== null ||
    officePreviewKind({ name: path }) !== null ||
    isWorkspaceFontPreviewPath(path)
  ) {
    return { kind: "document" };
  }
  const rendered = /\.(mmd|mermaid)$/i.test(path)
    ? "mermaid"
    : filePreviewDelimiter({ name: path }) !== null
      ? "table"
      : /\.html?$/i.test(path)
        ? "html"
        : null;
  return { kind: "text", rendered };
}
